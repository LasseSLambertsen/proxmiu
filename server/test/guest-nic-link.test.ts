import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadNicLinks, NicLinkReviews } from '../src/guest-nic-link.js'

type Params = Record<string, string | number | boolean | undefined>
const upid = 'UPID:pve1:00000123:00000456:12345678:qmconfig:100:root@pam:'
const secret = /private-|description|digest|ip=|gw=|firewall=|queues=/
function fixture(type: 'qemu' | 'lxc' = 'qemu') {
  const guest = { id: 'one', node: 'pve1', type, vmid: 100 }
  const raw = type === 'qemu'
    ? 'virtio=AA:bB:CC:dd:EE:fF,bridge=vmbr0,firewall=1,tag=0010,rate=01.50,queues=02,link_down=0'
    : 'name=eth0,hwaddr=AA:bB:CC:dd:EE:fF,bridge=vmbr0,ip=dhcp,ip6=auto,firewall=1,tag=0010,rate=01.50,mtu=01500,link_down=0'
  const state = {
    config: { digest: 'a'.repeat(40), [type === 'qemu' ? 'name' : 'hostname']: 'linkbox', description: 'private-native-notes', net0: raw, memory: 2048, onboot: 1 } as Record<string, unknown>,
    resource: { vmid: 100, type, node: 'pve1', status: 'stopped', template: 0 } as Record<string, unknown>,
    status: { status: 'stopped', ha: { managed: 0 } } as Record<string, unknown>,
    permissions: { '/nodes/pve1': { 'Sys.Audit': 1 } } as unknown,
    nodes: [{ node: 'pve1', status: 'online' }] as unknown,
    pending: [] as unknown, snapshots: [{ name: 'current' }] as unknown, tasks: [] as unknown,
    fail: '', result: null as unknown, apply: true,
    afterPut: undefined as (() => void) | undefined,
    onGet: undefined as ((path: string) => void) | undefined,
  }
  const reads: { path: string; params?: Params }[] = [], puts: { path: string; params?: Params }[] = []
  const client = {
    async get<T>(path: string, params?: Params): Promise<T> {
      reads.push({ path, params }); state.onGet?.(path)
      if (state.fail && path.endsWith(state.fail)) throw new Error('private-upstream-secret')
      const value = path === '/cluster/resources' ? [state.resource] : path === '/access/permissions' ? state.permissions : path === '/nodes' ? state.nodes : path.endsWith('/config') ? state.config : path.endsWith('/status/current') ? state.status : path.endsWith('/pending') ? state.pending : path.endsWith('/snapshot') ? state.snapshots : path.endsWith('/tasks') ? state.tasks : undefined
      if (value === undefined) throw new Error('Unexpected GET ' + path)
      return structuredClone(value) as T
    },
    async put<T>(path: string, params?: Params): Promise<T> {
      assert.equal(path, `/nodes/pve1/${type}/100/config`, 'Only the existing NIC configuration may be mutated')
      assert.deepEqual(Object.keys(params ?? {}).sort(), ['digest', 'net0'])
      puts.push({ path, params: structuredClone(params) })
      if (state.apply) { state.config.net0 = params!.net0; state.config.digest = 'b'.repeat(40) }
      state.afterPut?.()
      if (state.fail === 'put') throw new Error('private-upstream-secret')
      return state.result as T
    },
  }
  return { guest, raw, state, reads, puts, client }
}
const input = { nic: 'net0', linkDown: true }
const executeInput = (reviewId: string) => ({ reviewId, confirm: 'linkbox' })
function code(statusCode: number) {
  return (error: unknown) => {
    assert.equal((error as { statusCode: number }).statusCode, statusCode)
    assert.doesNotMatch((error as Error).message, /private-/)
    return true
  }
}

