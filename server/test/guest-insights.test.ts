import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const dataDir = mkdtempSync(join(tmpdir(), 'proxmiu-guests-test-'))
process.env.PROXMIU_DATA_DIR = dataDir
writeFileSync(join(dataDir, 'state.json'), JSON.stringify({ clusters: [], templates: [], sshUsers: {} }))
const { store } = await import('../src/store.js')

test('guest metadata merges fields, survives store reload and removes only the deleted connection', async () => {
  const input = { name: 'Lab', host: '127.0.0.1', port: 8006, authType: 'token' as const, username: 'test', secret: 'secret', verifyTls: false }
  const first = store.addCluster(input)
  const second = store.addCluster(input)
  assert.deepEqual(store.listGuestMetadata(), {})
  const saved = store.updateGuestMetadata(first.id, 'qemu', 100, { notes: 'A useful note' })
  assert.deepEqual({ favorite: saved.favorite, notes: saved.notes }, { favorite: false, notes: 'A useful note' })
  assert.ok(Number.isFinite(Date.parse(saved.updatedAt)))
  store.updateGuestMetadata(first.id, 'qemu', 100, { favorite: true })
  store.updateGuestMetadata(first.id, 'lxc', 100, { notes: 'Different guest type' })
  store.updateGuestMetadata(second.id, 'qemu', 100, { notes: 'Other connection' })
  const expected = store.listGuestMetadata()
  assert.equal(expected[`${first.id}/qemu/100`].notes, 'A useful note')
  assert.equal(expected[`${first.id}/qemu/100`].favorite, true)
  const reloaded = await import(new URL('../src/store.ts?reload=metadata', import.meta.url).href)
  assert.deepEqual(reloaded.store.listGuestMetadata(), expected)
  store.removeCluster(first.id)
  assert.deepEqual(Object.keys(store.listGuestMetadata()), [`${second.id}/qemu/100`])
  assert.deepEqual(JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8')).guestMetadata, store.listGuestMetadata())
  assert.throws(() => store.updateGuestMetadata(first.id, 'qemu', 100, { favorite: true }), /Unknown connection/)
  assert.throws(() => store.updateGuestMetadata(second.id, 'qemu', 100, {}))
  assert.throws(() => store.updateGuestMetadata(second.id, 'qemu', 100, { notes: 'x'.repeat(4001) }))
})

test('metadata accepts only a nonempty strict partial and canonical positive guest identity', async () => {
  const { guestMetadataPatchSchema, guestMetadataParamsSchema, guestInsightsParamsSchema, guestInsightsQuerySchema } = await import('../src/guest-insights.js')
  for (const input of [{}, { extra: true }, { favorite: 'true' }, { notes: null }, { notes: 'x'.repeat(4001) }]) {
    assert.equal(guestMetadataPatchSchema.safeParse(input).success, false)
  }
  assert.deepEqual(guestMetadataPatchSchema.parse({ notes: '' }), { notes: '' })
  assert.deepEqual(guestMetadataPatchSchema.parse({ favorite: false, notes: 'x'.repeat(4000) }), { favorite: false, notes: 'x'.repeat(4000) })
  for (const vmid of ['-1', '0', '1.5', '1e2', '00100', '9007199254740992', '../100']) {
    assert.equal(guestMetadataParamsSchema.safeParse({ id: 'cluster', type: 'qemu', vmid }).success, false)
  }
  assert.deepEqual(guestMetadataParamsSchema.parse({ id: 'cluster', type: 'lxc', vmid: '100' }), { id: 'cluster', type: 'lxc', vmid: 100 })
  assert.equal(guestMetadataParamsSchema.safeParse({ id: 'cluster', type: 'node', vmid: '100' }).success, false)
  for (const node of ['..', 'pve/node', '']) assert.equal(guestInsightsParamsSchema.safeParse({ id: 'cluster', node, type: 'qemu', vmid: '100' }).success, false)
  assert.deepEqual(guestInsightsQuerySchema.parse({}), { timeframe: 'hour' })
  for (const timeframe of ['month', '', ['hour', 'day']]) assert.equal(guestInsightsQuerySchema.safeParse({ timeframe }).success, false)
  assert.equal(guestInsightsQuerySchema.safeParse({ timeframe: 'day', extra: 'x' }).success, false)
})

test('config normalization exposes only supported safe fields for QEMU and LXC', async () => {
  const { normalizeGuestConfig } = await import('../src/guest-insights.js')
  const qemu = normalizeGuestConfig({
    name: 'dev', description: 'Personal server', cores: '4', sockets: 1, memory: '8192', ostype: 'l26', onboot: '1',
    net1: 'virtio=BC:24:11:AA:BB:CD,bridge=vmbr1,tag=10', net0: 'virtio=BC:24:11:AA:BB:CC,bridge=vmbr0,password=hidden',
    scsi0: 'local-lvm:vm-100-disk-0,size=32G', ide2: 'local-lvm:cloudinit,media=cdrom',
    cipassword: 'hidden', sshkeys: 'hidden', args: 'hidden', hookscript: 'hidden', password: 'hidden',
    scsi1: 'rbd://user:hidden@host/disk,password=hidden', net2: { password: 'hidden' },
  }, 'qemu')
  assert.deepEqual(qemu, {
    name: 'dev', description: 'Personal server', cores: 4, sockets: 1, memory: 8192, ostype: 'l26', onboot: true,
    networks: [{ name: 'net0', value: 'virtio=BC:24:11:AA:BB:CC,bridge=vmbr0' }, { name: 'net1', value: 'virtio=BC:24:11:AA:BB:CD,bridge=vmbr1,tag=10' }],
    disks: [{ name: 'ide2', value: 'local-lvm:cloudinit,media=cdrom' }, { name: 'scsi0', value: 'local-lvm:vm-100-disk-0,size=32G' }],
  })
  assert.doesNotMatch(JSON.stringify(qemu), /hidden|password|sshkeys|hookscript/)
  const lxc = normalizeGuestConfig({ hostname: 'container', unprivileged: 1, onboot: 0, memory: 512, cores: 'bad', sockets: -1,
    net0: 'name=eth0,bridge=vmbr0,ip=192.168.1.53/24,gw=192.168.1.1', rootfs: 'local-lvm:vm-101-disk-0,size=4G', mp0: '/srv/media,mp=/media,ro=1',
    'ssh-public-keys': 'hidden', lxc: ['hidden'],
  }, 'lxc')
  assert.equal(lxc.name, 'container')
  assert.equal(lxc.unprivileged, true)
  assert.equal(lxc.onboot, false)
  assert.equal(lxc.cores, undefined)
  assert.equal(lxc.disks.length, 2)
  assert.doesNotMatch(JSON.stringify(lxc), /hidden/)
  for (const malformed of [null, [], 'bad']) assert.throws(() => normalizeGuestConfig(malformed, 'qemu'))
})

test('RRD samples are ordered, numeric, deduplicated and keep gaps without inventing zero usage', async () => {
  const { normalizeGuestMetrics } = await import('../src/guest-insights.js')
  assert.deepEqual(normalizeGuestMetrics([
    { time: '300', cpu: '0.25', mem: '1024', maxmem: 4096, netin: '12.5', diskread: 0, secret: 'hidden' },
    { time: 100, cpu: null, mem: '', netin: -1, netout: Infinity, diskread: false },
    { time: 200, cpu: 0.5, diskwrite: '128' },
    { time: 200, cpu: 0.6, mem: '2048' },
    { time: 400, cpu: 2, mem: 'NaN', netout: 'bad', diskread: -10 },
    { time: null, cpu: 0.5 }, { time: -1 }, { time: 'bad' }, null,
  ]), [
    { time: 100 }, { time: 200, cpu: 0.6, diskwrite: 128, mem: 2048 },
    { time: 300, cpu: 0.25, mem: 1024, maxmem: 4096, netin: 12.5, diskread: 0 }, { time: 400 },
  ])
  assert.deepEqual(normalizeGuestMetrics([]), [])
  assert.throws(() => normalizeGuestMetrics({ data: [] }))
})

test('insights request AVERAGE history and retain independent successes without leaking upstream errors', async () => {
  const { loadGuestInsights } = await import('../src/guest-insights.js')
  const calls: unknown[][] = []
  const client = { get: async (path: string, params?: unknown) => {
    calls.push([path, params])
    if (path.endsWith('/config')) throw new Error('password=hidden')
    return [{ time: 100, cpu: 0.4 }]
  } }
  const result = await loadGuestInsights(client, { node: 'pve1', type: 'qemu', vmid: 100 }, 'week')
  assert.equal(result.config, null)
  assert.deepEqual(result.metrics, [{ time: 100, cpu: 0.4 }])
  assert.match(result.configError!, /configuration.*unavailable/i)
  assert.doesNotMatch(JSON.stringify(result), /hidden|password/)
  assert.deepEqual(calls, [['/nodes/pve1/qemu/100/config', undefined], ['/nodes/pve1/qemu/100/rrddata', { timeframe: 'week', cf: 'AVERAGE' }]])
  const reverse = await loadGuestInsights({ get: async (path: string) => {
    if (path.endsWith('/rrddata')) throw new Error('secret=hidden')
    return { hostname: 'container' }
  } }, { node: 'pve2', type: 'lxc', vmid: 101 }, 'day')
  assert.equal(reverse.config?.name, 'container')
  assert.deepEqual(reverse.metrics, [])
  assert.match(reverse.metricsError!, /history.*unavailable/i)
  assert.doesNotMatch(JSON.stringify(reverse), /hidden|secret/)
})
