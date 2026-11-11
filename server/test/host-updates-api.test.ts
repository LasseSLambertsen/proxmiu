import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import https from 'node:https'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import ssh2 from 'ssh2'
import selfsigned from 'selfsigned'

test('host updater authenticated agent flow, encrypted restart and offline lost-reply recovery', { timeout: 40_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'proxmiu-host-updater-api-'))
  let upstreamOnline = true, apiCalls = 0
  const cert = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { days: 1, keySize: 2048 })
  const upstream = https.createServer({ key: cert.private, cert: cert.cert }, (req, res) => {
    apiCalls++
    if (!upstreamOnline) { res.writeHead(503).end('private upstream details'); return }
    const path = req.url?.split('?')[0]
    const data = path?.endsWith('/version') ? { version: '8.2.7' } : path?.endsWith('/nodes') ? [{ node: 'pve', status: 'online' }] : []
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data }))
  })
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening')
  const host = ssh2.utils.generateKeyPairSync('ed25519')
  const parsed = ssh2.utils.parseKey(host.private)
  assert.ok(!(parsed instanceof Error) && !Array.isArray(parsed))
  const fingerprint = 'SHA256:' + createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '')
  let latest: Record<string, unknown> | undefined, loseApply = false, mutations = 0
  const sshClients = new Set<ssh2.Connection>()
  const ssh = new ssh2.Server({ hostKeys: [host.private] }, client => {
    sshClients.add(client); client.on('close', () => sshClients.delete(client)); client.on('error', () => {})
    client.on('authentication', ctx => ctx.method === 'publickey' ? ctx.accept() : ctx.reject())
    client.on('ready', () => client.on('session', accept => accept().on('exec', accept => {
      const channel = accept(); let input = ''
      channel.on('data', data => { input += data.toString() })
      channel.on('end', () => {
        const request = JSON.parse(input)
        let result: unknown = { proxmoxVersion: '8.2.7', proxmoxMajor: 8, codename: 'bookworm', machineIdHash: 'a'.repeat(64), ready: true, rebootSuggested: false, ...(latest ? { latestJobId: latest.id } : {}) }
        if (request.action === 'check') {
          mutations++
          latest = { id: 'b'.repeat(32), phase: 'check', state: 'review', startedAt: new Date().toISOString(), log: ['Reviewed fixture metadata.'], plan: { id: 'b'.repeat(32), digest: 'c'.repeat(64), expiresAt: new Date(Date.now() + 600000).toISOString(), proxmoxMajor: 8, codename: 'bookworm', kernelChange: false, packages: [{ name: 'pve-container', architecture: 'all', installed: '5.2.0', candidate: '5.3.6' }] } }
          result = latest
        } else if (request.action === 'apply') {
          mutations++; latest = { id: 'd'.repeat(32), phase: 'apply', state: 'running', startedAt: new Date().toISOString(), log: ['Accepted exact fixture versions.'] }; result = latest
          if (loseApply) { channel.exit(1); channel.end(); return }
        } else if (request.action === 'status') result = latest
        channel.write(JSON.stringify({ protocol: 1, node: 'pve', result })); channel.exit(0); channel.end()
      })
    })))
  })
  ssh.listen(0, '127.0.0.1'); await once(ssh, 'listening')
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening')
  const port = (probe.address() as { port: number }).port
  await new Promise<void>(r => probe.close(() => r()))
  let child: ReturnType<typeof spawn> | undefined, logs = ''
  async function boot() {
    child = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PROXMIU_DATA_DIR: directory, PROXMIU_PASSWORD: 'fixture-password' }, stdio: ['ignore', 'pipe', 'pipe'] })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Agent startup failed: ' + logs)), 10000)
      child!.stdout!.on('data', b => { logs += b; if (String(b).includes('Server listening')) { clearTimeout(timer); resolve() } })
      child!.stderr!.on('data', b => { logs += b })
      child!.once('exit', code => { if (code) { clearTimeout(timer); reject(new Error('Agent startup failed')) } })
    })
  }
  const stop = async () => { if (child && child.exitCode === null) { child.kill(); await once(child, 'exit') } }
  try {
    await boot()
    const root = `http://127.0.0.1:${port}/api`
    const login = await (await fetch(root + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'fixture-password' }) })).json()
    const request = (path: string, method = 'GET', body?: unknown, headers = {}) => fetch(root + path, { method, headers: { authorization: `Bearer ${login.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const cluster = await (await request('/clusters', 'POST', { name: 'Fixture', host: '127.0.0.1', port: (upstream.address() as { port: number }).port, authType: 'token', username: 'root@pam!fixture', secret: 'api-secret', verifyTls: false })).json()
    const base = `/clusters/${cluster.id}/nodes/pve/updater`
    assert.equal((await fetch(root + '/host-updaters')).status, 401)
    assert.equal((await request(base + '/setup', 'POST', {}, { origin: 'https://untrusted.invalid' })).status, 403)
    const prepared = await (await request(base + '/setup', 'POST', {})).json()
    assert.equal(prepared.privateKey, undefined)
    assert.equal((await (await request(base + '/setup', 'POST', {})).json()).publicKey, prepared.publicKey)
    let response = await request(base + '/configuration', 'PUT', { host: '127.0.0.1', port: (ssh.address() as { port: number }).port, fingerprint, revision: prepared.revision })
    assert.equal(response.status, 200, await response.clone().text())
    const disk = JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8'))
    const encrypted = disk.hostUpdaters.targets[`${cluster.id}/pve`].privateKey
    assert.match(encrypted, /^v1:/)
    assert.ok(!JSON.stringify(disk).includes('PRIVATE KEY'))
    await request('/settings/ssh-key/regenerate', 'POST', {})
    assert.equal(JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8')).hostUpdaters.targets[`${cluster.id}/pve`].privateKey, encrypted)
    response = await request(base + '/check', 'POST', {})
    assert.equal(response.status, 200, await response.clone().text())
    const review = await response.json()
    assert.equal(review.state, 'review')
    assert.equal((await request(base + '/apply', 'POST', { planId: review.plan.id, digest: review.plan.digest, confirmNode: 'other' })).status, 400)
    loseApply = true
    assert.equal((await request(base + '/apply', 'POST', { planId: review.plan.id, digest: review.plan.digest, confirmNode: 'pve' })).status, 502)
    assert.equal((await request(`/clusters/${cluster.id}`, 'DELETE')).status, 409)
    assert.equal((await request(base + '/configuration', 'DELETE', { confirmNode: 'pve' })).status, 409)
    await stop(); upstreamOnline = false; await boot()
    const callsBefore = apiCalls
    const recovered = await (await request(base)).json()
    assert.equal(recovered.job.state, 'running')
    assert.equal(recovered.job.id, 'd'.repeat(32))
    assert.equal(apiCalls, callsBefore, 'known operation recovery must not depend on Proxmox API')
    assert.equal(mutations, 2, 'reconnection never repeats check/apply')
    assert.ok(latest); latest.state = 'success'; latest.finishedAt = new Date().toISOString()
    assert.equal((await (await request(base)).json()).unresolved, false)
    assert.equal((await request(base + '/configuration', 'DELETE', { confirmNode: 'pve' })).status, 200)
    assert.deepEqual(await (await request('/host-updaters')).json(), [])
    assert.ok(!logs.includes('PRIVATE KEY'))
  } finally {
    await stop()
    for (const client of sshClients) client.end()
    await new Promise<void>(r => ssh.close(() => r()))
    await new Promise<void>(r => upstream.close(() => r()))
    rmSync(directory, { recursive: true, force: true })
  }
})
