import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import https from 'node:https'
import http from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import selfsigned from 'selfsigned'

for (const mode of ['normal', 'redirect', 'payload']) test(`saved settings: ${mode}`, { timeout: 30000 }, async () => {
  const cert = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { keySize: 2048, days: 1 })
  let trapRequests = 0
  const trap = http.createServer((_req, res) => { trapRequests++; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: { version: 'trap', ticket: 'trap', CSRFPreventionToken: 'trap' } })) })
  trap.listen(0, '127.0.0.1'); await once(trap, 'listening')
  const trapPort = (trap.address() as { port: number }).port
  let behavior = ''
  let accepted = ['old-secret']
  const authCalls: string[] = []
  let delayVersion = false
  let releaseVersion: (() => void) | undefined
  let releaseJob: (() => void) | undefined
  const upstream = https.createServer({ key: cert.private, cert: cert.cert }, async (req, res) => {
    const path = new URL(req.url!, 'https://localhost').pathname
    if (behavior === 'redirect-login' && path.endsWith('/access/ticket')) { res.writeHead(307, { location: `http://127.0.0.1:${trapPort}/trap` }).end(); return }
    if (behavior === 'redirect-version' && path.endsWith('/version') || behavior === 'redirect-nodes' && path.endsWith('/nodes')) { res.writeHead(302, { location: `http://127.0.0.1:${trapPort}/trap` }).end(); return }
    if (behavior.startsWith('login-') && path.endsWith('/access/ticket')) { res.setHeader('content-type', 'application/json'); res.end(behavior === 'login-html' ? '<html>login</html>' : JSON.stringify(behavior === 'login-empty' ? {} : behavior === 'login-null' ? { data: null } : behavior === 'login-ticket' ? { data: { ticket: 't' } } : { data: { ticket: 12, CSRFPreventionToken: 'c' } })); return }
    if (path.endsWith('/access/ticket')) {
      let body = ''; for await (const chunk of req) body += chunk
      const fields = new URLSearchParams(body)
      if (fields.get('username') !== 'root@pam' || fields.get('password') !== 'password-secret') { res.writeHead(401).end(); return }
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: { ticket: 'fixture-ticket', CSRFPreventionToken: 'fixture-csrf' } })); return
    }
    const auth = req.headers.authorization || ''
    authCalls.push(auth)
    if (req.headers.cookie !== 'PVEAuthCookie=fixture-ticket' && !accepted.some(secret => auth.endsWith('=' + secret))) { res.writeHead(401).end('private upstream detail'); return }
    if (behavior.startsWith('version-') && path.endsWith('/version') || behavior.startsWith('nodes-') && path.endsWith('/nodes')) {
      res.setHeader('content-type', 'application/json')
      const mode = behavior.split('-')[1]
      res.end(mode === 'html' ? '<html>bad</html>' : JSON.stringify(mode === 'empty' ? {} : mode === 'null' ? { data: null } : { data: behavior.startsWith('version-') ? { version: 123 } : [{ node: 5 }] }))
      return
    }
    const data = behavior === 'empty-nodes' && path.endsWith('/nodes') ? [] : path.endsWith('/version') ? { version: 'fixture' } : path.endsWith('/cluster/status') ? [] : path.endsWith('/nodes') ? [{ node: 'pve', status: 'online' }] : []
    if (path.endsWith('/cluster/nextid')) { releaseJob = () => res.writeHead(500).end(); return }
    const reply = () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data })) }
    if (delayVersion && path.endsWith('/version')) { delayVersion = false; releaseVersion = reply } else reply()
  })
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening')
  const port = (upstream.address() as { port: number }).port
  const sock = createServer(); sock.listen(0, '127.0.0.1'); await once(sock, 'listening'); const appPort = (sock.address() as { port: number }).port; await new Promise<void>(r => sock.close(() => r()))
  const dir = mkdtempSync(join(tmpdir(), 'connection-settings-'))
  let child: ReturnType<typeof spawn>
  let agentLogs = ''
  async function boot() {
    child = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(appPort), PROXMIU_DATA_DIR: dir, PROXMIU_PASSWORD: 'agent-fixture-password' }, stdio: ['ignore', 'pipe', 'pipe'] })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('startup timeout')), 10000)
      child.stdout!.on('data', b => { agentLogs += String(b); if (String(b).includes('Server listening')) { clearTimeout(timer); resolve() } })
      child.stderr!.on('data', b => { agentLogs += String(b) })
    })
  }
  await boot()
  try {
    const root = `http://127.0.0.1:${appPort}/api`
    const login = await (await fetch(root + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'agent-fixture-password' }) })).json()
    const request = (path: string, method = 'GET', body?: unknown) => fetch(root + path, { method, headers: { authorization: `Bearer ${login.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const cluster = await (await request('/clusters', 'POST', { name: 'Original', host: '127.0.0.1', port, authType: 'token', username: 'root@pam!fixture', secret: 'old-secret', verifyTls: false })).json()
    const url = `/clusters/${cluster.id}/settings`
    assert.equal((await (await request('/overview')).json()).clusters[0].ok, true)
    await request(`/guest-metadata/${cluster.id}/lxc/101`, 'PUT', { favorite: true })
    assert.equal((await fetch(root + url)).status, 401)
    let response = await request(url)
    assert.equal(response.status, 200)
    const settings = await response.json()
    assert.equal(settings.secret, undefined); assert.ok(settings.revision)
    if (mode === 'redirect' || mode === 'payload') {
      const baseline = readFileSync(join(dir, 'state.json'), 'utf8')
      const basic = { revision: settings.revision, name: 'Attempt', authType: 'token', username: settings.username, verifyTls: false }
      const cases = mode === 'redirect' ? ['redirect-version', 'redirect-nodes', 'redirect-login'] : ['version-html', 'version-empty', 'version-null', 'version-wrong', 'nodes-html', 'nodes-empty', 'nodes-null', 'nodes-wrong', 'login-html', 'login-empty', 'login-null', 'login-ticket', 'login-wrong']
      for (const item of cases) {
        behavior = item
        const candidate = item.includes('login') ? { ...basic, authType: 'password', username: 'root@pam', secret: 'password-secret' } : basic
        for (const [endpoint, method] of [[url + '/test', 'POST'], [url, 'PUT']]) {
          const checked = await request(endpoint, method, candidate)
          assert.equal(checked.status, 502, `${item} ${method}`)
          assert.ok(!(await checked.text()).includes('trap'))
        }
        assert.equal(trapRequests, 0, `${item} reached redirect trap`)
        behavior = ''
        assert.equal((await (await request(url)).json()).revision, settings.revision)
        assert.equal(readFileSync(join(dir, 'state.json'), 'utf8'), baseline)
        assert.equal((await (await request('/overview')).json()).clusters[0].ok, true)
        assert.ok(authCalls.at(-1)?.endsWith('=old-secret'))
      }
      behavior = 'empty-nodes'
      assert.equal((await request(url + '/test', 'POST', basic)).status, 200)
      return
    }
    const draft = { revision: settings.revision, name: 'Renamed', authType: settings.authType, username: settings.username, verifyTls: false }
    response = await request(url + '/test', 'POST', draft); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true })
    response = await request(url, 'PUT', { ...draft, host: 'attacker' }); assert.equal(response.status, 400)
    response = await request(url, 'PUT', { ...draft, username: 'other' }); assert.equal(response.status, 400)
    response = await request(url, 'PUT', { ...draft, username: 'bad\u0085name', secret: 'old-secret' }); assert.equal(response.status, 400)
    response = await request(url, 'PUT', draft); assert.equal(response.status, 200)
    const saved = await response.json(); assert.equal(saved.name, 'Renamed'); assert.equal(saved.id, cluster.id); assert.equal(saved.host, cluster.host); assert.equal(saved.createdAt, cluster.createdAt)
    response = await request(url, 'PUT', draft); assert.equal(response.status, 409)
    accepted = ['old-secret', 'new-secret']
    response = await request(url + '/test', 'POST', { ...draft, revision: saved.revision, secret: 'new-secret' }); assert.equal(response.status, 200)
    await request('/overview'); assert.ok(authCalls.at(-1)?.endsWith('=old-secret'))
    response = await request(url, 'PUT', { ...draft, revision: saved.revision, secret: 'wrong' }); assert.equal(response.status, 502); assert.ok(!(await response.text()).includes('private'))
    response = await request(url, 'PUT', { ...draft, revision: saved.revision, secret: 'new-secret' }); assert.equal(response.status, 200)
    const rotated = await response.json()
    accepted = ['new-secret']
    assert.equal((await (await request('/overview')).json()).clusters[0].ok, true)
    assert.ok(authCalls.at(-1)?.endsWith('=new-secret'))
    assert.equal((await (await request('/guest-metadata')).json())[`${cluster.id}/lxc/101`].favorite, true)
    child.kill(); await once(child, 'exit'); await boot()
    assert.equal((await (await request(url)).json()).revision, rotated.revision)
    assert.equal((await (await request('/overview')).json()).clusters[0].ok, true)
    const disk = readFileSync(join(dir, 'state.json'), 'utf8')
    assert.ok(!disk.includes('old-secret') && !disk.includes('new-secret'))
    response = await request(url, 'PUT', { ...draft, revision: rotated.revision, verifyTls: true }); assert.equal(response.status, 502)
    response = await request(url, 'PUT', { ...draft, revision: rotated.revision, secret: '' }); assert.equal(response.status, 400)
    response = await fetch(root + url, { headers: { origin: 'https://untrusted.invalid' } }); assert.equal(response.status, 403)
    delayVersion = true
    const late = request(url, 'PUT', { ...draft, revision: rotated.revision, name: 'Late' })
    while (!releaseVersion) await new Promise(r => setTimeout(r, 10))
    const concurrent = await request(url, 'PUT', { ...draft, revision: rotated.revision, name: 'Winner' }); assert.equal(concurrent.status, 200)
    releaseVersion(); assert.equal((await late).status, 409)
    assert.equal((await (await request(url)).json()).name, 'Winner')
    const winner = await (await request(url)).json()
    mkdirSync(join(dir, 'state.json.tmp'))
    response = await request(url, 'PUT', { ...draft, revision: winner.revision, name: 'Failed write' }); assert.equal(response.status, 500)
    rmSync(join(dir, 'state.json.tmp'), { recursive: true })
    assert.equal((await (await request(url)).json()).name, 'Winner')
    releaseVersion = undefined; delayVersion = true
    const duringJob = request(url, 'PUT', { ...draft, revision: winner.revision, name: 'Blocked' })
    while (!releaseVersion) await new Promise(r => setTimeout(r, 10))
    const job = await request('/provision', 'POST', { clusterId: cluster.id, node: 'pve', templateId: 'base', kind: 'lxc', hostname: 'fixture', cores: 1, memory: 512, disk: 4, storage: 'local' })
    assert.equal(job.status, 200)
    while (!releaseJob) await new Promise(r => setTimeout(r, 10))
    assert.equal((await request(url, 'PUT', { ...draft, revision: winner.revision })).status, 409)
    assert.equal((await request(url + '/test', 'POST', { ...draft, revision: winner.revision })).status, 200)
    releaseVersion(); assert.equal((await duringJob).status, 409)
    releaseJob()
    while ((await (await request('/jobs')).json()).some((j: { status: string }) => j.status === 'running')) await new Promise(r => setTimeout(r, 10))
    const passwordDraft = { ...draft, revision: winner.revision, authType: 'password', username: 'root@pam', secret: 'password-secret' }
    response = await request(url, 'PUT', passwordDraft); assert.equal(response.status, 200)
    const passwordSaved = await response.json()
    assert.equal((await (await request('/overview')).json()).clusters[0].ok, true)
    releaseVersion = undefined; delayVersion = true
    const removed = request(url + '/test', 'POST', { ...passwordDraft, revision: passwordSaved.revision })
    while (!releaseVersion) await new Promise(r => setTimeout(r, 10))
    assert.equal((await request(`/clusters/${cluster.id}`, 'DELETE')).status, 200)
    releaseVersion(); assert.equal((await removed).status, 404)
    assert.equal((await request(url)).status, 404)
  } catch (error) { console.error(agentLogs); throw error } finally { child.kill(); await once(child, 'exit'); await new Promise<void>(r => upstream.close(() => r())); await new Promise<void>(r => trap.close(() => r())); rmSync(dir, { recursive: true, force: true }) }
})
