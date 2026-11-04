// Actual rendered themes with local agent fixtures; no real network/Proxmox actions.
const { chromium } = require('playwright')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const root = path.resolve(__dirname, '../../dist/web')
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    let file = path.resolve(root, `.${pathname}`)
    if (!file.startsWith(`${root}/`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, 'index.html')
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(response)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const directory = process.env.SCREENSHOT_DIR || '/tmp/proxmiu-themes'
  fs.mkdirSync(directory, { recursive: true })
  const captureOnly = process.env.CAPTURE_ONLY === '1'
  const evidence = []
  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' })
    for (const width of [1440, 900, 390]) for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, reducedMotion: 'reduce' })
      const page = await context.newPage()
      page.setDefaultTimeout(5000)
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.addInitScript(mode => { if (!localStorage.getItem('proxmiu-theme')) localStorage.setItem('proxmiu-theme', mode) }, theme)
      await page.route('**/api/**', async route => {
        const pathname = new URL(route.request().url()).pathname
        let data = []
        if (pathname === '/api/health') data = { name: 'proxmiu-agent', version: 'fixture', authRequired: false }
        else if (pathname === '/api/auth/status') data = { authRequired: false, authenticated: true }
        else if (pathname === '/api/ai/settings') data = { configured: false, provider: 'openai', model: 'fixture' }
        else if (pathname === '/api/overview') data = { clusters: [{ id: 'lab', name: 'Home lab', host: '192.0.2.10', ok: true, nodes: [{ id: 'node/pve', type: 'node', node: 'pve', status: 'online', maxcpu: 16, cpu: .24, mem: 17179869184, maxmem: 68719476736 }], guests: [{ id: 'lxc/123', vmid: 123, type: 'lxc', node: 'pve', name: 'dev-box', status: 'running', cpu: .08, maxcpu: 4, mem: 1073741824, maxmem: 4294967296, uptime: 7200 }] }] }
        else if (pathname === '/api/clusters') data = [{ id: 'lab', name: 'Home lab', host: '192.0.2.10', port: 8006, username: 'proxmiu@pve!agent', authType: 'token', createdAt: '2026-11-04T00:00:00Z' }]
        else if (pathname === '/api/guest-metadata') data = {}
        else if (pathname.endsWith('/ips')) data = {}
        await route.fulfill({ json: data })
      })
      const base = `http://127.0.0.1:${server.address().port}`
      await page.goto(base + '/connections')
      await page.getByRole('heading', { name: 'Connections', exact: true }).waitFor()
      await page.getByText('Home lab', { exact: true }).waitFor()
      await page.evaluate(() => document.fonts.ready)
      const screenshot = await page.screenshot({ path: path.join(directory, `connections-${theme}-${width}.png`) })
      if (width >= 640) {
        const boundary = Math.round((await page.locator('aside').boundingBox()).width)
        const seam = await page.evaluate(async ({ encoded, boundary }) => {
          const picture = new Image()
          picture.src = 'data:image/png;base64,' + encoded
          await picture.decode()
          const canvas = document.createElement('canvas')
          canvas.width = picture.width; canvas.height = picture.height
          const ctx = canvas.getContext('2d')
          ctx.drawImage(picture, 0, 0)
          return [24, 80, 160].map(y => {
            const left = [...ctx.getImageData(boundary - 1, y, 1, 1).data].slice(0, 3)
            const right = [...ctx.getImageData(boundary + 1, y, 1, 1).data].slice(0, 3)
            return { y, left, right, jump: Math.max(...left.map((value, index) => Math.abs(value - right[index]))) }
          })
        }, { encoded: screenshot.toString('base64'), boundary })
        evidence.push({ theme, width, seam })
        if (!captureOnly) assert.ok(seam.every(sample => sample.jump <= 2), `Background must continue across sidebar gutter: ${JSON.stringify({ theme, width, seam })}`)
      }
      if (theme === 'light') {
        const contrast = await page.evaluate(() => {
          const css = getComputedStyle(document.documentElement)
          const ctx = document.createElement('canvas').getContext('2d')
          const rgb = token => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = css.getPropertyValue(token).trim(); ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data] }
          const blend = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] / 255 + bg[i] * (1 - fg[3] / 255))
          const luminance = color => color.reduce((sum, value, i) => { const s = value / 255; return sum + [0.2126, 0.7152, 0.0722][i] * (s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4) }, 0)
          const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05)
          const base = rgb('--background').slice(0, 3)
          const card = blend(rgb('--card'), base)
          return Object.fromEntries(['foreground', 'muted-foreground', 'faint-foreground', 'brand', 'success', 'warning', 'destructive', 'info'].map(name => {
            const surface = ['foreground', 'muted-foreground', 'faint-foreground'].includes(name) ? card : blend(rgb(`--${name}-soft`), card)
            return [name, ratio(blend(rgb(`--${name}`), surface), surface)]
          }))
        })
        evidence.push({ theme, width, contrast })
        if (!captureOnly) for (const [name, ratio] of Object.entries(contrast)) assert.ok(ratio >= 4.5, `${name} light contrast ${ratio.toFixed(2)} must be at least 4.5`)
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      if (!captureOnly) {
        for (const control of [page.getByRole('button', { name: 'Scan', exact: true }), page.getByRole('button', { name: 'Remove', exact: true }), page.getByPlaceholder('Local subnets')]) {
          const bounds = await control.boundingBox()
          assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, `Connections control must fit within ${width}px: ${JSON.stringify(bounds)}`)
        }
      }
      if (width === 1440) {
        await page.getByRole('button', { name: 'Add manually', exact: true }).click()
        await page.getByRole('dialog').waitFor()
        await page.screenshot({ path: path.join(directory, `dialog-${theme}.png`) })
        await page.keyboard.press('Escape')
      }
      if (width < 640) { await page.getByRole('button', { name: 'More', exact: true }).click(); await page.getByRole('menuitem', { name: theme === 'dark' ? 'Light mode' : 'Dark mode', exact: true }).click() }
      else await page.getByTitle('Toggle theme', { exact: true }).click()
      const toggled = theme === 'dark' ? 'light' : 'dark'
      await page.waitForFunction(mode => document.documentElement.classList.contains('dark') === (mode === 'dark') && localStorage.getItem('proxmiu-theme') === mode, toggled)
      const chrome = await page.evaluate(() => ({ value: document.querySelector('meta[name="theme-color"]').content.toLowerCase(), token: getComputedStyle(document.documentElement).getPropertyValue('--background').trim().toLowerCase() }))
      if (!captureOnly) assert.equal(chrome.value, chrome.token)
      await page.reload()
      await page.getByRole('heading', { name: 'Connections', exact: true }).waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), toggled === 'dark')
      assert.deepEqual(errors, [])
      await context.close()
    }
    fs.writeFileSync(path.join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    console.log(captureOnly ? 'CAPTURE: incumbent theme/background evidence saved' : 'PASS: light semantic/text contrast, continuous desktop/tablet sidebar gutters, both-mode dialogs, theme toggle/chrome persistence and 390px overflow (local fixtures)')
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
