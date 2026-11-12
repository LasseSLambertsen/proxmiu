import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DiskGrowthReviews, loadDiskInventory } from '../src/guest-disk-growth.js'

const GiB = 1024 ** 3
const upid = 'UPID:pve1:00000123:00000456:12345678:resize:100:root@pam:'
type Params = Record<string, string | number | boolean | undefined>
function fixture(type: 'qemu' | 'lxc' = 'qemu') {
  const guest = { id: 'one', node: 'pve1', type, vmid: 100 }
  const disk = type === 'qemu' ? 'scsi0' : 'rootfs'
  const volume = 'local-lvm:vm-100-disk-0'
  const raw = type === 'qemu' ? volume + ',cache=none,iothread=1,discard=on,backup=0,size=2G' : volume + ',acl=1,mountoptions=noatime;nodev,size=2G'
  const state = {
    config: { digest: 'a'.repeat(40), [type === 'qemu' ? 'name' : 'hostname']: 'diskbox', description: 'private-native-notes', memory: 2048, net0: 'private-network-options', onboot: 1, [disk]: raw } as Record<string, unknown>,
    resource: { vmid: 100, type, node: 'pve1', status: 'stopped', template: 0 } as Record<string, unknown>,
    status: { status: 'stopped', ha: { managed: 0 } } as Record<string, unknown>,
    nodes: [{ node: 'pve1', status: 'online' }] as unknown,
    storages: [{ storage: 'local-lvm', active: 1, enabled: 1, type: 'lvmthin', content: 'images,rootdir', avail: 100 * GiB }] as unknown,
    permissions: { '/nodes/pve1': { 'Sys.Audit': 1 } } as unknown,
    pending: [] as unknown, snapshots: [{ name: 'current' }] as unknown, tasks: [] as unknown,
    volumes: [{ volid: volume, vmid: 100, format: 'raw', content: type === 'qemu' ? 'images' : 'rootdir', size: 8 * GiB }] as unknown,
    attributes: { size: 8 * GiB, format: 'raw' } as unknown,
    fail: '', result: upid as unknown,
  }
  const puts: { path: string; params?: Params }[] = [], reads: { path: string; params?: Params }[] = []
  const client = {
    async get<T>(path: string, params?: Params): Promise<T> {
      reads.push({ path, params })
      if (state.fail && path.endsWith(state.fail)) throw new Error('private-upstream-secret')
      const value = path === '/access/permissions' ? state.permissions : path === '/cluster/resources' ? [state.resource] : path === '/nodes' ? state.nodes : path.endsWith('/config') ? state.config : path.endsWith('/status/current') ? state.status : path.endsWith('/pending') ? state.pending : path.endsWith('/snapshot') ? state.snapshots : path.endsWith('/storage') ? state.storages : path.endsWith('/tasks') ? state.tasks : path.endsWith('/content') ? state.volumes : path.includes('/content/') ? state.attributes : undefined
      if (value === undefined) throw new Error('Unexpected GET ' + path)
      return value as T
    },
    async put<T>(path: string, params?: Params): Promise<T> {
      assert.equal(path, `/nodes/pve1/${type}/100/resize`, 'Only native disk resize may be mutated')
      puts.push({ path, params })
      if (state.fail === 'put') throw new Error('private-upstream-secret')
      state.tasks = [{ upid, type: 'resize', id: '100', node: 'pve1', starttime: 100 }]
      return state.result as T
    },
  }
  return { guest, disk, volume, raw, state, client, puts, reads }
}

test('disk inventory uses current native config and authoritative volume bytes rather than size hints', async () => {
  for (const type of ['qemu', 'lxc'] as const) {
    const f = fixture(type)
    const inventory = await loadDiskInventory(f.client, f.guest)
    assert.equal(inventory.name, 'diskbox')
    assert.equal(inventory.ready, true)
    assert.equal(inventory.disks.length, 1)
    const item = inventory.disks[0]
    assert.equal(item.disk, f.disk); assert.equal(item.volume, f.volume)
    assert.equal(item.sizeBytes, 8 * GiB); assert.equal(item.canGrow, true)
    assert.equal(item.availableBytes, 100 * GiB)
    assert.ok(f.reads.some(r => r.path.endsWith('/config') && r.params?.current === 1))
    assert.ok(f.reads.some(r => r.path.endsWith('/content/' + encodeURIComponent(f.volume))))
    assert.doesNotMatch(JSON.stringify(inventory), /private-|cache=|iothread|mountoptions|digest|description|net0/)
    assert.equal(f.puts.length, 0)
  }
})