test('NIC inventory is deliberate, current, secret-safe and bounded at net31 for both guest types', async () => {
  for (const type of ['qemu', 'lxc'] as const) {
    const f = fixture(type)
    f.state.config.net31 = f.raw; f.state.config.net32 = f.raw
    const inventory = await loadNicLinks(f.client, f.guest)
    assert.equal(inventory.name, 'linkbox'); assert.equal(inventory.ready, true)
    assert.deepEqual(inventory.interfaces.map(n => n.nic), ['net0', 'net31'])
    assert.ok(inventory.interfaces.every(n => n.canEdit && n.linkDown === false))
    assert.equal(inventory.interfaces[0].mac!.toLowerCase(), 'aa:bb:cc:dd:ee:ff')
    assert.equal(inventory.interfaces[0].bridge, 'vmbr0'); assert.equal(inventory.interfaces[0].tag, 10)
    assert.equal((await new NicLinkReviews().preview(f.client, f.guest, 'rev', { nic: 'net31', linkDown: true })).nic, 'net31')
    assert.ok(f.reads.some(r => r.path.endsWith('/config') && r.params?.current === 1))
    assert.deepEqual(f.reads.find(r => r.path.endsWith('/tasks'))?.params, { source: 'active', vmid: 100, limit: 500 })
    assert.doesNotMatch(JSON.stringify(inventory), secret); assert.equal(f.puts.length, 0)
  }
})

test('review fixes identity and sends exactly one raw-preserving NIC plus digest PUT on null confirmation', async () => {
  for (const type of ['qemu', 'lxc'] as const) {
    const f = fixture(type), reviews = new NicLinkReviews(), before = structuredClone(f.state.config)
    const plan = await reviews.preview(f.client, f.guest, 'rev', input)
    assert.equal(plan.name, 'linkbox'); assert.equal(plan.nic, 'net0')
    assert.equal(plan.currentLinkDown, false); assert.equal(plan.linkDown, true)
    assert.equal(plan.node, 'pve1'); assert.equal(plan.type, type); assert.equal(plan.vmid, 100)
    assert.equal(f.puts.length, 0); assert.doesNotMatch(JSON.stringify(plan), secret)
    const result = await reviews.execute(f.client, f.guest, 'rev', executeInput(plan.reviewId))
    assert.equal(result.verified, true); assert.equal(result.name, 'linkbox')
    assert.equal(result.interface.nic, 'net0'); assert.equal(result.interface.linkDown, true)
    assert.equal(typeof result.observedAt, 'number'); assert.doesNotMatch(JSON.stringify(result), secret)
    assert.deepEqual(f.puts, [{ path: `/nodes/pve1/${type}/100/config`, params: { net0: f.raw.replace('link_down=0', 'link_down=1'), digest: 'a'.repeat(40) } }])
    assert.deepEqual(Object.fromEntries(Object.entries(f.state.config).filter(([k]) => !['digest', 'net0'].includes(k))), Object.fromEntries(Object.entries(before).filter(([k]) => !['digest', 'net0'].includes(k))))
  }
})

