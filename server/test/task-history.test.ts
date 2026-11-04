import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadTaskHistory, taskHistoryQuerySchema, TaskHistoryAccess, type NativeTask } from '../src/task-history.js'

const upid = 'UPID:pve1:00038759:013D985B:5EE4D2C9:qmstart:101:root@pam:'
const tokenUpid = 'UPID:pve1:00038760:013D985B:5EE4D2C9:qmstop:102:user@pve!agent:'
const nodeUpid = 'UPID:pve1:00038761:013D985B:5EE4D2C9:aptupdate::root@pam:'
const row = { upid, node: 'pve1', type: 'qmstart', id: '101', starttime: 1592054473, endtime: 1592054475, status: 'OK' }
const task: NativeTask = { upid, node: 'pve1', type: 'qmstart', vmid: 101, starttime: 1592054473, endtime: 1592054475, status: 'OK', state: 'success' }
const clientFor = (value: unknown) => ({ async get() { return value } })

test('history query accepts only canonical bounded cursors, positive guest IDs and existing node syntax', () => {
  assert.deepEqual(taskHistoryQuerySchema.parse({ node: 'pve1' }), { node: 'pve1', start: 0 })
  assert.deepEqual(taskHistoryQuerySchema.parse({ node: 'pve-2.local', start: '1000000', vmid: '9007199254740991' }), { node: 'pve-2.local', start: 1000000, vmid: 9007199254740991 })
  for (const start of ['', '-1', '01', '+1', '1e2', '1.0', '1000001', ' 1', ['0'], 0]) {
    assert.equal(taskHistoryQuerySchema.safeParse({ node: 'pve1', start }).success, false, String(start))
  }
  for (const vmid of ['', '0', '-1', '00101', '1.5', '1e2', '9007199254740992', ['101'], 101]) {
    assert.equal(taskHistoryQuerySchema.safeParse({ node: 'pve1', vmid }).success, false, String(vmid))
  }
  for (const node of ['', '..', '../pve1', 'pve1/tasks', 'pve1\n', 'x'.repeat(254), ['pve1']]) {
    assert.equal(taskHistoryQuerySchema.safeParse({ node }).success, false)
  }
  assert.equal(taskHistoryQuerySchema.safeParse({ node: 'pve1', source: 'active' }).success, false)
})

test('history requests one explicit node with all retained sources and an optional guest scope', async () => {
  const calls: unknown[][] = []
  const client = { async get(path: string, params?: unknown) { calls.push([path, params]); return [row] } }
  assert.deepEqual(await loadTaskHistory(client, 'pve1', { start: 50, vmid: 101 }), { tasks: [task], next: 51, hasMore: false, warnings: [] })
  assert.deepEqual(calls, [['/nodes/pve1/tasks', { source: 'all', start: 50, limit: 50, vmid: 101 }]])
  await loadTaskHistory(client, 'pve1', { start: 0 })
  assert.deepEqual(calls[1], ['/nodes/pve1/tasks', { source: 'all', start: 0, limit: 50 }])
})

test('native history exposes only task fields and preserves success, warnings, failures, running and unknown outcomes', async () => {
  const result = await loadTaskHistory(clientFor([
    { ...row, pid: 123, user: 'root@pam', password: 'hidden', config: { password: 'hidden' } },
    { ...row, upid: tokenUpid, type: 'qmstop', id: '102', status: 'WARNINGS: 1 issue' },
    { ...row, status: 'backup failed\u0000\u001b' },
    { ...row, status: undefined, endtime: undefined },
    { ...row, status: undefined },
    { upid: nodeUpid, starttime: 0 },
    { ...row, status: 'x'.repeat(1200) },
  ]), 'pve1', { start: 0 })
  assert.deepEqual(result.tasks.map(t => t.state), ['success', 'warning', 'error', 'running', 'unknown', 'running', 'error'])
  assert.deepEqual(result.tasks[0], task)
  assert.equal(result.tasks[1].upid, tokenUpid)
  assert.equal(result.tasks[1].vmid, 102)
  assert.equal(result.tasks[2].status, 'backup failed')
  assert.equal(result.tasks[3].endtime, undefined)
  assert.equal(result.tasks[5].vmid, undefined)
  assert.equal(result.tasks[5].type, 'aptupdate')
  assert.equal(result.tasks[6].status.length, 1000)
  assert.doesNotMatch(JSON.stringify(result), /hidden|password|config|"pid"|"user"|\u0000|\u001b/)
})

