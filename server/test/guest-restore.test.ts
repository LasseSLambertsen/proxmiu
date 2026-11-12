import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RestoreReviews, loadRestoreOptions } from '../src/guest-restore.js'

const guest = { id: 'cluster-a', node: 'pve1', type: 'qemu' as 'qemu' | 'lxc', vmid: 100 }
const volid = 'local:backup/vzdump-qemu-100-2026_11_12-12_00_00.vma.zst'
const input = { archive: volid, sourceStorage: 'local', storage: 'local-lvm', vmid: 201 }
const upid = 'UPID:pve1:00000123:00000456:12345678:qmrestore:201:root@pam:'
type Params = Record<string, string | number | boolean | undefined>

function fixture(type: 'qemu' | 'lxc' = 'qemu') {
  const state = {
    config: type === 'qemu' ? '# backup\nname: original\nonboot: 1\nmemory: 2048\nscsi0: local-lvm:vm-100-disk-0,size=8G\nnet0: virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0\n' : 'hostname: original\nunprivileged: 1\nonboot: 1\nrootfs: local-lvm:vm-100-disk-0,size=8G\nnet0: name=eth0,bridge=vmbr0,ip=dhcp,type=veth\n',
    archive: type === 'qemu' ? volid : volid.replace('qemu', 'lxc').replace('vma.zst', 'tar.zst'),
    format: type === 'qemu' ? 'vma.zst' : 'tar.zst',
    ctime: 100, size: 4096, collision: false, active: 1, online: true, moved: false, fail: '',
    postResult: type === 'qemu' ? upid : upid.replace('qmrestore', 'vzrestore'),
  }
  const posts: { path: string; params?: Params }[] = []
  const reads: { path: string; params?: Params }[] = []
  const client = {
    async get<T>(path: string, params?: Params): Promise<T> {
      reads.push({ path, params })
      if (state.fail && path.includes(state.fail)) throw new Error('private token=SECRET upstream body')
      let result: unknown
      if (path === '/cluster/resources') result = [{ type, vmid: 100, node: state.moved ? 'pve2' : 'pve1' }]
      else if (path === '/nodes') result = [{ node: 'pve1', status: state.online ? 'online' : 'offline' }]
      else if (path === '/cluster/nextid') {
        if (state.collision && params?.vmid) throw new Error('ID is in use')
        result = String(params?.vmid ?? 201)
      } else if (path.endsWith('/storage')) result = [
        { storage: 'local', active: 1, enabled: 1, content: 'backup,iso' },
        { storage: 'local-lvm', active: state.active, enabled: 1, content: type === 'qemu' ? 'images' : 'rootdir' },
        { storage: 'wrong', active: 1, enabled: 1, content: type === 'qemu' ? 'rootdir' : 'images' },
      ]
      else if (path.endsWith('/content')) result = [{ volid: state.archive, vmid: 100, content: 'backup', format: state.format, ctime: state.ctime, size: state.size }]
      else if (path.endsWith('/vzdump/extractconfig')) result = state.config
      else if (path.endsWith('/network')) result = [{ iface: 'vmbr0', type: 'bridge', active: 1 }]
      else throw new Error('Unexpected path: ' + path)
      return result as T
    },
    async post<T>(path: string, params?: Params): Promise<T> {
      posts.push({ path, params })
      if (state.fail === 'post') throw new Error('private token=SECRET uncertain outcome')
      return state.postResult as T
    },
  }
  return { client, state, posts, reads, guest: { ...guest, type }, input: { ...input, archive: state.archive } }
}

test('restore options verify the node and offer only active type-appropriate destinations', async () => {
  for (const type of ['qemu', 'lxc'] as const) {
    const f = fixture(type)
    assert.deepEqual(await loadRestoreOptions(f.client, f.guest), { storages: ['local-lvm'], suggestedVmid: 201 })
    assert.equal(f.posts.length, 0)
  }
})

test('review is read-only; exact QEMU and LXC restore payloads cannot start or overwrite guests', async () => {
  for (const type of ['qemu', 'lxc'] as const) {
    const f = fixture(type)
    const reviews = new RestoreReviews()
    const plan = await reviews.preview(f.client, f.guest, 'rev1', f.input)
    assert.equal(f.posts.length, 0)
    assert.equal(plan.vmid, 201)
    assert.equal(plan.node, 'pve1')
    assert.equal(plan.type, type)
    assert.equal(plan.storage, 'local-lvm')
    assert.equal(plan.archive, f.state.archive)
    assert.doesNotMatch(JSON.stringify(plan), /AA:BB|memory|unprivileged|rootfs|SECRET/)
    const result = await reviews.execute(f.client, f.guest, 'rev1', { reviewId: plan.reviewId, confirm: '201' })
    assert.deepEqual(result, { upid: f.state.postResult, node: 'pve1', vmid: 201, type })
    assert.deepEqual(f.posts, [{ path: `/nodes/pve1/${type}`, params: {
      vmid: 201, storage: 'local-lvm', force: 0, unique: 1, start: 0, onboot: 0,
      ...(type === 'qemu' ? { archive: f.state.archive } : { ostemplate: f.state.archive, restore: 1 }),
    } }])
  }
})

