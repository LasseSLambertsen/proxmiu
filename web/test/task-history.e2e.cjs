// After npm run build:web: CHROMIUM_PATH=/usr/bin/chromium node web/test/task-history.e2e.cjs
// Only agent HTTP responses are replaced; the shipped UI, routing and query lifecycle run normally.
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
    if (!file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return }
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
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
    page.setDefaultTimeout(8000)
    const failures = []
    const unexpected = []
    page.on('pageerror', error => failures.push(error.message))
    const guest = { id: 'qemu/110', type: 'qemu', vmid: 110, node: 'pve1', name: 'history-test', status: 'stopped', maxcpu: 2, maxmem: 2147483648 }
    const clusters = [
      { id: 'fixture', name: 'Test homelab', host: '127.0.0.1', ok: true, nodes: ['pve1', 'pve2'].map(node => ({ id: `node/${node}`, type: 'node', node, status: 'online' })), guests: [guest] },
      { id: 'archive', name: 'Archive connection', host: '127.0.0.2', ok: true, nodes: [{ id: 'node/pve9', type: 'node', node: 'pve9', status: 'online' }], guests: [] },
    ]
    const native = (index, node = 'pve1') => ({ upid: `UPID:${node}:00000001:00000001:${index.toString(16).padStart(8, '0')}:qmstart:110:root@pam:`, node, type: `qmstart-${index}`, vmid: 110, starttime: 1793700000 - index, endtime: 1793700001, state: 'success', status: 'OK' })
    const running = { ...native(1), type: 'qmigrate', state: 'running', status: 'running', endtime: undefined }
    const failed = { ...native(2), type: 'vzdump', state: 'error', status: '<script>window.historyExecuted = true</script>' }
    const warning = { ...native(3), type: 'qmsnapshot', state: 'warning', status: 'WARNINGS: one file skipped' }
    const unknown = { ...native(4), type: 'qmstop', state: 'unknown', status: '' }
    const tasks = [running, failed, warning, unknown, ...Array.from({ length: 246 }, (_, index) => native(index + 5))]
    const historyReads = []
    const statusReads = []
    const logReads = []
    let historyFailure = false
    let historyEmpty = false
    let historyWarnings = true
    let statusFailure = 0
    let liveStatus = { status: 'running' }
    let logFailure = false
    let releaseHistory
    let delayHistory = false
    let releaseStatus
    let delayStatus = false
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      let data
      if (url.pathname === '/api/health') data = { name: 'proxmiu-agent', version: 'test', authRequired: false }
      else if (url.pathname === '/api/auth/status') data = { authRequired: false, authenticated: true }
      else if (url.pathname === '/api/overview') data = { clusters }
      else if (url.pathname === '/api/templates') data = []
      else if (url.pathname === '/api/ai/settings') data = { configured: false, provider: 'openai', model: 'gpt-4o-mini' }
      else if (url.pathname === '/api/jobs/status') data = { available: true, writable: true, retention: { maxJobs: 50, maxLogLines: 5000, maxJobBytes: 131072 } }
      else if (url.pathname === '/api/jobs') data = [{ id: 'old-job', title: 'Earlier provisioning', createdAt: '2026-11-03T08:00:00Z', status: 'success', steps: [], log: ['Provisioning log retained across restarts'] }]
      else if (url.pathname === '/api/jobs/old-job') data = { id: 'old-job', title: 'Earlier provisioning', createdAt: '2026-11-03T08:00:00Z', status: 'success', steps: [], log: ['Provisioning log retained across restarts'] }
      else if (url.pathname === '/api/guest-metadata') data = {}
      else if (/^\/api\/clusters\/(fixture|archive)\/ips$/.test(url.pathname)) data = {}
      else if (/^\/api\/clusters\/(fixture|archive)\/task-history$/.test(url.pathname)) {
        const node = url.searchParams.get('node')
        const start = Number(url.searchParams.get('start'))
        assert.ok(['pve1', 'pve2', 'pve9'].includes(node))
        assert.ok(/^(0|[1-9]\d*)$/.test(url.searchParams.get('start')))
        assert.ok([...url.searchParams.keys()].every(key => ['node', 'start', 'vmid'].includes(key)))
        historyReads.push({ connection: url.pathname.split('/')[3], node, start, vmid: url.searchParams.get('vmid') })
        if (delayHistory && node === 'pve1') {
          delayHistory = false
          await new Promise(resolve => { releaseHistory = resolve })
        }
        if (historyFailure) return route.fulfill({ status: 503, json: { error: 'History unavailable: permission denied.' } })
        const pageTasks = historyEmpty ? [] : node === 'pve1' ? tasks.slice(start, start + 50) : [{ ...native(900, node), type: `${node}-operation` }]
        if (start === 50 && pageTasks.length) pageTasks[0] = tasks[49]
        data = { tasks: pageTasks, next: start + pageTasks.length, hasMore: pageTasks.length === 50, warnings: historyWarnings ? ['One malformed task was omitted.'] : [] }
      } else if (/^\/api\/clusters\/fixture\/tasks\/pve1\//.test(url.pathname)) {
        assert.ok(url.pathname.includes(encodeURIComponent(running.upid)) || url.pathname.includes(encodeURIComponent(failed.upid)))
        if (url.pathname.endsWith('/log')) {
          logReads.push({ path: url.pathname, start: url.searchParams.get('start') })
          if (logFailure) return route.fulfill({ status: 404, json: { error: 'Refresh task history before reading this task.' } })
          data = { lines: [{ n: 1, t: '<script>window.historyLogExecuted = true</script>' }], next: 1, truncated: false }
        } else {
          statusReads.push(url.pathname)
          if (delayStatus) {
            delayStatus = false
            await new Promise(resolve => { releaseStatus = resolve })
          }
          if (statusFailure) return route.fulfill({ status: statusFailure, json: { error: 'Refresh task history before reading this task.' } })
          data = liveStatus
        }
      } else if (/^\/api\/clusters\/fixture\/guests\/pve[12]\/qemu\/110\/insights$/.test(url.pathname)) data = { config: { cores: 2, memory: 2048, networks: [], disks: [] }, metrics: [] }
      else if (/^\/api\/clusters\/fixture\/guests\/pve[12]\/qemu\/110\/notes$/.test(url.pathname)) data = { notes: '', digest: 'notes-1' }
      else if (/^\/api\/clusters\/fixture\/guests\/pve[12]\/qemu\/110\/resource-settings$/.test(url.pathname)) data = { cores: 2, sockets: 1, memoryMiB: 2048, onboot: false, digest: 'resources-1', status: 'stopped', pending: false, editable: true }
      else if (/^\/api\/clusters\/fixture\/guests\/pve[12]\/qemu\/110\/operations$/.test(url.pathname)) data = { snapshots: [], storages: [], targets: [], errors: [] }
      else {
        unexpected.push(`${route.request().method()} ${url.pathname}${url.search}`)
        return route.fulfill({ status: 404, json: { error: 'No fixture for this API request' } })
      }
      return route.fulfill({ json: data })
    })
    const base = `http://127.0.0.1:${server.address().port}`
    const history = () => page.getByRole('region', { name: 'Proxmox task history', exact: true })
    const inspect = type => history().getByRole('button', { name: `Inspect ${type} task for guest 110`, exact: true })
    const refresh = () => history().getByRole('button', { name: 'Refresh history', exact: true }).first().click()
    const capture = async name => {
      if (!process.env.SCREENSHOT_DIR) return
      fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true })
      await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, name), fullPage: true })
    }
    await page.goto(`${base}/activity`, { waitUntil: 'networkidle' })
    await page.getByRole('tab', { name: 'Proxmox tasks', exact: true }).waitFor()
    await inspect('qmigrate').waitFor()
    assert.deepEqual(historyReads[0], { connection: 'fixture', node: 'pve1', start: 0, vmid: null })
    await history().getByText('One malformed task was omitted.', { exact: true }).waitFor()
    await inspect('vzdump').click()
    await history().getByText(failed.status, { exact: true }).last().waitFor()
    assert.equal(await page.evaluate(() => window.historyExecuted), undefined, 'Task results render as plain text')
    await history().getByRole('button', { name: 'Load task log', exact: true }).click()
    await history().getByLabel('Task log lines', { exact: true }).getByText('<script>window.historyLogExecuted = true</script>', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.historyLogExecuted), undefined)
    const savedNodes = clusters[0].nodes
    const savedGuests = clusters[0].guests
    const readsBeforeOffline = historyReads.length
    clusters[0].ok = false
    clusters[0].nodes = []
    clusters[0].guests = []
    await history().getByText('This connection is unavailable.', { exact: false }).waitFor()
    assert.equal(await history().getByLabel('History connection', { exact: true }).inputValue(), 'fixture', 'An outage must not silently switch connections')
    assert.equal(await history().getByLabel('History node', { exact: true }).inputValue(), 'pve1', 'Retain the last-known node when an offline overview returns no nodes')
    assert.equal(await history().getByLabel('Task log lines', { exact: true }).count(), 1, 'Retain the selected task and loaded log while offline')
    assert.equal(historyReads.length, readsBeforeOffline, 'Do not fetch a different source automatically')
    clusters[0].ok = true
    clusters[0].nodes = savedNodes
    clusters[0].guests = savedGuests
    await history().getByText('This connection is unavailable.', { exact: false }).waitFor({ state: 'detached' })
    await inspect('qmigrate').click()
    await history().getByText('Task running', { exact: true }).waitFor()
    assert.equal(await history().getByLabel('Task log lines', { exact: true }).count(), 0, 'Changing task resets loaded logs')
    liveStatus = { status: 'stopped', exitstatus: 'WARNINGS: transfer skipped' }
    await history().getByRole('region', { name: 'Selected Proxmox task', exact: true }).getByText(liveStatus.exitstatus, { exact: true }).waitFor()
    assert.ok((await inspect('qmigrate').locator('..').textContent()).includes('Warnings'), 'The selected history row must reflect its actual polled terminal status')
    liveStatus = { status: 'stopped', exitstatus: 'unexpected status' }
    await refresh()
    await inspect('qmigrate').click()
    await history().getByRole('region', { name: 'Selected Proxmox task', exact: true }).getByText('Result unknown', { exact: true }).waitFor()
    await inspect('qmstop').click()
    await history().getByText('Result unknown', { exact: true }).waitFor()
    liveStatus = { status: 'running' }
    statusFailure = 404
    await refresh()
    await inspect('qmigrate').click()
    await history().getByText('Refresh task history before reading this task.', { exact: true }).waitFor()
    await history().getByText('Refresh history and select the task again.', { exact: false }).waitFor()
    statusFailure = 0
    await refresh()
    await inspect('qmigrate').click()
    await history().getByText('Task running', { exact: true }).waitFor()
    logFailure = true
    await history().getByRole('button', { name: 'Load task log', exact: true }).click()
    await history().getByText('Refresh task history before reading this task.', { exact: true }).waitFor()
    logFailure = false
    await refresh()
    await inspect('qmigrate').click()
    await history().getByRole('button', { name: 'Load task log', exact: true }).click()
    await history().getByLabel('Task log lines', { exact: true }).waitFor()
    assert.ok(statusReads.every(read => read.includes('/tasks/pve1/')))
    assert.ok(logReads.every(read => read.path.includes('/tasks/pve1/')))
    statusFailure = 401
    await refresh()
    await inspect('qmigrate').click()
    await history().getByText('Refresh task history before reading this task.', { exact: true }).waitFor()
    assert.equal(await page.getByRole('heading', { name: 'Activity', exact: true }).count(), 1, 'A recoverable unauthorized read must use the existing session recovery')
    statusFailure = 0
    liveStatus = { status: 'stopped', exitstatus: 'ERROR: migration target unavailable' }
    await refresh()
    await inspect('qmigrate').click()
    await history().getByText(liveStatus.exitstatus, { exact: true }).first().waitFor()
    await inspect('qmigrate').locator('..').getByText('Failed', { exact: true }).waitFor()
    liveStatus = { status: 'stopped' }
    await refresh()
    await inspect('qmigrate').click()
    await history().getByText('Result unknown', { exact: true }).waitFor()
    delayStatus = true
    await refresh()
    await inspect('qmigrate').click()
    const statusDeadline = Date.now() + 8000
    while (!releaseStatus && Date.now() < statusDeadline) await new Promise(resolve => setTimeout(resolve, 10))
    assert.ok(releaseStatus, 'Selecting a running task must request its original status')
    await inspect('qmsnapshot').click()
    const oldStatusResponse = page.waitForResponse(response => response.url().includes('/tasks/pve1/') && !response.url().includes('/log'))
    liveStatus = { status: 'stopped', exitstatus: 'ERROR: late result from old selection' }
    releaseStatus()
    await oldStatusResponse
    assert.ok((await history().getByRole('region', { name: 'Selected Proxmox task', exact: true }).textContent()).includes('WARNINGS: one file skipped'), 'Late task status must not replace the new selection')
    assert.equal(await history().getByText(liveStatus.exitstatus, { exact: true }).count(), 0)
    liveStatus = { status: 'running' }

    await history().getByRole('button', { name: 'Load more tasks', exact: true }).click()
    await inspect('qmstart-100').waitFor()
    assert.equal(await history().getByRole('list', { name: 'Proxmox tasks', exact: true }).getByRole('listitem').count(), 99, 'Shifting pages deduplicate UPIDs')
    for (const end of [150, 200, 250]) {
      await history().getByRole('button', { name: 'Load more tasks', exact: true }).click()
      await page.waitForFunction(expected => [...document.querySelectorAll('[aria-label="Proxmox tasks"] li')].length === Math.min(200, expected - 1), end)
    }
    await history().getByText('Showing the display limit of 200 tasks.', { exact: false }).waitFor()
    assert.ok(await history().getByRole('button', { name: 'Load more tasks', exact: true }).isDisabled())
    assert.deepEqual(historyReads.slice(-4).map(read => read.start), [50, 100, 150, 200])
    historyFailure = true
    await refresh()
    await history().getByText('History unavailable: permission denied.', { exact: true }).waitFor()
    await history().getByText('Showing stale history.', { exact: false }).waitFor()
    assert.equal(await history().getByRole('listitem').count(), 200, 'A failed refresh keeps useful history')
    historyFailure = false
    historyEmpty = true
    await refresh()
    await history().getByText('Some history could not be read.', { exact: false }).waitFor()
    assert.equal(await history().getByText('No tasks found for this source.', { exact: true }).count(), 0, 'Warnings cannot claim verified empty history')
    historyWarnings = false
    await refresh()
    await history().getByText('No tasks found for this source.', { exact: true }).waitFor()
    historyEmpty = false
    await refresh()
    await inspect('qmigrate').waitFor()
    const readsBeforeInvalid = historyReads.length
    await history().getByLabel('Guest ID', { exact: true }).fill('01')
    assert.ok(await history().getByRole('button', { name: 'Apply filter', exact: true }).isDisabled())
    assert.equal(historyReads.length, readsBeforeInvalid, 'Invalid IDs never request history')
    await history().getByLabel('Guest ID', { exact: true }).fill('110')
    await history().getByRole('button', { name: 'Apply filter', exact: true }).click()
    await inspect('qmigrate').waitFor()
    assert.deepEqual(historyReads.at(-1), { connection: 'fixture', node: 'pve1', start: 0, vmid: '110' })
    await inspect('qmigrate').click()
    delayHistory = true
    await refresh()
    await page.waitForFunction(() => !!document.querySelector('[aria-label="History node"]'))
    const historyDeadline = Date.now() + 8000
    while (!releaseHistory && Date.now() < historyDeadline) await new Promise(resolve => setTimeout(resolve, 10))
    assert.ok(releaseHistory, 'Refreshing history must request the current source')
    await history().getByLabel('History node', { exact: true }).selectOption('pve2')
    await inspect('pve2-operation').waitFor()
    const previousSourceResponse = page.waitForResponse(response => response.url().includes('/task-history?node=pve1'))
    releaseHistory()
    await previousSourceResponse
    assert.equal(await inspect('qmigrate').count(), 0, 'Late responses cannot replace the new source')
    assert.equal(await history().getByRole('heading', { name: 'Selected task', exact: true }).count(), 0, 'Source changes clear task selection')
    await history().getByLabel('History connection', { exact: true }).selectOption('archive')
    await inspect('pve9-operation').waitFor()
    assert.deepEqual(historyReads.at(-1), { connection: 'archive', node: 'pve9', start: 0, vmid: '110' })
    await page.getByRole('tab', { name: 'Provisioning', exact: true }).click()
    await page.getByText('Provisioning log retained across restarts', { exact: true }).waitFor()
    await page.goto(`${base}/activity/old-job`, { waitUntil: 'networkidle' })
    assert.equal(await page.getByRole('tab', { name: 'Provisioning', exact: true }).getAttribute('aria-selected'), 'true')
    await page.getByText('Provisioning log retained across restarts', { exact: true }).waitFor()
    await page.getByRole('tab', { name: 'Proxmox tasks', exact: true }).click()
    await inspect('qmigrate').waitFor()
    await inspect('vzdump').click()
    await history().getByRole('button', { name: 'Load task log', exact: true }).click()
    await history().getByLabel('Task log lines', { exact: true }).waitFor()
    await page.evaluate(() => { document.querySelector('main').scrollTop = 0 })
    await capture('history-desktop.png')
    await page.setViewportSize({ width: 390, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth), 'History must fit 390px')
    await capture('history-mobile.png')
    await history().getByRole('heading', { name: 'Selected task', exact: true }).evaluate(element => {
      const main = document.querySelector('main')
      main.scrollTop += element.getBoundingClientRect().top - main.getBoundingClientRect().top - 85
    })
    await capture('history-log-mobile.png')
    await page.goto(`${base}/guests/fixture/pve1/qemu/110`, { waitUntil: 'networkidle' })
    await inspect('qmigrate').waitFor()
    assert.deepEqual(historyReads.at(-1), { connection: 'fixture', node: 'pve1', start: 0, vmid: '110' })
    assert.equal(await history().getByLabel('History connection', { exact: true }).count(), 0, 'Guest history uses the guest source automatically')
    await inspect('qmigrate').click()
    guest.node = 'pve2'
    await page.getByRole('button', { name: 'Refresh guest', exact: true }).click()
    await inspect('pve2-operation').waitFor()
    assert.deepEqual(historyReads.at(-1), { connection: 'fixture', node: 'pve2', start: 0, vmid: '110' })
    assert.equal(await history().getByRole('heading', { name: 'Selected task', exact: true }).count(), 0, 'Migration clears native-history selection')
    clusters[0].ok = false
    await page.getByRole('button', { name: 'Refresh guest', exact: true }).click()
    await history().getByText('This connection is unavailable.', { exact: false }).waitFor()
    assert.ok(await history().getByRole('button', { name: 'Refresh history', exact: true }).first().isDisabled())
    assert.deepEqual(unexpected, [], 'Every API request has a scoped fixture contract')
    assert.deepEqual(failures, [])
    console.log('PASS: native history sources/filter/paging/dedup/cap, errors/stale/warnings/empty, plain-text results/logs, running terminal success/warning/error/unknown states, 401/404 recovery, late-source/task races, Activity deep links, migration/offline and 390px layout')
  } finally {
    if (browser) await browser.close()
    server.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
