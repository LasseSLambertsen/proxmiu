import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cloneFixture } from './fixtures/vm-clone.js'

process.env.PROXMIU_DATA_DIR = mkdtempSync(join(tmpdir(), 'proxmiu-vm-clone-'))
const { store, DATA_DIR, decrypt } = await import('../src/store.js')
const { templateSchema } = await import('../src/templates.js')
const { forgetClient } = await import('../src/proxmox.js')
const { startProvision, getJob, flushJobHistory } = await import('../src/provision.js')
const template = templateSchema.parse({ id: 'clone-fixture', name: 'Clone fixture', kind: 'qemu', user: 'fixture-user', script: 'echo captured-only', resources: { cores: 3, memory: 1024, disk: 16 } })
store.saveTemplate(template)
after(async () => { await flushJobHistory(); rmSync(DATA_DIR, { recursive: true, force: true }) })

async function scenario(options: Parameters<typeof cloneFixture>[1], request = {}, check: (fixture: Awaited<ReturnType<typeof cloneFixture>>, job: NonNullable<ReturnType<typeof getJob>>) => void) {
  const fixture = await cloneFixture(store.sshKey().public, options)
  const cluster = store.addCluster({ name: 'Local fixture', host: '127.0.0.1', port: fixture.port, authType: 'token', username: 'fixture@pve!tests', secret: 'local-fixture-token', verifyTls: false })
  try {
    const started = startProvision({ clusterId: cluster.id, node: 'pve1', templateId: template.id, kind: 'qemu', hostname: 'clone-fixture', cores: 3, memory: 1024, disk: 16, swap: 512, storage: 'local-lvm', bridge: 'vmbr0', ipMode: 'dhcp', sourceVmid: 900, password: 'fixture-password', sshKeys: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIE+extra/key fixture+key', onboot: true, options: {}, ...request })
    let job = getJob(started.id)!
    const deadline = Date.now() + 10000
    while (job.status === 'running' && Date.now() < deadline) { await new Promise(r => setTimeout(r, 10)); job = getJob(started.id)! }
    assert.notEqual(job.status, 'running', 'local fixture job must finish within ten seconds')
    check(fixture, job)
    assert.deepEqual(fixture.errors, [])
  } finally { await fixture.close(); forgetClient(cluster.id); store.removeCluster(cluster.id) }
}
const writes = (f: Awaited<ReturnType<typeof cloneFixture>>) => f.calls.filter(c => c.method !== 'GET')

test('DHCP clone preflights source, preserves placement/NIC, sets exact vCPU count and grows scsi1 before starting', async () => {
  await scenario({}, {}, (f, job) => {
    assert.equal(job.status, 'success', job.error ?? 'expected successful clone')
    const config = f.calls.filter(c => c.method === 'POST' && c.path.endsWith('/401/config')).map(c => c.params)
    assert.equal(config[0].sockets, '1')
    assert.equal(config[0].vcpus, '3')
    assert.equal(config[0].cores, '3'); assert.equal(config[0].memory, '1024')
    assert.equal(config[0].ciuser, 'fixture-user'); assert.equal(config[0].cipassword, 'fixture-password')
    assert.equal(config[0].ipconfig0, 'ip=dhcp'); assert.equal(config[0].onboot, '1'); assert.equal(config[0].tags, 'proxmiu;clone-fixture'); assert.equal(config[0].agent, 'enabled=1')
    assert.equal(decodeURIComponent(config[0].sshkeys), `${store.sshKey().public}\nssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIE+extra/key fixture+key`)
    assert.equal(config.map(c => c.net0).find(Boolean), 'virtio=BC:24:11:AA:BB:CC,firewall=1,rate=12.5,mtu=1400,queues=4,bridge=vmbr0')
    assert.deepEqual(writes(f).find(c => c.method === 'PUT')?.params, { disk: 'scsi1', size: '16G' })
    const paths = f.calls.map(c => `${c.method} ${c.path}`)
    assert.ok(paths.indexOf('GET /nodes/pve1/qemu/900/config') < paths.indexOf('POST /nodes/pve1/qemu/900/clone'))
    assert.ok(paths.indexOf('GET /nodes/pve1/qemu/401/config') < paths.indexOf('POST /nodes/pve1/qemu/401/config'))
    assert.ok(paths.indexOf('PUT /nodes/pve1/qemu/401/resize') < paths.indexOf('POST /nodes/pve1/qemu/401/status/start'))
    assert.equal(job.result?.node, 'pve1'); assert.equal(job.result?.ip, '192.0.2.50')
    assert.deepEqual(f.authenticated, ['fixture-user']); assert.deepEqual(f.commands, ['sudo -n bash -s'])
    assert.equal(f.scripts.length, 1); assert.match(f.scripts[0], /echo captured-only/)
    assert.ok(job.log.some(line => line.includes('Synthetic install output')))
  })
})

test('static clone keeps a larger disk, replaces VLAN and uses current clone NIC rather than source NIC', async () => {
  await scenario({ source: { scsi1: 'local:vm-900-disk-1,size=32G', net0: 'e1000=00:00:00:00:00:01,bridge=source' }, clone: { net0: 'virtio=BC:24:11:11:22:33,bridge=vmbr0,tag=70,firewall=1,rate=8' } }, { ipMode: 'static', ipCidr: '192.0.2.60/24', gateway: '192.0.2.1', vlan: 100, onboot: false }, (f, job) => {
    assert.equal(job.status, 'success', job.error ?? 'expected successful clone')
    assert.equal(writes(f).some(c => c.method === 'PUT'), false, 'larger disk must not receive a shrink request')
    const params = f.calls.filter(c => c.method === 'POST' && c.path.endsWith('/401/config')).map(c => c.params)
    assert.equal(params[0].ipconfig0, 'ip=192.0.2.60/24,gw=192.0.2.1'); assert.equal(params[0].onboot, '0')
    assert.equal(params.map(c => c.net0).find(Boolean), 'virtio=BC:24:11:11:22:33,firewall=1,rate=8,bridge=vmbr0,tag=100')
    assert.equal(f.calls.some(c => c.path.includes('/agent/')), false); assert.equal(job.result?.ip, '192.0.2.60')
  })
})

for (const [name, source, disk] of [
  ['modern boot order takes precedence over legacy bootdisk', { bootdisk: 'scsi0' }, 'scsi1'],
  ['legacy bootdisk supports nonzero SATA and MiB units', { boot: 'cdn', bootdisk: 'sata2', sata2: 'local:vm-900-disk-2,size=8192M' }, 'sata2'],
  ['one data disk supports nonzero VirtIO and TiB units', { boot: '', scsi0: '', scsi1: '', virtio3: 'local:vm-900-disk-3,size=0.0078125T' }, 'virtio3'],
] as const) {
  test(`boot resolution: ${name}`, async () => {
    await scenario({ source }, {}, (f, job) => { assert.equal(job.status, 'success', job.error ?? 'expected successful clone'); assert.deepEqual(writes(f).find(c => c.method === 'PUT')?.params, { disk, size: '16G' }) })
  })
}

test('equal-sized fresh clone disk never receives a resize request', async () => {
  await scenario({ clone: { scsi1: 'local:vm-401-disk-1,size=16G' } }, {}, (f, job) => { assert.equal(job.status, 'success', job.error ?? 'expected successful clone'); assert.equal(writes(f).some(c => c.method === 'PUT'), false) })
})

for (const [name, options, request, error] of [
  ['missing source', { resources: [] }, {}, /900.*not found/i],
  ['moved source', {}, { node: 'pve2' }, /pve1.*pve2|pve2.*pve1/i],
  ['LXC source', { resources: [{ vmid: 900, node: 'pve1', type: 'lxc', template: 1 }] }, {}, /QEMU/i],
  ['non-template resource', { resources: [{ vmid: 900, node: 'pve1', type: 'qemu', template: 0 }] }, {}, /template/i],
  ['non-template config', { source: { template: 0 } }, {}, /template/i],
  ['missing cloud-init', { source: { ide2: 'local:iso/install.iso,media=cdrom' } }, {}, /cloud-init/i],
  ['ambiguous boot', { source: { boot: '', bootdisk: '' } }, {}, /boot.*ambiguous|ambiguous.*boot/i],
  ['missing selected boot disk', { source: { boot: 'order=scsi7;net0' } }, {}, /boot.*scsi7|scsi7.*boot/i],
  ['unknown disk size', { source: { scsi1: 'local:vm-900-disk-1' } }, {}, /size/i],
] as const) {
  test(`preflight rejects ${name} before any clone write`, async () => {
    await scenario(options, request, (f, job) => { assert.equal(job.status, 'error'); assert.match(job.error!, error); assert.deepEqual(writes(f), []); assert.equal(f.scripts.length, 0) })
  })
}

for (const fail of ['clone', 'configure', 'resize', 'configure-http', 'resize-http'] as const) {
  test(`${fail} failure retains partial clone identity and prevents start/SSH`, async () => {
    await scenario({ fail }, {}, (f, job) => {
      assert.equal(job.status, 'error'); assert.match(job.error!, new RegExp(fail.split('-')[0])); assert.equal(job.target?.vmid, 401); assert.equal(job.target?.node, 'pve1')
      assert.equal(writes(f).some(c => c.path.endsWith('/status/start')), false); assert.equal(f.scripts.length, 0)
      if (fail === 'clone') assert.equal(writes(f).some(c => c.path.endsWith('/401/config')), false)
      if (fail.startsWith('configure')) assert.equal(writes(f).some(c => c.method === 'PUT'), false)
      const saved = JSON.parse(decrypt(readFileSync(join(DATA_DIR, 'jobs.json'), 'utf8'))).jobs.find((j: { id: string }) => j.id === job.id)
      assert.equal(saved.status, 'error'); assert.equal(saved.target.vmid, 401); assert.ok(!JSON.stringify(saved).includes('fixture-password'))
    })
  })
}

test('nonzero SSH script exit stays an error after the clone starts', async () => {
  await scenario({ scriptExit: 23 }, {}, (f, job) => { assert.equal(job.status, 'error'); assert.match(job.error!, /exited with code 23/); assert.equal(job.result, undefined); assert.equal(f.scripts.length, 1); assert.deepEqual(f.authenticated, ['fixture-user']) })
})

for (const scriptEnd of ['signal', 'no-status'] as const) {
  test(`SSH ${scriptEnd} closure fails without claiming successful provisioning`, async () => {
    await scenario({ scriptEnd }, {}, (f, job) => {
      assert.equal(job.status, 'error', 'SSH must report explicit numeric zero for success')
      assert.match(job.error!, /exit status|signal|terminated/i)
      assert.equal(job.result, undefined)
      assert.equal(job.log.some(line => line.includes('All done.')), false)
      assert.equal(job.target?.vmid, 401); assert.equal(job.target?.node, 'pve1')
      assert.equal(f.scripts.length, 1); assert.deepEqual(f.authenticated, ['fixture-user'])
      const saved = JSON.parse(decrypt(readFileSync(join(DATA_DIR, 'jobs.json'), 'utf8'))).jobs.find((j: { id: string }) => j.id === job.id)
      assert.equal(saved.status, 'error'); assert.equal(saved.target.vmid, 401); assert.equal(saved.result, undefined)
    })
  })
}