test('semantic postconditions accept model aliases, native veth insertion, order, MAC case and numeric canonicalization', async () => {
  for (const type of ['qemu', 'lxc'] as const) {
    const f = fixture(type), reviews = new NicLinkReviews()
    f.state.afterPut = () => { f.state.config.net0 = type === 'qemu'
      ? 'link_down=ON,queues=2,rate=1.5,tag=10,firewall=yes,bridge=vmbr0,model=virtio,macaddr=aa:bb:cc:dd:ee:ff'
      : 'type=veth,link_down=YES,mtu=1500,rate=1.5,tag=10,firewall=on,ip6=auto,ip=dhcp,bridge=vmbr0,hwaddr=aa:bb:cc:dd:ee:ff,name=eth0' }
    const plan = await reviews.preview(f.client, f.guest, 'rev', input)
    assert.equal((await reviews.execute(f.client, f.guest, 'rev', executeInput(plan.reviewId))).verified, true)
    assert.equal(f.puts.length, 1)
  }
  for (const model of ['virtio', 'e1000', 'e1000e', 'rtl8139', 'vmxnet3']) {
    const f = fixture(); f.state.config.net0 = `${model}=AA:BB:CC:DD:EE:FF,bridge=vmbr0`
    assert.equal((await loadNicLinks(f.client, f.guest)).interfaces[0].canEdit, true, model)
  }
  const f = fixture('lxc'), reviews = new NicLinkReviews()
  f.state.config.net0 = 'type=veth,name=eth0,hwaddr=AA:bB:CC:dd:EE:fF,bridge=vmbr0,ip=192.0.2.100/24,gw=192.0.2.1,ip6=2001:db8::100/64,gw6=2001:db8::1,host-managed=OFF,mtu=01500,rate=01.50,tag=0010,firewall=FALSE'
  const before = String(f.state.config.net0)
  const plan = await reviews.preview(f.client, f.guest, 'rev', input)
  f.state.afterPut = () => { f.state.config.net0 = String(f.state.config.net0).replace('host-managed=OFF', 'host-managed=no').replace('mtu=01500', 'mtu=1500').replace('rate=01.50', 'rate=1.5').replace('tag=0010', 'tag=10').replace('firewall=FALSE', 'firewall=0') }
  assert.equal((await reviews.execute(f.client, f.guest, 'rev', executeInput(plan.reviewId))).verified, true)
  assert.equal(f.puts[0].params!.net0, before + ',link_down=1')
})

test('native boolean spellings are case insensitive and appended link_down preserves every original token', async () => {
  for (const spelling of ['0', 'off', 'OFF', 'no', 'No', 'false', 'FALSE']) {
    const f = fixture(), reviews = new NicLinkReviews()
    f.state.config.net0 = `virtio=AA:bB:CC:dd:EE:fF,bridge=vmbr0,firewall=${spelling}`
    assert.equal((await loadNicLinks(f.client, f.guest)).interfaces[0].linkDown, false)
    const raw = f.state.config.net0
    const plan = await reviews.preview(f.client, f.guest, 'rev', input)
    await reviews.execute(f.client, f.guest, 'rev', executeInput(plan.reviewId))
    assert.equal(f.puts[0].params!.net0, raw + ',link_down=1')
  }
  for (const spelling of ['1', 'on', 'ON', 'yes', 'Yes', 'true', 'TRUE']) {
    const f = fixture(); f.state.config.net0 = f.raw.replace('link_down=0', `link_down=${spelling}`)
    assert.equal((await loadNicLinks(f.client, f.guest)).interfaces[0].linkDown, true)
  }
})

test('ambiguous properties, unknown syntax, unsupported identities and trunks remain read-only', async () => {
  const raws = ['virtio,bridge=vmbr0', 'virtio=AA:BB:CC:DD:EE:FF', 'virtio=bad,bridge=vmbr0', 'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,trunks=10;20', 'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,unknown=private-token', 'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,bridge=vmbr1', 'virtio=AA:BB:CC:DD:EE:FF,model=virtio,bridge=vmbr0', 'virtio=AA:BB:CC:DD:EE:FF,bridge="vmbr0"', 'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,link_down=maybe', 'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,tag=4095', 'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,', 'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0\n', 'ne2k_pci=AA:BB:CC:DD:EE:FF,bridge=vmbr0']
  for (const raw of raws) {
    const f = fixture(); f.state.config.net0 = raw
    assert.equal((await loadNicLinks(f.client, f.guest)).interfaces[0].canEdit, false, raw)
    await assert.rejects(new NicLinkReviews().preview(f.client, f.guest, 'rev', input)); assert.equal(f.puts.length, 0)
  }
})

