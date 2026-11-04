// Browser-only local API fixtures; no guest creation or external services.
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
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(response)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.setDefaultTimeout(5000)
    const errors = [], writes = [], optionsNodes = [], sourceFailures = []
    page.on('pageerror', error => errors.push(error.message))
    const template = { id: 'cloud-fixture', name: 'Cloud fixture', kind: 'qemu', description: 'Local fixture', icon: 'box', builtin: false, user: 'root', script: '', notes: '', nesting: false, privileged: false, tags: [], os: ['debian-12'], resources: { cores: 3, memory: 1024, disk: 16, swap: 512 }, options: [] }
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url())
      let data = []
      if (url.pathname === '/api/health') data = { name: 'proxmiu-agent', version: 'fixture', authRequired: false }
      else if (url.pathname === '/api/auth/status') data = { authRequired: false, authenticated: true }
      else if (url.pathname === '/api/ai/settings') data = { configured: false }
      else if (url.pathname === '/api/overview') data = { clusters: [{ id: 'fixture', name: 'Fixture', ok: true, nodes: [{ type: 'node', node: 'pve1', status: 'online' }, { type: 'node', node: 'pve2', status: 'online' }], guests: [] }] }
      else if (url.pathname === '/api/guest-metadata') data = {}
      else if (url.pathname === '/api/templates') data = [template]
      else if (url.pathname === '/api/clusters') data = [{ id: 'fixture', name: 'Fixture', host: 'fixture.invalid' }, { id: 'second', name: 'Second', host: 'second.invalid' }, { id: 'empty', name: 'Empty', host: 'empty.invalid' }]
      else if (url.pathname.endsWith('/create-options')) {
        const node = url.searchParams.get('node') || 'pve2'
        optionsNodes.push(node)
        const catalog = url.pathname.includes('/empty/') ? [] : url.pathname.includes('/second/') ? [{ vmid: 902, name: 'Second cloud', node: 'pve2' }] : [{ vmid: 900, name: 'Debian cloud', node: 'pve1' }, { vmid: 901, name: 'Ubuntu cloud', node: 'pve2' }]
        data = { node, nodes: ['pve1', 'pve2'], nextid: 401, storages: { rootdir: [{ storage: 'containers', type: 'lvmthin', avail: 100000000000 }], images: [{ storage: node === 'pve1' ? 'source-storage' : 'other-storage', type: 'lvmthin', avail: 100000000000 }], vztmpl: [] }, bridges: [node === 'pve1' ? 'vmbr-source' : 'vmbr-other'], osTemplates: { downloaded: [], available: [] }, vmTemplates: catalog }
      } else if (url.pathname === '/api/provision') {
        writes.push(request.postDataJSON())
        return route.fulfill({ status: 502, json: { error: 'Captured local request.' } })
      }
      await route.fulfill({ json: data })
    })
    await page.goto(`http://127.0.0.1:${server.address().port}/create/cloud-fixture`)
    const source = page.getByLabel(/^Source template/), node = page.getByLabel(/^Node/)
    // React source/node synchronization can trigger a second options query. Observe
    // the coherent form after those effects settle, not just an attached select.
    const waitForPlacement = (sourceVmid, expectedNode, storage, bridge) => page.waitForFunction(expected => {
      const fieldValue = name => [...document.querySelectorAll('label')].find(label => label.querySelector('span')?.textContent === name)?.querySelector('select')?.value
      return Object.entries(expected).every(([name, value]) => fieldValue(name) === value) && document.querySelector('button[type="submit"]')?.disabled === false
    }, { 'Source template': sourceVmid, Node: expectedNode, Storage: storage, Bridge: bridge }, { timeout: 5000 })
    await source.waitFor().catch(async error => { throw new Error(`${error.message}\nPage: ${await page.locator('body').innerText()}\nErrors: ${errors.join('; ')}`) })
    await waitForPlacement('900', 'pve1', 'source-storage', 'vmbr-source')
    assert.equal(await source.inputValue(), '900')
    assert.equal(await node.inputValue(), 'pve1', 'default QEMU source must visibly select its actual node')
    await page.waitForFunction(() => [...document.querySelectorAll('select')].some(select => select.value === 'source-storage'))
    assert.ok(optionsNodes.includes('pve1'), 'source node storage/bridge options must refresh')
    assert.equal(await page.getByLabel(/^Storage/).inputValue(), 'source-storage')
    assert.equal(await page.getByLabel(/^Bridge/).inputValue(), 'vmbr-source')
    await page.getByText('Minimum size. Larger template disks are kept; smaller boot disks grow to this size.', { exact: true }).waitFor()
    assert.equal(writes.length, 0)
    const create = page.getByRole('button', { name: 'Create VM', exact: true })
    // Preserve a valid chosen source while returning from editable LXC placement.
    await page.getByRole('button', { name: /Container \(LXC\)/ }).click()
    await node.selectOption('pve2')
    await page.waitForFunction(() => [...document.querySelectorAll('select')].some(select => select.value === 'vmbr-other'))
    await page.getByRole('button', { name: /Virtual machine/ }).click()
    await waitForPlacement('900', 'pve1', 'source-storage', 'vmbr-source')
    if (await source.inputValue() !== '900') sourceFailures.push('returning to QEMU lost still-valid source 900')
    if (await node.inputValue() !== 'pve1') sourceFailures.push('QEMU → LXC → pve2 → QEMU left source 900 on locked node pve2')
    // Recover explicitly so the next regression is checked independently.
    await source.selectOption('901')
    await source.selectOption('900')
    const connection = page.getByLabel(/^Connection/)
    await connection.selectOption('second')
    await waitForPlacement('902', 'pve2', 'other-storage', 'vmbr-other')
    if (await source.inputValue() !== '902') sourceFailures.push('changing connection retained stale source instead of selecting 902')
    if (await node.inputValue() !== 'pve2') sourceFailures.push('changing connection failed to show source 902 node pve2')
    const secondSubmitted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/provision')
    await create.click()
    await secondSubmitted
    await page.getByText('Captured local request.', { exact: true }).waitFor()
    if (writes.length !== 1 || writes[0].sourceVmid !== 902 || writes[0].clusterId !== 'second' || writes[0].node !== 'pve2') sourceFailures.push('new connection submitted stale source instead of source 902 on pve2')
    await source.selectOption('902')
    await connection.selectOption('empty')
    await page.getByText(/No VM templates found/).waitFor()
    if (!await create.isDisabled()) sourceFailures.push('empty source catalog allowed stale source submission')
    const beforeEmptySubmit = writes.length
    await page.locator('form').evaluate(form => form.requestSubmit())
    await page.getByRole('alert').filter({ hasText: 'Select an available cloud-init template' }).waitFor()
    if (writes.length !== beforeEmptySubmit) sourceFailures.push('programmatic submit sent a stale source from an empty catalog')
    await connection.selectOption('fixture')
    await source.locator('option[value="900"]').waitFor({ state: 'attached' })
    await source.selectOption('900')
    assert.deepEqual(sourceFailures, [], 'source placement transitions must stay coherent')
    await source.selectOption('901')
    await waitForPlacement('901', 'pve2', 'other-storage', 'vmbr-other')
    assert.equal(await node.inputValue(), 'pve2')
    assert.equal(await page.getByLabel(/^Bridge/).inputValue(), 'vmbr-other')
    assert.equal(writes.length, 1, 'source placement changes must not provision automatically')
    const finalSubmitted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/provision')
    await create.click()
    await finalSubmitted
    await page.getByText('Captured local request.', { exact: true }).waitFor()
    assert.equal(writes.length, 2)
    assert.equal(writes[1].node, 'pve2'); assert.equal(writes[1].sourceVmid, 901)
    assert.equal(writes[1].storage, 'other-storage'); assert.equal(writes[1].bridge, 'vmbr-other')
    assert.deepEqual(errors, [])
    console.log('PASS QEMU source/node sync across mode/connection/empty catalogs, node options, disk minimum help and explicit request')
  } finally {
    if (browser) await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