test('status sanitization cannot turn malformed text into a successful or warning result', async () => {
  const result = await loadTaskHistory(clientFor([
    { ...row, status: 'O\u0000K' },
    { ...row, status: 'WARN\u001bINGS: hidden' },
    { ...row, status: '', endtime: 0xffffffff, starttime: 0 },
    { ...row, status: 'running', endtime: undefined },
    { ...row, status: 'running' },
  ]), 'pve1', { start: 0 })
  assert.deepEqual(result.tasks.map(t => t.state), ['error', 'error', 'unknown', 'running', 'unknown'])
  assert.equal(result.tasks[0].status, 'O K')
  assert.equal(result.tasks[1].status, 'WARN INGS: hidden')
  assert.equal(result.tasks[2].endtime, 0xffffffff)
})

test('native uppercase RUNNING is an active task until Proxmox reports a terminal result', async () => {
  const result = await loadTaskHistory(clientFor([
    { ...row, status: 'RUNNING', endtime: undefined },
    { ...row, status: 'RUNNING' },
    { ...row, status: 'unexpected status' },
  ]), 'pve1', { start: 0 })
  assert.deepEqual(result.tasks.map(t => t.state), ['running', 'unknown', 'unknown'])
})

test('native owners support OIDC email names, directory domains and machine accounts while excluding path separators', async () => {
  const owners = ['alice@example.com@oidc', 'DOMAIN\\alice@ad', 'host$@ad', 'søren@pve', 'user@pve!agent']
  const tasks = owners.map(owner => ({ ...row, upid: upid.replace('root@pam', owner) }))
  const result = await loadTaskHistory(clientFor(tasks), 'pve1', { start: 0 })
  assert.equal(result.tasks.length, owners.length)
  const access = new TaskHistoryAccess()
  access.remember('connection', 'pve1', result.tasks)
  for (const task of tasks) assert.equal(access.canRead('connection', 'pve1', task.upid), true)
  const invalid = ['user/other@pve', 'user:other@pve', 'user other@pve', 'user\u0000other@pve']
  const rejected = await loadTaskHistory(clientFor(invalid.map(owner => ({ ...row, upid: upid.replace('root@pam', owner) }))), 'pve1', { start: 0 })
  assert.equal(rejected.tasks.length, 0)
})

test('malformed native identities, conflicting fields and out-of-range times are omitted with a safe warning', async () => {
  const malformed = [
    null, [], 'hidden', {},
    { ...row, upid: 'UPID:test' },
    { ...row, upid: upid.replace('pve1', 'pve2') },
    { ...row, upid: upid.replace('root@pam', 'root@pam/hidden') },
    { ...row, upid: upid.replace('root@pam', 'root@pam\nhidden') },
    { ...row, upid: upid.replace('013D985B', 'nothex00') },
    { ...row, upid: upid.replace('root@pam', 'a'.repeat(256) + '@pam') },
    { ...row, node: 'pve2' }, { ...row, type: 'qmstop' }, { ...row, id: '102' },
    { ...row, vmid: 102 }, { ...row, starttime: -1 }, { ...row, starttime: 4294967296 },
    { ...row, starttime: 1.5 }, { ...row, starttime: null }, { ...row, starttime: true },
    { ...row, endtime: 4294967296 }, { ...row, endtime: -1 }, { ...row, endtime: row.starttime - 1 },
    { ...row, status: { password: 'hidden' } },
  ]
  const result = await loadTaskHistory(clientFor([row, ...malformed]), 'pve1', { start: 10 })
  assert.deepEqual(result.tasks, [task])
  assert.equal(result.next, 34)
  assert.equal(result.hasMore, false)
  assert.ok(result.warnings.length)
  assert.doesNotMatch(result.warnings.join(), /hidden|root@pam|UPID:/)
})

