import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BootOrderReviews, loadBootOrder } from '../src/guest-boot-order.js'

type Params = Record<string, string | number | boolean | undefined>
const ids = ['scsi0', 'ide2', 'net0']
const target = ['net0', 'scsi0', 'ide2']
function fixture() {
  const guest = { id: 'one', node: 'pve1', type: 'qemu' as const, vmid: 100 }
  const state = {
    config: {
      digest: 'a'.repeat(40), name: 'bootbox', boot: 'order=' + ids.join(';'),
      scsi0: 'local-lvm:vm-100-disk-0,cache=none,iothread=1,serial=private-serial,discard=on',
      scsi1: 'local-lvm:vm-100-disk-1,backup=0', ide2: 'local:iso/debian-12.iso,media=cdrom',
      net0: 'virtio=02:ab:cd:11:22:33,bridge=vmbr0,tag=20,firewall=YES,queues=4,rate=12.50',
      efidisk0: 'local-lvm:vm-100-efi,efitype=4m,pre-enrolled-keys=1', tpmstate0: 'local-lvm:vm-100-tpm,version=v2.0',
      bios: 'ovmf', machine: 'pc-q35-9.0', onboot: 1, startup: 'order=2,up=30', memory: 2048, cores: 2,
      description: 'private-native-notes', cipassword: '**********', ipconfig0: 'ip=192.0.2.10/24', unused0: 'local-lvm:vm-100-unused',
    } as Record<string, unknown>,
    resource: { type: 'qemu', vmid: 100, node: 'pve1', status: 'stopped' } as Record<string, unknown>,
    status: { status: 'stopped', ha: { managed: 0 } } as Record<string, unknown>,
    permissions: { '/nodes/pve1': { 'Sys.Audit': 0 } } as unknown,
    nodes: [{ node: 'pve1', status: 'online' }] as unknown,
    pending: [] as unknown, snapshots: [{ name: 'current' }] as unknown, tasks: [] as unknown,
    fail: '', mode: 'ok', response: null as unknown,
  }
  const reads: { path: string; params?: Params }[] = [], puts: { path: string; params?: Params }[] = []
  const client = {
    async get<T>(path: string, params?: Params): Promise<T> {
      reads.push({ path, params })
      if (state.fail && path.endsWith(state.fail)) throw new Error('private-upstream-secret')
      const value = path === '/cluster/resources' ? [state.resource] : path === '/access/permissions' ? state.permissions : path === '/nodes' ? state.nodes : path.endsWith('/config') ? state.config : path.endsWith('/status/current') ? state.status : path.endsWith('/pending') ? state.pending : path.endsWith('/snapshot') ? state.snapshots : path.endsWith('/tasks') ? state.tasks : undefined
      if (value === undefined) throw new Error('Unexpected GET ' + path)
      return structuredClone(value) as T
    },
    async put<T>(path: string, params?: Params): Promise<T> {
      assert.equal(path, '/nodes/pve1/qemu/100/config', 'Only native configuration PUT is allowed')
      assert.deepEqual(Object.keys(params!).sort(), ['boot', 'digest'], 'Never send device/firmware/power/delete fields')
      puts.push({ path, params })
      state.config.boot = params!.boot; state.config.digest = 'b'.repeat(40)
      if (state.mode === 'throw-after') throw new Error('private-transport-secret')
      if (state.mode === 'wrong-order') state.config.boot = 'order=' + ids.join(';')
      if (state.mode === 'disk') state.config.scsi0 = 'local-lvm:vm-100-replaced,serial=changed'
      if (state.mode === 'nic') state.config.net0 = String(state.config.net0).replace('11:22:33', '11:22:44')
      if (state.mode === 'firmware') state.config.bios = 'seabios'
      if (state.mode === 'autostart') state.config.onboot = 0
      if (state.mode === 'unrelated') state.config.memory = 4096
      if (state.mode === 'bootdisk') state.config.bootdisk = 'scsi0'
      if (state.mode === 'pending') state.pending = [{ key: 'boot', pending: params!.boot }]
      if (state.mode === 'running') state.status.status = 'running'
      if (state.mode === 'post-read') state.fail = '/config'
      if (state.mode === 'key-order') state.config = Object.fromEntries(Object.entries(state.config).reverse())
      return state.response as T
    },
  }
  return { guest, state, client, reads, puts }
}
async function preview(f: ReturnType<typeof fixture>, reviews = new BootOrderReviews(), order = target) {
  const inventory = await loadBootOrder(f.client, f.guest)
  const plan = await reviews.preview(f.client, f.guest, 'rev', { sourceIdentity: inventory.sourceIdentity, order })
  return { reviews, plan, inventory }
}