test('review is read-only and execution sends exact absolute-size/disk/digest payloads for both types', async () => {
  for (const type of ['qemu', 'lxc'] as const) {
    const f = fixture(type), reviews = new DiskGrowthReviews()
    const before = structuredClone(f.state.config)
    const plan = await reviews.preview(f.client, f.guest, 'rev', { disk: f.disk, targetGiB: 12 })
    assert.equal(plan.currentBytes, 8 * GiB); assert.equal(plan.targetBytes, 12 * GiB)
    assert.equal(plan.targetGiB, 12); assert.equal(plan.disk, f.disk)
    assert.equal(plan.name, 'diskbox'); assert.equal(plan.vmid, 100)
    assert.equal(f.puts.length, 0)
    assert.doesNotMatch(JSON.stringify(plan), /private-|cache=|mountoptions|digest|description|net0/)
    const result = await reviews.execute(f.client, f.guest, () => 'rev', { reviewId: plan.reviewId, confirm: 'diskbox' })
    assert.deepEqual(result, { node: 'pve1', type, vmid: 100, upid })
    assert.deepEqual(f.puts, [{ path: `/nodes/pve1/${type}/100/resize`, params: { disk: f.disk, size: '12G', digest: 'a'.repeat(40) } }])
    assert.deepEqual(f.state.config, before, 'No raw disk option or unrelated field may be rewritten')
  }
})

test('non-ready guest states and unreadable safety checks keep all disks read-only', async () => {
  for (const change of ['running', 'paused', 'unknown-status', 'moved', 'template', 'locked', 'pending', 'pending-delete', 'bad-pending', 'snapshot', 'bad-snapshots', 'ha', 'offline', 'active-task', 'bad-tasks', 'unreadable-tasks', 'bad-digest'] as const) {
    const f = fixture()
    if (change === 'running' || change === 'paused') f.state.status.status = change
    if (change === 'unknown-status') f.state.status.status = 'private-unknown-status'
    if (change === 'moved') f.state.resource.node = 'pve2'
    if (change === 'template') f.state.resource.template = 1
    if (change === 'locked') f.state.config.lock = 'backup'
    if (change === 'pending') f.state.pending = [{ key: 'scsi0', pending: 'other' }]
    if (change === 'pending-delete') f.state.pending = [{ key: 'scsi0', delete: 1 }]
    if (change === 'bad-pending') f.state.pending = [{}]
    if (change === 'snapshot') f.state.snapshots = [{ name: 'current' }, { name: 'before' }]
    if (change === 'bad-snapshots') f.state.snapshots = null
    if (change === 'ha') f.state.status.ha = { managed: 1 }
    if (change === 'offline') f.state.nodes = [{ node: 'pve1', status: 'offline' }]
    if (change === 'active-task') f.state.tasks = [{ upid, type: 'resize', id: '100' }]
    if (change === 'bad-tasks') f.state.tasks = {}
    if (change === 'unreadable-tasks') f.state.fail = '/tasks'
    if (change === 'bad-digest') f.state.config.digest = 'bad'
    const reviews = new DiskGrowthReviews()
    await assert.rejects(reviews.preview(f.client, f.guest, 'rev', { disk: f.disk, targetGiB: 12 }), undefined, change)
    assert.equal(f.puts.length, 0)
  }
})

test('unsafe devices/options and unsupported storage backends are not writable', async () => {
  for (const type of ['qemu', 'lxc'] as const) {
    for (const raw of ['/dev/sda', '/host/path,mp=/data', 'none,media=cdrom', 'local-lvm:vm-100-cloudinit,media=cdrom', 'local-lvm:vm-100-disk-0,ro=1', 'local-lvm:vm-100-disk-0,shared=1', 'local-lvm:vm-100-disk-0,scsiblock=1', 'local-lvm:vm-100-disk-0,ro=unknown', 'local-lvm:vm-100-disk-0,size=8G,size=9G']) {
      const f = fixture(type)
      f.state.config[f.disk] = raw
      const inventory = await loadDiskInventory(f.client, f.guest)
      assert.equal(inventory.disks[0].canGrow, false, raw)
      await assert.rejects(new DiskGrowthReviews().preview(f.client, f.guest, 'rev', { disk: f.disk, targetGiB: 12 }))
      assert.equal(f.puts.length, 0)
    }
    const f = fixture(type)
    f.state.storages = [{ storage: 'local-lvm', active: 1, enabled: 1, type: 'rbd', content: 'images,rootdir' }]
    assert.equal((await loadDiskInventory(f.client, f.guest)).disks[0].canGrow, false)
  }
})

