import assert from 'node:assert/strict'
import { test } from 'node:test'
import { backupQuerySchema, loadGuestBackups, loadTaskLog, taskLogQuerySchema } from '../src/guest-maintenance.js'

const guest = { node: 'pve1', type: 'lxc' as const, vmid: 100 }
const storage = { storage: 'local', active: 1, enabled: 1, content: 'iso,backup' }
const backup = { volid: 'local:backup/vzdump-lxc-100-2026_11_03-12_00_00.tar.zst', content: 'backup', vmid: 100, size: 4096, ctime: 300, format: 'tar.zst' }
type Params = Record<string, string | number | boolean | undefined>

function fixture(data: { storages?: unknown; backups?: unknown; logs?: unknown; fail?: 'storage' | 'content' | 'log' } = {}) {
  const calls: { path: string; params?: Params }[] = []
  return {
    calls,
    client: {
      async get<T>(path: string, params?: Params): Promise<T> {
        calls.push({ path, params })
        const kind = path.endsWith('/storage') ? 'storage' : path.endsWith('/content') ? 'content' : path.endsWith('/log') ? 'log' : undefined
        if (kind === data.fail) throw Object.assign(new Error('<script>private upstream response token=secret</script>'), { statusCode: 403 })
        if (kind === 'storage') return (Object.hasOwn(data, 'storages') ? data.storages : [storage]) as T
        if (kind === 'content') return (Object.hasOwn(data, 'backups') ? data.backups : [backup]) as T
        if (kind === 'log') return (Object.hasOwn(data, 'logs') ? data.logs : []) as T
        throw new Error('Unexpected GET ' + path)
      },
    },
  }
}

test('maintenance queries reject arbitrary options and invalid storage or log cursors', () => {
  assert.deepEqual(backupQuerySchema.parse({ storage: 'backup.pool-1' }), { storage: 'backup.pool-1' })
  for (const input of [{}, { storage: '../local' }, { storage: 'a/b' }, { storage: '' }, { storage: 'local', vmid: 101 }]) {
    assert.equal(backupQuerySchema.safeParse(input).success, false)
  }
  assert.deepEqual(taskLogQuerySchema.parse({}), { start: 0 })
  assert.deepEqual(taskLogQuerySchema.parse({ start: '200' }), { start: 200 })
  assert.deepEqual(taskLogQuerySchema.parse({ start: 1_000_000 }), { start: 1_000_000 })
  for (const start of [-1, 1_000_001, 0.5, Infinity, NaN, true, null, '', '1e3', '1.0', ' 1', ['1'], {}]) {
    assert.equal(taskLogQuerySchema.safeParse({ start }).success, false, String(start))
  }
  assert.equal(taskLogQuerySchema.safeParse({ start: 0, limit: 1_000_000 }).success, false)
})

test('backup inventory scopes the request to the selected guest and returns only whitelisted backup fields', async () => {
  const { client, calls } = fixture({ backups: [{ ...backup, notes: 'private', protected: 1, owner: 'root@pam', extra: { token: 'secret' } }] })
  assert.deepEqual(await loadGuestBackups(client, guest, 'local'), {
    backups: [{ storage: 'local', volid: backup.volid, size: 4096, ctime: 300, format: 'tar.zst' }], errors: [], truncated: false,
  })
  assert.deepEqual(calls, [
    { path: '/nodes/pve1/storage', params: { enabled: 1, content: 'backup' } },
    { path: '/nodes/pve1/storage/local/content', params: { content: 'backup', vmid: 100 } },
  ])
})

test('backup inventory rejects unavailable storage before reading its content', async () => {
  for (const storages of [[], [{ ...storage, active: 0 }], [{ ...storage, enabled: 0 }], [{ ...storage, enabled: '0' }], [{ ...storage, content: 'iso,images' }], [{ ...storage, storage: 'other' }]]) {
    const { client, calls } = fixture({ storages })
    await assert.rejects(loadGuestBackups(client, guest, 'local'), error => (error as { statusCode?: number }).statusCode === 409)
    assert.equal(calls.length, 1)
  }
  const { client, calls } = fixture()
  await assert.rejects(loadGuestBackups(client, guest, '../local'))
  assert.equal(calls.length, 0)
})

test('backup inventory excludes other guests, storage and malformed records while omitting invalid optional values', async () => {
  const { client } = fixture({ backups: [
    backup,
    { ...backup, vmid: 101 }, { ...backup, vmid: '100x' }, { ...backup, vmid: undefined },
    { ...backup, volid: 'other:backup/100' }, { ...backup, volid: 'local:iso/not-a-backup' },
    { ...backup, volid: 'local:backup/bad\nname' }, { ...backup, volid: 'local:backup/' + 'a'.repeat(1100) },
    { ...backup, content: 'images' }, { ...backup, volid: undefined }, null, [], 'backup',
    { volid: 'local:backup/older', vmid: '100', size: -1, ctime: Infinity, format: '<script>' },
  ] })
  const result = await loadGuestBackups(client, guest, 'local')
  assert.deepEqual(result.backups, [
    { storage: 'local', volid: backup.volid, size: 4096, ctime: 300, format: 'tar.zst' },
    { storage: 'local', volid: 'local:backup/older' },
  ])
  assert.ok(result.errors.length > 0)
  assert.equal(result.truncated, false)
})