test('inventory preserves the complete explicit enabled set and returns purpose-specific identities only', async () => {
  const f = fixture(), view = await loadBootOrder(f.client, f.guest)
  assert.equal(view.ready, true); assert.equal(view.name, 'bootbox'); assert.match(view.sourceIdentity!, /^[a-f0-9]{64}$/)
  assert.deepEqual(view.order.map(d => d.id), ids)
  assert.deepEqual(view.order.map(d => d.kind), ['disk', 'cdrom', 'network'])
  assert.ok(view.excluded.some(d => d.id === 'scsi1')); assert.ok(view.excluded.some(d => d.id === 'efidisk0'))
  assert.doesNotMatch(JSON.stringify(view), /private-|192\.0\.2|cipassword|cache=|iothread|digest|startup=/)
  assert.ok(f.reads.some(r => r.path.endsWith('/config') && r.params?.current === 1))
  assert.deepEqual(f.reads.find(r => r.path === '/access/permissions')?.params, { path: '/nodes/pve1' })
  assert.equal(f.puts.length, 0)
})

test('typed single-use review sends only exact boot permutation and fresh digest, preserving every other returned value', async () => {
  const f = fixture(), before = structuredClone(f.state.config), { reviews, plan } = await preview(f)
  assert.deepEqual(plan.currentOrder.map(d => d.id), ids); assert.deepEqual(plan.proposedOrder.map(d => d.id), target)
  assert.equal(f.puts.length, 0)
  await assert.rejects(reviews.execute(f.client, f.guest, 'rev', { reviewId: plan.reviewId, confirm: '100' }))
  assert.equal(f.puts.length, 0)
  const input = { reviewId: plan.reviewId, confirm: 'bootbox' }
  const result = await reviews.execute(f.client, f.guest, () => 'rev', input)
  assert.equal(result.verified, true); assert.deepEqual(result.order.map(d => d.id), target); assert.ok(result.observedAt > 0)
  assert.equal(result.node, 'pve1'); assert.equal(result.vmid, 100); assert.equal(result.type, 'qemu')
  assert.ok(!('upid' in result))
  assert.deepEqual(f.puts, [{ path: '/nodes/pve1/qemu/100/config', params: { boot: 'order=net0;scsi0;ide2', digest: 'a'.repeat(40) } }])
  assert.deepEqual(f.state.config, { ...before, boot: 'order=net0;scsi0;ide2', digest: 'b'.repeat(40) })
  assert.deepEqual(await reviews.execute(f.client, f.guest, 'rev', input), result); assert.equal(f.puts.length, 1)
})

test('all RAID members remain enabled and JSON object-key reordering is not a configuration change', async () => {
  const f = fixture(); f.state.config.boot = 'order=scsi0;scsi1;ide2;net0'; f.state.mode = 'key-order'
  const { reviews, plan } = await preview(f, new BootOrderReviews(), ['ide2', 'scsi1', 'net0', 'scsi0'])
  assert.equal((await reviews.execute(f.client, f.guest, 'rev', { reviewId: plan.reviewId, confirm: 'bootbox' })).verified, true)
  assert.equal(f.puts[0].params!.boot, 'order=ide2;scsi1;net0;scsi0')
  assert.ok(String(f.state.config.scsi0).includes('private-serial'))
})

