import assert from 'node:assert/strict'
import { createCipheriv, randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, writeFileSync, fsyncSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import type { Job } from '../src/job-history.js'

process.env.PROXMIU_DATA_DIR = mkdtempSync(join(tmpdir(), 'proxmiu-journal-codec-'))
const { JobHistory, normalizeJob, jobSecrets } = await import('../src/job-history.js')
const { encrypt, decrypt } = await import('../src/store.js')
const { runScript } = await import('../src/ssh.js')

const directory = () => mkdtempSync(join(tmpdir(), 'proxmiu-journal-'))
const job = (id = 'run-1', status: Job['status'] = 'running'): Job => ({
  id, title: 'Install → lab', kind: 'provision', templateId: 'plain', clusterId: 'source-1', status,
  createdAt: '2026-11-04T00:00:00.000Z', steps: [{ id: 'prepare', label: 'Prepare', status: 'done' }, { id: 'create', label: 'Create', status: 'running' }, { id: 'install', label: 'Install', status: 'pending' }], log: ['hello'],
  target: { vmid: 123, node: 'pve1', type: 'lxc', hostname: 'lab' },
})

test('encrypted terminal round-trip retains stable identity, outcomes and restrictive permissions', () => {
  const dir = directory()
  const history = new JobHistory(dir)
  const complete = { ...job('done', 'success'), finishedAt: '2026-11-04T00:01:00.000Z', result: { vmid: 123, node: 'pve1', type: 'lxc' as const, hostname: 'lab', user: 'root', notes: 'Connect later', ip: '192.0.2.4' } }
  history.register(complete)
  const raw = readFileSync(join(dir, 'jobs.json'), 'utf8')
  assert.ok(!raw.includes('Connect later'))
  assert.equal(JSON.parse(decrypt(raw)).version, 1)
  assert.deepEqual(new JobHistory(dir).get('done'), complete)
  if (process.platform !== 'win32') {
    assert.equal(statSync(join(dir, 'jobs.json')).mode & 0o777, 0o600)
    assert.equal(statSync(dir).mode & 0o777, 0o700)
  }
})

test('restart interrupts running steps, skips pending work and never invents completion or a result', () => {
  const dir = directory()
  new JobHistory(dir).register(job())
  const restored = new JobHistory(dir)
  const result = restored.get('run-1')!
  assert.equal(result.status, 'interrupted')
  assert.ok(result.interruptedAt)
  assert.equal(result.finishedAt, undefined)
  assert.equal(result.result, undefined)
  assert.deepEqual(result.steps.map(s => s.status), ['done', 'interrupted', 'skipped'])
  assert.equal(result.target?.vmid, 123)
  assert.match(result.recoveryGuidance!, /may still exist\/run; inspect it before starting again/)
  assert.deepEqual(new JobHistory(dir).get('run-1'), result)
})

test('failed atomic replacement preserves previous bytes, live outcomes and marks degradation', () => {
  const dir = directory()
  const original = new JobHistory(dir)
  original.register(job('old', 'success'))
  const bytes = readFileSync(join(dir, 'jobs.json'))
  const broken = new JobHistory(dir, { renameSync: () => { throw new Error('private filesystem details') } })
  assert.throws(() => broken.register(job('new')), /history.*save/i)
  assert.deepEqual(broken.list().map(j => j.id), ['old'])
  assert.deepEqual(readFileSync(join(dir, 'jobs.json')), bytes)
  assert.deepEqual(readdirSync(dir), ['jobs.json'])
  assert.equal(broken.status().available, true)
  assert.equal(broken.status().writable, false)
  assert.ok(!broken.status().warning?.includes('private filesystem'))
  assert.doesNotThrow(() => broken.checkpoint())
})

test('failed recovery save retains interrupted in-memory diagnostics and explicitly warns', () => {
  const dir = directory()
  new JobHistory(dir).register(job())
  const before = readFileSync(join(dir, 'jobs.json'))
  const restored = new JobHistory(dir, { renameSync: () => { throw new Error('disk full') } })
  assert.equal(restored.get('run-1')?.status, 'interrupted')
  assert.equal(restored.status().writable, false)
  assert.match(restored.status().warning!, /not saved/)
  assert.deepEqual(readFileSync(join(dir, 'jobs.json')), before)
})

test('malformed, extra fields, wrong version, wrong key and oversized journals fail closed untouched', () => {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', randomBytes(32), iv)
  const otherKeyBytes = Buffer.concat([cipher.update(JSON.stringify({ version: 1, savedAt: new Date().toISOString(), jobs: [] })), cipher.final()])
  const wrongKey = ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), otherKeyBytes.toString('base64')].join(':')
  const envelope = (jobs: unknown[]) => encrypt(JSON.stringify({ version: 1, savedAt: new Date().toISOString(), jobs }))
  const values = [
    'not ciphertext',
    encrypt(JSON.stringify({ version: 2, savedAt: new Date().toISOString(), jobs: [] })),
    encrypt(JSON.stringify({ version: 1, savedAt: new Date().toISOString(), jobs: [], requests: [] })),
    encrypt(JSON.stringify({ version: 1, savedAt: new Date().toISOString(), jobs: [{ ...job(), password: 'never' }] })),
    'v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA',
    wrongKey,
    envelope([job(), job()]),
    envelope([{ ...job(), result: { vmid: 123, node: 'pve1', type: 'lxc', hostname: 'lab', user: 'root', notes: 'safe', script: 'untrusted' } }]),
    envelope([{ ...job(), log: Array.from({ length: 40 }, () => 'x'.repeat(4096)) }]),
    'x'.repeat(12 * 1024 * 1024 + 1),
    encrypt(' '.repeat(8 * 1024 * 1024 + 1)),
  ]
  for (const value of values) {
    const dir = directory()
    writeFileSync(join(dir, 'jobs.json'), value)
    const history = new JobHistory(dir)
    assert.equal(history.status().available, false)
    assert.throws(() => history.list(), /unavailable/i)
    assert.throws(() => history.register(job()), /unavailable/i)
    history.flush()
    assert.equal(readFileSync(join(dir, 'jobs.json'), 'utf8'), value)
  }
})