test('unknown ownership/capacity/format, linked parents and duplicate attachments block growth', async () => {
  const cases = [
    { volumes: [{ volid: 'local-lvm:vm-100-disk-0', vmid: 101, format: 'raw' }] },
    { volumes: [{ volid: 'local-lvm:vm-100-disk-0', vmid: '100x', format: 'raw' }] },
    { volumes: [{ volid: 'local-lvm:vm-100-disk-0', vmid: 100, format: 'raw', parent: 'base-900-disk-0' }] },
    { attributes: { size: 0, format: 'raw' } }, { attributes: { size: -1, format: 'raw' } },
    { attributes: { size: Number.MAX_SAFE_INTEGER + 1, format: 'raw' } },
    { attributes: { size: 8 * GiB, format: 'iso' } }, { attributes: null },
  ]
  for (const changed of cases) {
    const f = fixture(); Object.assign(f.state, changed)
    assert.equal((await loadDiskInventory(f.client, f.guest)).disks[0].canGrow, false)
    assert.equal(f.puts.length, 0)
  }
  const f = fixture()
  f.state.config.virtio1 = f.raw
  const disks = (await loadDiskInventory(f.client, f.guest)).disks
  assert.equal(disks.length, 2); assert.ok(disks.every(d => !d.canGrow))
  f.state.config = { ...f.state.config, efidisk0: f.raw, tpmstate0: f.raw, unused0: f.raw }
  assert.equal((await loadDiskInventory(f.client, f.guest)).disks.length, 2, 'Special and unused devices are outside this editor')
})

test('valid raw/qcow2/subvol metadata and explicit volume keys retain exact native options', async () => {
  for (const type of ['qemu', 'lxc'] as const) {
    const f = fixture(type)
    const format = type === 'qemu' ? 'qcow2' : 'subvol'
    f.state.config[f.disk] = `${type === 'qemu' ? 'file' : 'volume'}=${f.raw}`
    f.state.storages = [{ storage: 'local-lvm', type: type === 'qemu' ? 'dir' : 'zfspool', active: 1, content: 'images,rootdir', avail: 100 * GiB }]
    f.state.volumes = [{ volid: f.volume, vmid: '100', format, content: type === 'qemu' ? 'images' : 'rootdir' }]
    f.state.attributes = { format, size: String(8 * GiB) }
    assert.equal((await loadDiskInventory(f.client, f.guest)).disks[0].canGrow, true)
  }
})

test('strict input rejects equal/shrink, invalid GiB, path overrides and arbitrary parameters', async () => {
  for (const targetGiB of [8, 4, 0, 1.5, 65537, Infinity, '12']) {
    const f = fixture()
    await assert.rejects(new DiskGrowthReviews().preview(f.client, f.guest, 'rev', { disk: f.disk, targetGiB }))
    assert.equal(f.puts.length, 0)
  }
  for (const extra of [{ disk: '../scsi0' }, { skiplock: true }, { digest: 'override' }, { volume: '/dev/sda' }]) {
    const f = fixture()
    await assert.rejects(new DiskGrowthReviews().preview(f.client, f.guest, 'rev', { disk: f.disk, targetGiB: 12, ...extra }))
    assert.equal(f.puts.length, 0)
  }
})

test('storage availability is reported as an advisory shortfall, not a reservation', async () => {
  const f = fixture(), reviews = new DiskGrowthReviews()
  const plan = await reviews.preview(f.client, f.guest, 'rev', { disk: f.disk, targetGiB: 512 })
  assert.equal(plan.availableBytes, 100 * GiB)
  assert.equal(plan.shortfall, true)
  assert.equal(plan.deltaBytes, 504 * GiB)
  assert.equal(f.puts.length, 0)
})