test('schema rejects no-op, membership changes, duplicates, empty targets and unrelated fields without PUT', async () => {
  const f = fixture(), reviews = new BootOrderReviews(), view = await loadBootOrder(f.client, f.guest)
  for (const order of [ids, [], ['ide2', 'net0'], ['net0', 'scsi0', 'scsi0'], ['scsi1', 'ide2', 'net0'], [...target, 'scsi1']]) await assert.rejects(reviews.preview(f.client, f.guest, 'rev', { sourceIdentity: view.sourceIdentity, order }))
  for (const body of [{ order: target }, { sourceIdentity: 'bad', order: target }, { sourceIdentity: view.sourceIdentity, order: target, bootdisk: 'scsi0' }]) await assert.rejects(reviews.preview(f.client, f.guest, 'rev', body))
  assert.equal(f.puts.length, 0)
})

test('missing/empty/legacy/mixed/unknown/duplicate/raw malformed source orders remain read-only', async () => {
  for (const boot of [undefined, '', 'cdn', 'legacy=cdn', 'legacy=cdn,order=scsi0;ide2', 'order=scsi0;ide2,menu=1', 'order=scsi0;ide2,order=net0', 'order=scsi0;;ide2', 'order=scsi0;ide2;', 'order=scsi0;scsi0', 'order=scsi0', 'order=scsi0,ide2', 'order=scsi0; ide2', 'order="scsi0;ide2"', 'order=scsi0\\;ide2', 'order=scsi0;ide2\n']) {
    const f = fixture(); if (boot === undefined) delete f.state.config.boot; else f.state.config.boot = boot
    const view = await loadBootOrder(f.client, f.guest)
    assert.equal(view.ready, false, String(boot)); assert.equal(f.puts.length, 0)
    await assert.rejects(new BootOrderReviews().preview(f.client, f.guest, 'rev', { sourceIdentity: view.sourceIdentity, order: target }))
  }
})

test('visible legacy cleanup hazards and native bootdisk deletion cases are refused before a write', async () => {
  for (const key of ['bootdisk', 'args', 'smp', 'cdrom', 'snapstate', 'unused-alias', 'efi-unused-alias', 'bad-unused']) {
    const f = fixture()
    if (key === 'unused-alias') f.state.config.unused0 = 'local-lvm:vm-100-disk-0'
    else if (key === 'efi-unused-alias') f.state.config.unused0 = 'local-lvm:vm-100-efi'
    else if (key === 'bad-unused') f.state.config.unused0 = 'unverifiable-reference'
    else f.state.config[key] = key === 'smp' ? 4 : key === 'bootdisk' ? 'scsi0' : 'legacy-value'
    const view = await loadBootOrder(f.client, f.guest)
    assert.equal(view.ready, false, key)
    await assert.rejects(new BootOrderReviews().preview(f.client, f.guest, 'rev', { sourceIdentity: view.sourceIdentity, order: target }))
    assert.equal(f.puts.length, 0)
  }
  const f = fixture(); f.state.config.bootdisk = ''
  assert.equal((await loadBootOrder(f.client, f.guest)).ready, false, 'Presence must be distinguished from truthiness')
})

