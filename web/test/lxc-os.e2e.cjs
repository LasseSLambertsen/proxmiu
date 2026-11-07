// Only local API fixtures: no Proxmox, guest, SSH or external script requests.
const { chromium } = require('playwright')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const root = path.resolve(__dirname, '../../dist/web')
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname
    let file = path.resolve(root, '.' + pathname)
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, 'index.html')
    res.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' })
    const page = await browser.newPage()
    page.setDefaultTimeout(3000)
    const oldOs = 'debian-12-standard_12.7-1_amd64.tar.zst', newOs = 'debian-13-standard_13.1-1_amd64.tar.zst'
    const template = { id: 'cs-fixture', name: 'Community fixture', kind: 'lxc', description: 'Synthetic fixture', source: { type: 'community-scripts', slug: 'isponsorblocktv' }, icon: 'box', user: 'root', script: '', notes: '', nesting: true, privileged: false, tags: [], os: ['debian-13', 'debian-12', 'ubuntu-24.04'], resources: { cores: 1, memory: 1024, disk: 4, swap: 512 }, options: [] }
    let available = [newOs], writes = [], errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.route('**/api/**', async route => {
      const req = route.request(), pathname = new URL(req.url()).pathname
      let data = []
      if (pathname === '/api/health') data = { name: 'proxmiu-agent', authRequired: false }
      else if (pathname === '/api/auth/status') data = { authRequired: false, authenticated: true }
      else if (pathname === '/api/ai/settings') data = { configured: false }
      else if (pathname === '/api/overview') data = { clusters: [] }
      else if (pathname === '/api/templates') data = [template]
      else if (pathname === '/api/clusters') data = [{ id: 'fixture', name: 'Fixture', host: 'fixture.invalid' }]
      else if (pathname.endsWith('/create-options')) data = { node: 'pve1', nodes: ['pve1'], nextid: 100, storages: { rootdir: [{ storage: 'local', avail: 1e11 }], images: [], vztmpl: [{ storage: 'local' }] }, bridges: ['vmbr0'], osTemplates: { downloaded: [`local:vztmpl/${oldOs}`], available }, vmTemplates: [] }
      else if (pathname === '/api/provision') { writes.push(req.postDataJSON()); return route.fulfill({ status: 502, json: { error: 'Captured fixture request' } }) }
      await route.fulfill({ json: data })
    })
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      available = [newOs]; template.os = ['debian-13', 'debian-12', 'ubuntu-24.04']
      await page.goto(`http://127.0.0.1:${server.address().port}/create/cs-fixture`)
      await page.getByText(`Automatic: ${newOs} (downloads first)`, { exact: true }).waitFor()
      available = [oldOs]
      await page.reload()
      await page.getByText('Community Script default: debian-13. Choose another OS only if the app supports it.', { exact: true }).waitFor()
      assert.equal(await page.getByText(`Automatic: ${oldOs}`, { exact: true }).count(), 0)
      await page.getByLabel('Operating system').selectOption(`local:vztmpl/${oldOs}`)
      await page.getByRole('button', { name: 'Create container', exact: true }).click()
      await page.getByText('Captured fixture request', { exact: true }).waitFor()
      assert.equal(writes.at(-1).osTemplate, `local:vztmpl/${oldOs}`, 'manual OS override remains an explicit request')
      template.os = []
      await page.reload()
      await page.getByText('Refresh this template from Community Scripts to load its OS default. Manual choices here are Debian/Ubuntu; verify app compatibility before selecting one.', { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    }
    assert.equal(writes.length, 2)
    assert.deepEqual(errors, [])
    console.log('PASS Community OS priority preview, missing/default guidance, manual override and desktop/mobile layout')
  } finally {
    if (browser) await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
