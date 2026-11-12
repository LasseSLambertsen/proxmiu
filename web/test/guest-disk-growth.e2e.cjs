// Local browser fixtures only: no Proxmox node, SSH or provider calls.
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
    res.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.setDefaultTimeout(8000)
    const errors = [], unexpected = [], previews = [], submits = []
    page.on('pageerror', e => errors.push(e.message))
    const GiB = 1024 ** 3
    const guest = { id: 'qemu/110', type: 'qemu', vmid: 110, node: 'pve1', name: 'disk-lab', status: 'stopped', maxcpu: 2, maxmem: 2 * GiB, maxdisk: 2 * GiB }
    let disk = { disk: 'scsi0', volume: 'local-lvm:vm-110-disk-0', storage: 'local-lvm', sizeBytes: 8 * GiB, format: 'raw', availableBytes: GiB, canGrow: true }
    let outcome = { status: 'running' }, submitFailure = 0, reviewFailure = false, statusFailure = false, capacityFailure = false, expired = false, inspections = 0, insightReads = 0
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
      else if (url.pathname.endsWith('/insights')) { insightReads++; data = { config: { networks: [], disks: [{ name: 'scsi0', value: 'local-lvm:vm-110-disk-0,size=2G' }] }, metrics: [] } }
      else if (url.pathname.endsWith('/notes')) data = { notes: '', digest: 'abc123' }
      else if (url.pathname.endsWith('/resource-settings')) data = { cores: 2, sockets: 1, memoryMiB: 2048, onboot: false, digest: 'abc123', status: 'stopped', pending: false, editable: true }
      else if (url.pathname.endsWith('/operations')) data = { snapshots: [], storages: [], targets: [], errors: [] }
      else if (url.pathname.endsWith('/disk-capacity') && method === 'GET') {
        inspections++
        if (capacityFailure) return route.fulfill({ status: 502, json: { error: 'Storage metadata unavailable.' } })
        data = { name: 'disk-lab', ready: guest.status === 'stopped', reason: guest.status === 'stopped' ? undefined : 'Shut down this guest before reviewing disk growth.', errors: [], disks: [disk, { disk: 'ide2', volume: null, storage: null, sizeBytes: null, format: null, availableBytes: null, canGrow: false, reason: 'Optical media is outside this editor.' }] }
      } else if (url.pathname.endsWith('/disk-growth-review') && method === 'POST') {
        previews.push(req.postDataJSON())
        if (reviewFailure) return route.fulfill({ status: 409, json: { error: 'Disk checks changed. Refresh the capacity and review again.' } })
        const targetGiB = req.postDataJSON().targetGiB
        data = { ...req.postDataJSON(), reviewId: 'review-' + previews.length, node: 'pve1', type: guest.type, vmid: 110, name: 'disk-lab', volume: disk.volume, storage: disk.storage, format: disk.format, currentBytes: disk.sizeBytes, targetBytes: targetGiB * GiB, deltaBytes: targetGiB * GiB - disk.sizeBytes, availableBytes: disk.availableBytes, shortfall: targetGiB * GiB - disk.sizeBytes > disk.availableBytes, expiresAt: Date.now() + (expired ? -1000 : 300000) }
      } else if (url.pathname.endsWith('/disk-growth') && method === 'POST') {
        submits.push(req.postDataJSON())
        if (submitFailure) return route.fulfill({ status: submitFailure, json: { error: submitFailure === 409 ? 'Configuration changed. No resize was submitted. Refresh and review again.' : 'Disk growth acceptance is unknown. Inspect Proxmox task history and actual disk capacity.' } })
        data = { node: 'pve1', upid: 'UPID:pve1:00000123:00000456:12345678:resize:110:root@pam:', vmid: 110, type: guest.type }
      } else if (url.pathname.includes('/tasks/') && url.pathname.endsWith('/log')) data = { lines: [{ n: 1, t: '<script>unsafe()</script>' }], next: 1, truncated: false }
      else if (url.pathname.includes('/tasks/')) {
        if (statusFailure) return route.fulfill({ status: 502, json: { error: 'Task status unavailable.' } })
        data = outcome
      } else { unexpected.push(method + ' ' + url.pathname); return route.fulfill({ status: 404, json: { error: 'Missing fixture' } }) }
      await route.fulfill({ json: data })
    })
    const base = `http://127.0.0.1:${server.address().port}`
    await page.goto(base + '/guests/fixture/pve1/qemu/110', { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Disk capacity', exact: true }).waitFor()
    assert.equal(inspections, 0, 'Storage inspection must be deliberate, not a background request on every guest visit')
    await page.getByRole('button', { name: 'Inspect disk capacity', exact: true }).click()
    const card = page.getByRole('region', { name: 'Disk capacity', exact: true })
    await card.getByText('8.0 GiB', { exact: true }).waitFor()
    assert.ok(await card.getByRole('button', { name: 'Grow ide2', exact: true }).isDisabled())
    const open = async () => {
      await card.getByRole('button', { name: 'Grow scsi0', exact: true }).click()
      const d = page.getByRole('dialog')
      await d.getByLabel('Target capacity (GiB)', { exact: true }).waitFor()
      return d
    }
    const review = async d => {
      await d.getByLabel('Target capacity (GiB)', { exact: true }).fill('12')
      await d.getByRole('button', { name: 'Review disk growth', exact: true }).click()
      await d.getByLabel('Type disk-lab to confirm', { exact: true }).waitFor()
    }
    let d = await open()
    assert.equal(await d.getByLabel('Target capacity (GiB)', { exact: true }).inputValue(), '9')
    await d.getByLabel('Target capacity (GiB)', { exact: true }).fill('8')
    assert.ok(await d.getByRole('button', { name: 'Review disk growth', exact: true }).isDisabled())
    await d.getByLabel('Target capacity (GiB)', { exact: true }).fill('12.5')
    assert.ok(await d.getByRole('button', { name: 'Review disk growth', exact: true }).isDisabled())
    await review(d)
    assert.deepEqual(previews[0], { disk: 'scsi0', targetGiB: 12 })
    assert.match(await d.textContent(), /partition and filesystem/i)
    assert.match(await d.textContent(), /not a reservation/i)
    await d.getByText(/less than the requested increase/i).waitFor()
    const grow = d.getByRole('button', { name: 'Grow disk', exact: true })
    assert.ok(await grow.isDisabled())
    await d.getByLabel('Type disk-lab to confirm', { exact: true }).fill('110')
    assert.ok(await grow.isDisabled())
    assert.equal(submits.length, 0)
    for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 })
      await page.evaluate(t => document.documentElement.classList.toggle('dark', t === 'dark'), theme)
      assert.equal(await d.evaluate(el => el.scrollWidth > el.clientWidth), false)
      await grow.scrollIntoViewIfNeeded()
      assert.ok((await grow.boundingBox()).y < 844)
      if (process.env.SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true })
        await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `disk-review-${theme}-${width}.png`), fullPage: true })
      }
    }
    await d.getByLabel('Type disk-lab to confirm', { exact: true }).fill('disk-lab')
    await grow.evaluate(el => { el.click(); el.click() })
    await d.getByText('Disk growth running', { exact: true }).waitFor()
    assert.deepEqual(submits, [{ reviewId: 'review-1', confirm: 'disk-lab' }])
    await d.getByRole('button', { name: 'Load task log', exact: true }).click()
    await d.getByText('<script>unsafe()</script>', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => typeof window.unsafe), 'undefined')
    statusFailure = true
    await d.getByRole('button', { name: 'Refresh growth status', exact: true }).click()
    await d.getByText('Disk growth status unavailable', { exact: true }).waitFor()
    statusFailure = false
    disk = { ...disk, sizeBytes: 12 * GiB + 4 * 1024 ** 2 }
    outcome = { status: 'stopped', exitstatus: 'WARNINGS: 1' }
    const before = inspections, beforeInsights = insightReads
    capacityFailure = true
    await d.getByRole('button', { name: 'Refresh growth status', exact: true }).click()
    await d.getByText('Disk growth completed with warnings', { exact: true }).waitFor()
    await d.getByText(/Storage metadata unavailable\./).waitFor()
    const deadline = Date.now() + 3000
    while (insightReads <= beforeInsights && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
    assert.ok(insightReads > beforeInsights, 'Terminal resize must refresh related configuration even when capacity observation fails')
    capacityFailure = false
    await d.getByRole('button', { name: 'Refresh observed capacity', exact: true }).click()
    await d.getByText(/12,889,096,192 bytes/).waitFor()
    assert.ok(inspections > before, 'Terminal result needs a new uncached metadata read')
    assert.match(await d.textContent(), /may already have grown/i)
    for (const [result, title] of [[{ status: 'stopped', exitstatus: 'filesystem resize failed' }, 'Disk growth failed'], [{ status: 'stopped' }, 'Disk growth outcome unknown'], [{ status: 'stopped', exitstatus: 'OK' }, 'Disk growth task completed']]) {
      outcome = result
      await d.getByRole('button', { name: 'Refresh growth status', exact: true }).click()
      await d.getByText(title, { exact: true }).waitFor()
      assert.equal(submits.length, 1)
    }
    capacityFailure = true
    await d.getByRole('button', { name: 'Refresh observed capacity', exact: true }).click()
    await d.getByText(/Storage metadata unavailable\./).waitFor()
    assert.match(await d.textContent(), /Last observed/i)
    await d.getByRole('button', { name: 'Close', exact: true }).click()
    capacityFailure = false; disk = { ...disk, sizeBytes: 8 * GiB }
    await card.getByRole('button', { name: 'Refresh capacity', exact: true }).click()
    await card.getByText('8.0 GiB', { exact: true }).waitFor()
    submitFailure = 409
    d = await open(); await review(d)
    await d.getByLabel('Type disk-lab to confirm', { exact: true }).fill('disk-lab')
    await d.getByRole('button', { name: 'Grow disk', exact: true }).click()
    await d.getByText(/Configuration changed. No resize was submitted/).waitFor()
    assert.equal(await d.getByLabel('Target capacity (GiB)', { exact: true }).inputValue(), '12')
    assert.ok(await d.getByRole('button', { name: 'Review disk growth', exact: true }).isDisabled())
    await d.getByRole('button', { name: 'Refresh current capacity', exact: true }).click()
    await review(d)
    submitFailure = 502
    await d.getByLabel('Type disk-lab to confirm', { exact: true }).fill('disk-lab')
    await d.getByRole('button', { name: 'Grow disk', exact: true }).click()
    await d.getByText(/Disk growth acceptance is unknown/).waitFor()
    assert.equal(await d.getByRole('button', { name: 'Grow disk', exact: true }).count(), 0)
    assert.equal(await d.getByRole('button', { name: 'Review disk growth', exact: true }).count(), 0)
    assert.match(await d.textContent(), /Activity/)
    assert.equal(submits.length, 3)
    await d.getByRole('button', { name: 'Close', exact: true }).click()
    expired = true; submitFailure = 0
    d = await open()
    await d.getByRole('button', { name: 'Review disk growth', exact: true }).click()
    await d.getByText(/review expired/i).waitFor()
    assert.ok(await d.getByRole('button', { name: 'Grow disk', exact: true }).isDisabled())
    await d.getByRole('button', { name: 'Edit target', exact: true }).click()
    expired = false; reviewFailure = true
    await d.getByRole('button', { name: 'Review disk growth', exact: true }).click()
    await d.getByText(/Disk checks changed/).waitFor()
    assert.equal(await d.getByLabel('Target capacity (GiB)', { exact: true }).inputValue(), '9')
    await page.evaluate(() => window.dispatchEvent(new Event('proxmiu-agent-change')))
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    assert.equal(submits.length, 3)
    // Container filesystem effects differ from the VM's virtual-disk-only request.
    guest.type = 'lxc'; guest.id = 'lxc/110'; expired = false; reviewFailure = false
    disk = { ...disk, disk: 'rootfs', sizeBytes: 8 * GiB, format: 'raw' }
    await page.goto(base + '/guests/fixture/pve1/lxc/110', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Inspect disk capacity', exact: true }).click()
    await page.getByRole('button', { name: 'Grow rootfs', exact: true }).click()
    d = page.getByRole('dialog')
    await d.getByText(/check and repair the filesystem/).waitFor()
    await d.getByRole('button', { name: 'Cancel', exact: true }).click()
    disk = { ...disk, volume: 'zfs:subvol-110-disk-0', storage: 'zfs', format: 'subvol' }
    await page.getByRole('button', { name: 'Refresh capacity', exact: true }).click()
    await page.getByRole('button', { name: 'Grow rootfs', exact: true }).click()
    d = page.getByRole('dialog')
    await d.getByText('Proxmox adjusts the ZFS subvolume quota.', { exact: true }).waitFor()
    // A review itself must not silently retarget a disk replaced since opening.
    disk = { ...disk, volume: 'zfs:subvol-110-disk-1' }
    await d.getByLabel('Target capacity (GiB)', { exact: true }).fill('16')
    await d.getByRole('button', { name: 'Review disk growth', exact: true }).click()
    await d.getByText(/selected disk volume changed or disappeared/).waitFor()
    assert.equal(await d.getByRole('button', { name: 'Grow disk', exact: true }).count(), 0)
    assert.ok(await d.getByRole('button', { name: 'Review disk growth', exact: true }).isDisabled())
    await d.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: 'Refresh capacity', exact: true }).click()
    await page.getByRole('button', { name: 'Grow rootfs', exact: true }).click()
    d = page.getByRole('dialog')
    // A deliberate capacity refresh must reject replacement too.
    disk = { ...disk, volume: 'zfs:subvol-110-disk-2' }
    await d.getByLabel('Target capacity (GiB)', { exact: true }).fill('16')
    await d.getByRole('button', { name: 'Refresh current capacity', exact: true }).click()
    await d.getByText(/selected disk volume changed or disappeared/).waitFor()
    assert.equal(await d.getByLabel('Target capacity (GiB)', { exact: true }).inputValue(), '16')
    assert.ok(await d.getByRole('button', { name: 'Review disk growth', exact: true }).isDisabled())
    await d.getByRole('button', { name: 'Cancel', exact: true }).click()
    guest.status = 'running'
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Inspect disk capacity', exact: true }).click()
    await page.getByText('Shut down this guest before reviewing disk growth.', { exact: true }).waitFor()
    assert.ok(await page.getByRole('button', { name: 'Grow rootfs', exact: true }).isDisabled())
    assert.equal(submits.length, 3)
    assert.deepEqual(errors, [])
    assert.deepEqual(unexpected, [])
    console.log('Disk-growth browser fixtures passed: deliberate metadata, exact review, confirmation/double-click guard, observed rounded capacity, warnings/failure/unknown, stale draft, expiry, agent switch, LXC filesystem/quota boundaries, replacement volume, running state and 390px themes.')
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
})().catch(e => { console.error(e); process.exitCode = 1 })