test('execution revalidates configuration, property, actual size, ownership, storage and revision', async () => {
  for (const change of ['digest', 'property', 'capacity', 'ownership', 'storage', 'status', 'active', 'revision'] as const) {
    const f = fixture(), reviews = new DiskGrowthReviews()
    const plan = await reviews.preview(f.client, f.guest, 'rev', { disk: f.disk, targetGiB: 12 })
    if (change === 'digest') f.state.config.digest = 'b'.repeat(40)
    if (change === 'property') f.state.config[f.disk] = f.raw + ',ssd=1'
    if (change === 'capacity') f.state.attributes = { format: 'raw', size: 9 * GiB }
    if (change === 'ownership') f.state.volumes = [{ volid: f.volume, vmid: 200, format: 'raw' }]
    if (change === 'storage') f.state.storages = []
    if (change === 'status') f.state.status.status = 'running'
    if (change === 'active') f.state.tasks = [{ upid, type: 'resize', id: '100' }]
    const input = { reviewId: plan.reviewId, confirm: 'diskbox' }
    await assert.rejects(reviews.execute(f.client, f.guest, change === 'revision' ? 'rev2' : 'rev', input), undefined, change)
    await assert.rejects(reviews.execute(f.client, f.guest, 'rev', input))
    assert.equal(f.puts.length, 0)
  }
})

test('wrong identity/confirmation and expired reviews never submit', async () => {
  let now = 1000
  const f = fixture(), reviews = new DiskGrowthReviews(() => now)
  const plan = await reviews.preview(f.client, f.guest, 'rev', { disk: f.disk, targetGiB: 12 })
  await assert.rejects(reviews.execute(f.client, f.guest, 'rev', { reviewId: plan.reviewId, confirm: 'other' }))
  await assert.rejects(reviews.execute(f.client, { ...f.guest, id: 'other' }, 'rev', { reviewId: plan.reviewId, confirm: 'diskbox' }))
  now += 300001
  await assert.rejects(reviews.execute(f.client, f.guest, 'rev', { reviewId: plan.reviewId, confirm: 'diskbox' }))
  assert.equal(f.puts.length, 0)
})

test('separate concurrent reviews are reserved per guest and each plan is single-use', async () => {
  const f = fixture(), reviews = new DiskGrowthReviews()
  const a = await reviews.preview(f.client, f.guest, 'rev', { disk: f.disk, targetGiB: 12 })
  const b = await reviews.preview(f.client, f.guest, 'rev', { disk: f.disk, targetGiB: 16 })
  const outcomes = await Promise.allSettled([a, b].map(plan => reviews.execute(f.client, f.guest, 'rev', { reviewId: plan.reviewId, confirm: 'diskbox' })))
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(f.puts.length, 1)
  assert.equal((await reviews.execute(f.client, f.guest, 'rev', { reviewId: a.reviewId, confirm: 'diskbox' })).upid, upid)
  assert.equal(f.puts.length, 1)
})

test('revision/expiry changes during awaited checks cannot pass final admission', async () => {
  for (const mode of ['revision', 'expiry']) {
    let now = 1000, revision = 'rev'
    const f = fixture(), reviews = new DiskGrowthReviews(() => now)
    const plan = await reviews.preview(f.client, f.guest, revision, { disk: f.disk, targetGiB: 12 })
    const get = f.client.get
    f.client.get = async <T>(path: string, params?: Params): Promise<T> => {
      const value = await get<T>(path, params)
      if (path.includes('/content/')) { if (mode === 'revision') revision = 'changed'; else now += 300001 }
      return value
    }
    await assert.rejects(reviews.execute(f.client, f.guest, () => revision, { reviewId: plan.reviewId, confirm: 'diskbox' }))
    assert.equal(f.puts.length, 0)
  }
})

test('null/malformed/wrong task or PUT failure is uncertain, secret-safe and never replayed', async () => {
  for (const result of [null, 'UPID:bad', upid.replace(':100:', ':101:'), upid.replace(':resize:', ':qmrestore:'), upid.replace(':pve1:', ':pve2:'), 'throw']) {
    const f = fixture(), reviews = new DiskGrowthReviews()
    const plan = await reviews.preview(f.client, f.guest, 'rev', { disk: f.disk, targetGiB: 12 })
    if (result === 'throw') f.state.fail = 'put'
    else f.state.result = result
    const input = { reviewId: plan.reviewId, confirm: 'diskbox' }
    await assert.rejects(reviews.execute(f.client, f.guest, 'rev', input), error => {
      assert.match((error as Error).message, /unknown|unconfirmed/i)
      assert.match((error as Error).message, /history|inspect/i)
      assert.doesNotMatch((error as Error).message, /private-/)
      return true
    })
    await assert.rejects(reviews.execute(f.client, f.guest, 'rev', input))
    assert.equal(f.puts.length, 1)
  }
})