test('review rejects a same-ID, unavailable storage, offline node or moved source before mutation', async () => {
  for (const change of ['same-id', 'wrong-storage', 'offline', 'moved', 'collision', 'disabled'] as const) {
    const f = fixture()
    if (change === 'same-id') f.input.vmid = 100
    if (change === 'wrong-storage') f.input.storage = 'wrong'
    if (change === 'offline') f.state.online = false
    if (change === 'moved') f.state.moved = true
    if (change === 'collision') f.state.collision = true
    if (change === 'disabled') f.state.active = 0
    await assert.rejects(new RestoreReviews().preview(f.client, f.guest, 'rev', f.input))
    assert.equal(f.posts.length, 0)
  }
})

test('archive type and ID must be canonical and match the source; ambiguous formats are rejected', async () => {
  for (const archive of [volid.replace('qemu', 'lxc'), volid.replace('-100-', '-101-'), volid.replace('vma.zst', 'tar.zst'), 'local:backup/unknown', 'local:backup/' + 'a'.repeat(256)]) {
    const f = fixture()
    f.state.archive = archive
    f.input.archive = archive
    await assert.rejects(new RestoreReviews().preview(f.client, f.guest, 'rev', f.input))
    assert.equal(f.posts.length, 0)
  }
  const f = fixture()
  f.state.format = 'pbs-ct'
  await assert.rejects(new RestoreReviews().preview(f.client, f.guest, 'rev', f.input))
})

test('PBS vm/ct identity is supported only with matching canonical type and ID', async () => {
  for (const type of ['qemu', 'lxc'] as const) {
    const f = fixture(type)
    f.state.archive = `local:backup/${type === 'qemu' ? 'vm' : 'ct'}/100/2026-11-12T12:00:00Z`
    f.input.archive = f.state.archive
    f.state.format = type === 'qemu' ? 'pbs-vm' : 'pbs-ct'
    assert.equal((await new RestoreReviews().preview(f.client, f.guest, 'rev', f.input)).type, type)
    f.state.format = type === 'qemu' ? 'pbs-ct' : 'pbs-vm'
    await assert.rejects(new RestoreReviews().preview(f.client, f.guest, 'rev', f.input))
  }
})

test('unsupported host dependencies and malformed extracted configurations block review', async () => {
  const cases: ['qemu' | 'lxc', string][] = [
    ['qemu', 'args: -device dangerous'], ['qemu', 'affinity: 0-3'], ['qemu', 'numa0: cpus=0-1,hostnodes=0,memory=1024,policy=bind'], ['qemu', 'hookscript: local:snippets/hook.sh'],
    ['qemu', 'hostpci0: 0000:00:01.0'], ['qemu', 'usb0: host=1-1'], ['qemu', 'virtiofs0: shared'],
    ['qemu', 'scsi1: /dev/sda'], ['qemu', 'ide2: local:iso/test.iso,media=cdrom'],
    ['qemu', 'net1: virtio=AA:BB:CC:DD:EE:FF,bridge=missing'], ['qemu', 'serial0: /dev/ttyS0'], ['qemu', 'parallel0: /dev/parport0'], ['qemu', 'parallel1: /dev/usb/lp0'],
    ['qemu', '[snapshot]\nname: other'], ['qemu', 'name: duplicate'],
    ['lxc', 'unprivileged: 0'], ['lxc', 'mp0: /host/path,mp=/data'],
    ['lxc', 'mp0: local-lvm:vm-100-disk-1,mp=/data'], ['lxc', 'lxc.mount.entry: /dev/fuse dev/fuse none bind'],
    ['lxc', 'hookscript: local:snippets/hook.sh'], ['lxc', 'dev0: /dev/dri/card0'],
    ['lxc', 'features: nesting=1,keyctl=1'],
  ]
  for (const [type, added] of cases) {
    const f = fixture(type)
    f.state.config += added + '\n'
    await assert.rejects(new RestoreReviews().preview(f.client, f.guest, 'rev', f.input), undefined, added)
    assert.equal(f.posts.length, 0)
  }
})