test('native ordinary family upper bounds work, while unsupported enabled entries are never silently omitted', async () => {
  for (const key of ['ide3', 'sata5', 'scsi30', 'virtio15', 'net31']) {
    const f = fixture(); f.state.config[key] = key.startsWith('net') ? f.state.config.net0 : 'local-lvm:vm-100-extra,serial=private-extra'
    f.state.config.boot = `order=${key};ide2`
    const { reviews, plan } = await preview(f, new BootOrderReviews(), ['ide2', key])
    assert.equal((await reviews.execute(f.client, f.guest, 'rev', { reviewId: plan.reviewId, confirm: 'bootbox' })).verified, true)
  }
  for (const key of ['ide4', 'sata6', 'scsi31', 'virtio16', 'net32', 'efidisk0', 'tpmstate0', 'unused0', 'usb0', 'hostpci0', 'virtiofs0', 'serial0', 'missing0']) {
    const f = fixture(); if (!key.startsWith('missing')) f.state.config[key] ??= 'local-lvm:vm-100-extra'
    f.state.config.boot = `order=scsi0;${key}`
    const view = await loadBootOrder(f.client, f.guest)
    assert.equal(view.ready, false, key); assert.deepEqual(view.order.map(d => d.id), ['scsi0', key])
    assert.equal(f.puts.length, 0)
  }
})

test('an unparseable excluded attached drive cannot hide a native unused-reference cleanup alias', async () => {
  const f = fixture()
  f.state.config.scsi1 = 'local-lvm:vm-100-disk-1,product=Acme ,size=1G'
  f.state.config.unused0 = 'local-lvm:vm-100-disk-1'
  const view = await loadBootOrder(f.client, f.guest)
  assert.equal(view.ready, false)
  await assert.rejects(new BootOrderReviews().preview(f.client, f.guest, 'rev', { sourceIdentity: view.sourceIdentity, order: target }))
  assert.equal(f.puts.length, 0)
  delete f.state.config.unused0
  assert.equal((await loadBootOrder(f.client, f.guest)).ready, true, 'Without unused references this excluded device is retained without rewriting it')
})

test('configured ISO references exclude empty/host optical media and exact native cloud-init identifiers', async () => {
  for (const volume of ['local:cloudinit', 'local:vm-100-cloudinit', 'local:100/vm-100-cloudinit.raw', 'local:100/cloudinit.qcow2', 'none', '/dev/cdrom']) {
    const f = fixture(); f.state.config.ide2 = volume + ',media=cdrom'
    assert.equal((await loadBootOrder(f.client, f.guest)).ready, false, volume)
  }
  for (const volume of ['local:iso/cloudinit.iso', 'local:iso/my-cloudinit.iso']) {
    const f = fixture(); f.state.config.ide2 = volume + ',media=cdrom'
    assert.equal((await loadBootOrder(f.client, f.guest)).ready, true, volume)
  }
  for (const volume of ['local:100/cloudinit-backup.raw', 'local:100/notcloudinit.raw', 'local:100/CloudInit.raw']) {
    const f = fixture(); f.state.config.scsi0 = volume + ',serial=private-preserved'
    assert.equal((await loadBootOrder(f.client, f.guest)).ready, true, volume)
  }
  const f = fixture(); f.state.config.scsi0 = 'local-lvm:vm-100-cloudinit,media=disk'
  assert.equal((await loadBootOrder(f.client, f.guest)).ready, false)
})

test('passthrough and ambiguous critical device identities are unsupported, unrelated options are preserved', async () => {
  for (const raw of ['/dev/disk/by-id/host', 'local-lvm:vm-100-disk-0,scsiblock=on', 'local-lvm:vm-100-disk-0,file=other:disk', 'file=local-lvm:vm-100-disk-0,file=other:disk', 'local-lvm:vm-100-disk-0,media=disk,media=cdrom']) {
    const f = fixture(); f.state.config.scsi0 = raw
    assert.equal((await loadBootOrder(f.client, f.guest)).ready, false, raw)
  }
  const f = fixture(); f.state.config.scsi0 = 'file=local-lvm:vm-100-disk-0,custom-option=kept,serial=private model'
  const { reviews, plan } = await preview(f)
  assert.equal((await reviews.execute(f.client, f.guest, 'rev', { reviewId: plan.reviewId, confirm: 'bootbox' })).verified, true)
  assert.equal(f.state.config.scsi0, 'file=local-lvm:vm-100-disk-0,custom-option=kept,serial=private model')
})