test('guest-scoped history does not relabel node tasks or another guest as the requested guest', async () => {
  const result = await loadTaskHistory(clientFor([
    { ...row, id: undefined },
    { ...row, upid: tokenUpid, id: '102', type: 'qmstop' },
    { upid: nodeUpid, starttime: 0 },
    { upid: nodeUpid, starttime: 0, vmid: 101 },
  ]), 'pve1', { start: 0, vmid: 101 })
  assert.deepEqual(result.tasks, [task])
  assert.equal(result.next, 4)
  assert.ok(result.warnings.length)
})

test('native task identities accept bounded long-uptime process ticks without widening uint32 timestamps', async () => {
  const longTick = upid.replace('013D985B', '1013D985B')
  const maxTick = upid.replace('013D985B', 'FFFFFFFFFFFFFFFF')
  const result = await loadTaskHistory(clientFor([
    { ...row, upid: longTick },
    { ...row, upid: maxTick },
    { ...row, upid: upid.replace('013D985B', '1FFFFFFFFFFFFFFFF') },
    { ...row, upid: upid.replace('5EE4D2C9', '15EE4D2C9') },
  ]), 'pve1', { start: 0 })
  assert.deepEqual(result.tasks.map(t => t.upid), [longTick, maxTick])
  assert.equal(result.next, 4)
  assert.ok(result.warnings.length)
  const access = new TaskHistoryAccess()
  access.remember('cluster-a', 'pve1', result.tasks)
  assert.equal(access.canRead('cluster-a', 'pve1', longTick), true)
  assert.equal(access.canRead('cluster-a', 'pve1', maxTick), true)
})

test('pagination counts upstream rows even when every row is malformed, and never exceeds its cursor or page caps', async () => {
  const allBad = await loadTaskHistory(clientFor(Array.from({ length: 50 }, () => null)), 'pve1', { start: 50 })
  assert.deepEqual(allBad.tasks, [])
  assert.equal(allBad.next, 100)
  assert.equal(allBad.hasMore, true)
  assert.ok(allBad.warnings.length)
  const cap = await loadTaskHistory(clientFor(Array.from({ length: 50 }, () => row)), 'pve1', { start: 999990 })
  assert.equal(cap.next, 1000000)
  assert.equal(cap.hasMore, true)
  const end = await loadTaskHistory(clientFor(Array.from({ length: 50 }, () => row)), 'pve1', { start: 1000000 })
  assert.equal(end.next, 1000000)
  assert.equal(end.hasMore, false)
  const oversized = await loadTaskHistory(clientFor(Array.from({ length: 70 }, () => row)), 'pve1', { start: 0 })
  assert.equal(oversized.tasks.length, 50)
  assert.equal(oversized.next, 50)
  assert.equal(oversized.hasMore, true)
  assert.ok(oversized.warnings.length)
  assert.deepEqual(await loadTaskHistory(clientFor([]), 'pve1', { start: 50 }), { tasks: [], next: 50, hasMore: false, warnings: [] })
})

test('upstream failures and malformed envelopes fail safely while direct invalid paths never make a request', async () => {
  for (const payload of [null, {}, { data: [] }, 'password=hidden']) {
    await assert.rejects(loadTaskHistory(clientFor(payload), 'pve1', { start: 0 }), error => {
      assert.equal((error as { statusCode?: number }).statusCode, 502)
      assert.doesNotMatch(String(error), /hidden|password/)
      return true
    })
  }
  const denied = { async get(): Promise<unknown> { throw Object.assign(new Error('password=hidden'), { statusCode: 403, details: 'hidden' }) } }
  await assert.rejects(loadTaskHistory(denied, 'pve1', { start: 0 }), error => {
    assert.equal((error as { statusCode?: number }).statusCode, 403)
    assert.match(String(error), /history.*unavailable/i)
    assert.doesNotMatch(JSON.stringify(error) + String(error), /hidden|password|details/)
    return true
  })
  const unreachable = { async get(): Promise<unknown> { throw new Error('secret=hidden') } }
  await assert.rejects(loadTaskHistory(unreachable, 'pve1', { start: 0 }), error => (error as { statusCode?: number }).statusCode === 502 && !String(error).includes('hidden'))
  let calls = 0
  const neverCalled = { async get() { calls++; return [] } }
  for (const [node, options] of [['../pve1', { start: 0 }], ['pve1', { start: -1 }], ['pve1', { start: 1.5 }], ['pve1', { start: 0, vmid: 0 }]] as const) {
    await assert.rejects(loadTaskHistory(neverCalled, node, options))
  }
  assert.equal(calls, 0)
})