test('LXC host-managed interfaces and raw custom config pairs, legacy and flattened directives are read-only', async () => {
  for (const raw of ['type=phys,name=eth0,hwaddr=AA:BB:CC:DD:EE:FF,bridge=vmbr0', 'name=eth0,bridge=vmbr0', 'name=eth0,hwaddr=AA:BB:CC:DD:EE:FF,bridge=vmbr0,trunks=10', 'name=eth0,hwaddr=AA:BB:CC:DD:EE:FF,bridge=vmbr0,unknown=1']) {
    const f = fixture('lxc'); f.state.config.net0 = raw
    assert.equal((await loadNicLinks(f.client, f.guest)).interfaces[0].canEdit, false)
  }
  for (const custom of [{ lxc: [['lxc.net.0.type', 'veth']] }, { lxc: [['lxc.network.type', 'veth']] }, { lxc: [['lxc.mount.entry', '/private /mnt none bind 0 0']] }, { 'lxc.net.0.type': 'veth' }, { 'lxc.network.type': 'veth' }, { lxc: 'private-malformed' }]) {
    const f = fixture('lxc'); Object.assign(f.state.config, custom)
    assert.equal((await loadNicLinks(f.client, f.guest)).interfaces[0].canEdit, false, JSON.stringify(custom))
    await assert.rejects(new NicLinkReviews().preview(f.client, f.guest, 'rev', input)); assert.equal(f.puts.length, 0)
  }
})

test('all unavailable or unsafe readiness evidence prevents review and mutation', async () => {
  const mutations: Record<string, (f: ReturnType<typeof fixture>) => void> = {
    running: f => { f.state.status.status = 'running' }, resourceRunning: f => { f.state.resource.status = 'running' }, paused: f => { f.state.status.status = 'paused' }, moved: f => { f.state.resource.node = 'pve2' }, template: f => { f.state.resource.template = 1 }, configTemplate: f => { f.state.config.template = 1 }, lock: f => { f.state.config.lock = 'backup' }, digest: f => { f.state.config.digest = 'invalid' }, pending: f => { f.state.pending = [{ key: 'net0', pending: 'private' }] }, deletion: f => { f.state.pending = [{ key: 'net0', delete: 1 }] }, badPending: f => { f.state.pending = [{}] }, snapshot: f => { f.state.snapshots = [{ name: 'before' }] }, badSnapshot: f => { f.state.snapshots = null }, managed: f => { f.state.status.ha = { managed: 1 } }, missingHA: f => { delete f.state.status.ha }, unknownHA: f => { f.state.status.ha = { managed: 'unknown' } }, offline: f => { f.state.nodes = [{ node: 'pve1', status: 'offline' }] }, duplicateNode: f => { f.state.nodes = [{ node: 'pve1', status: 'online' }, { node: 'pve1', status: 'online' }] }, malformedNodes: f => { f.state.nodes = null }, badTasks: f => { f.state.tasks = {} }, truncatedTasks: f => { f.state.tasks = Array(500).fill({}) },
  }
  for (const [name, mutate] of Object.entries(mutations)) {
    const f = fixture(); mutate(f)
    await assert.rejects(new NicLinkReviews().preview(f.client, f.guest, 'rev', input), undefined, name)
    assert.equal(f.puts.length, 0, name)
  }
  for (const value of [2, 'unknown', null]) {
    const f = fixture(); f.state.resource.template = value
    await assert.rejects(new NicLinkReviews().preview(f.client, f.guest, 'rev', input), undefined, `Malformed resource template: ${JSON.stringify(value)}`)
    assert.equal(f.puts.length, 0)
  }
  for (const path of ['/cluster/resources', '/config', '/status/current', '/pending', '/snapshot', '/nodes', '/tasks', '/access/permissions']) {
    const f = fixture(); f.state.fail = path
    await assert.rejects(new NicLinkReviews().preview(f.client, f.guest, 'rev', input), undefined, path); assert.equal(f.puts.length, 0)
  }
})