test('disconnected NIC remains eligible as configured without claiming PXE success', async () => {
  const f = fixture(); f.state.config.net0 += ',link_down=1'
  const view = await loadBootOrder(f.client, f.guest)
  assert.equal(view.ready, true); assert.match(view.order.find(d => d.id === 'net0')?.warning ?? '', /disconnect|link/i)
  assert.equal(f.puts.length, 0)
})

test('running/moved/template/lock/unknown/pending/snapshot/HA/offline/task states block admission', async () => {
  for (const change of ['running', 'resource-running', 'moved', 'template', 'bad-template', 'lock', 'digest', 'pending-zero', 'pending-false', 'pending-empty', 'delete', 'bad-pending', 'snapshot', 'ha', 'no-ha', 'offline', 'active', 'saturated', 'bad-tasks', 'permissions', 'read-failure']) {
    const f = fixture()
    if (change === 'running') f.state.status.status = 'running'
    if (change === 'resource-running') f.state.resource.status = 'running'
    if (change === 'moved') f.state.resource.node = 'pve2'
    if (change === 'template') f.state.config.template = 1
    if (change === 'bad-template') f.state.resource.template = 'unknown'
    if (change === 'lock') f.state.config.lock = 'backup'
    if (change === 'digest') f.state.config.digest = 'invalid'
    if (change.startsWith('pending-')) f.state.pending = [{ key: 'memory', pending: change === 'pending-zero' ? 0 : change === 'pending-false' ? false : '' }]
    if (change === 'delete') f.state.pending = [{ key: 'scsi1', delete: 1 }]
    if (change === 'bad-pending') f.state.pending = [{}]
    if (change === 'snapshot') f.state.snapshots = [{ name: 'snapshot1' }]
    if (change === 'ha') f.state.status.ha = { managed: 1 }
    if (change === 'no-ha') delete f.state.status.ha
    if (change === 'offline') f.state.nodes = [{ node: 'pve1', status: 'offline' }]
    if (change === 'active') f.state.tasks = [{ status: 'RUNNING' }]
    if (change === 'saturated') f.state.tasks = Array(500).fill({})
    if (change === 'bad-tasks') f.state.tasks = {}
    if (change === 'permissions') f.state.permissions = { '/': { 'Sys.Audit': 1 } }
    if (change === 'read-failure') f.state.fail = '/pending'
    await assert.rejects(preview(f), undefined, change); assert.equal(f.puts.length, 0)
  }
})

test('exact-node numeric audit grants and verified recent terminal tasks are handled correctly', async () => {
  for (const grant of [0, 1]) {
    const f = fixture(); f.state.permissions = { '/nodes/pve1': { 'Sys.Audit': grant } }
    f.state.tasks = [{ upid: 'UPID:pve1:00000123:00000456:12345678:qmstart:100:root@pam:', node: 'pve1', type: 'qmstart', id: '100', starttime: 0x12345678, endtime: 0x12345679, status: 'OK' }]
    assert.equal((await loadBootOrder(f.client, f.guest)).ready, true)
  }
})

test('source identity is stable across JSON key ordering but rejects device/firmware/source replacement before preview', async () => {
  const f = fixture(), view = await loadBootOrder(f.client, f.guest), reviews = new BootOrderReviews()
  f.state.config = Object.fromEntries(Object.entries(f.state.config).reverse())
  assert.equal((await loadBootOrder(f.client, f.guest)).sourceIdentity, view.sourceIdentity)
  for (const field of ['scsi0', 'net0', 'bios', 'startup']) {
    const g = fixture(), old = await loadBootOrder(g.client, g.guest)
    g.state.config[field] = String(g.state.config[field]) + '-changed'
    await assert.rejects(reviews.preview(g.client, g.guest, 'rev', { sourceIdentity: old.sourceIdentity, order: target }))
    assert.equal(g.puts.length, 0)
  }
})

