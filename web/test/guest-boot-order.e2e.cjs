// Synthetic agent APIs only. Never connects to Proxmox or changes a real guest.
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
    const guest = { id: 'qemu/110', type: 'qemu', vmid: 110, node: 'pve1', name: 'boot-lab', status: 'stopped', maxcpu: 2, maxmem: 2 * 1024 ** 3 }
    let nativeName = guest.name, source = 'source-1', heldRead = null
    const devices = [
      { id: 'scsi0', kind: 'disk', label: 'local-lvm:vm-110-disk-0', identity: 'disk-0' },
      { id: 'scsi1', kind: 'disk', label: 'local-lvm:vm-110-disk-1', identity: 'disk-1' },
      { id: 'ide2', kind: 'cdrom', label: 'local:iso/rescue.iso', identity: 'iso-2' },
      { id: 'net0', kind: 'network', label: 'virtio · 02:ab:cd:11:22:33 · vmbr0', identity: 'net-0', warning: 'Configured disconnected; preserved.' },
    ]
    let order = [...devices], readFailure = false, writeFailure = 0, expired = false, corruptReview = '', corruptResult = false, reads = 0, insightReads = 0
    const inventory = () => ({ name: nativeName, ready: guest.status === 'stopped', reason: guest.status === 'stopped' ? undefined : 'Shut down this VM before reviewing boot order.', errors: [], sourceIdentity: source, order, excluded: [{ id: 'efidisk0', reason: 'Firmware storage is not a boot target.' }] })
    await page.route('**/api/**', async route => {
      const req = route.request(), url = new URL(req.url()), method = req.method()
      let data
      if (url.pathname === '/api/health') data = { name: 'proxmiu-agent', version: 'fixture', authRequired: true }
      else if (url.pathname === '/api/auth/status') data = { authRequired: true, authenticated: true }
      else if (url.pathname === '/api/overview') data = { clusters: [{ id: 'fixture', name: 'Fixture lab', host: '127.0.0.1', ok: true, nodes: [{ id: 'node/pve1', node: 'pve1', type: 'node', status: 'online' }], guests: [guest] }] }
      else if (url.pathname === '/api/templates' || url.pathname === '/api/jobs') data = []
      else if (url.pathname === '/api/guest-metadata' || url.pathname.endsWith('/ips')) data = {}
      else if (url.pathname.endsWith('/ai/settings')) data = { configured: false, provider: 'openai', model: 'fixture' }
      else if (url.pathname.endsWith('/task-history')) data = { tasks: [], next: 0, hasMore: false, warnings: [] }
      else if (url.pathname.endsWith('/insights')) { insightReads++; data = { config: { networks: [], disks: [] }, metrics: [] } }
      else if (url.pathname.endsWith('/notes')) data = { notes: '', digest: 'abc123' }
      else if (url.pathname.endsWith('/resource-settings')) data = { cores: 2, sockets: 1, memoryMiB: 2048, onboot: false, digest: 'abc123', status: guest.status, pending: false, editable: true }
      else if (url.pathname.endsWith('/operations')) data = { snapshots: [], storages: [], targets: [], errors: [] }
      else if (url.pathname.endsWith('/boot-order') && method === 'GET') {
        reads++
        if (readFailure) return route.fulfill({ status: 502, json: { error: 'Boot configuration unavailable.' } })
        data = inventory()
        if (heldRead) { const held = heldRead; heldRead = null; data = structuredClone(data); held.started(); await held.gate }
      } else if (url.pathname.endsWith('/boot-order-review') && method === 'POST') {
        const input = req.postDataJSON(); reviews.push(input)
        data = { reviewId: 'review-' + reviews.length, name: nativeName, node: 'pve1', vmid: 110, type: 'qemu', sourceIdentity: source, currentOrder: order, proposedOrder: input.order.map(id => order.find(d => d.id === id)), expiresAt: Date.now() + (expired ? -1000 : 300000) }
        if (corruptReview === 'source') data.sourceIdentity = 'replacement'
        if (corruptReview === 'current') data.currentOrder = data.currentOrder.map((d, i) => i ? d : { ...d, identity: 'replacement' })
        if (corruptReview === 'proposed') data.proposedOrder = [...data.proposedOrder].reverse()
        plans.set(data.reviewId, data)
      } else if (url.pathname.endsWith('/boot-order') && method === 'POST') {
        const input = req.postDataJSON(); writes.push(input)
        if (writeFailure === 409) return route.fulfill({ status: 409, json: { error: 'Boot configuration changed. No update was submitted. Refresh and review again.' } })
        order = plans.get(input.reviewId).proposedOrder; source = 'after-' + writes.length
        if (writeFailure) return route.fulfill({ status: writeFailure, json: { error: 'Boot order outcome is unconfirmed. Inspect current configuration and pending changes.' } })
        data = { verified: true, name: nativeName, node: 'pve1', type: 'qemu', vmid: 110, sourceIdentity: source, order: corruptResult ? [...order].reverse() : order, observedAt: Date.now() }
      } else { unexpected.push(method + ' ' + url.pathname); return route.fulfill({ status: 404, json: { error: 'Missing fixture' } }) }
      await route.fulfill({ json: data })
    })
    const base = `http://127.0.0.1:${server.address().port}`
    const visit = () => page.goto(base + `/guests/fixture/pve1/${guest.type}/110`, { waitUntil: 'networkidle' })
    await visit()
    await page.getByRole('heading', { name: 'Boot device order', exact: true }).waitFor()
    assert.equal(reads, 0, 'Boot inventory is on demand')
    const card = page.getByRole('region', { name: 'Boot device order', exact: true })
    const inspect = async () => { await card.getByRole('button', { name: 'Inspect boot order', exact: true }).click(); await card.getByRole('button', { name: 'Edit boot order', exact: true }).waitFor() }
    const open = async () => { await card.getByRole('button', { name: 'Edit boot order', exact: true }).click(); return page.getByRole('dialog') }
    const move = async d => {
      await d.getByRole('button', { name: 'Move scsi1 up', exact: true }).focus()
      await page.keyboard.press('Enter')
      assert.equal(await d.getByRole('button', { name: 'Move scsi1 up', exact: true }).evaluate(el => document.activeElement === el || el.closest('li').contains(document.activeElement)), true, 'Focus follows moved row')
      await d.getByRole('status').filter({ hasText: 'scsi1 moved to position 1 of 4' }).waitFor()
      assert.deepEqual(await d.getByRole('list', { name: 'Draft boot order' }).locator('li').evaluateAll(rows => rows.map(r => r.dataset.device)), ['scsi1', 'scsi0', 'ide2', 'net0'])
    }
    const review = async d => { await move(d); await d.getByRole('button', { name: 'Review boot order', exact: true }).click(); await d.getByLabel(`Type ${nativeName} to confirm`, { exact: true }).waitFor() }
    const close = async d => { await d.getByRole('button', { name: /^(Cancel|Close)$/, exact: true }).click() }
    const refresh = () => card.getByRole('button', { name: 'Refresh boot order', exact: true }).click()
    const reset = async () => { order = [...devices]; source = 'source-1'; writeFailure = 0; readFailure = false; expired = false; corruptReview = ''; corruptResult = false; await refresh() }
    await inspect()
    await card.getByText('efidisk0', { exact: true }).waitFor()
    let d = await open()
    assert.ok(await d.getByRole('button', { name: 'Review boot order', exact: true }).isDisabled())
    assert.equal(await d.getByRole('checkbox').count(), 0)
    await review(d)
    assert.deepEqual(reviews[0], { sourceIdentity: 'source-1', order: ['scsi1', 'scsi0', 'ide2', 'net0'] })
    assert.deepEqual(await d.getByRole('list', { name: 'Current boot order' }).locator('li').evaluateAll(rows => rows.map(r => r.dataset.device)), ['scsi0', 'scsi1', 'ide2', 'net0'])
    assert.deepEqual(await d.getByRole('list', { name: 'Proposed boot order' }).locator('li').evaluateAll(rows => rows.map(r => r.dataset.device)), ['scsi1', 'scsi0', 'ide2', 'net0'])
    assert.match(await d.textContent(), /another OS.*installer.*fail/i)
    const save = d.getByRole('button', { name: 'Save boot order', exact: true })
    assert.ok(await save.isDisabled())
    await d.getByLabel('Type boot-lab to confirm', { exact: true }).fill('110'); assert.ok(await save.isDisabled())
    await d.getByLabel('Type boot-lab to confirm', { exact: true }).fill(nativeName)
    await save.evaluate(el => { el.click(); el.click() })
    await d.getByText('Boot order saved and verified', { exact: true }).waitFor()
    assert.deepEqual(writes, [{ reviewId: 'review-1', confirm: nativeName }])
    assert.equal(await d.getByRole('button', { name: /\b(task|log)\b/i }).count(), 0)
    await close(d); await reset()
    d = await open(); await review(d); writeFailure = 409
    await d.getByLabel('Type boot-lab to confirm', { exact: true }).fill(nativeName)
    await d.getByRole('button', { name: 'Save boot order', exact: true }).click()
    await d.getByText(/Boot configuration changed. No update was submitted/).waitFor()
    assert.deepEqual(await d.getByRole('list', { name: 'Draft boot order' }).locator('li').evaluateAll(rows => rows.map(r => r.dataset.device)), ['scsi1', 'scsi0', 'ide2', 'net0'])
    assert.ok(await d.getByRole('button', { name: 'Review boot order', exact: true }).isDisabled())
    await d.getByRole('button', { name: 'Refresh current boot order', exact: true }).click()
    await d.getByRole('button', { name: 'Review boot order', exact: true }).click()
    await d.getByLabel('Type boot-lab to confirm', { exact: true }).waitFor()
    writeFailure = 502; readFailure = true; guest.status = 'running'
    const before = insightReads
    await d.getByLabel('Type boot-lab to confirm', { exact: true }).fill(nativeName)
    await d.getByRole('button', { name: 'Save boot order', exact: true }).click()
    await d.getByText(/Boot order outcome is unconfirmed/).waitFor()
    assert.equal(await d.getByRole('button', { name: 'Save boot order', exact: true }).count(), 0)
    assert.equal(await d.getByRole('button', { name: 'Review boot order', exact: true }).count(), 0)
    const deadline = Date.now() + 3000
    while (insightReads <= before && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
    assert.ok(insightReads > before, 'Related config invalidates independently of observation')
    readFailure = false
    await d.getByRole('button', { name: 'Refresh observed boot order', exact: true }).click()
    await d.getByRole('list', { name: 'Last observed boot order' }).waitFor()
    readFailure = true
    await d.getByRole('button', { name: 'Refresh observed boot order', exact: true }).click()
    await d.getByText(/Boot configuration unavailable/).waitFor()
    assert.equal(await d.getByRole('list', { name: 'Last observed boot order' }).locator('li').count(), 4)
    assert.equal(await d.getByRole('button', { name: 'Review boot order', exact: true }).count(), 0)
    await close(d); guest.status = 'stopped'; readFailure = false; await page.reload({ waitUntil: 'networkidle' }); await inspect(); await reset()
    for (const corruption of ['source', 'current', 'proposed']) {
      d = await open(); corruptReview = corruption
      await move(d); await d.getByRole('button', { name: 'Review boot order', exact: true }).click()
      await d.getByText(/original boot configuration no longer matches/).waitFor()
      assert.equal(await d.getByRole('button', { name: 'Save boot order', exact: true }).count(), 0)
      assert.ok(await d.getByRole('button', { name: 'Review boot order', exact: true }).isDisabled())
      await close(d); await reset()
    }
    d = await open(); await move(d); source = 'replacement-before-refresh'
    await d.getByRole('button', { name: 'Refresh current boot order', exact: true }).click()
    await d.getByText(/original boot configuration no longer matches/).waitFor()
    assert.ok(await d.getByRole('button', { name: 'Review boot order', exact: true }).isDisabled())
    await close(d); await reset()
    d = await open(); expired = true; await move(d)
    await d.getByRole('button', { name: 'Review boot order', exact: true }).click()
    await d.getByText(/review expired/i).waitFor()
    assert.ok(await d.getByRole('button', { name: 'Save boot order', exact: true }).isDisabled())
    await page.evaluate(() => window.dispatchEvent(new Event('proxmiu-agent-change')))
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await inspect(); await reset()
    d = await open(); corruptResult = true; await review(d)
    await d.getByLabel('Type boot-lab to confirm', { exact: true }).fill(nativeName)
    await d.getByRole('button', { name: 'Save boot order', exact: true }).click()
    await d.getByText(/Boot order verification is unconfirmed/).waitFor()
    assert.equal(await d.getByText('Boot order saved and verified', { exact: true }).count(), 0)
    assert.equal(await d.getByRole('button', { name: 'Review boot order', exact: true }).count(), 0)
    await close(d); await reset()
    // A late old-session read must not overwrite the newly inspected cache, even at the same URL.
    d = await open()
    let release, started
    const startedPromise = new Promise(resolve => { started = resolve })
    heldRead = { started, gate: new Promise(resolve => { release = resolve }) }
    await d.getByRole('button', { name: 'Refresh current boot order', exact: true }).click()
    await startedPromise
    const oldLabel = devices[0].label
    devices[0] = { ...devices[0], label: 'fresh-agent-device', identity: 'fresh-agent-disk' }; order = [...devices]; source = 'fresh-agent-source'
    await page.locator('button[title="Log out"]').evaluate(el => el.click())
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await inspect(); await card.getByText('fresh-agent-device', { exact: true }).waitFor()
    const lateResponse = page.waitForResponse(response => response.url().endsWith('/boot-order') && response.request().method() === 'GET')
    release(); await (await lateResponse).finished(); await page.waitForTimeout(100)
    await card.getByText('fresh-agent-device', { exact: true }).waitFor()
    assert.equal(await card.getByText(oldLabel, { exact: true }).count(), 0, 'Late old-session response cannot replace fresh inventory')
    guest.status = 'running'; await page.reload({ waitUntil: 'networkidle' }); await inspect()
    await card.getByText('Shut down this VM before reviewing boot order.', { exact: true }).waitFor()
    assert.ok(await card.getByRole('button', { name: 'Edit boot order', exact: true }).isDisabled())
    guest.type = 'lxc'; guest.id = 'lxc/110'; const beforeLxc = reads
    await visit(); assert.equal(await page.getByRole('region', { name: 'Boot device order', exact: true }).count(), 0); assert.equal(reads, beforeLxc)
    guest.type = 'qemu'; guest.id = 'qemu/110'; guest.status = 'stopped'; guest.name = nativeName = 'a'.repeat(63)
    devices[0].label = 'local:iso/' + 'long-volume-label'.repeat(12) + '.iso'; order = [...devices]
    await visit(); await inspect(); d = await open(); await review(d)
    const confirmation = d.getByLabel(`Type ${nativeName} to confirm`, { exact: true })
    for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 })
      await page.evaluate(t => document.documentElement.classList.toggle('dark', t === 'dark'), theme)
      assert.equal(await d.evaluate(el => el.scrollWidth > el.clientWidth), false, `Dialog overflow at ${width} ${theme}`)
      assert.equal(await confirmation.evaluate(el => el.closest('label').scrollWidth > el.closest('label').clientWidth), false)
      assert.equal(await d.evaluate(el => { const x = document.getElementById(el.getAttribute('aria-describedby')); return x.scrollWidth > x.clientWidth }), false)
      const action = d.getByRole('button', { name: 'Save boot order', exact: true }); await action.scrollIntoViewIfNeeded()
      const box = await action.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 844)
      if (process.env.SCREENSHOT_DIR) { fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `boot-order-long-${theme}-${width}.png`), fullPage: true }) }
    }
    await confirmation.fill(nativeName); await d.getByRole('button', { name: 'Save boot order', exact: true }).click()
    await d.getByText('Boot order saved and verified', { exact: true }).waitFor()
    assert.equal(writes.length, 5)
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
    console.log('Boot order browser fixtures passed: on-demand QEMU-only inventory; same-set arrows/focus/announcement; exact old/new review; typed name/double-click; stale draft; source/device/proposal replacement; expiry/agent switch/late old-session cache guard; unknown and retained observation including running VM; independent config invalidation; result verification; running/LXC guards; long names/labels at 390px and 1440px in both themes; no task fabrication.')
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
})().catch(error => { console.error(error); process.exitCode = 1 })
