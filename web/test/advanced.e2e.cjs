// After npm run build:web: CHROMIUM_PATH=/usr/bin/chromium node web/test/advanced.e2e.cjs
// All agent requests are intercepted; no Proxmox host or AI provider is contacted.
const { chromium } = require('playwright')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const root = path.resolve(__dirname, '../../dist/web')
  assert.ok(fs.existsSync(path.join(root, 'index.html')), 'Run npm run build:web first')
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    let file = path.join(root, decodeURIComponent(pathname))
    if (!file.startsWith(root + path.sep) && file !== root) { response.writeHead(403); response.end(); return }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      if (pathname.startsWith('/assets/')) { response.writeHead(404); response.end(); return }
      file = path.join(root, 'index.html')
    }
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(response)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const base = `http://127.0.0.1:${server.address().port}`
    const waitForCompletedTask = async number => {
      await page.getByText(`UPID:pve1:task-${number}`, { exact: true }).waitFor({ state: 'attached' })
      await page.getByText('Task completed', { exact: true }).waitFor()
      assert.ok(taskPolls >= 2, `Task ${number} must reach its own stopped state`)
    }
    const capture = async name => {
      if (!process.env.SCREENSHOT_DIR) return
      fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true })
      await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, name), fullPage: true })
    }
    const scrollToHeading = async name => {
      await page.getByRole('heading', { name, exact: true }).evaluate(element => {
        const main = document.querySelector('main')
        main.scrollTop += element.getBoundingClientRect().top - main.getBoundingClientRect().top - (innerWidth < 640 ? 68 : 20)
      })
    }
    const fitsViewport = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth)
    const guest = { id: 'lxc/110', type: 'lxc', vmid: 110, node: 'pve1', name: 'notes-test-with-a-long-name-that-wraps-comfortably-on-a-phone', status: 'running', cpu: .2, maxcpu: 2, mem: 1024, maxmem: 4096 }
    const cluster = { id: 'fixture', name: 'Test homelab', host: '127.0.0.1', ok: true, nodes: [{ id: 'node/pve1', type: 'node', node: 'pve1', status: 'online' }], guests: [guest] }
    let notes = { notes: 'Already in Proxmox', digest: 'version-1', legacyNotes: 'Old agent notes' }
    let notesFailure = false
    let noteWrites = 0
    const operations = []
    let taskPolls = 0
    let taskExit = 'ERROR: backup storage is full'
    let holdMigration = false
    let settings = { configured: false, provider: 'openai', model: 'gpt-4o-mini' }
    let savedSettings
    const context = { clusters: [{ nodes: [{ cpu: .2, maxcpu: 8, mem: 4096, maxmem: 8192 }], guests: [{ type: 'lxc', status: 'running', cpu: .2, maxcpu: 2, mem: 1024, maxmem: 4096 }] }], unavailableConnections: 1 }
    let reviewFailure = true
    let aiAdvice = 'Check memory headroom.\n<script>Never execute this</script>'
    const reviews = []
    await page.route('**/api/**', async route => {
      const request = route.request()
      const url = new URL(request.url())
      const body = request.method() === 'GET' ? undefined : request.postDataJSON()
      let data = {}
      if (url.pathname === '/api/health') data = { name: 'proxmiu-agent', version: 'test', authRequired: false }
      else if (url.pathname === '/api/auth/status') data = { authRequired: false, authenticated: true }
      else if (url.pathname === '/api/overview') data = { clusters: [cluster] }
      else if (url.pathname.endsWith('/insights')) data = { config: { networks: [], disks: [] }, metrics: [] }
      else if (url.pathname.endsWith('/resource-settings')) data = { cores: 2, sockets: 1, memoryMiB: 2048, onboot: true, digest: 'a'.repeat(40), status: 'running', pending: false, editable: false, reason: 'Shut down this guest before editing its allocation.' }
      else if (url.pathname.endsWith('/backups')) data = { backups: [], errors: [], truncated: false }
      else if (url.pathname.endsWith('/ips')) data = { 'lxc/110': '192.0.2.10' }
      else if (url.pathname === '/api/templates' || url.pathname === '/api/jobs') data = []
      else if (url.pathname === '/api/guest-metadata') data = {}
      else if (url.pathname.endsWith('/notes')) {
        if (request.method() === 'PUT') {
          noteWrites++
          if (notesFailure) return route.fulfill({ status: 503, json: { error: 'Proxmox is unavailable. Try again.' } })
          if (body.digest !== notes.digest) return route.fulfill({ status: 409, json: { error: 'Notes changed in Proxmox. Reload before saving.' } })
          notes = { ...notes, notes: body.notes, digest: `version-${noteWrites + 1}` }
        }
        data = notes
      } else if (url.pathname.endsWith('/operations')) {
        if (request.method() === 'POST') {
          operations.push(body)
          if (body.action === 'migrate') { guest.node = body.target; holdMigration = true }
          taskPolls = 0
          data = { upid: `UPID:pve1:task-${operations.length}`, node: 'pve1' }
        } else data = { snapshots: [{ name: 'before-upgrade', description: 'Known good', snaptime: 1700000000 }], storages: ['backup-store'], targets: ['pve2'], errors: ['Some storage information is unavailable: permission denied'] }
      } else if (url.pathname.includes('/tasks/')) {
        taskPolls++
        data = taskPolls === 1 || holdMigration ? { status: 'running' } : { status: 'stopped', exitstatus: taskExit }
      } else if (url.pathname === '/api/settings') data = { sshPublicKey: 'ssh-ed25519 fixture', sshKeyCreatedAt: new Date().toISOString(), authRequired: false }
      else if (url.pathname === '/api/self-update') data = { enabled: false, status: { state: 'idle' }, available: false }
      else if (url.pathname === '/api/ai/settings') {
        if (request.method() === 'PUT') { savedSettings = body; settings = { configured: true, provider: body.provider, model: body.model } }
        if (request.method() === 'DELETE') settings = { ...settings, configured: false }
        data = settings
      } else if (url.pathname === '/api/ai/context') data = context
      else if (url.pathname === '/api/ai/review') {
        reviews.push(body)
        if (reviewFailure) return route.fulfill({ status: 502, json: { error: 'AI provider unavailable. Try again later.' } })
        data = { advice: aiAdvice }
      } else return route.fulfill({ status: 404, json: { error: 'No fixture for this API' } })
      return route.fulfill({ json: data })
    })
    await page.goto(`${base}/guests/fixture/pve1/lxc/110`, { waitUntil: 'networkidle' })
    const editor = page.getByLabel('Guest notes', { exact: true })
    await page.getByText('Saved in Proxmox', { exact: true }).waitFor()
    assert.equal(await editor.inputValue(), 'Already in Proxmox')
    assert.equal(noteWrites, 0, 'Legacy notes must never be written automatically')
    await editor.fill('Updated in the workspace')
    await page.getByRole('button', { name: 'Save notes', exact: true }).click()
    await page.getByText('Notes saved', { exact: true }).first().waitFor()
    assert.equal(notes.notes, 'Updated in the workspace')
    await editor.fill('')
    await page.getByRole('button', { name: 'Save notes', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('#guest-notes')?.value === '' && [...document.querySelectorAll('button')].some(button => button.textContent === 'Save notes' && button.disabled))
    assert.equal(notes.notes, '', 'Clearing notes must save an empty Proxmox description')
    await editor.fill('Keep my draft')
    notesFailure = true
    await page.getByRole('button', { name: 'Save notes', exact: true }).click()
    await page.getByText('Proxmox is unavailable. Try again.', { exact: true }).waitFor()
    assert.equal(await editor.inputValue(), 'Keep my draft')
    notesFailure = false
    notes = { ...notes, notes: 'Changed outside Proxmiu', digest: 'outside-version' }
    await page.getByRole('button', { name: 'Save notes', exact: true }).click()
    await page.getByText('Notes changed in Proxmox. Reload before saving.', { exact: true }).waitFor()
    assert.equal(await editor.inputValue(), 'Keep my draft')
    await page.getByRole('button', { name: 'Reload Proxmox notes', exact: true }).click()
    const reload = page.getByRole('dialog')
    await reload.getByRole('button', { name: 'Reload notes', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('#guest-notes')?.value === 'Changed outside Proxmiu')
    await page.getByText('Recover old agent notes', { exact: true }).click()
    await page.getByRole('button', { name: 'Copy old notes into draft', exact: true }).click()
    assert.equal(await editor.inputValue(), 'Old agent notes')
    assert.equal(notes.notes, 'Changed outside Proxmiu', 'Recovery creates a draft and must not overwrite Proxmox')

    await page.getByText('Some storage information is unavailable: permission denied', { exact: true }).waitFor()
    await page.getByLabel('Snapshot name', { exact: true }).fill('before-change')
    await page.getByRole('button', { name: 'Create snapshot', exact: true }).click()
    await page.getByText('Task running', { exact: true }).waitFor()
    await page.getByText('ERROR: backup storage is full', { exact: true }).waitFor()
    assert.deepEqual(operations[0], { action: 'snapshot', name: 'before-change' })
    assert.ok(taskPolls >= 2, 'Task must be polled until stopped')
    taskExit = 'OK'
    await page.getByRole('button', { name: 'Create backup', exact: true }).click()
    await waitForCompletedTask(2)
    assert.deepEqual(operations[1], { action: 'backup', storage: 'backup-store' })
    await page.getByRole('button', { name: 'Roll back before-upgrade', exact: true }).click()
    const rollback = page.getByRole('dialog')
    assert.ok(await rollback.getByRole('button', { name: 'Roll back', exact: true }).isDisabled())
    await rollback.getByRole('textbox').fill('wrong-name')
    assert.ok(await rollback.getByRole('button', { name: 'Roll back', exact: true }).isDisabled())
    await rollback.getByRole('textbox').fill(guest.name)
    await rollback.getByRole('button', { name: 'Roll back', exact: true }).click()
    await waitForCompletedTask(3)
    assert.deepEqual(operations[2], { action: 'rollback', name: 'before-upgrade', confirm: guest.name })
    await page.getByRole('button', { name: 'Delete snapshot before-upgrade', exact: true }).click()
    const deletion = page.getByRole('dialog')
    assert.ok(await deletion.getByRole('button', { name: 'Delete snapshot', exact: true }).isDisabled())
    await deletion.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: 'Migrate guest', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Migrate', exact: true }).click()
    await page.getByText('Task running', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Refresh guest', exact: true }).click()
    await page.getByText('Container 110 · pve2', { exact: true }).waitFor()
    assert.equal(await page.getByText('UPID:pve1:task-4', { exact: true }).count(), 1, 'Moving nodes must retain the original task and source-node polling')
    assert.ok(await page.getByRole('button', { name: 'Create backup', exact: true }).isDisabled(), 'Do not allow another operation while migration is unconfirmed')
    assert.equal(await editor.inputValue(), 'Old agent notes', 'A node move must preserve an unsaved note draft')
    holdMigration = false
    await waitForCompletedTask(4)
    assert.deepEqual(operations[3], { action: 'migrate', target: 'pve2' })
    await page.locator('main').evaluate(element => { element.scrollTop = 0 })
    await capture('guest-desktop.png')
    await scrollToHeading('Snapshots, backups & migration')
    await capture('operations-desktop.png')
    await page.setViewportSize({ width: 390, height: 844 })
    assert.ok(await fitsViewport(), 'Guest workspace must fit 390px')
    await page.locator('main').evaluate(element => { element.scrollTop = 0 })
    await capture('guest-mobile.png')
    await scrollToHeading('Guest notes')
    await capture('notes-mobile.png')
    await scrollToHeading('Snapshots, backups & migration')
    await capture('operations-mobile.png')

    await page.goto(`${base}/settings`, { waitUntil: 'networkidle' })
    const token = page.getByLabel('API token', { exact: true })
    assert.equal(await token.getAttribute('type'), 'password')
    await token.fill('secret-fixture-token')
    await page.getByLabel('Model', { exact: true }).fill('custom-model')
    await page.getByRole('button', { name: 'Save AI settings', exact: true }).click()
    await page.getByText('Token saved on your agent', { exact: true }).waitFor()
    assert.equal(await token.inputValue(), '', 'Token input must be cleared after save')
    assert.deepEqual(savedSettings, { provider: 'openai', model: 'custom-model', token: 'secret-fixture-token' })
    await page.getByRole('button', { name: 'Preview inventory', exact: true }).click()
    const preview = page.getByLabel('Inventory preview', { exact: true })
    await preview.waitFor()
    const previewed = JSON.parse(await preview.textContent())
    assert.deepEqual(previewed, context)
    const reviewButton = page.getByRole('button', { name: 'Request advice', exact: true })
    assert.ok(await reviewButton.isDisabled(), 'Review requires explicit consent')
    await page.getByLabel('Send this inventory to the configured AI provider for this review.', { exact: true }).check()
    await reviewButton.click()
    await page.getByText('AI provider unavailable. Try again later.', { exact: true }).waitFor()
    assert.deepEqual(reviews[0], { consent: true, context: previewed })
    reviewFailure = false
    await page.getByLabel('Send this inventory to the configured AI provider for this review.', { exact: true }).check()
    await reviewButton.click()
    await page.getByText('Check memory headroom.', { exact: false }).waitFor()
    assert.equal(await page.locator('script').filter({ hasText: 'Never execute this' }).count(), 0)
    assert.ok((await page.getByLabel('AI advice', { exact: true }).textContent()).includes('<script>Never execute this</script>'))
    aiAdvice = 'Illustrative advice for this mock inventory:\n\nCheck memory headroom before increasing allocations. Compare readings across a longer period, and review storage and target compatibility before migration. No changes have been made.'
    await page.getByLabel('Send this inventory to the configured AI provider for this review.', { exact: true }).check()
    await reviewButton.click()
    await page.getByText('Illustrative advice for this mock inventory:', { exact: false }).waitFor()
    assert.ok(await fitsViewport(), 'AI settings must fit 390px')
    await page.locator('main').evaluate(element => { element.scrollTop = 0 })
    await capture('ai-mobile.png')
    await scrollToHeading('Review resource usage')
    await capture('ai-review-mobile.png')
    await page.setViewportSize({ width: 1440, height: 1100 })
    await page.locator('main').evaluate(element => { element.scrollTop = 0 })
    await capture('ai-desktop.png')
    await page.getByRole('button', { name: 'Remove token', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Remove token', exact: true }).click()
    await page.getByText('No AI token configured', { exact: true }).waitFor()
    assert.equal(settings.configured, false)
    assert.ok(await page.getByRole('button', { name: 'Preview inventory', exact: true }).isDisabled())
    assert.deepEqual(errors, [])
    console.log('PASS: Proxmox notes save/clear/error/conflict/recovery; partial operation reads and task completion/failure; typed snapshot confirmations; backup/migration; AI token removal, exact preview consent, provider failure and plain-text advice; 390px layouts')
  } finally {
    if (browser) await browser.close()
    server.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