test('stale digest/order/raw device/name/revision and expired reviews cannot write', async () => {
  for (const change of ['digest', 'order', 'device', 'name', 'revision', 'expiry']) {
    const f = fixture(); let now = 1000
    const { reviews, plan } = await preview(f, new BootOrderReviews(() => now))
    if (change === 'digest') f.state.config.digest = 'c'.repeat(40)
    if (change === 'order') f.state.config.boot = 'order=ide2;net0;scsi0'
    if (change === 'device') f.state.config.scsi0 += ',backup=0'
    if (change === 'name') f.state.config.name = 'changed'
    if (change === 'expiry') now += 300001
    await assert.rejects(reviews.execute(f.client, f.guest, change === 'revision' ? 'other' : 'rev', { reviewId: plan.reviewId, confirm: 'bootbox' }))
    assert.equal(f.puts.length, 0)
  }
})

test('null is required and unexpected native result/partial/postcondition changes stay consumed and unconfirmed', async () => {
  for (const mode of ['non-null', 'throw-after', 'wrong-order', 'disk', 'nic', 'firmware', 'autostart', 'unrelated', 'bootdisk', 'pending', 'running', 'post-read']) {
    const f = fixture(), { reviews, plan } = await preview(f)
    f.state.mode = mode; if (mode === 'non-null') f.state.response = 'UPID:unexpected'
    const input = { reviewId: plan.reviewId, confirm: 'bootbox' }
    await assert.rejects(reviews.execute(f.client, f.guest, 'rev', input), (e: any) => e.statusCode === 502 && /unconfirmed|inspect|unknown/i.test(e.message), mode)
    await assert.rejects(reviews.execute(f.client, f.guest, 'rev', input))
    assert.equal(f.puts.length, 1, mode)
  }
})

test('disappeared or changed connection revision is no-write before PUT and unconfirmed after PUT', async () => {
  for (const after of [false, true]) {
    const f = fixture(), { reviews, plan } = await preview(f)
    const revision = () => { if (!after || f.puts.length) throw new Error('private-connection-removed'); return 'rev' }
    await assert.rejects(reviews.execute(f.client, f.guest, revision, { reviewId: plan.reviewId, confirm: 'bootbox' }), (e: any) => e.statusCode === (after ? 502 : 409))
    assert.equal(f.puts.length, after ? 1 : 0)
  }
  const f = fixture(), { reviews, plan } = await preview(f); let rev = 'rev'
  const original = f.client.get
  f.client.get = async <T>(path: string, params?: Params): Promise<T> => { const result = await original<T>(path, params); rev = 'changed'; return result }
  await assert.rejects(reviews.execute(f.client, f.guest, () => rev, { reviewId: plan.reviewId, confirm: 'bootbox' })); assert.equal(f.puts.length, 0)
})

test('separate simultaneous reviews share admission and old reviews cannot replay in a new process instance', async () => {
  const f = fixture(), reviews = new BootOrderReviews(), a = await preview(f, reviews), b = await preview(f, reviews)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), original = f.client.get
  f.client.get = async <T>(path: string, params?: Params): Promise<T> => { await gate; return original<T>(path, params) }
  const first = reviews.execute(f.client, f.guest, 'rev', { reviewId: a.plan.reviewId, confirm: 'bootbox' })
  await assert.rejects(reviews.execute(f.client, f.guest, 'rev', { reviewId: b.plan.reviewId, confirm: 'bootbox' }))
  release(); assert.equal((await first).verified, true); assert.equal(f.puts.length, 1)
  await assert.rejects(new BootOrderReviews().execute(f.client, f.guest, 'rev', { reviewId: a.plan.reviewId, confirm: 'bootbox' }))
  assert.equal(f.puts.length, 1)
})

test('boot-order control rejects LXC before any write', async () => {
  const f = fixture()
  await assert.rejects(loadBootOrder(f.client, { ...f.guest, type: 'lxc' }))
  assert.equal(f.puts.length, 0)
})