test('complete task visibility needs exact-node effective Sys.Audit numeric zero or one', async () => {
  for (const value of [0, 1]) {
    const f = fixture(); f.state.permissions = { '/nodes/pve1': { 'Sys.Audit': value } }
    assert.equal((await loadNicLinks(f.client, f.guest)).ready, true)
    assert.deepEqual(f.reads.find(r => r.path === '/access/permissions')?.params, { path: '/nodes/pve1' })
  }
  for (const permissions of [null, {}, { '/': { 'Sys.Audit': 1 } }, { '/nodes/pve2': { 'Sys.Audit': 1 } }, ...[undefined, 2, true, '1', '0'].map(value => ({ '/nodes/pve1': { 'Sys.Audit': value } }))]) {
    const f = fixture(); f.state.permissions = permissions
    assert.equal((await loadNicLinks(f.client, f.guest)).ready, false)
    await assert.rejects(new NicLinkReviews().preview(f.client, f.guest, 'rev', input)); assert.equal(f.puts.length, 0)
  }
})

test('terminal rows in the active task file are allowed only with complete matching native timestamps and identity', async () => {
  const row = { upid, node: 'pve1', type: 'qmconfig', id: '100', starttime: 0x12345678, endtime: 0x12345678 + 10, status: 'OK' }
  for (const status of ['OK', 'WARNINGS: 1', 'native operation failed']) {
    const f = fixture(); f.state.tasks = [{ ...row, status }]
    assert.equal((await loadNicLinks(f.client, f.guest)).ready, true, status)
  }
  for (const task of [{ upid, node: 'pve1', type: 'qmconfig', id: '100', starttime: 0x12345678 }, { ...row, status: 'RUNNING' }, { ...row, status: undefined }, { ...row, starttime: 100 }, { ...row, endtime: 100 }, { ...row, node: 'pve2' }, { ...row, id: '101' }, { ...row, upid: 'UPID:bad' }, {}]) {
    const f = fixture(); f.state.tasks = [task]
    assert.equal((await loadNicLinks(f.client, f.guest)).ready, false, JSON.stringify(task)); assert.equal(f.puts.length, 0)
  }
})

test('strict review and execution inputs reject no-op, arbitrary properties and invalid identity without PUT', async () => {
  for (const value of [{ ...input, linkDown: false }, { ...input, linkDown: 'true' }, { ...input, nic: '../net0' }, { ...input, nic: 'net32' }, { ...input, nic: 'net00' }, { ...input, bridge: 'vmbr1' }, { ...input, digest: 'override' }]) {
    const f = fixture(); await assert.rejects(new NicLinkReviews().preview(f.client, f.guest, 'rev', value)); assert.equal(f.puts.length, 0)
  }
  const f = fixture(), reviews = new NicLinkReviews(), plan = await reviews.preview(f.client, f.guest, 'rev', input)
  for (const value of [{ reviewId: plan.reviewId, confirm: null }, { ...executeInput(plan.reviewId), skiplock: true }, { ...executeInput(plan.reviewId), reviewId: '../bad' }]) await assert.rejects(reviews.execute(f.client, f.guest, 'rev', value))
  assert.equal(f.puts.length, 0)
})

test('stale digest, raw spelling, name, identity, readiness and connection revision consume review without PUT', async () => {
  for (const change of ['digest', 'raw', 'name', 'mac', 'bridge', 'status', 'pending', 'revision']) {
    const f = fixture(), reviews = new NicLinkReviews(), plan = await reviews.preview(f.client, f.guest, 'rev', input)
    if (change === 'digest') f.state.config.digest = 'b'.repeat(40)
    if (change === 'raw') f.state.config.net0 = f.raw.replace('tag=0010', 'tag=10')
    if (change === 'name') f.state.config.name = 'replacement'
    if (change === 'mac') f.state.config.net0 = f.raw.replace('AA:bB', 'aa:bb')
    if (change === 'bridge') f.state.config.net0 = f.raw.replace('vmbr0', 'vmbr1')
    if (change === 'status') f.state.status.status = 'running'
    if (change === 'pending') f.state.pending = [{ key: 'net0', pending: f.raw }]
    await assert.rejects(reviews.execute(f.client, f.guest, change === 'revision' ? 'changed' : 'rev', executeInput(plan.reviewId)), code(409), change)
    await assert.rejects(reviews.execute(f.client, f.guest, 'rev', executeInput(plan.reviewId)), code(409)); assert.equal(f.puts.length, 0)
  }
})