test('malformed or contradictory enabled storage state cannot admit growth', async () => {
  for (const extra of [{ enabled: 'unknown' }, { enabled: false }, { disabled: 1 }, { active: 'unknown' }, { content: undefined }]) {
    const f = fixture()
    f.state.storages = [{ storage: 'local-lvm', active: 1, enabled: 1, type: 'lvmthin', content: 'images,rootdir', avail: 100 * GiB, ...extra }]
    assert.equal((await loadDiskInventory(f.client, f.guest)).disks[0].canGrow, false)
    assert.equal(f.puts.length, 0)
  }
})

test('ordinary disks cannot alias EFI, TPM, unused or memory-state volume references', async () => {
  for (const special of ['efidisk0', 'tpmstate0', 'unused0', 'vmstate']) {
    const f = fixture()
    f.state.config[special] = f.volume + (special === 'efidisk0' ? ',efitype=4m,size=8G' : '')
    const inventory = await loadDiskInventory(f.client, f.guest)
    assert.equal(inventory.disks.length, 1, 'Special volumes must remain unselectable')
    assert.equal(inventory.disks[0].canGrow, false, special)
    await assert.rejects(new DiskGrowthReviews().preview(f.client, f.guest, 'rev', { disk: f.disk, targetGiB: 12 }))
    assert.equal(f.puts.length, 0)
  }
})

test('missing HA metadata is not proof that a stopped guest is unmanaged', async () => {
  const f = fixture()
  f.state.status = { status: 'stopped' }
  const inventory = await loadDiskInventory(f.client, f.guest)
  assert.equal(inventory.ready, false)
  assert.equal(inventory.disks[0].canGrow, false)
  assert.match(inventory.reason!, /HA|high.availability/i)
  assert.equal(f.puts.length, 0)
})

test('complete task visibility requires an effective exact-node Sys.Audit grant, including propagation zero', async () => {
  for (const propagation of [0, 1]) {
    const f = fixture()
    f.state.permissions = { '/nodes/pve1': { 'Sys.Audit': propagation } }
    assert.equal((await loadDiskInventory(f.client, f.guest)).ready, true)
    assert.deepEqual(f.reads.find(r => r.path === '/access/permissions')?.params, { path: '/nodes/pve1' })
  }
  for (const permissions of [undefined, {}, { '/': { 'Sys.Audit': 1 } }, { '/nodes/pve1': {} }, { '/nodes/pve1': { 'Sys.Audit': 2 } }]) {
    const f = fixture(); f.state.permissions = permissions
    const view = await loadDiskInventory(f.client, f.guest)
    assert.equal(view.ready, false)
    assert.match(view.reason!, /Sys.Audit|task visibility/i)
    assert.equal(f.puts.length, 0)
  }
})

test('recent finished tasks do not block growth while incomplete or contradictory task rows remain unconfirmed', async () => {
  for (const status of ['OK', 'WARNINGS: 1', 'disk allocation failed']) {
    const f = fixture()
    f.state.tasks = [{ upid, node: 'pve1', type: 'resize', id: '100', starttime: 0x12345678, endtime: 0x12345678 + 10, status }]
    assert.equal((await loadDiskInventory(f.client, f.guest)).ready, true, status)
  }
  for (const extra of [{ status: 'OK' }, { endtime: 110, status: 'RUNNING' }, { endtime: 110 }, { endtime: 110, status: 'unexpected status' }, { endtime: 110, status: 'OK', upid: upid.replace(':100:', ':101:') }]) {
    const f = fixture()
    f.state.tasks = [{ upid, node: 'pve1', type: 'resize', id: '100', starttime: 100, ...extra }]
    assert.equal((await loadDiskInventory(f.client, f.guest)).ready, false)
    assert.equal(f.puts.length, 0)
  }
})

test('a completed task row must match its native UPID start time before it can be exempted', async () => {
  const f = fixture()
  f.state.tasks = [{ upid, node: 'pve1', type: 'resize', id: '100', starttime: 100, endtime: 110, status: 'OK' }]
  assert.equal((await loadDiskInventory(f.client, f.guest)).ready, false)
  assert.equal(f.puts.length, 0)
})

test('LXC unused volume references also prevent an ordinary rootfs alias from being resized', async () => {
  const f = fixture('lxc')
  f.state.config.unused0 = f.volume
  const inventory = await loadDiskInventory(f.client, f.guest)
  assert.equal(inventory.disks.length, 1)
  assert.equal(inventory.disks[0].canGrow, false)
  await assert.rejects(new DiskGrowthReviews().preview(f.client, f.guest, 'rev', { disk: f.disk, targetGiB: 12 }))
  assert.equal(f.puts.length, 0)
})