test('upstream credential failures are safe gateway errors and do not expire an authenticated agent session', async () => {
  const rejectedCredentials = {
    async get(): Promise<unknown> {
      throw Object.assign(new Error('Proxmox rejected password=hidden'), { statusCode: 401, details: 'hidden' })
    },
  }
  await assert.rejects(loadTaskHistory(rejectedCredentials, 'pve1', { start: 0 }), error => {
    assert.equal((error as { statusCode?: number }).statusCode, 502)
    assert.match(String(error), /history.*unavailable/i)
    assert.doesNotMatch(JSON.stringify(error) + String(error), /hidden|password|details/)
    return true
  })
})

test('history access validates native task identities and isolates connection, original node and UPID', () => {
  const access = new TaskHistoryAccess()
  assert.equal(access.canRead('cluster-a', 'pve1', upid), false)
  access.remember('cluster-a', 'pve1', [task])
  assert.equal(access.canRead('cluster-a', 'pve1', upid), true)
  assert.equal(access.canRead('cluster-b', 'pve1', upid), false)
  assert.equal(access.canRead('cluster-a', 'pve2', upid), false)
  access.remember('cluster-a', 'pve2', [task])
  access.remember('cluster-a', 'pve1', [{ ...task, upid: 'UPID:forged' }, { ...task, upid: tokenUpid, node: 'pve2' }])
  assert.equal(access.canRead('cluster-a', 'pve2', upid), false)
  assert.equal(access.canRead('cluster-a', 'pve1', 'UPID:forged'), false)
  assert.equal(access.canRead('cluster-a', 'pve1', tokenUpid), false)
  access.remember('cluster-b', 'pve1', [task])
  access.removeConnection('cluster-a')
  assert.equal(access.canRead('cluster-a', 'pve1', upid), false)
  assert.equal(access.canRead('cluster-b', 'pve1', upid), true)
})

test('history access expires exactly after thirty minutes and a fresh history read renews access', () => {
  let now = 0
  const access = new TaskHistoryAccess(() => now)
  access.remember('cluster-a', 'pve1', [task])
  now = 30 * 60_000 - 1
  assert.equal(access.canRead('cluster-a', 'pve1', upid), true)
  now++
  assert.equal(access.canRead('cluster-a', 'pve1', upid), false)
  access.remember('cluster-a', 'pve1', [task])
  now += 20 * 60_000
  access.remember('cluster-a', 'pve1', [task])
  now += 20 * 60_000
  assert.equal(access.canRead('cluster-a', 'pve1', upid), true)
})

test('history access revalidates remembered task fields instead of trusting a caller cast', () => {
  const access = new TaskHistoryAccess()
  for (const invalid of [
    { ...task, type: 'qmstop' }, { ...task, vmid: 102 }, { ...task, starttime: -1 },
    { ...task, endtime: 4294967296 }, { ...task, status: { password: 'hidden' } },
    { ...task, upid: upid.replace('root@pam', '../root@pam') }, null,
  ]) access.remember('cluster-a', 'pve1', [invalid as NativeTask])
  assert.equal(access.canRead('cluster-a', 'pve1', upid), false)
  access.remember('../cluster-a', 'pve1', [task])
  assert.equal(access.canRead('../cluster-a', 'pve1', upid), false)
})

test('history access evicts the oldest of at most five thousand entries without corrupting overlapping key parts', () => {
  let now = 0
  const access = new TaskHistoryAccess(() => now)
  access.remember('cluster-a', 'pve1', [task])
  now++
  for (let i = 0; i < 5000; i++) access.remember(`cluster-${i}`, 'pve1', [task])
  assert.equal(access.canRead('cluster-a', 'pve1', upid), false)
  assert.equal(access.canRead('cluster-0', 'pve1', upid), true)
  assert.equal(access.canRead('cluster-4999', 'pve1', upid), true)
  now = 30 * 60_000 + 1
  assert.equal(access.canRead('cluster-4999', 'pve1', upid), false)
  access.remember('cluster-new', 'pve1', [task])
  assert.equal(access.canRead('cluster-new', 'pve1', upid), true)
})
