// After npm run build:web, run with Playwright: node web/test/lynx.e2e.cjs
// API traffic is intercepted; this test never contacts a Proxmox host.
const { chromium } = require('playwright')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

async function checkAppCompanion(browser) {
  const root = path.resolve(__dirname, '../../dist/web')
  assert.ok(fs.existsSync(path.join(root, 'index.html')), 'Run npm run build:web before the app companion check')
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    let file = path.resolve(root, `.${pathname}`)
    if (!file.startsWith(`${root}/`)) file = path.join(root, 'index.html')
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, 'index.html')
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(response)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const page = await browser.newPage()
  try {
    await page.route('**/api/**', route => {
      const pathname = new URL(route.request().url()).pathname
      let data = []
      if (pathname === '/api/health') data = { name: 'proxmiu-agent', version: 'test', authRequired: false }
      else if (pathname === '/api/auth/status') data = { authRequired: false, authenticated: true }
      else if (pathname === '/api/overview') data = { clusters: [] }
      else if (pathname === '/api/guest-metadata') data = {}
      return route.fulfill({ json: data })
    })
    for (const width of [1440, 820, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`http://127.0.0.1:${server.address().port}`)
      const meet = page.locator('[data-lynx-wake]:visible')
      await meet.waitFor()
      assert.equal(await meet.count(), 1, `One discoverable companion control at ${width}px`)
      assert.equal(await meet.getAttribute('aria-label'), 'Meet your lynx')
      assert.equal(await meet.getAttribute('aria-expanded'), 'false')
      await meet.focus()
      await page.keyboard.press('Enter')
      assert.equal(await page.locator('#proxmiu-lynx').count(), 1, 'The actual app opens its companion with one keyboard action')
      await page.keyboard.press('Escape')
      assert.ok(await meet.evaluate(element => element === document.activeElement))
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
      assert.equal(overflow, false, `No companion layout overflow at ${width}px`)
    }
    console.log('PASS: actual app companion is visible on desktop, tablet and phone; keyboard activation and focus restoration')
  } finally {
    await page.close()
    server.close()
  }
}

async function main() {
  const root = path.resolve(__dirname, '..')
  const asset = [path.join(root, 'lynx-easter-egg.js'), path.join(root, 'public/lynx-easter-egg.js')].find(fs.existsSync)
  assert.ok(asset, 'Lynx script must exist')
  const server = http.createServer((request, response) => {
    if (request.url === '/lynx-easter-egg.js') {
      response.setHeader('Content-Type', 'text/javascript')
      fs.createReadStream(asset).pipe(response)
      return
    }
    response.setHeader('Content-Type', 'text/html')
    response.end('<header style="position:fixed;top:0;z-index:1"><a class="brand" href="./" data-lynx-trigger>Proxmiu</a></header><button type="button" data-lynx-wake style="position:fixed;top:50px;z-index:1">Meet your lynx</button><main style="height:2400px;padding-top:1700px"><div id="install">Install</div></main><script defer src="/lynx-easter-egg.js"></script>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    const executablePath = process.env.CHROMIUM_PATH
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    const logo = page.locator('.brand')
    const issues = []
    await page.evaluate(() => { history.replaceState(null, '', '#install'); window.scrollTo(0, 1200) })
    await logo.click()
    await page.waitForTimeout(500)
    if (await page.evaluate(() => scrollY > 0 || location.hash !== '')) issues.push('Home logo must return to the top and clear the section hash')
    const companion = page.getByRole('button', { name: 'Meet your lynx' })
    await companion.focus()
    await page.keyboard.press('Enter')
    assert.equal(await page.locator('#proxmiu-lynx').count(), 1, 'A visible companion control wakes the lynx with one keyboard action')
    assert.equal(await companion.getAttribute('aria-expanded'), 'true')
    assert.ok(await page.getByRole('button', { name: 'Pet the lynx' }).evaluate(element => element === document.activeElement))
    await page.getByRole('button', { name: 'Dismiss lynx' }).click()
    assert.equal(await companion.getAttribute('aria-expanded'), 'false')
    assert.ok(await companion.evaluate(element => element === document.activeElement), 'Direct activation restores companion focus')
    await companion.click()
    assert.equal(await page.locator('#proxmiu-lynx').count(), 1, 'A single pointer click also wakes the lynx')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(1500)
    for (let i = 0; i < 4; i++) await logo.click()
    assert.equal(await page.locator('#proxmiu-lynx').count(), 0)
    await page.waitForTimeout(1500)
    await logo.click()
    assert.equal(await page.locator('#proxmiu-lynx').count(), 0, 'An idle click sequence must reset')
    for (let i = 0; i < 4; i++) await logo.click()
    assert.equal(await page.locator('#proxmiu-lynx').count(), 1, 'Five quick clicks reveal the lynx')
    const menuIsAbove = await page.evaluate(() => {
      const menu = document.createElement('div')
      menu.id = 'test-menu'
      menu.style.cssText = 'position:fixed;inset:0;z-index:50'
      document.body.append(menu)
      const box = document.querySelector('#proxmiu-lynx').getBoundingClientRect()
      const above = document.elementFromPoint(box.x + 20, box.y + 20) === menu
      menu.remove()
      return above
    })
    if (!menuIsAbove) issues.push('App menus and dialogs must appear above the mascot')
    await page.getByRole('button', { name: 'Pet the lynx' }).click()
    assert.match(await page.locator('#proxmiu-lynx').textContent(), /Purr/)
    for (let i = 0; i < 5; i++) await logo.click()
    assert.equal(await page.locator('#proxmiu-lynx').count(), 1, 'Repeated activation must not duplicate the mascot')
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('#proxmiu-lynx').count(), 0)
    await logo.focus()
    for (let i = 0; i < 5; i++) await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Dismiss lynx' }).click()
    assert.equal(await page.locator('#proxmiu-lynx').count(), 0)
    assert.ok(await logo.evaluate(element => element === document.activeElement), 'Dismissing restores trigger focus')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 390, height: 844 })
    for (let i = 0; i < 5; i++) await logo.click()
    const durations = await page.locator('#proxmiu-lynx *').evaluateAll(elements => elements.map(element => getComputedStyle(element).animationDuration))
    assert.ok(durations.every(duration => duration === '0s'))
    const box = await page.locator('#proxmiu-lynx').boundingBox()
    assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height < 844 - 75)
    assert.deepEqual(issues, [])
    await checkAppCompanion(browser)
    console.log('PASS: visible single-click and keyboard activation, focus return, activation threshold, idle reset, pet reaction, duplicate prevention, keyboard activation, dismissal, focus return, reduced motion and mobile bounds')
  } finally {
    if (browser) await browser.close()
    server.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
