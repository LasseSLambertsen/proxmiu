// Built UI + real noVNC, against an isolated RFB3.8/None fixture. No PVE/provider access.
const { chromium } = require('playwright')
const { WebSocketServer } = require('ws')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

;(async () => {
  const root = path.resolve('dist/web')
  const server = http.createServer((req, res) => {
    let file = path.join(root, new URL(req.url, 'http://localhost').pathname)
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, 'index.html')
    res.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(res)
  })
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/api/graphical-console') { socket.destroy(); return }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws))
  })
  const sessions = [], sockets = new Set()
  let hold = false, failure = false
  wss.on('connection', ws => {
    sockets.add(ws); ws.on('error', () => {}); ws.on('close', () => sockets.delete(ws))
    const session = { connect: null, keys: [], pointers: [], clipboard: [], pixels: false }
    sessions.push(session)
    let phase = 'connect', buffer = Buffer.alloc(0)
    ws.on('message', (raw, binary) => {
      if (phase === 'connect') {
        assert.equal(binary, false)
        session.connect = JSON.parse(raw.toString())
        assert.deepEqual(session.connect, { type: 'connect', clusterId: 'fixture', node: 'pve1', guestType: 'qemu', vmid: 110, token: 'fixture-session' })
        if (failure) { ws.send(JSON.stringify({ type: 'error', message: 'VM display unavailable. Refresh the workspace.' })); ws.close(); return }
        if (hold) return
        ws.send(JSON.stringify({ type: 'ready' })); ws.send(Buffer.from('RFB 003.008\n')); phase = 'version'; return
      }
      assert.equal(binary, true)
      buffer = Buffer.concat([buffer, raw])
      while (buffer.length) {
        if (phase === 'version') { if (buffer.length < 12) return; assert.equal(buffer.subarray(0, 12).toString(), 'RFB 003.008\n'); buffer = buffer.subarray(12); phase = 'security'; ws.send(Buffer.from([1, 1])) }
        else if (phase === 'security') { assert.equal(buffer[0], 1); buffer = buffer.subarray(1); phase = 'init'; ws.send(Buffer.alloc(4)) }
        else if (phase === 'init') {
          assert.equal(buffer[0], 1); buffer = buffer.subarray(1); phase = 'messages'
          const header = Buffer.alloc(24), name = Buffer.from('Fixture graphical display')
          header.writeUInt16BE(128, 0); header.writeUInt16BE(96, 2)
          header[4] = 32; header[5] = 24; header[7] = 1
          header.writeUInt16BE(255, 8); header.writeUInt16BE(255, 10); header.writeUInt16BE(255, 12)
          header[14] = 0; header[15] = 8; header[16] = 16; header.writeUInt32BE(name.length, 20)
          ws.send(Buffer.concat([header, name]))
        } else {
          const type = buffer[0]
          let length
          if (type === 0) length = 20
          else if (type === 2) { if (buffer.length < 4) return; length = 4 + 4 * buffer.readUInt16BE(2) }
          else if (type === 3) length = 10
          else if (type === 4) length = 8
          else if (type === 5) length = 6
          else if (type === 6) { if (buffer.length < 8) return; length = 8 + buffer.readUInt32BE(4) }
          else throw new Error('Unexpected RFB input type: ' + type)
          if (buffer.length < length) return
          const frame = buffer.subarray(0, length); buffer = buffer.subarray(length)
          if (type === 3 && !session.pixels) {
            session.pixels = true
            const rectangle = Buffer.alloc(16), pixels = Buffer.alloc(128 * 96 * 4)
            rectangle.writeUInt16BE(1, 2); rectangle.writeUInt16BE(128, 8); rectangle.writeUInt16BE(96, 10)
            for (let p = 0; p < pixels.length; p += 4) { pixels[p] = 24; pixels[p + 1] = 160; pixels[p + 2] = 224 }
            const update = Buffer.concat([rectangle, pixels]); ws.send(update.subarray(0, 7)); ws.send(update.subarray(7))
          }
          if (type === 4) session.keys.push({ down: frame[1], key: frame.readUInt32BE(4) })
          if (type === 5) session.pointers.push({ buttons: frame[1], x: frame.readUInt16BE(2), y: frame.readUInt16BE(4) })
          if (type === 6) session.clipboard.push(frame.subarray(8).toString())
        }
      }
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', ...(process.env.INSECURE_FIXTURE ? { args: ['--host-resolver-rules=MAP graphical-fixture.test 127.0.0.1', '--proxy-server=direct://'] } : {}) })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.setDefaultTimeout(10000)
    const errors = [], unexpected = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('console', event => { if (event.text().includes('Disconnection timed out')) errors.push(event.text()) })
    await page.addInitScript(() => {
      localStorage.setItem('proxmiu-agent', JSON.stringify({ url: '', token: 'fixture-session' }))
      window.clipboardReads = 0; window.clipboardWrites = 0
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => { window.clipboardReads++; return 'system-private-text' }, writeText: async () => { window.clipboardWrites++ } } })
    })
    const guest = { id: 'qemu/110', type: 'qemu', vmid: 110, node: 'pve1', name: 'graphical-fixture', status: 'running' }
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      let data
      if (url.pathname === '/api/health') data = { name: 'proxmiu-agent', version: 'fixture', authRequired: false }
      else if (url.pathname === '/api/auth/status') data = { authRequired: false, authenticated: true }
      else if (url.pathname === '/api/overview') data = { clusters: [{ id: 'fixture', name: 'Fixture', host: '127.0.0.1', ok: true, nodes: [{ type: 'node', node: 'pve1', status: 'online' }], guests: [guest] }] }
      else if (url.pathname === '/api/templates' || url.pathname === '/api/jobs') data = []
      else if (url.pathname === '/api/guest-metadata' || url.pathname.endsWith('/ips')) data = {}
      else if (url.pathname === '/api/ai/settings') data = { configured: false, provider: 'openai', model: 'fixture' }
      else if (url.pathname.endsWith('/insights')) data = { config: {}, metrics: [] }
      else if (url.pathname.endsWith('/notes')) data = { notes: '', digest: 'abc123' }
      else if (url.pathname.endsWith('/operations')) data = { snapshots: [], storages: [], targets: [], errors: [] }
      else if (url.pathname.endsWith('/task-history')) data = { tasks: [], next: 0, hasMore: false, warnings: [] }
      else if (url.pathname.endsWith('/resource-settings')) data = { editable: false }
      else { unexpected.push(url.pathname); return route.fulfill({ status: 404, json: { error: 'Missing fixture' } }) }
      await route.fulfill({ json: data })
    })
    const base = `http://${process.env.INSECURE_FIXTURE ? 'graphical-fixture.test' : '127.0.0.1'}:${server.address().port}`
    await page.goto(base + '/guests/fixture/pve1/qemu/110', { waitUntil: 'networkidle' })
    if (process.env.INSECURE_FIXTURE) assert.equal(await page.evaluate(() => window.isSecureContext), false)
    await page.getByRole('button', { name: 'Console', exact: true }).click()
    const d = page.getByRole('dialog')
    assert.equal(await d.getByLabel('Console type', { exact: true }).inputValue(), 'graphical')
    assert.equal(sessions.length, 0)
    await d.getByRole('button', { name: 'Connect', exact: true }).click()
    await d.getByText('Connected', { exact: true }).waitFor()
    const canvas = d.locator('canvas')
    await page.waitForFunction(() => {
      const c = document.querySelector('[role="dialog"] canvas')
      if (!c || c.width !== 128) return false
      return [...c.getContext('2d').getImageData(40, 40, 1, 1).data].join(',') === '24,160,224,255'
    })
    assert.equal(sessions.length, 1)
    await d.getByRole('button', { name: 'Focus display', exact: true }).click()
    await page.keyboard.press('a'); await canvas.click()
    await d.getByRole('button', { name: 'Ctrl+Alt+Delete', exact: true }).click()
    await d.getByRole('button', { name: 'Send text to guest', exact: true }).click()
    await d.getByLabel('Type into guest', { exact: true }).fill('b')
    await d.getByRole('button', { name: 'Enter', exact: true }).click()
    await d.getByLabel('Clipboard text', { exact: true }).fill('fixture-paste')
    await d.getByRole('button', { name: 'Send clipboard text', exact: true }).click()
    for (let i = 0; i < 100 && !sessions[0].clipboard.length; i++) await page.waitForTimeout(10)
    assert.ok(sessions[0].keys.some(e => e.key === 97 && e.down))
    assert.ok(sessions[0].keys.some(e => e.key === 98 && e.down))
    assert.ok(sessions[0].keys.some(e => e.key === 0xff0d && e.down))
    assert.ok(sessions[0].keys.some(e => e.key === 65535 && e.down))
    assert.ok(sessions[0].pointers.some(e => e.buttons === 1 && e.x < 128 && e.y < 96))
    assert.deepEqual(sessions[0].clipboard, ['fixture-paste'])
    assert.deepEqual(await page.evaluate(() => [window.clipboardReads, window.clipboardWrites]), [0, 0])
    for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width < 640 ? 844 : 1000 })
      await page.evaluate(t => document.documentElement.classList.toggle('dark', t === 'dark'), theme)
      assert.equal(await d.evaluate(el => el.scrollWidth > el.clientWidth), false)
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const imageBounds = await d.getByRole('application', { name: 'Graphical console display', exact: true }).boundingBox(), actionBounds = await d.getByRole('button', { name: 'Reconnect', exact: true }).boundingBox()
      assert.ok(imageBounds.y + imageBounds.height <= actionBounds.y + 1, 'The display must not cover footer actions: ' + JSON.stringify({ width, theme, imageBounds, actionBounds }))
      if (process.env.SCREENSHOT_DIR) { fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `graphical-${theme}-${width}.png`), fullPage: true }) }
    }
    await d.getByRole('button', { name: 'Reconnect', exact: true }).click()
    await d.getByText('Connected', { exact: true }).waitFor()
    assert.equal(sessions.length, 2)
    await d.getByLabel('Console type', { exact: true }).selectOption('serial')
    await d.getByText(/existing serial socket/).waitFor()
    for (let i = 0; i < 100 && sockets.size; i++) await page.waitForTimeout(10)
    assert.equal(sockets.size, 0)
    await page.waitForTimeout(3500)
    assert.deepEqual(errors, [], 'noVNC must finish its disconnect lifecycle after component unmount')
    await d.getByLabel('Console type', { exact: true }).selectOption('graphical')
    failure = true
    await d.getByRole('button', { name: 'Reconnect', exact: true }).click()
    await d.getByText('VM display unavailable. Refresh the workspace.', { exact: true }).waitFor()
    failure = false; hold = true
    await d.getByRole('button', { name: 'Reconnect', exact: true }).click()
    for (let i = 0; i < 100 && sockets.size === 0; i++) await page.waitForTimeout(10)
    guest.status = 'stopped'
    await page.getByRole('button', { name: 'Refresh guest', exact: true }).click()
    await d.waitFor({ state: 'hidden' })
    for (let i = 0; i < 100 && sockets.size; i++) await page.waitForTimeout(10)
    assert.equal(sockets.size, 0)
    guest.status = 'running'; hold = false
    await page.route('**/assets/GraphicalConsole-*.js', route => route.abort())
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Console', exact: true }).click()
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await page.getByText('Graphical display could not load. Reload Proxmiu and reconnect.', { exact: true }).waitFor()
    await page.getByLabel('Console type', { exact: true }).selectOption('serial')
    await page.getByText(/existing serial socket/).waitFor()
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
    const storage = await page.evaluate(() => JSON.stringify(localStorage))
    assert.doesNotMatch(storage, /private-vnc-ticket|private-api-secret|private-pve-cookie|system-private-text|fixture-paste/)
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
    console.log('PASS graphical real-noVNC fixtures: framebuffer pixels, keyboard/pointer/CAD, explicit clipboard, reconnect/switch/offline cleanup, mobile themes and no automatic clipboard access.')
  } finally {
    await browser?.close()
    for (const socket of sockets) socket.terminate()
    await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve))
  }
})().catch(e => { console.error(e); process.exitCode = 1 })