test('wrong confirmation, guest identity, expiry and a restarted review store cannot submit', async () => {
  let now = 1000
  const f = fixture(), reviews = new NicLinkReviews(() => now), plan = await reviews.preview(f.client, f.guest, 'rev', input)
  assert.equal(plan.expiresAt, 301000)
  await assert.rejects(reviews.execute(f.client, f.guest, 'rev', { reviewId: plan.reviewId, confirm: 'Linkbox' }), code(409))
  for (const guest of [{ ...f.guest, id: 'other' }, { ...f.guest, node: 'pve2' }, { ...f.guest, vmid: 101 }]) await assert.rejects(reviews.execute(f.client, guest, 'rev', executeInput(plan.reviewId)), code(409))
  await assert.rejects(new NicLinkReviews().execute(f.client, f.guest, 'rev', executeInput(plan.reviewId)), code(409))
  now = plan.expiresAt
  await assert.rejects(reviews.execute(f.client, f.guest, 'rev', executeInput(plan.reviewId)), code(409)); assert.equal(f.puts.length, 0)
})

test('per-guest reservation admits only one concurrent review execution and caches the known result', async () => {
  const f = fixture(), reviews = new NicLinkReviews()
  const a = await reviews.preview(f.client, f.guest, 'rev', input), b = await reviews.preview(f.client, f.guest, 'rev', input)
  const results = await Promise.allSettled([a, b].map(p => reviews.execute(f.client, f.guest, 'rev', executeInput(p.reviewId))))
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.puts.length, 1)
  const winner = results.findIndex(r => r.status === 'fulfilled'), plan = [a, b][winner]
  const observed = (results[winner] as PromiseFulfilledResult<unknown>).value
  f.state.config.net0 = f.raw; f.state.fail = '/config'
  assert.deepEqual(await reviews.execute(f.client, f.guest, 'rev', executeInput(plan.reviewId)), observed)
  assert.equal(f.puts.length, 1)
})

test('revision replacement, removal and expiry during awaited preflight are rejected at final admission', async () => {
  for (const mode of ['revision', 'removed', 'expiry']) {
    let now = 1000, revision = 'rev'
    const f = fixture(), reviews = new NicLinkReviews(() => now), plan = await reviews.preview(f.client, f.guest, 'rev', input)
    f.state.onGet = path => { if (path.endsWith('/tasks')) { if (mode === 'removed') revision = ''; else if (mode === 'revision') revision = 'changed'; else now += 300001 } }
    await assert.rejects(reviews.execute(f.client, f.guest, () => { if (!revision) throw new Error('private-removed-connection'); return revision }, executeInput(plan.reviewId)), code(409), mode)
    assert.equal(f.puts.length, 0)
  }
})

test('non-null responses, lost replies and partial writes are unknown, secret-safe and never replayed', async () => {
  for (const mode of ['nonnull', 'throw-before-apply', 'throw-after-apply']) {
    const f = fixture(), reviews = new NicLinkReviews(), plan = await reviews.preview(f.client, f.guest, 'rev', input)
    if (mode === 'nonnull') f.state.result = upid
    else { f.state.fail = 'put'; f.state.apply = mode === 'throw-after-apply' }
    await assert.rejects(reviews.execute(f.client, f.guest, 'rev', executeInput(plan.reviewId)), error => {
      code(502)(error); assert.match((error as Error).message, /unknown|unconfirmed/i); assert.match((error as Error).message, /inspect/i); return true
    })
    f.state.fail = ''
    const fresh = await loadNicLinks(f.client, f.guest)
    assert.equal(fresh.interfaces[0].linkDown, mode !== 'throw-before-apply')
    await assert.rejects(reviews.execute(f.client, f.guest, 'rev', executeInput(plan.reviewId)), code(409)); assert.equal(f.puts.length, 1)
  }
})