test('malformed selected-guest backups warn instead of reporting an empty success; other guests stay silent', async () => {
  for (const backups of [[{ ...backup, volid: undefined }], [{ ...backup, volid: 'other:backup/private-token=secret' }], [null]]) {
    const result = await loadGuestBackups(fixture({ backups }).client, guest, 'local')
    assert.deepEqual(result.backups, [])
    assert.ok(result.errors.length > 0)
    assert.doesNotMatch(result.errors.join(), /secret|token=|<script>/)
    assert.equal(result.truncated, false)
  }
  assert.deepEqual(await loadGuestBackups(fixture({ backups: [{ ...backup, vmid: 101 }] }).client, guest, 'local'), { backups: [], errors: [], truncated: false })
})

test('backup inventory reports storage/content read and malformed response failures as safe errors', async () => {
  for (const data of [{ fail: 'storage' as const }, { fail: 'content' as const }, { storages: null }, { storages: {} }, { backups: null }, { backups: { error: 'secret' } }]) {
    const { client, calls } = fixture(data)
    const result = await loadGuestBackups(client, guest, 'local')
    assert.deepEqual(result.backups, [])
    assert.equal(result.truncated, false)
    assert.ok(result.errors.length > 0)
    assert.doesNotMatch(result.errors.join(), /secret|token=|<script>/)
    if ('fail' in data && data.fail === 'storage') assert.equal(calls.length, 1)
  }
  assert.deepEqual(await loadGuestBackups(fixture({ backups: [] }).client, guest, 'local'), { backups: [], errors: [], truncated: false })
})

test('backup inventory keeps the newest 500 entries and explicitly reports truncation', async () => {
  const backups = Array.from({ length: 502 }, (_, i) => ({ ...backup, volid: 'local:backup/item-' + i, ctime: i }))
  const result = await loadGuestBackups(fixture({ backups }).client, guest, 'local')
  assert.equal(result.backups.length, 500)
  assert.equal(result.backups[0].ctime, 501)
  assert.equal(result.backups.at(-1)?.ctime, 2)
  assert.equal(result.truncated, true)
  assert.deepEqual(result.errors, [])
})

test('task logs request 200 rows at the numeric cursor, encode the task ID and retain plain text', async () => {
  const { client, calls } = fixture({ logs: [{ n: '201', t: '<script>alert("log")</script>', user: 'private' }, { n: 202, t: '' }] })
  assert.deepEqual(await loadTaskLog(client, 'pve1', 'UPID:pve1:123:backup:', 200), {
    lines: [{ n: 201, t: '<script>alert("log")</script>' }, { n: 202, t: '' }], next: 202, truncated: false,
  })
  assert.deepEqual(calls, [{ path: '/nodes/pve1/tasks/UPID%3Apve1%3A123%3Abackup%3A/log', params: { start: 200, limit: 200 } }])
})

test('task log cursors reject invalid direct helper input before upstream reads', async () => {
  const { client, calls } = fixture()
  for (const start of [-1, 0.5, 1_000_001, NaN]) await assert.rejects(loadTaskLog(client, 'pve1', 'UPID:test', start))
  assert.equal(calls.length, 0)
})

test('task logs normalize ordered unique line numbers after the offset and exclude malformed entries', async () => {
  const { client } = fixture({ logs: [
    { n: 7, t: 'last' }, { n: 5, t: 'already seen' }, { n: '6', t: 'first' }, { n: 6, t: 'duplicate' },
    { n: 6.5, t: 'fraction' }, { n: '7x', t: 'invalid' }, { n: 8, t: { html: '<script>' } }, null,
  ] })
  assert.deepEqual(await loadTaskLog(client, 'pve1', 'UPID:test', 5), {
    lines: [{ n: 6, t: 'first' }, { n: 7, t: 'last' }], next: 7, truncated: true,
  })
})

test('task logs bound lines and text with visible truncation while preserving the next cursor', async () => {
  const logs = Array.from({ length: 205 }, (_, i) => ({ n: i + 1, t: i === 0 ? 'x'.repeat(3000) : 'line ' + (i + 1) }))
  const result = await loadTaskLog(fixture({ logs }).client, 'pve1', 'UPID:test', 0)
  assert.equal(result.lines.length, 200)
  assert.equal(result.lines[0].t.length, 2000)
  assert.match(result.lines[0].t, /\[truncated\]$/)
  assert.deepEqual(result.lines.at(-1), { n: 200, t: 'line 200' })
  assert.equal(result.next, 200)
  assert.equal(result.truncated, true)
})

test('task logs preserve empty cursors, recognize the PVE empty sentinel and bound the largest cursor', async () => {
  assert.deepEqual(await loadTaskLog(fixture().client, 'pve1', 'UPID:test', 25), { lines: [], next: 25, truncated: false })
  assert.deepEqual(await loadTaskLog(fixture({ logs: [{ n: 0, t: 'no content' }] }).client, 'pve1', 'UPID:test', 0), { lines: [], next: 0, truncated: false })
  assert.deepEqual(await loadTaskLog(fixture({ logs: [{ n: 1_000_001, t: 'outside supported range' }] }).client, 'pve1', 'UPID:test', 1_000_000), { lines: [], next: 1_000_000, truncated: true })
})

test('task logs expose safe errors for denied or malformed upstream responses', async () => {
  for (const data of [{ fail: 'log' as const }, { logs: null }, { logs: { message: 'secret' } }]) {
    await assert.rejects(loadTaskLog(fixture(data).client, 'pve1', 'UPID:test', 0), error => {
      assert.equal((error as { statusCode?: number }).statusCode, 502)
      assert.doesNotMatch((error as Error).message, /secret|token=|<script>/)
      return true
    })
  }
})
