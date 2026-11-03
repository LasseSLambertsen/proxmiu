// After npm run build, run with Playwright available: node web/test/outages.e2e.cjs
// All API traffic is intercepted. This test never contacts a Proxmox host.
const { chromium } = require('playwright')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const root = path.resolve(__dirname, '../../dist/web')
  assert.ok(fs.existsSync(path.join(root, 'index.html')), 'Run npm run build first')
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    let file = path.join(root, decodeURIComponent(pathname))
    if (!file.startsWith(root + path.sep) && file !== root) { response.writeHead(403); response.end(); return }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      if (pathname.startsWith('/assets/')) { response.writeHead(404); response.end(); return }
      file = path.join(root, 'index.html')
    }
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(response)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const base = `http://127.0.0.1:${server.address().port}`
    const guest = { id: 'lxc/110', type: 'lxc', vmid: 110, node: 'pve1', name: 'notes-test', status: 'running', cpu: .2, maxcpu: 2, mem: 1024, maxmem: 4096 }
    const cluster = { id: 'fixture', name: 'Test homelab', host: '127.0.0.1', ok: true, nodes: [{ id: 'node/pve1', type: 'node', node: 'pve1', status: 'online' }], guests: [guest] }
    let mode = 'live'
    await page.route('**/api/**', route => {
      const url = new URL(route.request().url())
      let data = {}
      if (url.pathname === '/api/health') data = { name: 'proxmiu-agent', version: 'test', authRequired: false }
      else if (url.pathname === '/api/auth/status') data = { authRequired: false, authenticated: true }
      else if (url.pathname === '/api/overview') {
        if (mode === 'agent-offline') return route.fulfill({ status: 503, json: { error: 'Agent unavailable' } })
        data = { clusters: [mode === 'host-offline' ? { ...cluster, ok: false, nodes: [], guests: [] } : cluster] }
      } else if (url.pathname.endsWith('/insights')) data = { config: { networks: [], disks: [] }, metrics: [] }
      else if (url.pathname.endsWith('/notes')) data = { notes: '', digest: 'initial' }
      else if (url.pathname.endsWith('/operations')) data = { snapshots: [], storages: [], targets: [], errors: [] }
      else if (url.pathname.endsWith('/ips')) data = { 'lxc/110': '192.0.2.10' }
      else if (url.pathname === '/api/templates' || url.pathname === '/api/jobs') data = []
      else if (url.pathname !== '/api/guest-metadata') return route.fulfill({ status: 404, json: { error: 'No fixture for this API' } })
      return route.fulfill({ json: data })
    })
    await page.goto(`${base}/guests/fixture/pve1/lxc/110`, { waitUntil: 'networkidle' })
    const notes = page.getByLabel('Guest notes', { exact: true })
    await notes.fill('Keep this unsaved draft through an outage.')
    mode = 'host-offline'
    await page.getByRole('button', { name: 'Refresh guest', exact: true }).click()
    await page.getByText(/This connection is unavailable/).waitFor()
    assert.equal(await notes.inputValue(), 'Keep this unsaved draft through an outage.')
    assert.ok(await page.getByRole('button', { name: 'Reboot', exact: true }).isDisabled())
    mode = 'live'
    await page.getByRole('button', { name: 'Try reconnecting', exact: true }).click()
    await page.getByText(/This connection is unavailable/).waitFor({ state: 'detached' })
    assert.equal(await notes.inputValue(), 'Keep this unsaved draft through an outage.')
    await page.goto(base, { waitUntil: 'networkidle' })
    await page.getByText('All connected nodes are online', { exact: true }).waitFor()
    mode = 'agent-offline'
    await page.getByText('Could not refresh your homelab', { exact: true }).waitFor()
    assert.equal(await page.getByText('All connected nodes are online', { exact: true }).count(), 0)
    await page.getByText('Showing last known readings', { exact: true }).waitFor()
    assert.deepEqual(errors, [])
    console.log('PASS: notes survive host outage/recovery; stale power controls disabled; failed refresh cannot show healthy status')
  } finally {
    if (browser) await browser.close()
    server.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
