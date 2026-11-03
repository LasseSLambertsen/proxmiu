// Capture the built app through a real agent and the bundled synthetic Proxmox mock.
// Build first, then: CHROMIUM_PATH=/usr/bin/chromium node scripts/capture-advanced.cjs
// These screenshots show synthetic mock data, not readings from a real Proxmox host.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { createServer } = require('node:net')
const { tmpdir } = require('node:os')
const path = require('node:path')

const project = path.resolve(__dirname, '..')
const output = path.resolve(process.env.CAPTURE_DIR || '/tmp/proxmiu-release')
const dataDirectory = mkdtempSync(path.join(tmpdir(), 'proxmiu-capture-'))
const processes = []
const screenshots = []
const isolatedEnvironment = { ...process.env }
for (const name of Object.keys(isolatedEnvironment)) {
  if (name.startsWith('PROXMIU_') || name.startsWith('MOCK_')) delete isolatedEnvironment[name]
}

async function availablePort() {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

async function boot(args, environment, ready) {
  const child = spawn(process.execPath, args, { cwd: project, env: { ...isolatedEnvironment, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] })
  processes.push(child)
  let logs = ''
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Startup timed out: ${logs.slice(-3000)}`)) }, 15000)
    const record = buffer => {
      logs = (logs + String(buffer)).slice(-6000)
      if (logs.includes(ready)) { clearTimeout(timeout); resolve() }
    }
    child.stdout.on('data', record)
    child.stderr.on('data', record)
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Capture server exited (${code}): ${logs.slice(-3000)}`)) })
  })
  return child
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise(resolve => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000)
    child.once('exit', () => { clearTimeout(timeout); resolve() })
    child.kill()
  })
}

async function main() {
  assert.ok(existsSync(path.join(project, 'dist/web/index.html')), 'Run npm run build first')
  assert.ok(existsSync(path.join(project, 'dist/server/index.js')), 'Run npm run build first')
  mkdirSync(output, { recursive: true })
  const mockPort = await availablePort()
  const agentPort = await availablePort()
  await boot(['--import', 'tsx', 'server/dev/mock-proxmox.ts'], { MOCK_PORT: String(mockPort) }, 'Mock Proxmox API')
  await boot(['dist/server/index.js'], { PORT: String(agentPort), HOST: '127.0.0.1', LOG_LEVEL: 'info', PROXMIU_DATA_DIR: dataDirectory }, 'Server listening')
  const origin = `http://127.0.0.1:${agentPort}`
  const api = async (route, method = 'GET', body) => {
    const response = await fetch(`${origin}/api${route}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const data = await response.json()
    assert.equal(response.status, 200, `${method} ${route}: ${JSON.stringify(data)}`)
    return data
  }
  const connection = await api('/clusters', 'POST', { name: 'Homelab', host: '127.0.0.1', port: mockPort, authType: 'token', username: 'root@pam!proxmiu', secret: 'mock', verifyTls: false })
  const guestApi = `/clusters/${connection.id}/guests/pve1/lxc/110`
  const notes = await api(`${guestApi}/notes`)
  const note = 'Claude Code development workspace.\nReview resource history before changing allocations.\nCreate a snapshot before system updates.'
  await api(`${guestApi}/notes`, 'PUT', { notes: note, digest: notes.digest })
  assert.equal((await api('/ai/settings')).configured, false, 'Capture must not have a saved AI token')
  const guestRoute = `${origin}/guests/${connection.id}/pve1/lxc/110`
  let browser
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, reducedMotion: 'reduce', colorScheme: 'dark' })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => { localStorage.setItem('proxmiu-theme', 'dark') })
    const capture = async name => {
      await page.evaluate(() => document.fonts.ready)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth), `${name} must fit its viewport`)
      const destination = path.join(output, name)
      await page.screenshot({ path: destination, fullPage: true, animations: 'disabled' })
      screenshots.push(destination)
    }
    const scrollTop = () => page.locator('main').evaluate(element => { element.scrollTop = 0 })
    const scrollTo = async heading => page.getByRole('heading', { name: heading, exact: true }).evaluate(element => {
      const main = document.querySelector('main')
      main.scrollTop += element.getBoundingClientRect().top - main.getBoundingClientRect().top - (innerWidth < 640 ? 68 : 20)
    })

    await page.goto(guestRoute, { waitUntil: 'networkidle' })
    await page.getByText('Saved in Proxmox', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('Guest notes', { exact: true }).inputValue(), note)
    await page.getByLabel('Snapshot name', { exact: true }).fill('before-maintenance')
    await page.getByLabel('Snapshot description', { exact: true }).fill('Restore point before system updates')
    await page.getByRole('button', { name: 'Create snapshot', exact: true }).click()
    await page.getByText('Task completed', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Roll back before-maintenance', exact: true }).waitFor()
    assert.ok((await api(`${guestApi}/operations`)).snapshots.some(snapshot => snapshot.name === 'before-maintenance'))
    await page.getByLabel('Snapshot name', { exact: true }).fill('')
    await page.getByLabel('Snapshot description', { exact: true }).fill('')
    await scrollTop()
    await capture('guest-desktop.png')
    await scrollTo('Snapshots, backups & migration')
    await capture('operations-desktop.png')

    await page.setViewportSize({ width: 390, height: 844 })
    await scrollTop()
    await capture('guest-mobile.png')
    await scrollTo('Guest notes')
    await capture('notes-mobile.png')
    await scrollTo('Snapshots, backups & migration')
    await capture('operations-mobile.png')
    await scrollTo('Backups')
    await capture('backup-migration-mobile.png')

    await page.goto(`${origin}/settings`, { waitUntil: 'networkidle' })
    await page.getByText('No AI token configured', { exact: true }).waitFor()
    assert.ok(await page.getByRole('button', { name: 'Preview inventory', exact: true }).isDisabled())
    await scrollTop()
    await capture('ai-mobile.png')
    await scrollTo('Review resource usage')
    await capture('ai-preview-mobile.png')
    await page.setViewportSize({ width: 1440, height: 1200 })
    await scrollTop()
    await capture('ai-desktop.png')

    await page.goto(origin, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Meet your lynx', exact: true }).click()
    await page.getByRole('button', { name: 'Pet the lynx', exact: true }).waitFor()
    await scrollTop()
    await capture('overview-companion-desktop.png')
    assert.deepEqual(errors, [])
    assert.equal((await api('/ai/settings')).configured, false)
    const metadata = {
      generatedAt: new Date().toISOString(),
      source: 'Built Proxmiu app and real local agent connected to server/dev/mock-proxmox.ts',
      synthetic: true,
      caption: 'Screenshots use synthetic data from the bundled Proxmox mock. They do not show a real Proxmox host.',
      ai: 'Unconfigured real AI settings endpoint; no token saved and no provider calls made.',
      viewports: { desktop: { width: 1440, height: 1200 }, mobile: { width: 390, height: 844 } },
      screenshots,
    }
    writeFileSync(path.join(output, 'capture.json'), JSON.stringify(metadata, null, 2) + '\n')
    console.log(metadata.caption)
    console.log(screenshots.join('\n'))
  } finally { if (browser) await browser.close() }
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  for (const child of processes.reverse()) await stop(child)
  rmSync(dataDirectory, { recursive: true, force: true })
})