test('execution rechecks reviewed archive/configuration/storage/ID/connection and consumes stale reviews', async () => {
  for (const change of ['config', 'archive', 'storage', 'collision', 'connection', 'source'] as const) {
    const f = fixture()
    const reviews = new RestoreReviews()
    const plan = await reviews.preview(f.client, f.guest, 'rev', f.input)
    if (change === 'config') f.state.config += 'cores: 4\n'
    if (change === 'archive') f.state.ctime++
    if (change === 'storage') f.state.active = 0
    if (change === 'collision') f.state.collision = true
    if (change === 'source') f.state.moved = true
    const execution = { reviewId: plan.reviewId, confirm: '201' }
    await assert.rejects(reviews.execute(f.client, f.guest, change === 'connection' ? 'rev2' : 'rev', execution))
    await assert.rejects(reviews.execute(f.client, f.guest, 'rev', execution))
    assert.equal(f.posts.length, 0)
  }
})

test('expired and wrong-source reviews cannot execute; typed new-ID confirmation is required', async () => {
  let now = 1000
  const f = fixture()
  const reviews = new RestoreReviews(() => now)
  const plan = await reviews.preview(f.client, f.guest, 'rev', f.input)
  await assert.rejects(reviews.execute(f.client, f.guest, 'rev', { reviewId: plan.reviewId, confirm: '100' }))
  await assert.rejects(reviews.execute(f.client, { ...f.guest, id: 'another' }, 'rev', { reviewId: plan.reviewId, confirm: '201' }))
  now += 5 * 60_000 + 1
  await assert.rejects(reviews.execute(f.client, f.guest, 'rev', { reviewId: plan.reviewId, confirm: '201' }))
  assert.equal(f.posts.length, 0)
})

test('simultaneous and repeated submissions issue at most one POST and keep new-guest attribution', async () => {
  const f = fixture()
  const reviews = new RestoreReviews()
  const plan = await reviews.preview(f.client, f.guest, 'rev', f.input)
  const args = { reviewId: plan.reviewId, confirm: '201' }
  const outcomes = await Promise.allSettled([reviews.execute(f.client, f.guest, 'rev', args), reviews.execute(f.client, f.guest, 'rev', args)])
  assert.ok(outcomes.some(v => v.status === 'fulfilled'))
  assert.equal(f.posts.length, 1)
  assert.equal((await reviews.execute(f.client, f.guest, 'rev', args)).vmid, 201)
  assert.equal(f.posts.length, 1)
})

test('unknown acceptance and malformed/wrong-target task IDs cannot be replayed or leak upstream bodies', async () => {
  for (const failure of ['post', 'invalid', 'wrong-target', 'wrong-node'] as const) {
    const f = fixture()
    const reviews = new RestoreReviews()
    const plan = await reviews.preview(f.client, f.guest, 'rev', f.input)
    if (failure === 'post') f.state.fail = 'post'
    if (failure === 'invalid') f.state.postResult = 'UPID:bad'
    if (failure === 'wrong-target') f.state.postResult = upid.replace(':201:', ':100:')
    if (failure === 'wrong-node') f.state.postResult = upid.replace(':pve1:', ':pve2:')
    const args = { reviewId: plan.reviewId, confirm: '201' }
    await assert.rejects(reviews.execute(f.client, f.guest, 'rev', args), error => {
      assert.match((error as Error).message, /history|inspect/i)
      assert.doesNotMatch((error as Error).message, /SECRET|private/)
      return true
    })
    await assert.rejects(reviews.execute(f.client, f.guest, 'rev', args))
    assert.equal(f.posts.length, 1)
  }
})

test('read errors are safe and do not create a review or mutate upstream', async () => {
  const f = fixture()
  f.state.fail = 'extractconfig'
  await assert.rejects(new RestoreReviews().preview(f.client, f.guest, 'rev', f.input), error => {
    assert.doesNotMatch((error as Error).message, /SECRET|private/)
    return true
  })
  assert.equal(f.posts.length, 0)
})

test('connection changes and expiry during awaited checks cannot bypass final admission', async () => {
  for (const change of ['connection', 'expiry'] as const) {
    const f = fixture()
    let now = 1000, revision = 'rev'
    const reviews = new RestoreReviews(() => now)
    const plan = await reviews.preview(f.client, f.guest, revision, f.input)
    const get = f.client.get
    f.client.get = async <T>(path: string, params?: Params): Promise<T> => {
      const result = await get<T>(path, params)
      if (path === '/cluster/nextid') {
        if (change === 'connection') revision = 'rev2'
        else now += 300_001
      }
      return result
    }
    await assert.rejects(reviews.execute(f.client, f.guest, () => revision, { reviewId: plan.reviewId, confirm: '201' }))
    assert.equal(f.posts.length, 0)
  }
})

test('current connection revision resolver permits an unchanged reviewed connection', async () => {
  const f = fixture(), reviews = new RestoreReviews()
  const plan = await reviews.preview(f.client, f.guest, 'rev', f.input)
  assert.equal((await reviews.execute(f.client, f.guest, () => 'rev', { reviewId: plan.reviewId, confirm: '201' })).vmid, 201)
})
