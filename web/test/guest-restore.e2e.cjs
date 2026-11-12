// CHROMIUM_PATH=/usr/bin/chromium node web/test/guest-restore.e2e.cjs (after build:web)
// All APIs terminate in browser fixtures. No real infrastructure is contacted.
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
    const errors = [], unexpected = [], submits = [], previews = []
    page.on('pageerror', e => errors.push(e.message))
    page.setDefaultTimeout(8000)
    const archive = 'local:backup/vzdump-qemu-110-2026_11_12-12_00_00.vma.zst'
    const guest = { id: 'qemu/110', type: 'qemu', vmid: 110, node: 'pve1', name: 'restore-source', status: 'running', maxcpu: 2, maxmem: 2147483648 }
    let outcome = { status: 'running' }, reviewFailure = false, submitFailure = false, statusFailure = false
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
      else if (url.pathname.endsWith('/insights')) data = { config: { networks: [], disks: [] }, metrics: [] }
      else if (url.pathname.endsWith('/notes')) data = { notes: '', digest: 'abc123' }
      else if (url.pathname.endsWith('/resource-settings')) data = { cores: 2, sockets: 1, memoryMiB: 2048, onboot: false, digest: 'abc123', status: 'running', pending: false, editable: false, reason: 'Stop the guest before editing.' }
      else if (url.pathname.endsWith('/operations')) data = { snapshots: [], storages: ['local'], targets: [], errors: [] }
      else if (url.pathname.endsWith('/backups')) data = { backups: [{ storage: 'local', volid: archive, format: 'vma.zst', ctime: 1794484800, size: 4096 }], errors: [], truncated: false }
      else if (url.pathname.endsWith('/restore-options')) data = { storages: ['local-lvm'], suggestedVmid: 201 }
      else if (url.pathname.endsWith('/restore-review') && method === 'POST') {
        previews.push(req.postDataJSON())
        if (reviewFailure) return route.fulfill({ status: 409, json: { error: 'Archive changed. Refresh the backup inventory.' } })
        data = { ...req.postDataJSON(), reviewId: 'abc', node: 'pve1', type: 'qemu', ctime: 1794484800, size: 4096, expiresAt: Date.now() + 300000 }
      } else if (url.pathname.endsWith('/restore') && method === 'POST') {
        submits.push(req.postDataJSON())
        if (submitFailure) return route.fulfill({ status: 502, json: { error: 'Restore acceptance is unknown. Inspect Proxmox task history and guest 201 before attempting another restore.' } })
        data = { node: 'pve1', upid: 'UPID:pve1:00000123:00000456:12345678:qmrestore:201:root@pam:', vmid: 201, type: 'qemu' }
      } else if (url.pathname.includes('/tasks/') && url.pathname.endsWith('/log')) data = { lines: [{ n: 1, t: '<script>unsafe()</script>' }], next: 1, truncated: false }
      else if (url.pathname.includes('/tasks/')) {
        if (statusFailure) return route.fulfill({ status: 502, json: { error: 'Task status unavailable.' } })
        data = outcome
      } else { unexpected.push(method + ' ' + url.pathname); return route.fulfill({ status: 404, json: { error: 'Missing fixture' } }) }
      await route.fulfill({ json: data })
    })
    const base = `http://127.0.0.1:${server.address().port}`
    await page.goto(base + '/guests/fixture/pve1/qemu/110', { waitUntil: 'networkidle' })
    const open = async () => {
      await page.getByRole('button', { name: 'Restore backup', exact: true }).click()
      const d = page.getByRole('dialog')
      await d.getByLabel('New guest ID', { exact: true }).waitFor()
      await page.waitForFunction(() => document.querySelector('input[aria-label="New guest ID"]')?.value === '201')
      return d
    }
    const review = async d => {
      await d.getByRole('button', { name: 'Review restore', exact: true }).click()
      await d.getByLabel('Type 201 to confirm', { exact: true }).waitFor()
    }
    let d = await open()
    await d.getByRole('button', { name: 'Cancel', exact: true }).click()
    assert.equal(submits.length, 0)
    d = await open()
    await review(d)
    assert.deepEqual(previews[0], { archive, sourceStorage: 'local', storage: 'local-lvm', vmid: 201 })
    assert.ok((await d.textContent()).includes('Static IP'))
    const install = d.getByRole('button', { name: 'Restore new guest', exact: true })
    assert.ok(await install.isDisabled())
    await d.getByLabel('Type 201 to confirm', { exact: true }).fill('110')
    assert.ok(await install.isDisabled())
    assert.equal(submits.length, 0)
    await d.getByLabel('Type 201 to confirm', { exact: true }).fill('201')
    await install.focus(); await page.keyboard.press('Enter')
    await d.getByText('Restore running', { exact: true }).waitFor()
    assert.deepEqual(submits, [{ reviewId: 'abc', confirm: '201' }])
    await d.getByText('New VM 201 · pve1', { exact: true }).waitFor()
    await d.getByRole('button', { name: 'Load task log', exact: true }).click()
    await d.getByText('<script>unsafe()</script>', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => typeof window.unsafe), 'undefined')
    statusFailure = true
    await d.getByRole('button', { name: 'Refresh restore status', exact: true }).click()
    await d.getByText('Restore status unavailable', { exact: true }).waitFor()
    statusFailure = false
    // Exercise each terminal result fixture without submitting another restore.
    for (const [result, heading] of [
      [{ status: 'stopped' }, 'Restore outcome unknown'],
      [{ status: 'stopped', exitstatus: 'disk allocation failed' }, 'Restore failed'],
      [{ status: 'stopped', exitstatus: 'OK' }, 'Restore task completed'],
    ]) {
      outcome = result
      await d.getByRole('button', { name: 'Refresh restore status', exact: true }).click()
      await d.getByText(heading, { exact: true }).waitFor()
      assert.equal(submits.length, 1)
    }
    outcome = { status: 'stopped', exitstatus: 'WARNINGS: 1' }
    await d.getByRole('button', { name: 'Refresh restore status', exact: true }).click()
    await d.getByText('Restore completed with warnings', { exact: true }).waitFor()
    assert.equal(submits.length, 1)
    assert.ok((await d.textContent()).includes('Activity'))
    for (const theme of ['light', 'dark']) {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.evaluate(t => document.documentElement.classList.toggle('dark', t === 'dark'), theme)
        assert.equal(await d.evaluate(el => el.scrollWidth > el.clientWidth), false)
        if (process.env.SCREENSHOT_DIR) {
          fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true })
          await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `restore-${theme}-${width}.png`), fullPage: true })
        }
      }
    }
    await d.getByRole('button', { name: 'Close dialog', exact: true }).click()
    reviewFailure = true
    d = await open()
    await d.getByRole('button', { name: 'Review restore', exact: true }).click()
    await d.getByText('Archive changed. Refresh the backup inventory.', { exact: true }).waitFor()
    assert.equal(await d.getByRole('button', { name: 'Restore new guest', exact: true }).count(), 0)
    await d.getByRole('button', { name: 'Cancel', exact: true }).click()
    reviewFailure = false; submitFailure = true
    d = await open(); await review(d)
    await d.getByLabel('Type 201 to confirm', { exact: true }).fill('201')
    await d.getByRole('button', { name: 'Restore new guest', exact: true }).click()
    await d.getByText(/Restore acceptance is unknown/).waitFor()
    assert.equal(await d.getByRole('button', { name: 'Restore new guest', exact: true }).count(), 0, 'Unknown acceptance must not offer replay')
    assert.equal(submits.length, 2)
    assert.deepEqual(errors, [])
    assert.deepEqual(unexpected, [])
    console.log('Restore browser fixtures passed: review/typed confirmation, new target, logs/warnings, stale/unknown acceptance and 390px light/dark.')
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
})().catch(e => { console.error(e); process.exitCode = 1 })
