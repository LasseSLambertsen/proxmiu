// Requires Node.js and Playwright: node tests/lynx.e2e.cjs
const { chromium } = require('playwright')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

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
    response.end('<header style="position:fixed;top:0;z-index:1"><a class="brand" href="./" data-lynx-trigger>Proxmiu</a></header><main style="height:2400px;padding-top:1700px"><div id="install">Install</div></main><script defer src="/lynx-easter-egg.js"></script>')
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
    console.log('PASS: activation threshold, idle reset, pet reaction, duplicate prevention, keyboard activation, dismissal, focus return, reduced motion and mobile bounds')
  } finally {
    if (browser) await browser.close()
    server.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
