// Built, isolated sample tour. Uses only a local static fixture and existing Playwright/Chromium.
const { chromium } = require('playwright')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const root = path.resolve(__dirname, '../../dist')
  const externalBase = process.env.DEMO_BASE_URL
  if (!externalBase) {
    assert.ok(fs.existsSync(path.join(root, 'demo/index.html')), 'build:demo must produce dist/demo/index.html')
    const html = fs.readFileSync(path.join(root, 'demo/index.html'), 'utf8')
    assert.match(html, /connect-src 'none'/)
    assert.match(html, /form-action 'none'/)
    assert.doesNotMatch(html, /manifest|serviceWorker/)
    const files = fs.readdirSync(path.join(root, 'demo'), { recursive: true }).filter(file => fs.statSync(path.join(root, 'demo', file)).isFile())
    assert.ok(files.every(file => file === 'index.html' || /^assets[\\/][^/\\]+\.(js|css|woff2|png|svg)$/.test(file)), 'only HTML and bundled assets may ship')
  }
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname
    const file = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname))
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found') }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(res)
  })
  if (!externalBase) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = externalBase ? new URL(externalBase).href.replace(/\/?$/, '/') : `http://127.0.0.1:${server.address().port}/demo/`
  const sentinels = { 'proxmiu-agent': JSON.stringify({ url: 'https://agent.invalid', token: 'NONSECRET_SENTINEL' }), 'proxmiu-ssh-keys': 'ssh-ed25519 NONSECRET_SENTINEL sample@invalid', 'proxmiu-workspace-v1:https%3A%2F%2Fagent.invalid': JSON.stringify({ version: 1, filters: { query: 'NONSECRET_SENTINEL' }, views: [{ id: 'sentinel', name: 'Sample saved view', filters: {} }] }), 'proxmiu-theme': 'light' }
  const shots = process.env.SCREENSHOT_DIR
  if (shots) fs.mkdirSync(shots, { recursive: true })
  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' })
    for (const width of [1440, 900, 390]) for (const theme of ['dark', 'light']) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, reducedMotion: 'reduce' })
      // Keep probes outside the page so reload cannot erase evidence from earlier documents.
      const storageAccess = [], networkConstruction = []
      await context.exposeBinding('__demoProbe', (_, kind, detail) => { (kind === 'storage' ? storageAccess : networkConstruction).push(detail) })
      await context.addInitScript(({ sentinels, theme }) => {
        const get = Storage.prototype.getItem, set = Storage.prototype.setItem
        for (const [key, value] of Object.entries(sentinels)) if (get.call(localStorage, key) === null) set.call(localStorage, key, value)
        if (get.call(localStorage, 'proxmiu-demo-theme') === null) set.call(localStorage, 'proxmiu-demo-theme', theme)
        for (const method of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) {
          const original = Storage.prototype[method]
          Storage.prototype[method] = function (...args) { void window.__demoProbe('storage', [method, args[0]]); return original.apply(this, args) }
        }
        window.__sentinels = () => Object.fromEntries(Object.keys(sentinels).map(key => [key, get.call(localStorage, key)]))
        for (const name of ['WebSocket', 'EventSource', 'XMLHttpRequest', 'Worker', 'SharedWorker']) window[name] = function (...args) { void window.__demoProbe('network', [name, String(args[0])]); throw new Error('Forbidden demo transport: ' + name) }
        window.fetch = (...args) => { void window.__demoProbe('network', ['fetch', String(args[0])]); return Promise.reject(new Error('Forbidden demo fetch')) }
        navigator.sendBeacon = (...args) => { void window.__demoProbe('network', ['beacon', String(args[0])]); return false }
        if (navigator.serviceWorker) navigator.serviceWorker.register = (...args) => { void window.__demoProbe('network', ['serviceWorker', String(args[0])]); return Promise.reject(new Error('No demo service worker')) }
      }, { sentinels, theme })
      const page = await context.newPage()
      page.setDefaultTimeout(5000)
      const errors = [], requests = [], failed = [], csp = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('request', request => requests.push(request.url()))
      page.on('requestfailed', request => failed.push(request.url()))
      page.on('console', message => { if (/Content Security Policy|Refused to/.test(message.text())) csp.push(message.text()) })
      await page.goto(base)
      const cspMeta = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
      assert.match(cspMeta, /connect-src 'none'/); assert.match(cspMeta, /form-action 'none'/)
      assert.equal(await page.locator('link[rel=manifest]').count(), 0)
      await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor()
      await page.getByText('9.1 GiB', { exact: true }).waitFor()
      assert.ok(await page.getByText('Demo · Sample data', { exact: true }).isVisible())
      assert.equal(await page.getByRole('link', { name: 'Install Proxmiu' }).getAttribute('href'), '/#install')
      const installAppearance = await page.getByRole('link', { name: 'Install Proxmiu' }).evaluate(element => {
        const style = getComputedStyle(element)
        const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1
        const context = canvas.getContext('2d')
        const rgba = color => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return Array.from(context.getImageData(0, 0, 1, 1).data) }
        const foreground = rgba(style.color), background = rgba(style.backgroundColor)
        const luminance = channels => channels.slice(0, 3).map(channel => channel / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
        const fg = luminance(foreground), bg = luminance(background)
        return { contrast: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05), foreground, background, decoration: style.textDecorationLine }
      })
      assert.ok(installAppearance.contrast >= 4.5, `Install Proxmiu contrast must reach 4.5:1: ${JSON.stringify(installAppearance)}`)
      assert.equal(installAppearance.decoration, 'none', 'primary CTA has no plain-link underline')
      assert.equal(await page.getByRole('link', { name: 'Exit demo' }).getAttribute('href'), '/')
      const nav = page.getByRole('navigation', { name: 'Demo sections' })
      await nav.getByRole('link', { name: 'Guests', exact: true }).click()
      await page.getByLabel('Search guests').fill('no-such-sample')
      await page.getByText('No sample guests match').waitFor()
      await page.getByRole('button', { name: 'Reset filters' }).click()
      await page.getByLabel('Status').selectOption('stopped')
      assert.equal(await page.getByRole('link', { name: 'archive-vm', exact: true }).count(), 1)
      assert.equal(await page.getByRole('link', { name: 'dev-lynx', exact: true }).count(), 0)
      await page.getByRole('button', { name: 'Reset filters' }).click()
      await page.getByLabel('Guest type').selectOption('qemu')
      assert.equal(await page.getByRole('link', { name: 'dev-lynx', exact: true }).count(), 0)
      await page.reload()
      assert.equal(await page.getByLabel('Guest type').inputValue(), 'all', 'filters reset on reload')
      await page.getByRole('link', { name: 'dev-lynx', exact: true }).click()
      await page.getByText('Synthetic samples · fixed snapshot', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Memory', exact: true }).click()
      const chart = page.getByRole('group', { name: /^Memory chart/ })
      await page.getByText('Average usage', { exact: true }).waitFor()
      await chart.focus(); await page.keyboard.press('ArrowLeft')
      assert.equal(await chart.evaluate(el => el === document.activeElement), true)
      assert.equal(await page.getByText('Average usage', { exact: true }).count(), 0, 'keyboard inspection selects a sample')
      for (let index = 0; index < 11; index++) await page.keyboard.press('ArrowLeft')
      await page.getByText('No sample', { exact: true }).waitFor()
      for (const [metric, title] of [['CPU', 'CPU'], ['Network', 'Network'], ['Disk I/O', 'Disk I/O']]) {
        await page.getByRole('button', { name: metric, exact: true }).click()
        assert.equal(await page.getByRole('button', { name: metric, exact: true }).getAttribute('aria-pressed'), 'true')
        await page.getByRole('group', { name: title + ' chart. Use left and right arrows to inspect samples.' }).waitFor()
      }
      await page.getByText('192.0.2.101', { exact: true }).waitFor()
      await page.reload()
      await page.getByRole('heading', { name: 'dev-lynx', exact: true }).waitFor()
      await nav.getByRole('link', { name: 'Templates', exact: true }).click()
      await page.getByRole('link', { name: 'View Docker host configuration' }).click()
      await page.getByRole('heading', { name: 'Docker host configuration' }).waitFor()
      await page.getByText('Read-only configuration', { exact: true }).waitFor()
      await nav.getByRole('link', { name: 'Activity', exact: true }).click()
      await page.getByRole('link', { name: /archive-vm.*Interrupted/ }).click()
      await page.getByRole('button', { name: 'Inspect saved step: Install packages' }).click()
      assert.match(await page.locator('pre').innerText(), /<script>sample only<\/script>/)
      assert.equal(await page.locator('pre script').count(), 0)
      await page.reload()
      await page.getByRole('heading', { name: 'archive-vm · saved run' }).waitFor()
      await page.goto(base + '#/guests/missing')
      await page.getByRole('heading', { name: 'Sample not found' }).waitFor()
      await page.reload()
      await page.getByRole('link', { name: 'Return to Overview' }).click()
      await page.goto(base + '#/unknown')
      await page.getByRole('heading', { name: 'Sample not found' }).waitFor()
      await page.getByRole('link', { name: 'Return to Overview' }).click()
      await page.getByRole('button', { name: 'Toggle demo theme' }).click()
      await page.reload()
      assert.equal(await page.locator('html').evaluate(el => el.classList.contains('dark')), theme !== 'dark')
      await page.getByRole('button', { name: 'Toggle demo theme' }).click()
      for (const route of ['/', '/guests', '/guests/101', '/templates', '/templates/docker', '/activity', '/activity/interrupted']) {
        await page.goto(base + '#' + route)
        await page.locator('h1').waitFor()
        const bounds = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, width: innerWidth, main: document.querySelector('main').scrollWidth, box: document.querySelector('main').clientWidth }))
        assert.ok(bounds.page <= bounds.width + 1 && bounds.main <= bounds.box + 1, `overflow ${width} ${theme} ${route}: ${JSON.stringify(bounds)}`)
      }
      if (shots) {
        await page.goto(base)
        await page.evaluate(() => document.fonts.ready)
        await page.screenshot({ path: path.join(shots, `overview-${theme}-${width}.png`), fullPage: true })
        await page.goto(base + '#/guests/101')
        await page.getByRole('heading', { name: 'dev-lynx' }).waitFor()
        await page.screenshot({ path: path.join(shots, `guest-${theme}-${width}.png`), fullPage: true })
      }
      assert.deepEqual(await page.evaluate(() => window.__sentinels()), sentinels)
      assert.ok(storageAccess.length > 0 && storageAccess.every(([, key]) => key === 'proxmiu-demo-theme'), 'normal app storage must never be accessed')
      assert.deepEqual(networkConstruction, [])
      assert.ok(requests.every(url => url.startsWith(base)), 'all requests remain under /demo/')
      assert.deepEqual(failed, []); assert.deepEqual(errors, []); assert.deepEqual(csp, [])
      assert.ok(requests.some(url => /\.woff2$/.test(url)), 'self-hosted fonts loaded')
      assert.equal(await page.locator('input[type=password], form, iframe').count(), 0)
      await context.close()
      console.log(`PASS ${width}px ${theme}: exploration, reload, bounds, storage/network isolation`)
    }
  } finally { if (browser) await browser.close(); if (server.listening) await new Promise(resolve => server.close(resolve)) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
