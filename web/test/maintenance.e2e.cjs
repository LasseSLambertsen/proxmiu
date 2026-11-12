// After npm run build:web: CHROMIUM_PATH=/usr/bin/chromium node web/test/maintenance.e2e.cjs
// Requests terminate at this fixture boundary; no Proxmox host or provider is contacted.
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
    const failures = []
    const unexpected = []
    page.on('pageerror', error => failures.push(error.message))
    const guest = { id: 'qemu/110', type: 'qemu', vmid: 110, node: 'pve1', name: 'maintenance-test', status: 'stopped', maxcpu: 4, maxmem: 2147483648 }
    const cluster = { id: 'fixture', name: 'Test homelab', host: '127.0.0.1', ok: true, nodes: [{ id: 'node/pve1', type: 'node', node: 'pve1', status: 'online' }], guests: [guest] }
    let resource = { cores: 2, sockets: 2, memoryMiB: 2048, onboot: false, digest: 'digest-1', status: 'stopped', pending: false, editable: true }
    let saveFailure = false
    const writes = []
    const operations = []
    const backupReads = []
    let backupResponse = { backups: [], errors: ['Backup storage unavailable: permission denied'], truncated: false }
    let backupFailure = false
    const logReads = []
    let logFailure = false
    let taskSequence = 0
    let taskState = 'stopped'
    const taskSourceReads = []
    await page.route('**/api/**', async route => {
      const request = route.request()
      const url = new URL(request.url())
      const method = request.method()
      const body = method === 'GET' ? undefined : request.postDataJSON()
      let data
      if (url.pathname === '/api/health') data = { name: 'proxmiu-agent', version: 'test', authRequired: false }
      else if (url.pathname === '/api/auth/status') data = { authRequired: false, authenticated: true }
      else if (url.pathname === '/api/overview') data = { clusters: [cluster] }
      else if (url.pathname.endsWith('/task-history')) data = { tasks: [], next: 0, hasMore: false, warnings: [] }
      else if (url.pathname === '/api/templates' || url.pathname === '/api/jobs') data = []
      else if (url.pathname === '/api/guest-metadata') data = {}
      else if (url.pathname === '/api/ai/settings') data = { configured: false, provider: 'openai', model: 'fixture' }
      else if (url.pathname === '/api/clusters/fixture/ips') data = {}
      else if (/^\/api\/clusters\/fixture\/guests\/pve[12]\/qemu\/110\/insights$/.test(url.pathname)) data = { config: { cores: resource.cores, sockets: 2, memory: resource.memoryMiB, networks: [], disks: [] }, metrics: [] }
      else if (/^\/api\/clusters\/fixture\/guests\/pve[12]\/qemu\/110\/notes$/.test(url.pathname) && method === 'GET') data = { notes: '', digest: 'notes-1' }
      else if (/^\/api\/clusters\/fixture\/guests\/pve[12]\/qemu\/110\/resource-settings$/.test(url.pathname)) {
        if (method === 'PUT') {
          writes.push({ path: url.pathname, body })
          if (saveFailure) return route.fulfill({ status: 503, json: { error: 'Resource save unavailable. Try again.' } })
          if (body.digest !== resource.digest) return route.fulfill({ status: 409, json: { error: 'Resource settings changed in Proxmox. Reload before saving.' } })
          resource = { ...resource, ...body, digest: `saved-${writes.length}` }
        } else assert.equal(method, 'GET')
        data = resource
      } else if (/^\/api\/clusters\/fixture\/guests\/pve[12]\/qemu\/110\/operations$/.test(url.pathname)) {
        if (method === 'POST') {
          operations.push(body)
          taskSequence++
          data = { upid: `UPID:pve1:maintenance-${taskSequence}`, node: 'pve1' }
        } else data = { snapshots: [], storages: ['backup-store', 'archive'], targets: ['pve2'], errors: [] }
      } else if (/^\/api\/clusters\/fixture\/guests\/pve[12]\/qemu\/110\/backups$/.test(url.pathname) && method === 'GET') {
        backupReads.push({ path: url.pathname, search: url.search })
        assert.ok(['?storage=backup-store', '?storage=archive'].includes(url.search), `Unexpected backup selection: ${url.search}`)
        if (backupFailure) return route.fulfill({ status: 503, json: { error: 'Backup inventory connection failed.' } })
        data = backupResponse
      } else if (/^\/api\/clusters\/fixture\/tasks\/pve1\/UPID%3Apve1%3Amaintenance-\d+\/log$/.test(url.pathname) && method === 'GET') {
        assert.ok(/^\?start=\d+$/.test(url.search), `Unexpected log cursor: ${url.search}`)
        const start = Number(url.searchParams.get('start'))
        logReads.push({ path: url.pathname, start })
        if (logFailure) return route.fulfill({ status: 502, json: { error: 'Task log could not be read.' } })
        data = { lines: Array.from({ length: 200 }, (_, index) => ({ n: start + index + 1, t: start + index === 0 ? '<script>window.taskLogExecuted = true</script>' : `Diagnostic line ${start + index + 1}` })), next: start + 200, truncated: start === 0 }
      } else if (/^\/api\/clusters\/fixture\/tasks\/pve1\/UPID%3Apve1%3Amaintenance-\d+$/.test(url.pathname) && method === 'GET') {
        taskSourceReads.push(url.pathname)
        data = { status: taskState, ...(taskState === 'stopped' ? { exitstatus: 'OK' } : {}) }
      } else {
        unexpected.push(`${method} ${url.pathname}${url.search}`)
        return route.fulfill({ status: 404, json: { error: 'No fixture for this API request' } })
      }
      return route.fulfill({ json: data })
    })
    const base = `http://127.0.0.1:${server.address().port}`
    const capture = async name => {
      if (!process.env.SCREENSHOT_DIR) return
      fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true })
      await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, name), fullPage: true })
    }
    const showSection = async name => page.getByRole('heading', { name, exact: true }).evaluate(element => {
      const main = document.querySelector('main')
      main.scrollTop += element.getBoundingClientRect().top - main.getBoundingClientRect().top - (innerWidth < 640 ? 68 : 20)
    })
    await page.goto(`${base}/guests/fixture/pve1/qemu/110`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Resource settings', exact: true }).waitFor()
    const cores = page.getByLabel('Cores per socket', { exact: true })
    const memory = page.getByLabel('Memory (MiB)', { exact: true })
    const review = page.getByRole('button', { name: 'Review resource changes', exact: true })
    assert.equal(await cores.inputValue(), '2')
    assert.equal(await memory.inputValue(), '2048')
    assert.ok(await review.isDisabled(), 'Unchanged settings must not save')
    await page.getByText('2 sockets', { exact: false }).first().waitFor()
    for (const value of ['0', '129', '1.5', '']) {
      await cores.fill(value)
      assert.ok(await review.isDisabled(), `Reject cores ${value}`)
    }
    await cores.fill('4')
    for (const value of ['15', '1048577', '16.5', '']) {
      await memory.fill(value)
      assert.ok(await review.isDisabled(), `Reject memory ${value}`)
    }
    await memory.fill('4096')
    await page.getByRole('switch', { name: 'Start at boot', exact: true }).click()
    await review.click()
    assert.equal(writes.length, 0, 'Review must not save before confirmation')
    const confirm = page.getByRole('dialog')
    assert.ok((await confirm.textContent()).includes('2 → 4'))
    assert.ok((await confirm.textContent()).includes('2048 → 4096'))
    await confirm.getByRole('button', { name: 'Apply resource changes', exact: true }).click()
    await page.getByText('Resource settings saved', { exact: true }).waitFor()
    assert.deepEqual(writes[0], { path: '/api/clusters/fixture/guests/pve1/qemu/110/resource-settings', body: { cores: 4, memoryMiB: 4096, onboot: true, digest: 'digest-1' } })
    await cores.fill('6')
    saveFailure = true
    await review.click()
    await page.getByRole('dialog').getByRole('button', { name: 'Apply resource changes', exact: true }).click()
    await page.getByRole('dialog').getByText('Resource save unavailable. Try again.', { exact: true }).waitFor()
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    assert.equal(await cores.inputValue(), '6')
    saveFailure = false
    resource = { ...resource, cores: 8, digest: 'external-digest' }
    await review.click()
    await page.getByRole('dialog').getByRole('button', { name: 'Apply resource changes', exact: true }).click()
    await page.getByRole('dialog').getByText('Resource settings changed in Proxmox. Reload before saving.', { exact: true }).waitFor()
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    assert.equal(await cores.inputValue(), '6', 'Conflict must preserve the draft')
    assert.ok(await review.isDisabled(), 'Stale writes require explicit reload')

    taskState = 'running'
    await page.getByRole('button', { name: 'Migrate guest', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Migrate', exact: true }).click()
    await page.getByText('Task running', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Load task log', exact: true }).click()
    await page.getByLabel('Task log lines', { exact: true }).getByText('<script>window.taskLogExecuted = true</script>', { exact: true }).waitFor()
    assert.deepEqual(logReads[0], { path: '/api/clusters/fixture/tasks/pve1/UPID%3Apve1%3Amaintenance-1/log', start: 0 })
    assert.equal(await page.evaluate(() => window.taskLogExecuted), undefined)
    guest.node = 'pve2'
    await page.getByRole('button', { name: 'Refresh guest', exact: true }).click()
    await page.getByText('Virtual machine 110 · pve2', { exact: true }).waitFor()
    assert.equal(await cores.inputValue(), '6', 'Node migration must retain the resource draft')
    logFailure = true
    await page.getByRole('button', { name: 'Load more log lines', exact: true }).click()
    await page.getByText('Task log could not be read.', { exact: true }).waitFor()
    assert.ok((await page.getByLabel('Task log lines', { exact: true }).textContent()).includes('<script>window.taskLogExecuted = true</script>'), 'Failed log reads retain prior lines')
    logFailure = false
    await page.getByRole('button', { name: 'Load more log lines', exact: true }).click()
    await page.getByLabel('Task log lines', { exact: true }).getByText('Diagnostic line 400', { exact: true }).waitFor()
    assert.equal(logReads.at(-1).start, 200, 'Retry retains the failed cursor')
    assert.ok(logReads.every(read => read.path.includes('/tasks/pve1/')), 'Task logs retain the original node after migration')
    for (let count = 400; count < 2000; count += 200) {
      await page.getByRole('button', { name: 'Load more log lines', exact: true }).click()
      await page.getByLabel('Task log lines', { exact: true }).getByText(`Diagnostic line ${count + 200}`, { exact: true }).waitFor()
    }
    assert.ok(await page.getByRole('button', { name: 'Load more log lines', exact: true }).isDisabled(), 'Display must stop at 2000 lines')
    await page.getByText('Open Proxmox for the full task log.', { exact: false }).waitFor()
    assert.equal(logReads.at(-1).start, 1800)
    taskState = 'stopped'
    await page.getByText('Task completed', { exact: true }).waitFor()
    assert.ok(taskSourceReads.every(value => value.includes('/tasks/pve1/')))
    assert.deepEqual(operations[0], { action: 'migrate', target: 'pve2' })

    await page.getByRole('button', { name: 'Reload resource settings', exact: true }).click()
    assert.equal(await cores.inputValue(), '6', 'Reload review preserves the draft until confirmed')
    await page.getByRole('dialog').getByRole('button', { name: 'Reload settings', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('input[aria-label="Cores per socket"]')?.value === '8')
    resource = { ...resource, status: 'running', editable: false, reason: 'Stop the guest in Proxmox before editing resource settings.' }
    await page.getByRole('button', { name: 'Reload resource settings', exact: true }).click()
    await page.getByText(resource.reason, { exact: true }).waitFor()
    assert.ok(await cores.isDisabled())
    resource = { ...resource, status: 'stopped', pending: true, reason: 'Pending changes must be resolved in Proxmox.' }
    await page.getByRole('button', { name: 'Reload resource settings', exact: true }).click()
    await page.getByText(resource.reason, { exact: true }).waitFor()
    assert.ok(await memory.isDisabled())
    resource = { ...resource, cores: null, memoryMiB: null, pending: false, reason: 'This guest uses an unsupported memory configuration.' }
    await page.getByRole('button', { name: 'Reload resource settings', exact: true }).click()
    await page.getByText(resource.reason, { exact: true }).waitFor()
    assert.equal(await memory.inputValue(), '', 'Unsupported memory must not acquire a default')
    assert.ok(await review.isDisabled())
    assert.equal(writes.length, 3, 'Running/pending/unsupported states must not write or trigger power actions')

    await page.getByText('Backup storage unavailable: permission denied', { exact: true }).waitFor()
    assert.equal(await page.getByText('No backups found on this storage.', { exact: true }).count(), 0, 'Partial permission errors must not claim empty success')
    backupResponse = { backups: [], errors: [], truncated: false }
    await page.getByRole('button', { name: 'Refresh backup inventory', exact: true }).click()
    await page.getByText('No backups found on this storage.', { exact: true }).waitFor()
    backupFailure = true
    await page.getByRole('button', { name: 'Refresh backup inventory', exact: true }).click()
    await page.getByText('Backup inventory connection failed.', { exact: false }).waitFor()
    backupFailure = false
    backupResponse = { backups: [{ storage: 'archive', volid: 'archive:backup/vzdump-qemu-110-2026_11_03-10_00_00.vma.zst', size: 1073741824, ctime: 1793700000, format: 'vma.zst' }], errors: [], truncated: true }
    await page.getByLabel('Browse backup storage', { exact: true }).selectOption('archive')
    await page.getByText(backupResponse.backups[0].volid, { exact: true }).waitFor()
    assert.equal(backupReads.at(-1).search, '?storage=archive')
    await page.getByText('1.0 GiB', { exact: true }).waitFor()
    await page.getByText('vma.zst', { exact: true }).waitFor()
    await page.getByText('Showing the newest 500 backups.', { exact: false }).waitFor()
    const readsBeforeBackup = backupReads.length
    const refreshedBackups = page.waitForResponse(response => response.url().includes('/backups?storage=archive'))
    await page.getByRole('button', { name: 'Create backup', exact: true }).click()
    await page.getByText('Task completed', { exact: true }).waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('code')].some(element => element.textContent === 'UPID:pve1:maintenance-2'))
    await refreshedBackups
    assert.ok(backupReads.length > readsBeforeBackup, 'Completed backup refreshes inventory')
    assert.deepEqual(operations[1], { action: 'backup', storage: 'backup-store' })
    assert.equal(await page.getByRole('button', { name: 'Load task log', exact: true }).count(), 1, 'New tracked tasks start with a separate unloaded log')
    assert.equal(logReads.length, 11, 'Task logs load only on explicit request')

    resource = { cores: 8, sockets: 2, memoryMiB: 4096, onboot: true, digest: 'final-digest', status: 'stopped', pending: false, editable: true }
    await page.getByRole('button', { name: 'Reload resource settings', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('input[aria-label="Memory (MiB)"]')?.value === '4096')
    await showSection('Resource settings')
    await capture('maintenance-desktop.png')
    await page.setViewportSize({ width: 390, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth), 'Maintenance workspace must fit 390px')
    await showSection('Resource settings')
    await capture('maintenance-mobile.png')
    await showSection('Existing backups')
    await capture('backups-mobile.png')
    await page.getByRole('button', { name: 'Load task log', exact: true }).click()
    await page.getByLabel('Task log lines', { exact: true }).getByText('<script>window.taskLogExecuted = true</script>', { exact: true }).waitFor()
    await showSection('Task log')
    await capture('task-log-mobile.png')
    assert.deepEqual(unexpected, [], 'Every API request must have an explicit fixture contract')
    assert.deepEqual(failures, [])
    console.log('PASS: resource validation/review/save/failure/conflict/reload and migration draft; running/pending/unsupported states; backup errors/empty/results/storage/completion refresh; source-node plain-text paged bounded task logs; 390px layout')
  } finally {
    if (browser) await browser.close()
    server.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
