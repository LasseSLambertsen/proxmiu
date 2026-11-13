// Synthetic local APIs only; no actual guest, SDN/IPAM or provider access.
const { chromium } = require('playwright')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
;(async () => {
  const root = path.resolve('dist/web')
  const server = http.createServer((req, res) => {
    let file = path.join(root, new URL(req.url, 'http://localhost').pathname)
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html')
    res.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' })
    const page = await browser.newPage({ viewport: { width: 1440, height: 844 } })
    page.setDefaultTimeout(8000)
    const errors = [], unexpected = [], reviews = [], writes = [], plans = new Map()
    page.on('pageerror', error => errors.push(error.message))
    const guest = { id: 'qemu/110', type: 'qemu', vmid: 110, node: 'pve1', name: 'link-lab', status: 'stopped', maxcpu: 2, maxmem: 2 * 1024 ** 3 }
    let nativeName = 'link-lab'
    let nic = { nic: 'net0', mac: '02:ab:cd:11:22:33', bridge: 'vmbr0', tag: 20, model: 'virtio', ifname: null, linkDown: false, canEdit: true }
    let readFailure = false, writeFailure = 0, expired = false, reads = 0, insightReads = 0
    await page.route('**/api/**', async route => {
      const req = route.request(), url = new URL(req.url()), method = req.method()
      let data
      if (url.pathname === '/api/health') data = { name: 'proxmiu-agent', version: 'fixture', authRequired: false }
      else if (url.pathname === '/api/auth/status') data = { authRequired: false, authenticated: true }
      else if (url.pathname === '/api/overview') data = { clusters: [{ id: 'fixture', name: 'Fixture lab', host: '127.0.0.1', ok: true, nodes: [{ id: 'node/pve1', node: 'pve1', type: 'node', status: 'online' }], guests: [guest] }] }
      else if (url.pathname === '/api/templates' || url.pathname === '/api/jobs') data = []
      else if (url.pathname === '/api/guest-metadata' || url.pathname.endsWith('/ips')) data = {}
      else if (url.pathname.endsWith('/ai/settings')) data = { configured: false, provider: 'openai', model: 'fixture' }
      else if (url.pathname.endsWith('/task-history')) data = { tasks: [], next: 0, hasMore: false, warnings: [] }
      else if (url.pathname.endsWith('/insights')) { insightReads++; data = { config: { networks: [], disks: [] }, metrics: [] } }
      else if (url.pathname.endsWith('/notes')) data = { notes: '', digest: 'abc123' }
      else if (url.pathname.endsWith('/resource-settings')) data = { cores: 2, sockets: 1, memoryMiB: 2048, onboot: false, digest: 'abc123', status: 'stopped', pending: false, editable: true }
      else if (url.pathname.endsWith('/operations')) data = { snapshots: [], storages: [], targets: [], errors: [] }
      else if (url.pathname.endsWith('/nic-links') && method === 'GET') {
        reads++
        if (readFailure) return route.fulfill({ status: 502, json: { error: 'Interface metadata unavailable.' } })
        data = { name: nativeName, ready: guest.status === 'stopped', reason: guest.status === 'stopped' ? undefined : 'Shut down this guest before reviewing link state.', errors: [], interfaces: [nic, { nic: 'net1', mac: null, bridge: null, tag: null, model: null, ifname: null, linkDown: null, canEdit: false, reason: 'Unsupported native NIC options.' }] }
      } else if (url.pathname.endsWith('/nic-link-review') && method === 'POST') {
        const input = req.postDataJSON(); reviews.push(input)
        data = { ...nic, ...input, reviewId: 'review-' + reviews.length, name: nativeName, node: 'pve1', vmid: 110, type: guest.type, currentLinkDown: nic.linkDown, expiresAt: Date.now() + (expired ? -1000 : 300000) }
        plans.set(data.reviewId, data)
      } else if (url.pathname.endsWith('/nic-link') && method === 'POST') {
        const input = req.postDataJSON(); writes.push(input)
        if (writeFailure === 409) return route.fulfill({ status: 409, json: { error: 'NIC configuration changed. No update was submitted. Refresh and review again.' } })
        nic = { ...nic, linkDown: plans.get(input.reviewId).linkDown }
        if (writeFailure) return route.fulfill({ status: writeFailure, json: { error: 'Link change outcome is unconfirmed. Inspect current NIC configuration and pending changes.' } })
        data = { verified: true, name: nativeName, node: 'pve1', type: guest.type, vmid: 110, interface: nic, observedAt: Date.now() }
      } else { unexpected.push(method + ' ' + url.pathname); return route.fulfill({ status: 404, json: { error: 'Missing fixture' } }) }
      await route.fulfill({ json: data })
    })
    const base = `http://127.0.0.1:${server.address().port}`
    await page.goto(base + '/guests/fixture/pve1/qemu/110', { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Network link state', exact: true }).waitFor()
    assert.equal(reads, 0)
    const card = page.getByRole('region', { name: 'Network link state', exact: true })
    await card.getByRole('button', { name: 'Inspect network links', exact: true }).click()
    await card.getByText('Connected on next start', { exact: true }).waitFor()
    assert.ok(await card.getByRole('button', { name: 'Edit net1 link', exact: true }).isDisabled())
    const open = async () => {
      await card.getByRole('button', { name: 'Edit net0 link', exact: true }).click()
      const d = page.getByRole('dialog')
      await d.getByLabel('Configured connection', { exact: true }).waitFor()
      return d
    }
    const review = async d => {
      await d.getByLabel('Configured connection', { exact: true }).selectOption('disconnected')
      await d.getByRole('button', { name: 'Review link state', exact: true }).click()
      await d.getByLabel('Type link-lab to confirm', { exact: true }).waitFor()
    }
    let d = await open()
    assert.ok(await d.getByRole('button', { name: 'Review link state', exact: true }).isDisabled())
    await review(d)
    assert.deepEqual(reviews[0], { nic: 'net0', linkDown: true })
    assert.match(await d.textContent(), /next start/i)
    const save = d.getByRole('button', { name: 'Save link state', exact: true })
    assert.ok(await save.isDisabled())
    await d.getByLabel('Type link-lab to confirm', { exact: true }).fill('110')
    assert.ok(await save.isDisabled())
    for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 })
      await page.evaluate(t => document.documentElement.classList.toggle('dark', t === 'dark'), theme)
      assert.equal(await d.evaluate(el => el.scrollWidth > el.clientWidth), false)
      await save.scrollIntoViewIfNeeded(); assert.ok((await save.boundingBox()).y < 844)
      if (process.env.SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true })
        await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `nic-link-${theme}-${width}.png`), fullPage: true })
      }
    }
    await d.getByLabel('Type link-lab to confirm', { exact: true }).fill('link-lab')
    await save.evaluate(el => { el.click(); el.click() })
    await d.getByText('Link state saved and verified', { exact: true }).waitFor()
    assert.deepEqual(writes, [{ reviewId: 'review-1', confirm: 'link-lab' }])
    assert.equal(await d.getByRole('button', { name: 'Load task log' }).count(), 0)
    await d.getByRole('button', { name: 'Close', exact: true }).click()
    nic = { ...nic, linkDown: false }
    await card.getByRole('button', { name: 'Refresh network links', exact: true }).click()
    d = await open(); await review(d)
    writeFailure = 409
    await d.getByLabel('Type link-lab to confirm', { exact: true }).fill('link-lab')
    await d.getByRole('button', { name: 'Save link state', exact: true }).click()
    await d.getByText(/NIC configuration changed. No update was submitted/).waitFor()
    assert.equal(await d.getByLabel('Configured connection', { exact: true }).inputValue(), 'disconnected')
    assert.ok(await d.getByRole('button', { name: 'Review link state', exact: true }).isDisabled())
    await d.getByRole('button', { name: 'Refresh current interface', exact: true }).click()
    await review(d)
    writeFailure = 502; readFailure = true
    const before = insightReads
    await d.getByLabel('Type link-lab to confirm', { exact: true }).fill('link-lab')
    await d.getByRole('button', { name: 'Save link state', exact: true }).click()
    await d.getByText(/Link change outcome is unconfirmed/).waitFor()
    assert.equal(await d.getByRole('button', { name: 'Save link state', exact: true }).count(), 0)
    assert.equal(await d.getByRole('button', { name: 'Review link state', exact: true }).count(), 0)
    const deadline = Date.now() + 3000
    while (insightReads <= before && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
    assert.ok(insightReads > before, 'Possibly applied updates refresh related config independently of failed observations')
    readFailure = false
    await d.getByRole('button', { name: 'Refresh observed interface', exact: true }).click()
    await d.getByText('Last observed: Disconnected on next start', { exact: true }).waitFor()
    readFailure = true
    await d.getByRole('button', { name: 'Refresh observed interface', exact: true }).click()
    await d.getByText(/Interface metadata unavailable\./).waitFor()
    await d.getByText('Last observed: Disconnected on next start', { exact: true }).waitFor()
    assert.equal(writes.length, 3)
    await d.getByRole('button', { name: 'Close', exact: true }).click()
    readFailure = false; writeFailure = 0; nic = { ...nic, linkDown: false }
    await card.getByRole('button', { name: 'Refresh network links', exact: true }).click()
    d = await open()
    nic = { ...nic, mac: '02:ab:cd:11:22:44' }
    await d.getByLabel('Configured connection', { exact: true }).selectOption('disconnected')
    await d.getByRole('button', { name: 'Review link state', exact: true }).click()
    await d.getByText(/original NIC identity no longer matches/).waitFor()
    assert.equal(await d.getByRole('button', { name: 'Save link state', exact: true }).count(), 0)
    await d.getByRole('button', { name: 'Cancel', exact: true }).click()
    await card.getByRole('button', { name: 'Refresh network links', exact: true }).click()
    d = await open(); expired = true
    await d.getByLabel('Configured connection', { exact: true }).selectOption('disconnected')
    await d.getByRole('button', { name: 'Review link state', exact: true }).click()
    await d.getByText(/review expired/i).waitFor()
    assert.ok(await d.getByRole('button', { name: 'Save link state', exact: true }).isDisabled())
    await page.evaluate(() => window.dispatchEvent(new Event('proxmiu-agent-change')))
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    assert.equal(writes.length, 3)
    guest.type = 'lxc'; guest.id = 'lxc/110'; expired = false
    nic = { ...nic, model: null, ifname: 'eth0', linkDown: false }
    await page.goto(base + '/guests/fixture/pve1/lxc/110', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Inspect network links', exact: true }).click()
    d = await open()
    await d.getByText('net0 · eth0', { exact: true }).waitFor()
    await review(d)
    await d.getByLabel('Type link-lab to confirm', { exact: true }).fill('link-lab')
    await d.getByRole('button', { name: 'Save link state', exact: true }).click()
    await d.getByText('Link state saved and verified', { exact: true }).waitFor()
    assert.equal(writes.length, 4)
    await d.getByRole('button', { name: 'Close', exact: true }).click()
    nic = { ...nic, linkDown: false }
    await card.getByRole('button', { name: 'Refresh network links', exact: true }).click()
    d = await open()
    nic = { ...nic, mac: '02:ab:cd:11:22:55' }
    await d.getByRole('button', { name: 'Refresh current interface', exact: true }).click()
    await d.getByText(/original NIC identity no longer matches/).waitFor()
    assert.ok(await d.getByRole('button', { name: 'Review link state', exact: true }).isDisabled())
    await d.getByRole('button', { name: 'Cancel', exact: true }).click()
    guest.status = 'running'
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Inspect network links', exact: true }).click()
    await page.getByText('Shut down this guest before reviewing link state.', { exact: true }).waitFor()
    assert.ok(await page.getByRole('button', { name: 'Edit net0 link', exact: true }).isDisabled())
    assert.equal(writes.length, 4)

    // Native-valid 63-character names must fit the description and confirmation at 390px.
    guest.status = 'stopped'; guest.name = nativeName = 'a'.repeat(63)
    nic = { ...nic, linkDown: false }
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Inspect network links', exact: true }).click()
    d = await open()
    await d.getByLabel('Configured connection', { exact: true }).selectOption('disconnected')
    await d.getByRole('button', { name: 'Review link state', exact: true }).click()
    const longConfirmation = d.getByLabel(`Type ${nativeName} to confirm`, { exact: true })
    await longConfirmation.waitFor()
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.evaluate(t => document.documentElement.classList.toggle('dark', t === 'dark'), theme)
      assert.equal(await d.evaluate(el => el.scrollWidth > el.clientWidth), false, `Long-name dialog overflow in ${theme}`)
      assert.equal(await longConfirmation.evaluate(el => el.closest('label').scrollWidth > el.closest('label').clientWidth), false, `Long confirmation label overflow in ${theme}`)
      assert.equal(await d.evaluate(el => { const description = document.getElementById(el.getAttribute('aria-describedby')); return description.scrollWidth > description.clientWidth }), false, `Long description overflow in ${theme}`)
      const longSave = d.getByRole('button', { name: 'Save link state', exact: true })
      await longSave.scrollIntoViewIfNeeded()
      const box = await longSave.boundingBox()
      assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844)
      if (process.env.SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true })
        await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `nic-link-long-name-${theme}-390.png`), fullPage: true })
      }
    }
    await longConfirmation.fill(nativeName)
    await d.getByRole('button', { name: 'Save link state', exact: true }).click()
    await d.getByText('Link state saved and verified', { exact: true }).waitFor()
    assert.equal(writes.length, 5)
    assert.equal(writes.at(-1).confirm, nativeName)
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
    console.log('NIC link browser fixtures passed: deliberate inspection, next-start state, review/typed confirmation, no task fabrication, double-click guard, stale draft, partial outcome/retained observation, replacement review/refresh, expiry, agent switch, LXC, running-state guard and 390px themes including 63-character names.')
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
})().catch(error => { console.error(error); process.exitCode = 1 })