test('bounded snapshots retain newest escaped UTF-8 log tail within serialized byte budget', () => {
  const input = job()
  input.log = Array.from({ length: 9000 }, (_, i) => `${i}:` + '\u0000"\\😀'.repeat(1500))
  const snapshot = normalizeJob(input)
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= 128 * 1024)
  assert.ok(snapshot.log.length <= 5000)
  assert.ok(snapshot.log.every(line => line.length <= 4096))
  assert.ok(snapshot.log.at(-1)?.startsWith('8999:'))
  assert.equal(snapshot.logTruncated, true)
  assert.equal(input.log.length, 9000, 'Snapshotting must not mutate the caller')
})

test('retention evicts oldest terminal work, preserves active work and refuses all-active admission', () => {
  const dir = directory()
  const history = new JobHistory(dir)
  const activeJobs = Array.from({ length: 50 }, (_, i) => ({ ...job(`active-${i}`), createdAt: new Date(i * 1000).toISOString() }))
  for (const active of activeJobs) history.register(active)
  assert.throws(() => history.register(job('rejected')), /active/i)
  assert.equal(history.list().length, 50)
  const active = activeJobs[30]
  active.status = 'success'
  history.checkpoint()
  history.register(job('accepted'))
  assert.equal(history.get('active-30'), undefined)
  assert.ok(history.get('active-0'))
  assert.ok(history.get('accepted'))
})

test('central snapshots redact short secrets, defaults, long options and errors/logs/result notes', () => {
  const secrets = jobSecrets({ password: 'p!', options: { SHORT: 'xy', OTHER: 'long-token' } }, { options: [{ key: 'SHORT', type: 'secret', default: 'zz' }, { key: 'DEFAULT', type: 'secret', default: 'ab' }] })
  const input = job('secret', 'error')
  input.log = ['p! xy zz ab long-token']
  input.error = 'failure: xy ab'
  input.result = { vmid: 123, node: 'pve1', type: 'lxc', hostname: 'lab', user: 'root', notes: 'p! zz ab' }
  const history = new JobHistory(directory())
  history.register(input, secrets)
  const snapshot = history.get('secret')!
  for (const value of ['p!', 'xy', 'zz', 'ab', 'long-token']) {
    assert.ok(!JSON.stringify(snapshot.log).includes(value))
    assert.ok(!snapshot.error?.includes(value))
    assert.ok(!snapshot.result?.notes.includes(value))
  }
  assert.ok(!JSON.stringify(snapshot).includes('secretValues'))
})

