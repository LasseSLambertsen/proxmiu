// Run after npm run build:web; all API and WebSocket traffic is local fixture data.
const { chromium } = require('playwright')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
async function main() {
  const root = path.resolve(__dirname, '../../dist/web')
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname
    let file = path.join(root, decodeURIComponent(pathname))
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, 'index.html')
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.addInitScript(() => {
      window.consoleSockets = []
      window.clipboardFixture = ''
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => window.clipboardFixture, writeText: async text => { window.copiedFixture = text } } })
      class FakeSocket extends EventTarget {
        static OPEN = 1; readyState = 0; bufferedAmount = 0
        constructor(url) { super(); this.url = url; this.messages = []; window.consoleSockets.push(this); if (window.holdNextOpen) window.holdNextOpen = false; else setTimeout(() => this.openNow(), 0) }
        openNow() { if (this.readyState !== 0) return; this.readyState = 1; this.dispatchEvent(new Event('open')); this.onopen?.() }
        send(value) { this.messages.push(JSON.parse(value)); if (this.messages.at(-1).type === 'connect') setTimeout(() => this.onmessage?.({ data: JSON.stringify(window.nextConsoleError ? { type: 'error', message: window.nextConsoleError } : { type: 'status', status: 'connected' }) }), 0) }
        close() { this.readyState = 3; this.staleClose = this.onclose; this.staleMessage = this.onmessage; setTimeout(() => { this.onclose?.(); this.dispatchEvent(new Event('close')) }, 0) }
      }
      window.WebSocket = FakeSocket
    })
    const guest = { id: 'lxc/110', type: 'lxc', vmid: 110, node: 'pve1', name: 'fixture', status: 'running' }
    const clusters = [{ id: 'fixture', name: 'Fixture', host: '127.0.0.1', ok: true, nodes: [{ type: 'node', node: 'pve1', status: 'online' }], guests: [guest] }]
    let ips = {}
    await page.route('**/api/**', async route => {
      const pathname = new URL(route.request().url()).pathname
      let data = {}
      if (pathname === '/api/health') data = { name: 'proxmiu-agent', version: 'test', authRequired: false }
      else if (pathname === '/api/auth/status') data = { authRequired: false, authenticated: true }
      else if (pathname === '/api/overview') data = { clusters }
      else if (pathname === '/api/templates' || pathname === '/api/jobs') data = []
      else if (pathname.endsWith('/ips')) data = ips
      else if (pathname.endsWith('/ssh/user')) data = { username: null }
      else if (pathname.endsWith('/insights')) data = { config: {}, metrics: [] }
      else if (pathname.endsWith('/notes')) data = { notes: '', digest: 'fixture' }
      else if (pathname.endsWith('/operations')) data = { snapshots: [], storages: [], targets: [], errors: [] }
      else if (pathname.endsWith('/task-history')) data = { tasks: [], next: 0, hasMore: false, warnings: [] }
      else if (pathname.endsWith('/resource-settings')) data = { editable: false }
      await route.fulfill({ json: data })
    })
    const capture = async label => {
      if (!process.env.SCREENSHOT_DIR) return
      fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true })
      for (const theme of ['light', 'dark']) {
        await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark')
        await page.waitForTimeout(300)
        await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `console-${label}-${theme}.png`) })
      }
    }
    await page.goto(`http://127.0.0.1:${server.address().port}/guests/fixture/pve1/lxc/110`, { waitUntil: 'networkidle' })
    assert.equal(await page.getByRole('button', { name: 'Open terminal' }).isDisabled(), true)
    await page.getByRole('button', { name: 'Console', exact: true }).click()
    assert.equal(await page.evaluate(() => window.consoleSockets.length), 0)
    await capture('desktop-ready')
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await page.getByText('Connected', { exact: true }).waitFor()
    await capture('desktop-connected')
    let state = await page.evaluate(() => ({ url: window.consoleSockets[0].url, messages: window.consoleSockets[0].messages }))
    assert.match(state.url, /\/api\/console$/)
    assert.deepEqual(Object.keys(state.messages[0]).sort(), ['clusterId', 'cols', 'guestType', 'node', 'rows', 'type', 'vmid'].sort())
    assert.equal(state.messages[0].vmid, 110)
    await page.getByRole('button', { name: 'Tab', exact: true }).click()
    assert.ok(await page.evaluate(() => window.consoleSockets[0].messages.some(m => m.type === 'data' && m.data === '\t')))
    const longInput = 'é😀\u0001'.repeat(18000)
    await page.evaluate(text => { window.clipboardFixture = text }, longInput)
    await page.getByRole('button', { name: 'Paste from clipboard' }).click()
    await page.waitForFunction(() => window.consoleSockets[0].messages.filter(m => m.type === 'data').length > 3)
    const chunks = await page.evaluate(() => window.consoleSockets[0].messages.filter(m => m.type === 'data').slice(1).map(m => m.data))
    assert.equal(chunks.join(''), longInput)
    assert.ok(chunks.every(chunk => Buffer.byteLength(chunk) <= 32768 && Buffer.byteLength(JSON.stringify({ type: 'data', data: chunk })) <= 256 * 1024))
    await page.evaluate(() => { window.consoleSockets[0].bufferedAmount = 1024 * 1024 })
    await page.getByRole('button', { name: 'Tab', exact: true }).click()
    assert.equal(await page.evaluate(() => window.consoleSockets[0].readyState), 3)
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
    await page.waitForFunction(() => window.consoleSockets.length === 2)
    assert.equal(await page.evaluate(() => window.consoleSockets[0].readyState), 3)
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
    assert.equal(await page.evaluate(() => window.consoleSockets[1].readyState), 3)
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
    await page.waitForFunction(() => window.consoleSockets.length === 3)
    guest.node = 'pve2'
    await page.getByRole('button', { name: 'Refresh guest', exact: true }).click()
    await page.waitForFunction(() => window.consoleSockets[2].readyState === 3)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Console', exact: true }).click()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await capture('mobile-ready')
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await page.waitForFunction(() => window.consoleSockets.length === 4)
    await page.getByRole('status').filter({ hasText: 'Connected' }).waitFor()
    await capture('mobile-connected')
    clusters[0].ok = false
    await page.getByRole('button', { name: 'Refresh guest', exact: true }).click()
    await page.waitForFunction(() => window.consoleSockets[3].readyState === 3)
    clusters[0].ok = true
    await page.getByRole('button', { name: 'Refresh guest', exact: true }).click()
    await page.getByRole('button', { name: 'Console', exact: true }).click()
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await page.waitForFunction(() => window.consoleSockets.length === 5)
    await page.evaluate(() => window.dispatchEvent(new Event('proxmiu-agent-change')))
    await page.waitForFunction(() => window.consoleSockets[4].readyState === 3)
    guest.type = 'qemu'; guest.id = 'qemu/110'; guest.node = 'pve1'
    ips = { 'qemu/110': '192.0.2.7' }
    await page.goto(`http://127.0.0.1:${server.address().port}/guests/fixture/pve1/qemu/110`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Console', exact: true }).click()
    await page.evaluate(() => { window.nextConsoleError = 'This VM needs a configured serial socket before its console can connect.' })
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'serial socket' }).waitFor()
    await page.evaluate(() => { window.nextConsoleError = 'Could not connect to the guest console. Check permissions and connection settings.' })
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'permissions' }).waitFor()
    await page.getByRole('button', { name: 'Close dialog' }).click()
    await page.getByRole('button', { name: 'Open terminal' }).click()
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await page.waitForFunction(() => window.consoleSockets.some(s => s.url.endsWith('/api/ssh') && s.messages.some(m => m.type === 'connect')))
    const ssh = await page.evaluate(() => { const s = window.consoleSockets.find(s => s.url.endsWith('/api/ssh')); return s.messages.find(m => m.type === 'connect') })
    assert.equal(ssh.host, '192.0.2.7'); assert.equal(ssh.username, 'root'); assert.equal(ssh.useAppKey, true)
    assert.equal(ssh.clusterId, undefined); assert.equal(ssh.guestType, undefined)
    await page.getByRole('button', { name: 'Close dialog' }).click()
    await page.getByRole('button', { name: 'Console', exact: true }).click()
    await page.evaluate(() => { window.nextConsoleError = ''; window.holdNextOpen = true })
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    const oldIndex = await page.evaluate(() => window.consoleSockets.length - 1)
    await page.evaluate(() => { window.holdNextOpen = true })
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
    await page.evaluate(index => window.consoleSockets[index].staleClose?.(), oldIndex)
    await page.getByRole('status').filter({ hasText: 'Connecting…' }).waitFor({ timeout: 1500 })
    await page.evaluate(() => window.consoleSockets.at(-1).openNow())
    await page.getByRole('status').filter({ hasText: 'Connected' }).waitFor()
    await page.evaluate(index => { window.consoleSockets[index].staleClose?.(); window.consoleSockets[index].staleMessage?.({ data: JSON.stringify({ type: 'error', message: 'stale failure' }) }) }, oldIndex)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await page.getByRole('status').filter({ hasText: 'Connected' }).count(), 1)
    assert.equal(await page.getByText('stale failure').count(), 0)
    console.log('PASS: no-IP LXC, explicit controls, Unicode clipboard chunking, migration/offline/agent-change cleanup, QEMU errors, SSH protocol and mobile layout')
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
