const { chromium } = require('playwright')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
async function main() {
  const root = path.resolve('dist/web')
  const server = http.createServer((req, res) => { let file = path.join(root, new URL(req.url, 'http://localhost').pathname); if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, 'index.html'); res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream'); fs.createReadStream(file).pipe(res) })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' })
  try {
    const page = await browser.newPage()
    const connection = { id: 'fixture', name: 'Fixture', host: '127.0.0.1', port: 8006, authType: 'token', username: 'root@pam!fixture', verifyTls: false, createdAt: '2024-01-01T00:00:00Z', revision: 'revision' }
    let current = { ...connection }, lastBody, conflict = false, failure = false, holdTest, holdSave
    await page.route('**/api/**', async route => {
      const request = route.request(), p = new URL(request.url()).pathname
      if (p.endsWith('/settings/test')) {
        lastBody = request.postDataJSON()
        if (holdTest) await new Promise(resolve => { holdTest = resolve })
        return route.fulfill({ json: { ok: true } })
      }
      if (p.endsWith('/settings') && request.method() === 'PUT') {
        lastBody = request.postDataJSON()
        if (holdSave) await new Promise(resolve => { holdSave = resolve })
        if (failure) return route.fulfill({ status: 502, json: { error: 'Could not verify the connection.' } })
        if (conflict) return route.fulfill({ status: 409, json: { error: 'Connection settings changed. Reload saved settings.' } })
        current = { ...current, ...lastBody, revision: 'next' }; delete current.secret
        return route.fulfill({ json: current })
      }
      const data = p === '/api/health' ? { name: 'proxmiu-agent', authRequired: false } : p === '/api/auth/status' ? { authenticated: true } : p === '/api/clusters' ? [current] : p.endsWith('/settings') ? current : p === '/api/overview' ? { clusters: [] } : []
      await route.fulfill({ json: data })
    })
    await page.goto(`http://127.0.0.1:${server.address().port}/connections`)
    const open = async () => { await page.getByRole('button', { name: 'Edit' }).click(); await page.getByLabel('New secret').waitFor() }
    await open()
    assert.equal(await page.getByLabel('New secret').inputValue(), '')
    assert.equal(await page.getByText('Destination:').count(), 1)
    assert.equal(await page.getByLabel('Host').count(), 0)
    holdTest = true
    await page.getByRole('button', { name: 'Test', exact: true }).click()
    await page.waitForFunction(() => [...document.querySelectorAll('input')].some(e => e.value === 'Fixture' && e.disabled))
    assert.equal(await page.getByLabel('Name', { exact: true }).isDisabled(), true)
    await page.getByText('Testing…').waitFor()
    while (typeof holdTest !== 'function') await new Promise(r => setTimeout(r, 10))
    holdTest(); holdTest = null
    await page.getByText('Connection verified.').waitFor()
    assert.equal('secret' in lastBody, false)
    await page.getByLabel('Name', { exact: true }).fill('Draft name')
    assert.equal(await page.getByText('Connection verified.').count(), 0)
    failure = true
    holdSave = true
    await page.getByRole('button', { name: 'Save changes' }).click()
    while (typeof holdSave !== 'function') await new Promise(r => setTimeout(r, 10))
    await page.getByText('Saving…').waitFor()
    holdSave(); holdSave = null
    await page.getByRole('alert').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Cancel' }).isDisabled(), false)
    assert.equal(await page.getByRole('button', { name: 'Close dialog' }).isDisabled(), false)
    assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'Draft name')
    failure = false
    conflict = true
    await page.getByRole('button', { name: 'Save changes' }).click()
    await page.getByRole('alert').waitFor()
    assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'Draft name')
    current.name = 'Saved elsewhere'
    await page.getByRole('button', { name: 'Reload saved settings' }).click()
    await page.getByLabel('Name', { exact: true }).waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('input')].some(e => e.value === 'Saved elsewhere'))
    conflict = false
    await page.getByLabel('Name', { exact: true }).fill('New name')
    holdSave = true
    await page.getByRole('button', { name: 'Save changes' }).click()
    while (typeof holdSave !== 'function') await new Promise(r => setTimeout(r, 10))
    assert.equal(await page.getByRole('button', { name: 'Cancel' }).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: 'Close dialog' }).isDisabled(), true)
    await page.getByRole('button', { name: 'Cancel' }).evaluate(button => button.click())
    await page.getByRole('button', { name: 'Close dialog' }).evaluate(button => button.click())
    assert.equal(await page.getByRole('dialog').count(), 1)
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('dialog').count(), 1)
    await page.mouse.click(5, 5)
    assert.equal(await page.getByRole('dialog').count(), 1)
    await page.getByText('Saving…').waitFor()
    holdSave(); holdSave = null
    await page.getByText('New name', { exact: true }).waitFor()
    await open()
    await page.getByRole('button', { name: 'Cancel' }).click()
    assert.equal(await page.getByRole('dialog').count(), 0)
    await open()
    holdTest = true
    await page.getByRole('button', { name: 'Test', exact: true }).click()
    while (typeof holdTest !== 'function') await new Promise(r => setTimeout(r, 10))
    await page.evaluate(() => window.dispatchEvent(new Event('proxmiu-agent-change')))
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    holdTest(); holdTest = null
    await open()
    assert.equal(await page.getByText('Connection verified.').count(), 0)
    if (process.env.SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true })
      for (const [label, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
        await page.setViewportSize({ width, height })
        for (const theme of ['light', 'dark']) {
          await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark')
          await page.waitForTimeout(300)
          await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `connection-settings-ready-${label}-${theme}.png`) })
          failure = true
          await page.getByRole('button', { name: 'Save changes' }).click()
          await page.getByRole('alert').waitFor()
          await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `connection-settings-error-${label}-${theme}.png`) })
          failure = false
          await page.getByLabel('Name', { exact: true }).fill(current.name + (theme === 'light' ? ' ' : '  '))
          await page.getByRole('alert').waitFor({ state: 'detached' })
        }
      }
    }
    console.log('Connection settings browser fixture passed')
  } finally { await browser.close(); await new Promise(r => server.close(r)) }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
