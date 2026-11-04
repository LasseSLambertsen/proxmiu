// After npm run build:web: node web/test/job-history.e2e.cjs (synthetic API responses only).
const { chromium } = require('playwright')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const root = path.resolve(__dirname, '../../dist/web')
  const server = http.createServer((request, response) => {
    let file = path.join(root, new URL(request.url, 'http://localhost').pathname)
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, 'index.html')
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(response)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
    page.setDefaultTimeout(8000)
    const errors = [], unexpected = [], detailReads = []
    page.on('pageerror', error => errors.push(error.message))
    const target = { vmid: 123, node: 'pve1', type: 'lxc', hostname: 'history-lab' }
    const jobs = [
      { id: 'interrupted', title: 'Install history-lab', status: 'interrupted', createdAt: '2026-11-04T01:00:00Z', interruptedAt: '2026-11-04T01:02:00Z', recoveryGuidance: 'The guest or remote command may still exist/run; inspect it before starting again.', target, logTruncated: true, steps: [{ id: 'create', label: 'Create container', status: 'done' }, { id: 'install', label: 'Install', status: 'interrupted' }, { id: 'extra', label: 'Extras', status: 'skipped' }], log: ['Saved newest log tail', '<script>window.executed = true</script>'], result: { ...target, ip: '192.0.2.4', user: 'root', notes: 'Stale result must not appear ready' } },
      { id: 'complete', title: 'Completed plain server', status: 'success', createdAt: '2026-11-03T00:00:00Z', finishedAt: '2026-11-03T00:02:00Z', steps: [{ id: 'install', label: 'Install', status: 'done' }], log: ['All done.'], result: { ...target, ip: '192.0.2.4', user: 'root', notes: 'Saved setup notes' } },
      { id: 'error', title: 'Earlier failed update', kind: 'update', status: 'error', createdAt: '2026-11-02T00:00:00Z', steps: [{ id: 'update', label: 'Update', status: 'error' }], error: 'Synthetic update failure', log: ['ERROR: Synthetic update failure'] },
    ].map(job => ({ ...job, templateId: 'plain', clusterId: 'fixture' }))
    let mode = 'normal', degraded = false, statusFailure = false
    await page.route('**/api/**', async route => {
      const pathname = new URL(route.request().url()).pathname
      let data
      if (pathname === '/api/health') data = { name: 'proxmiu-agent', version: 'fixture', authRequired: false }
      else if (pathname === '/api/auth/status') data = { authRequired: false, authenticated: true }
      else if (pathname === '/api/overview') data = { clusters: [] }
      else if (pathname === '/api/guest-metadata') data = {}
      else if (pathname === '/api/templates') data = []
      else if (pathname === '/api/ai/settings') data = { configured: false, provider: 'openai', model: 'gpt-4o-mini' }
      else if (pathname === '/api/jobs/status') {
        if (statusFailure) return route.fulfill({ status: 503, json: { error: 'Synthetic status read failed' } })
        data = { available: mode !== 'unavailable', writable: mode !== 'unavailable' && !degraded, warning: mode === 'unavailable' ? 'Saved history is unavailable; inspect agent storage.' : degraded ? 'Recent changes may be lost on restart.' : undefined, lastSavedAt: '2026-11-04T01:02:00Z', retention: { maxJobs: 50, maxLogLines: 5000, maxJobBytes: 131072 } }
      } else if (pathname === '/api/jobs') {
        if (['unavailable', 'read-error'].includes(mode)) return route.fulfill({ status: 503, json: { error: 'Synthetic history read failed' } })
        data = mode === 'empty' ? [] : jobs.map(({ log, ...job }) => job)
      } else if (pathname.startsWith('/api/jobs/')) {
        detailReads.push(pathname)
        data = jobs.find(job => pathname.endsWith('/' + job.id))
        if (!data) return route.fulfill({ status: 404, json: { error: 'Unknown retained job' } })
      } else {
        unexpected.push(pathname)
        return route.fulfill({ status: 404, json: { error: 'Unexpected fixture request' } })
      }
      return route.fulfill({ json: data })
    })
    const origin = `http://127.0.0.1:${server.address().port}`
    const go = (id = '') => page.goto(`${origin}/activity${id ? '/' + id : ''}`, { waitUntil: 'networkidle' })
    const provisioning = async () => page.getByRole('tab', { name: 'Provisioning', exact: true }).click()
    const fit = async name => {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth), `${name} must fit its viewport`)
      if (process.env.SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true })
        await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, name + '.png'), fullPage: true })
      }
    }
    await go('interrupted')
    await page.getByText('Run interrupted', { exact: true }).waitFor()
    await page.getByText('The guest or remote command may still exist/run; inspect it before starting again.', { exact: true }).waitFor()
    await page.getByText('Intended guest: history-lab · LXC 123 · pve1', { exact: true }).waitFor()
    await page.getByText('Connection: fixture', { exact: true }).waitFor()
    await page.getByText('Showing the newest saved log tail. Earlier output was truncated.', { exact: true }).waitFor()
    await page.getByText('Retains up to 50 runs, 5,000 log lines and 128 KiB per run.', { exact: true }).waitFor()
    assert.equal(await page.getByText(/was ready when this run finished/i).count(), 0)
    assert.equal(await page.locator('.animate-spin, .animate-pulse').count(), 0)
    const reads = detailReads.length
    await page.waitForTimeout(1400)
    assert.equal(detailReads.length, reads, 'Interrupted detail must stop polling')
    assert.equal(await page.evaluate(() => window.executed), undefined)
    await fit('retained-interrupted-desktop')
    await page.setViewportSize({ width: 390, height: 844 })
    await fit('retained-interrupted-mobile')
    await page.getByRole('link', { name: 'Completed plain server', exact: false }).click()
    await page.getByText('history-lab was ready when this run finished', { exact: true }).waitFor()
    await page.getByText('Saved SSH address; verify the guest before connecting.', { exact: true }).waitFor()
    assert.equal(await page.getByText('history-lab is ready', { exact: true }).count(), 0)
    await fit('retained-complete-mobile')
    await page.getByRole('link', { name: 'Earlier failed update', exact: false }).click()
    await page.getByText('Synthetic update failure', { exact: true }).waitFor()
    degraded = true
    await go('interrupted')
    await page.getByText('History is not fully saved', { exact: true }).waitFor()
    await page.getByText('Recent changes may be lost on restart.', { exact: true }).waitFor()
    await fit('retained-degraded-mobile')
    mode = 'unavailable'
    await go('interrupted')
    await page.getByText('Provisioning history unavailable', { exact: true }).waitFor()
    assert.equal(await page.getByText('Nothing has run yet', { exact: true }).count(), 0)
    await fit('retained-unavailable-mobile')
    mode = 'read-error'; degraded = false
    await go('interrupted')
    await page.getByText('Could not read provisioning history', { exact: true }).waitFor()
    assert.equal(await page.getByText('Nothing has run yet', { exact: true }).count(), 0)
    mode = 'empty'
    await go('unknown')
    await page.getByText('Unknown retained job', { exact: true }).waitFor()
    assert.equal(await page.getByText('Nothing has run yet', { exact: true }).count(), 0, 'Deep link failures remain visible with an empty list')
    // Use an ordinary provisioning tab to distinguish verified empty history.
    await go(); await provisioning()
    await page.getByText('Nothing has run yet', { exact: true }).waitFor()
    statusFailure = true
    await go(); await provisioning()
    await page.getByText('Could not read history persistence status', { exact: true }).waitFor()
    assert.equal(await page.getByText('Nothing has run yet', { exact: true }).count(), 0)
    assert.deepEqual(errors, [])
    // Empty overview prevents native-history traffic; switching tabs is still keyboard navigable.
    await page.getByRole('tab', { name: 'Provisioning', exact: true }).focus()
    await page.keyboard.press('ArrowLeft')
    assert.equal(await page.getByRole('tab', { name: 'Proxmox tasks', exact: true }).getAttribute('aria-selected'), 'true')
    assert.deepEqual(unexpected, [])
    console.log('PASS: retained terminal/interrupted deep links, recovery/target, plain text, historical readiness, no interrupted polling/spinner, retention/truncation, degraded/unavailable/read-error/empty distinctions, keyboard and desktop/390px layouts')
  } finally { if (browser) await browser.close(); server.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
