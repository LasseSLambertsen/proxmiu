// Provider/agent responses are fixtures; no paid provider or real Proxmox host is contacted.
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
    const settings = { configured: true, provider: 'openrouter', model: 'openai/fixture-model' }
    let inventoryAvailable = true
    let expireNext = false
    let holdPreview
    let holdPreviewNext = false
    let holdChat
    let holdChatNext = false
    let failApply = true
    let previewCount = 0
    const sends = []
    const writes = []
    const before = { cores: 2, sockets: 2, memoryMiB: 2048, onboot: false, digest: 'abcdef', status: 'stopped', pending: false, editable: true }
    const target = { clusterId: 'lab', node: 'pve', type: 'qemu', vmid: 100, name: 'Fixture database' }
    const context = { capturedAt: new Date().toISOString(), type: 'qemu', status: 'stopped', allocation: { cores: 2, sockets: 2, memoryMiB: 2048, onboot: false }, editable: true, history: { timeframe: 'day', samples: 24, cpuSamples: 24, cpuMean: .2, cpuPeak: .4, memorySamples: 24, memoryMeanBytes: 1024, memoryPeakBytes: 2048 } }
    const proposal = { target, before, after: { cores: 4, memoryMiB: 4096, onboot: true, digest: 'abcdef' } }
    await page.route('**/api/**', async route => {
      const request = route.request()
      const url = new URL(request.url())
      let data = []
      if (url.pathname === '/api/health') data = { name: 'proxmiu-agent', version: 'fixture', authRequired: false }
      else if (url.pathname === '/api/auth/status') data = { authRequired: false, authenticated: true }
      else if (url.pathname === '/api/overview') data = { clusters: inventoryAvailable ? [{ id: 'lab', name: 'Fixture lab', ok: true, nodes: [{ id: 'node/pve', type: 'node', node: 'pve', status: 'online' }], guests: [100, 101].map(vmid => ({ id: `qemu/${vmid}`, type: 'qemu', node: 'pve', vmid, name: vmid === 100 ? 'Fixture database' : 'Fixture web', status: 'stopped', maxcpu: 4, maxmem: 2147483648 })) }] : [] }
      else if (url.pathname === '/api/guest-metadata') data = {}
      else if (url.pathname === '/api/ai/settings') data = settings
      else if (url.pathname === '/api/ai/setup-context') {
        previewCount++
        assert.equal(url.searchParams.get('id'), 'lab')
        const vmid = Number(url.searchParams.get('vmid'))
        if (holdPreviewNext) { holdPreviewNext = false; await new Promise(resolve => { holdPreview = resolve }) }
        const expiresAt = new Date(Date.now() + (expireNext ? 1000 : 600000)).toISOString()
        expireNext = false
        data = { previewId: `00000000-0000-4000-8000-${String(previewCount).padStart(12, '0')}`, expiresAt, provider: settings.provider, model: settings.model, target: { ...target, vmid, name: vmid === 100 ? target.name : 'Fixture web' }, context, before }
      } else if (url.pathname === '/api/ai/chat') {
        const body = request.postDataJSON()
        sends.push(body)
        assert.ok(body.messages.every(message => Object.keys(message).sort().join(',') === 'content,role'))
        if (body.setup) assert.deepEqual(Object.keys(body.setup).sort(), ['consent', 'previewId'])
        if (holdChatNext) { holdChatNext = false; await new Promise(resolve => { holdChat = resolve }) }
        data = { reply: '<script>window.lynxInjected=true</script>A measured move. Review this allocation.', ...(body.setup ? { proposal } : {}) }
      } else if (url.pathname.endsWith('/resource-settings') && request.method() === 'PUT') {
        writes.push({ url: url.pathname, body: request.postDataJSON() })
        if (failApply) return route.fulfill({ status: 409, json: { error: 'Configuration changed. Refresh the preview.' } })
        data = { ...before, ...proposal.after, digest: 'fedcba' }
      }
      await route.fulfill({ json: data })
    })
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.getByRole('button', { name: 'Chat with Lynx', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Chat with Lynx' })
    const draft = dialog.getByRole('textbox', { name: 'Message Lynx' })
    await draft.fill('Help me with my setup')
    await draft.press('Enter')
    await dialog.getByText(/A measured move/).waitFor()
    assert.deepEqual(Object.keys(sends[0]), ['messages'])
    assert.equal(previewCount, 0, 'Opening chat never reads selected-guest configuration automatically')
    await dialog.locator('summary').filter({ hasText: 'Help with my setup' }).click()
    const selection = dialog.getByRole('combobox', { name: 'Guest to inspect' })
    assert.equal(await selection.inputValue(), '', 'Guest selection is explicit')
    await selection.selectOption('lab/qemu/100/pve')
    assert.equal(await dialog.locator('[data-chat-message]').count(), 0, 'Selecting scope clears old conversation')
    await dialog.getByRole('button', { name: 'Preview setup', exact: true }).click()
    await dialog.getByRole('region', { name: 'Setup preview' }).waitFor()
    const consent = dialog.getByRole('checkbox', { name: 'Share this setup snapshot' })
    assert.equal(await consent.isChecked(), false)
    await dialog.getByText('Inspect exact shared context', { exact: true }).click()
    const shown = JSON.parse(await dialog.locator('[aria-label="Exact setup context"]').textContent())
    assert.deepEqual(shown, context)
    assert.doesNotMatch(JSON.stringify(shown), /Fixture database|lab|pve|abcdef/)
    await draft.fill('What should I inspect first?')
    await draft.press('Enter')
    await page.waitForFunction(() => document.querySelectorAll('[data-chat-message="assistant"]').length === 1)
    assert.deepEqual(Object.keys(sends.at(-1)), ['messages'], 'Preview without consent stays local')
    await consent.check()
    await draft.fill('Set 4 cores and 4096 MiB with boot enabled')
    await draft.press('Enter')
    const card = dialog.getByRole('region', { name: 'Proposed resource changes' })
    await card.waitFor()
    assert.equal(sends.at(-1).setup.consent, true)
    assert.deepEqual(Object.keys(sends.at(-1)), ['messages', 'setup'])
    assert.equal(writes.length, 0, 'Model proposal cannot write before user confirmation')
    assert.equal(await page.evaluate(() => window.lynxInjected), undefined)
    assert.match(await card.textContent(), /2 sockets/)
    assert.match(await card.textContent(), /Connection lab/, 'Standalone proposal identifies its original connection')
    await card.getByRole('button', { name: 'Review changes', exact: true }).click()
    assert.equal(writes.length, 0, 'Review itself does not apply')
    await card.getByRole('button', { name: 'Apply changes', exact: true }).click()
    await card.getByRole('alert').waitFor()
    assert.match(await card.textContent(), /Configuration changed/)
    assert.equal(await card.count(), 1, 'Failed apply retains exact proposal')
    failApply = false
    await card.getByRole('button', { name: 'Apply changes', exact: true }).click()
    await card.getByText(/The agent saved these settings/).waitFor()
    assert.deepEqual(writes, [0, 1].map(() => ({ url: '/api/clusters/lab/guests/pve/qemu/100/resource-settings', body: proposal.after })))
    assert.equal(await card.getByRole('button', { name: 'Apply changes' }).count(), 0, 'Successful changes cannot be applied twice')
    assert.equal(await dialog.getByRole('region', { name: 'Setup preview' }).count(), 0, 'Successful write invalidates evidence')
    await dialog.getByRole('button', { name: 'Clear conversation' }).click()
    expireNext = true
    await dialog.getByRole('button', { name: 'Preview setup', exact: true }).click()
    await consent.waitFor()
    await consent.check()
    await dialog.getByText('This preview expired. Refresh it and review sharing consent again.', { exact: true }).waitFor()
    assert.equal(await consent.count(), 0, 'Expired snapshots require renewed consent')
    await dialog.getByRole('button', { name: 'Refresh setup preview' }).click()
    await consent.waitFor()
    assert.equal(await consent.isChecked(), false)
    await consent.check()
    holdChatNext = true
    await draft.fill('Old guest question')
    await draft.press('Enter')
    await dialog.locator('[aria-label="Lynx is replying"]').waitFor()
    await selection.selectOption('lab/qemu/101/pve')
    holdChat()
    await draft.fill('New guest draft')
    assert.equal(await card.count(), 0)
    assert.equal(await dialog.locator('[data-chat-message]').count(), 0, 'Late old guest response cannot restore transcript/actions')
    holdPreviewNext = true
    await dialog.getByRole('button', { name: 'Preview setup', exact: true }).click()
    await page.waitForResponse(response => response.url().includes('/api/overview'), { timeout: 10000 })
    await selection.selectOption('lab/qemu/100/pve')
    const latePreview = page.waitForResponse(response => response.url().includes('/api/ai/setup-context'))
    holdPreview()
    await latePreview
    assert.equal(await dialog.getByRole('region', { name: 'Setup preview' }).count(), 0, 'Late previews cannot replace selected source')
    await dialog.getByRole('button', { name: 'Preview setup', exact: true }).click()
    await consent.waitFor()
    await consent.check()
    await draft.fill('Plan this allocation')
    await draft.press('Enter')
    await card.waitFor()
    await consent.uncheck()
    assert.equal(await card.count(), 0, 'Withdrawing consent removes unapplied actions')
    await consent.check()
    await draft.fill('Plan it again')
    await draft.press('Enter')
    await card.waitFor()
    await page.evaluate(() => window.dispatchEvent(new Event('proxmiu:ai-settings-changed')))
    assert.equal(await card.count(), 0, 'Replacing key with same provider/model clears actions and evidence')
    assert.equal(await dialog.locator('[data-chat-message]').count(), 0)
    assert.equal(await dialog.getByRole('region', { name: 'Setup preview' }).count(), 0)
    await dialog.getByRole('button', { name: 'Preview setup', exact: true }).click()
    await consent.waitFor()
    await consent.check()
    await draft.fill('Desktop fixture question')
    await draft.press('Enter')
    await card.waitFor()
    await card.getByRole('button', { name: 'Review changes' }).click()
    await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)) })
    const screenshots = process.env.SCREENSHOT_DIR || '/tmp/lynx-setup-fixtures'
    fs.mkdirSync(screenshots, { recursive: true })
    await page.screenshot({ path: path.join(screenshots, 'desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await card.getByRole('button', { name: 'Apply changes' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(screenshots, 'mobile.png') })
    const box = await dialog.boundingBox()
    assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844, JSON.stringify(box))
    assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth), false)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    inventoryAvailable = false
    await page.waitForResponse(response => response.url().includes('/api/overview'), { timeout: 10000 })
    assert.equal(await selection.inputValue(), 'lab/qemu/100/pve', 'Temporary missing inventory retains selection')
    assert.match(await dialog.textContent(), /Inventory is unavailable for this selection/)
    assert.deepEqual(failures, [])
    console.log('PASS: setup selection, exact preview, consent, trusted proposal review/apply, failed/stale preservation, successful invalidation, expiry/reconsent, scope and settings changes, late response guards, offline retention, plaintext and 390px layout (fixtures)')
  } finally { if (browser) await browser.close(); server.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
