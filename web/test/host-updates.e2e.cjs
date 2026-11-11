// Synthetic API/browser fixtures only; no real host commands or enrollment.
const { chromium } = require('playwright')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const root = path.resolve(__dirname, '../../dist/web')
  const server = http.createServer((req, res) => {
    let file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname)
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, 'index.html')
    res.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(res)
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' })
  const page = await browser.newPage()
  page.setDefaultTimeout(4000)
  const errors = [], writes = []
  let configured = false, prepared = false, job
  const cluster = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
  const plan = { id: 'a'.repeat(32), digest: 'b'.repeat(64), expiresAt: new Date(Date.now() + 600000).toISOString(), proxmoxMajor: 8, codename: 'bookworm', kernelChange: true,
    packages: [{ name: 'pve-container', architecture: 'all', installed: '5.2.0', candidate: '5.3.6' }, { name: 'new-dependency', architecture: 'amd64', installed: null, candidate: '1.0-1' }] }
  const target = () => ({ clusterId: cluster, node: 'pve', publicKey: 'ssh-ed25519 fixture-public-key', revision: 'revision', configured,
    setupCommand: '# Run as root on pve\npython3 -I install-host-updater.py --public-key fixture',
    configuration: configured ? { host: '192.0.2.1', port: 22, fingerprint: 'SHA256:' + 'a'.repeat(43) } : undefined,
    info: configured ? { ready: true, proxmoxVersion: '8.2.7', proxmoxMajor: 8, codename: 'bookworm', machineIdHash: 'c'.repeat(64), rebootSuggested: false } : undefined,
    unresolved: job?.state === 'running', job })
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), pathname = url.pathname, method = req.method()
    let data = []
    if (method !== 'GET') writes.push({ pathname, body: req.postDataJSON() })
    if (pathname.endsWith('/health')) data = { name: 'proxmiu-agent', authRequired: false }
    else if (pathname.endsWith('/auth/status')) data = { authRequired: false, authenticated: true }
    else if (pathname.endsWith('/ai/settings')) data = { configured: false }
    else if (pathname.endsWith('/overview')) data = { clusters: [] }
    else if (pathname.endsWith('/host-updaters')) data = prepared ? [target()] : []
    else if (pathname.endsWith('/updater/setup')) { prepared = true; data = target() }
    else if (pathname.endsWith('/updater/configuration')) { configured = true; data = target() }
    else if (pathname.endsWith('/updater/check')) { job = { id: '1'.repeat(32), state: 'review', phase: 'check', startedAt: new Date().toISOString(), log: ['Package metadata checked.'], plan }; data = job }
    else if (pathname.endsWith('/updater/apply')) { job = { id: '2'.repeat(32), state: 'running', phase: 'apply', startedAt: new Date().toISOString(), log: ['Installing exact reviewed versions.'] }; data = job }
    else if (pathname.endsWith('/updater')) {
      if (!prepared) return route.fulfill({ status: 404, json: { error: 'Prepare restricted updater access first.' } })
      data = target()
    }
    await route.fulfill({ json: data })
  })
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    await page.goto(`${base}/nodes/${cluster}/pve/updates`)
    await page.getByRole('heading', { name: 'Node updates', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Prepare restricted access' }).click()
    await page.getByText('Dedicated public key', { exact: true }).waitFor()
    await page.getByLabel('SSH host', { exact: true }).fill('192.0.2.1')
    await page.getByLabel('Host fingerprint', { exact: true }).fill('SHA256:' + 'a'.repeat(43))
    await page.getByRole('button', { name: 'Verify updater access' }).click()
    await page.getByRole('button', { name: 'Check updates', exact: true }).click()
    await page.getByText('pve-container', { exact: true }).waitFor()
    await page.getByText('New dependency', { exact: true }).waitFor()
    const install = page.getByRole('button', { name: 'Install reviewed updates', exact: true })
    assert.equal(await install.isEnabled(), false)
    await page.getByLabel('Confirm node name', { exact: true }).fill('other')
    assert.equal(await install.isEnabled(), false)
    await page.getByLabel('Confirm node name', { exact: true }).fill('pve')
    for (const theme of ['dark', 'light']) for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      const output = path.resolve(__dirname, '../../.superpowers/sdd/proxmox-updater')
      fs.mkdirSync(output, { recursive: true })
      await page.screenshot({ path: path.join(output, `review-${theme}-${width}.png`), fullPage: true })
    }
    await install.click()
    const applied = writes.filter(w => w.pathname.endsWith('/apply'))
    assert.deepEqual(applied[0].body, { planId: plan.id, digest: plan.digest, confirmNode: 'pve' })
    await page.getByText('Accepted work continues on the host when you leave this page.', { exact: true }).waitFor()
    await page.reload()
    await page.getByText('Installing exact reviewed versions.', { exact: true }).waitFor()
    assert.equal(writes.filter(w => w.pathname.endsWith('/apply')).length, 1)
    await page.goto(`${base}/nodes/${cluster}/other/updates`)
    assert.equal(await page.getByLabel('Confirm node name', { exact: true }).count(), 0)
    assert.deepEqual(errors, [])
    console.log('PASS updater enrollment, complete plan/additions, typed install, recovery, no retry and 390px/light/dark layouts')
  } finally { await browser.close(); await new Promise(r => server.close(r)) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