test('null requires fresh readable readiness and all original interface semantics before verification', async () => {
  for (const mode of ['not-applied', 'changed-mac', 'changed-bridge', 'changed-firewall', 'changed-rate', 'extra-option', 'missing-interface', 'pending', 'running', 'active-task', 'unreadable', 'moved']) {
    const f = fixture(), reviews = new NicLinkReviews(), plan = await reviews.preview(f.client, f.guest, 'rev', input)
    f.state.afterPut = () => {
      const raw = String(f.state.config.net0)
      if (mode === 'not-applied') f.state.config.net0 = f.raw
      if (mode === 'changed-mac') f.state.config.net0 = raw.replace('AA:bB', '00:11')
      if (mode === 'changed-bridge') f.state.config.net0 = raw.replace('vmbr0', 'vmbr1')
      if (mode === 'changed-firewall') f.state.config.net0 = raw.replace('firewall=1', 'firewall=0')
      if (mode === 'changed-rate') f.state.config.net0 = raw.replace('rate=01.50', 'rate=2')
      if (mode === 'extra-option') f.state.config.net0 = raw + ',unknown=1'
      if (mode === 'missing-interface') delete f.state.config.net0
      if (mode === 'pending') f.state.pending = [{ key: 'net0', pending: raw }]
      if (mode === 'running') f.state.status.status = 'running'
      if (mode === 'active-task') f.state.tasks = [{ upid }]
      if (mode === 'unreadable') f.state.fail = '/config'
      if (mode === 'moved') f.state.resource.node = 'pve2'
    }
    await assert.rejects(reviews.execute(f.client, f.guest, 'rev', executeInput(plan.reviewId)), code(502), mode)
    await assert.rejects(reviews.execute(f.client, f.guest, 'rev', executeInput(plan.reviewId)), code(409)); assert.equal(f.puts.length, 1)
  }
  for (const [key, value] of Object.entries({ name: 'eth1', hwaddr: '00:11:22:33:44:55', bridge: 'vmbr1', ip: '192.0.2.101/24', gw: '192.0.2.2', ip6: '2001:db8::101/64', gw6: '2001:db8::2', type: 'phys', 'host-managed': '1', mtu: '1400', rate: '2', tag: '11', firewall: '1' })) {
    const f = fixture('lxc'), reviews = new NicLinkReviews()
    f.state.config.net0 = 'type=veth,name=eth0,hwaddr=AA:bB:CC:dd:EE:fF,bridge=vmbr0,ip=192.0.2.100/24,gw=192.0.2.1,ip6=2001:db8::100/64,gw6=2001:db8::1,host-managed=0,mtu=1500,rate=1.5,tag=10,firewall=0'
    const plan = await reviews.preview(f.client, f.guest, 'rev', input)
    f.state.afterPut = () => { f.state.config.net0 = String(f.state.config.net0).split(',').map(token => token.startsWith(key + '=') ? key + '=' + value : token).join(',') }
    await assert.rejects(reviews.execute(f.client, f.guest, 'rev', executeInput(plan.reviewId)), code(502), key)
    assert.equal(f.puts.length, 1, key)
  }
})

test('removed connection after PUT remains an unknown consumed write and fresh observation never unlocks it', async () => {
  const f = fixture(), reviews = new NicLinkReviews(); let revision = 'rev'
  const plan = await reviews.preview(f.client, f.guest, revision, input)
  f.state.afterPut = () => { revision = '' }
  await assert.rejects(reviews.execute(f.client, f.guest, () => { if (!revision) throw new Error('private-removed'); return revision }, executeInput(plan.reviewId)), code(502))
  assert.equal((await loadNicLinks(f.client, f.guest)).interfaces[0].linkDown, true)
  revision = 'rev'
  await assert.rejects(reviews.execute(f.client, f.guest, revision, executeInput(plan.reviewId)), code(409)); assert.equal(f.puts.length, 1)
})
