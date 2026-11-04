// Local provider/agent fixtures only. No real provisioning or paid API calls.
const { chromium } = require('playwright')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const root = path.resolve(__dirname, '../../dist/web')
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    let file = path.resolve(root, `.${pathname}`)
    if (!file.startsWith(`${root}/`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, 'index.html')
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(response)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.setDefaultTimeout(5000)
    const failures = []
    page.on('pageerror', error => failures.push(error.message))
    const template = { id: 'docker-host', name: 'Docker host', description: 'Fixture template', kind: 'lxc', builtin: true, icon: 'box', tags: [], os: ['debian-12'], resources: { cores: 2, memory: 2048, disk: 16, swap: 512 }, options: [{ key: 'ACCESS_TOKEN', label: 'Fixture access token', type: 'secret' }] }
    const createDraft = { templateId: template.id, templateName: template.name, kind: 'lxc', cores: 4, memoryMiB: 8192, diskGiB: 64 }
    const sends = [], writes = []
    let holdChat, holdNext = false, missingTemplate = false
    let holdCatalogNext = false, releaseCatalog, catalogReadStarted, catalogReads = 0
    let holdConnectionsNext = false, releaseConnections, connectionReadStarted
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url())
      let data = []
      if (url.pathname === '/api/health') data = { name: 'proxmiu-agent', version: 'fixture', authRequired: false }
      else if (url.pathname === '/api/auth/status') data = { authRequired: false, authenticated: true }
      else if (url.pathname === '/api/ai/settings') data = { configured: true, provider: 'openrouter', model: 'fixture-model' }
      else if (url.pathname === '/api/overview') data = { clusters: [{ id: 'lab', name: 'Fixture lab', ok: true, nodes: [{ type: 'node', node: 'pve', status: 'online' }], guests: [] }] }
      else if (url.pathname === '/api/clusters') {
        if (holdConnectionsNext) {
          holdConnectionsNext = false
          connectionReadStarted()
          await new Promise(resolve => { releaseConnections = resolve })
        }
        data = [{ id: 'lab', name: 'Fixture lab', host: 'fixture.invalid' }]
      }
      else if (url.pathname === '/api/templates') {
        catalogReads++
        if (holdCatalogNext) {
          holdCatalogNext = false
          catalogReadStarted()
          await new Promise(resolve => { releaseCatalog = resolve })
        }
        data = missingTemplate ? [] : [template]
      }
      else if (url.pathname === '/api/guest-metadata') data = {}
      else if (url.pathname.endsWith('/create-options')) data = { node: 'pve', nodes: ['pve', 'pve2'], nextid: 110, storages: { rootdir: [{ storage: 'local-lvm', type: 'lvmthin', avail: 100000000000 }], images: [], vztmpl: [] }, bridges: ['vmbr0', 'vmbr1'], osTemplates: { downloaded: [], available: ['debian-12-standard.tar.zst'] }, vmTemplates: [] }
      else if (url.pathname === '/api/ai/chat') {
        const body = request.postDataJSON()
        sends.push(body)
        assert.deepEqual(Object.keys(body).sort(), body.createDraft ? ['createDraft', 'messages'] : ['messages'])
        if (holdNext) { holdNext = false; await new Promise(resolve => { holdChat = resolve }) }
        data = { reply: '<script>window.createInjected=true</script>A sound starting point.', ...(body.createDraft ? { createDraft } : {}) }
      } else if (url.pathname === '/api/provision') {
        writes.push(request.postDataJSON())
        return route.fulfill({ status: 502, json: { error: 'Fixture provisioning unavailable; draft preserved.' } })
      }
      await route.fulfill({ json: data })
    })
    const base = `http://127.0.0.1:${server.address().port}`
    await page.goto(base)
    const wake = () => page.getByRole('button', { name: 'Chat with Lynx', exact: true })
    await wake().click()
    const dialog = page.getByRole('dialog', { name: 'Chat with Lynx' })
    const planning = dialog.getByRole('checkbox', { name: 'Plan a new guest' })
    await planning.check()
    const message = dialog.getByRole('textbox', { name: 'Message Lynx' })
    await message.fill('Plan a Docker host: 4 cores, 8192 MiB, 64 GiB disk')
    await message.press('Enter')
    const card = dialog.getByRole('region', { name: 'New guest draft' })
    await card.waitFor()
    assert.equal(sends[0].createDraft, true)
    assert.equal(writes.length, 0)
    assert.match(await card.textContent(), /8192 MiB/)
    assert.equal(await page.evaluate(() => window.createInjected), undefined)
    await card.getByRole('button', { name: 'Review in Create', exact: true }).click()
    await page.waitForURL('**/create/docker-host')
    await page.getByRole('region', { name: 'Draft from Lynx' }).waitFor()
    assert.equal(await page.getByLabel('vCPU', { exact: true }).inputValue(), '4')
    assert.equal(await page.getByLabel('Memory (GiB)', { exact: true }).inputValue(), '8')
    assert.equal(await page.getByLabel('Disk (GiB)', { exact: true }).inputValue(), '64')
    assert.equal(await page.getByLabel('Hostname', { exact: true }).inputValue(), 'docker-host')
    assert.equal(await page.getByLabel(/^Node/).inputValue(), 'pve')
    assert.equal(await page.getByLabel(/^Bridge/).inputValue(), 'vmbr0')
    assert.equal(await page.getByLabel('Fixture access token', { exact: true }).inputValue(), '')
    assert.equal(writes.length, 0, 'Review navigation never provisions')
    const create = page.getByRole('button', { name: 'Create container', exact: true })
    assert.ok(await create.isDisabled())
    await page.locator('form').evaluate(form => form.requestSubmit())
    assert.equal(writes.length, 0, 'Programmatic form submission still requires review')
    const review = page.getByRole('checkbox', { name: 'I reviewed placement, resources, networking and access' })
    await review.check()
    await page.getByRole('switch', { name: 'Start at boot', exact: true }).click()
    assert.ok(await create.isDisabled(), 'Changing boot behavior requires renewed review')
    await review.check()
    await page.getByLabel('Hostname', { exact: true }).fill('reviewed-host')
    assert.ok(await create.isDisabled(), 'Editing the form requires renewed review')
    await review.check()
    await create.click()
    await page.getByText('Fixture provisioning unavailable; draft preserved.').waitFor()
    assert.equal(writes.length, 1)
    assert.equal(writes[0].hostname, 'reviewed-host')
    assert.equal(writes[0].cores, 4)
    assert.equal(writes[0].memory, 8192)
    assert.equal(writes[0].disk, 64)
    assert.equal(writes[0].clusterId, 'lab')
    assert.equal(writes[0].node, 'pve')
    assert.equal(writes[0].bridge, 'vmbr0')
    assert.equal(writes[0].options.ACCESS_TOKEN, '')
    assert.equal(writes[0].createDraft, undefined)
    assert.equal(await page.getByLabel('Hostname', { exact: true }).inputValue(), 'reviewed-host')

    // A second handoff must explicitly replace any open creation form.
    await wake().click()
    await card.getByRole('button', { name: 'Review in Create', exact: true }).click()
    await dialog.getByText(/unsaved fields will be cleared/).waitFor()
    assert.equal(await page.getByLabel('Hostname', { exact: true }).inputValue(), 'reviewed-host')
    await dialog.getByRole('button', { name: 'Replace form and review', exact: true }).click()
    await page.waitForFunction(() => [...document.querySelectorAll('label')].find(label => label.textContent.trim() === 'Hostname')?.querySelector('input')?.value === 'docker-host')
    await page.getByRole('region', { name: 'Draft from Lynx' }).waitFor()
    assert.equal(await page.getByLabel('Hostname', { exact: true }).inputValue(), 'docker-host')
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: `/tmp/lynx-create-form-${width}.png`, fullPage: true })
    }
    assert.doesNotMatch(await page.evaluate(() => JSON.stringify(history.state)), /memoryMiB|diskGiB|templateName/, 'Draft data stays out of browser history')
    await page.goBack()
    await page.waitForFunction(() => [...document.querySelectorAll('label')].find(label => label.textContent.trim() === 'vCPU')?.querySelector('input')?.value === '2')
    assert.equal(await page.getByRole('region', { name: 'Draft from Lynx' }).count(), 0, 'Back navigation cannot restore a consumed draft')
    await page.reload()
    assert.equal(await page.getByRole('region', { name: 'Draft from Lynx' }).count(), 0, 'Reload cannot revive the memory-only consumed draft')
    assert.equal(await page.getByLabel('vCPU', { exact: true }).inputValue(), '2', 'Ordinary creation retains template defaults')
    await create.waitFor({ state: 'visible' })
    assert.equal(await page.getByRole('checkbox', { name: 'I reviewed placement, resources, networking and access' }).count(), 0)
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Create container' && !button.disabled))
    assert.ok(await create.isEnabled(), 'Ordinary manual creation has no AI acknowledgment gate')
    await page.setViewportSize({ width: 1440, height: 1000 })
    await wake().click()
    await planning.check()
    holdNext = true
    await message.fill('Plan another host')
    await message.press('Enter')
    await page.waitForFunction(() => document.querySelector('[aria-label="Lynx is replying"]'))
    await planning.uncheck()
    holdChat()
    await page.waitForTimeout(100)
    assert.equal(await card.count(), 0, 'Late creation proposals cannot return after changing mode')
    assert.equal(await dialog.locator('[data-chat-message]').count(), 0)
    await planning.check()
    await message.fill('Plan a new Docker host')
    await message.press('Enter')
    await card.waitFor()
    holdCatalogNext = true
    const entered = new Promise(resolve => { catalogReadStarted = resolve })
    await card.getByRole('button', { name: 'Review in Create', exact: true }).click()
    const readsBefore = catalogReads
    await dialog.getByRole('button', { name: 'Replace form and review', exact: true }).evaluate(button => { button.click(); button.click() })
    await entered
    assert.equal(catalogReads, readsBefore + 1, 'Duplicate review clicks do not duplicate the handoff')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    const finished = page.waitForResponse(response => new URL(response.url()).pathname === '/api/templates')
    releaseCatalog()
    await (await finished).finished()
    await page.evaluate(() => new Promise(requestAnimationFrame))
    assert.equal(await page.getByRole('region', { name: 'Draft from Lynx' }).count(), 0, 'Dismissing review prevents late navigation or handoff')
    assert.equal(await page.getByLabel('vCPU', { exact: true }).inputValue(), '2')
    await wake().click()
    holdCatalogNext = true
    const backEntered = new Promise(resolve => { catalogReadStarted = resolve })
    await card.getByRole('button', { name: 'Review in Create', exact: true }).click()
    await dialog.getByRole('button', { name: 'Replace form and review', exact: true }).click()
    await backEntered
    await page.goBack()
    const afterBack = page.url()
    assert.ok(!new URL(afterBack).pathname.startsWith('/create/'))
    const backFinished = page.waitForResponse(response => new URL(response.url()).pathname === '/api/templates')
    releaseCatalog()
    await (await backFinished).finished()
    await page.evaluate(() => new Promise(requestAnimationFrame))
    assert.equal(page.url(), afterBack, 'A late review response must not override browser Back')
    await page.keyboard.press('Escape')
    await page.getByRole('navigation').getByRole('link', { name: 'Create', exact: true }).click()
    assert.equal(await page.getByText(/Lynx draft expired or no longer matches/).count(), 0, 'Navigation cancellation must not leave a staged handoff')
    await page.getByRole('button', { name: /Docker host/ }).click()
    await page.getByLabel('vCPU', { exact: true }).waitFor()
    assert.equal(await page.getByRole('region', { name: 'Draft from Lynx' }).count(), 0)
    await wake().click()
    missingTemplate = true
    await card.getByRole('button', { name: 'Review in Create', exact: true }).click()
    await dialog.getByRole('button', { name: 'Replace form and review', exact: true }).click()
    await dialog.getByText(/built-in template is unavailable/).waitFor()
    assert.equal(await page.getByLabel('vCPU', { exact: true }).inputValue(), '2', 'Unavailable template cannot overwrite the open form')
    // Abandon a staged draft while Create is waiting for connections, then open the template manually.
    missingTemplate = false
    await page.goto(base)
    await wake().click()
    await planning.check()
    await message.fill('Plan a Docker host')
    await message.press('Enter')
    await card.waitFor()
    holdConnectionsNext = true
    const connectionEntered = new Promise(resolve => { connectionReadStarted = resolve })
    await card.getByRole('button', { name: 'Review in Create', exact: true }).click()
    await connectionEntered
    await page.goBack()
    await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor()
    const connectionsFinished = page.waitForResponse(response => new URL(response.url()).pathname === '/api/clusters')
    releaseConnections()
    await (await connectionsFinished).finished()
    await page.getByRole('navigation').getByRole('link', { name: 'Templates', exact: true }).click()
    await page.getByRole('button', { name: 'Use', exact: true }).click()
    await page.getByLabel('vCPU', { exact: true }).waitFor()
    assert.equal(await page.getByRole('region', { name: 'Draft from Lynx' }).count(), 0, 'Back while form data loads must discard the queued handoff')
    assert.equal(await page.getByLabel('vCPU', { exact: true }).inputValue(), '2')
    assert.equal(writes.length, 1)
    assert.deepEqual(failures, [])
    console.log('PASS: explicit creation mode, bounded draft review, exact resource handoff, untouched placement/network/secrets, review gate and explicit submit, failed provisioning preservation, deliberate replacement, one-use reload, mode/late-response reset, duplicate review/close guards, unavailable template rejection, plaintext and desktop/390px layout (fixtures)')
  } finally {
    if (browser) await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