test('multiline secret defaults redact separately emitted short line fragments', () => {
  const secrets = jobSecrets({}, { options: [{ key: 'TOKEN', type: 'secret', default: 'first-secret-line\r\nxy\nlast-secret-line' }] })
  const input = job('multiline', 'error')
  input.log = ['prefix first-secret-line suffix', 'xy', 'last-secret-line']
  input.error = 'Failed: xy'
  input.result = { vmid: 123, node: 'pve1', type: 'lxc', hostname: 'lab', user: 'root', notes: 'first-secret-line' }
  const snapshot = normalizeJob(input, secrets)
  assert.equal(snapshot.log[1], '••••••')
  assert.ok(!snapshot.error?.includes('xy'))
  assert.ok(!snapshot.result?.notes.includes('first-secret-line'))
})

for (const source of ['password', 'supplied option', 'template default'] as const) {
  test(`lone-CR ${source} fragments are redacted after SSH line normalization`, async () => {
    const value = 'alpha\rbeta'
    const secrets = jobSecrets(
      source === 'password' ? { password: value } : source === 'supplied option' ? { options: { TOKEN: value } } : {},
      { options: [{ key: 'TOKEN', type: 'secret', ...(source === 'template default' ? { default: value } : {}) }] },
    )
    const dir = directory()
    const history = new JobHistory(dir)
    const active = job()
    active.log = []
    active.error = 'Failed alpha and beta'
    active.result = { vmid: 123, node: 'pve1', type: 'lxc', hostname: 'lab', user: 'root', notes: 'Inspect alpha and beta' }
    history.register(active, secrets)
    const stream = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
      end() { this.emit('data', Buffer.from(value + '\n')); this.emit('close', 0) },
    })
    const connection = { exec(_command: string, _options: unknown, callback: (error: null, output: typeof stream) => void) { callback(null, stream) } } as unknown as Parameters<typeof runScript>[0]
    assert.equal(await runScript(connection, '# synthetic fixture', { onLine: line => history.append(active, line) }), 0)
    history.checkpoint()
    const snapshot = history.get(active.id)!
    assert.deepEqual(snapshot.log, ['••••••', '••••••'])
    assert.doesNotMatch(snapshot.error!, /alpha|beta/)
    assert.doesNotMatch(snapshot.result!.notes, /alpha|beta/)
    assert.doesNotMatch(decrypt(readFileSync(join(dir, 'jobs.json'), 'utf8')), /alpha|beta/)
  })
}

test('runtime log flush coalesces by 250ms and terminal checkpoint persists immediately without throwing', async () => {
  const dir = directory()
  const history = new JobHistory(dir)
  const active = job()
  history.register(active)
  history.append(active, 'new tail')
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.ok(JSON.parse(decrypt(readFileSync(join(dir, 'jobs.json'), 'utf8'))).jobs[0].log.includes('new tail'))
  active.status = 'success'
  history.checkpoint()
  assert.equal(new JobHistory(dir).get(active.id)?.status, 'success')
})

test('write and fsync failures preserve the old journal and never change a live successful outcome', () => {
  for (const boundary of ['writeFileSync', 'fsyncSync'] as const) {
    const dir = directory()
    let fail = false
    const operation = boundary === 'writeFileSync' ? writeFileSync : fsyncSync
    const history = new JobHistory(dir, { [boundary]: (...args: unknown[]) => {
      if (fail) throw new Error('Disk boundary failure')
      return (operation as (...args: unknown[]) => unknown)(...args)
    } })
    const live = job('old', 'success')
    history.register(live)
    const bytes = readFileSync(join(dir, 'jobs.json'))
    fail = true
    live.status = 'success'
    live.finishedAt = '2026-11-04T00:02:00.000Z'
    assert.doesNotThrow(() => history.append(live, 'Last live output'))
    assert.doesNotThrow(() => history.checkpoint())
    assert.equal(history.get('old')?.status, 'success')
    assert.ok(history.get('old')?.log.includes('Last live output'))
    assert.equal(history.status().writable, false)
    assert.deepEqual(readFileSync(join(dir, 'jobs.json')), bytes)
    assert.deepEqual(readdirSync(dir), ['jobs.json'])
  }
})

test('graceful flush writes a pending log tail immediately and missing history starts normally', () => {
  const dir = directory()
  const history = new JobHistory(dir)
  assert.deepEqual(history.list(), [])
  assert.equal(history.status().available, true)
  const live = job()
  history.register(live)
  history.append(live, 'Shutdown tail')
  history.flush()
  assert.ok(new JobHistory(dir).get(live.id)?.log.includes('Shutdown tail'))
})
