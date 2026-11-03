import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadResourceSettings, saveResourceSettings, resourceSettingsSchema } from '../src/guest-resource-settings.js'

const guest = { node: 'pve1', type: 'qemu' as const, vmid: 100 }
function fixture() {
  const config: Record<string, unknown> = { cores: 2, sockets: 2, memory: 4096, onboot: 1, digest: 'a'.repeat(40), description: 'Keep this note', net0: 'do not change' }
  let status = 'stopped'
  let pending: unknown = [{ key: 'memory', value: 4096 }]
  const writes: Record<string, unknown>[] = []
  const client = {
    async get<T>(path: string): Promise<T> {
      if (path.endsWith('/config')) return { ...config } as T
      if (path.endsWith('/status/current')) return { status } as T
      if (path.endsWith('/pending')) return pending as T
      throw new Error('Unexpected GET ' + path)
    },
    async put<T>(_path: string, patch: Record<string, unknown>): Promise<T> {
      writes.push(patch)
      assert.equal(patch.digest, config.digest)
      Object.assign(config, patch, { digest: 'b'.repeat(40) })
      return null as T
    },
  }
  return { client, config, writes, setStatus: (value: string) => { status = value }, setPending: (value: unknown) => { pending = value } }
}

test('stopped resource settings use cores per socket, MiB and native onboot without returning arbitrary config', async () => {
  const { client } = fixture()
  assert.deepEqual(await loadResourceSettings(client, guest), { cores: 2, sockets: 2, memoryMiB: 4096, onboot: true, digest: 'a'.repeat(40), status: 'stopped', pending: false, editable: true })
  assert.equal((await loadResourceSettings(client, { ...guest, type: 'lxc' })).sockets, 1)
})

test('resource patch rejects non-integers, unsafe bounds, unknown config and non-boolean boot flags', () => {
  const valid = { cores: 2, memoryMiB: 4096, onboot: false, digest: 'a'.repeat(40) }
  assert.equal(resourceSettingsSchema.safeParse(valid).success, true)
  for (const patch of [{ cores: 0 }, { cores: 129 }, { cores: 1.5 }, { memoryMiB: 15 }, { memoryMiB: 1048577 }, { memoryMiB: Infinity }, { onboot: 1 }, { digest: 'invalid' }, { sockets: 4 }, { description: 'Not allowed' }]) assert.equal(resourceSettingsSchema.safeParse({ ...valid, ...patch }).success, false)
})

test('resource saves preserve sockets, notes, networking and all fields outside the explicit allocation patch', async () => {
  const { client, config, writes } = fixture()
  const result = await saveResourceSettings(client, guest, { cores: 4, memoryMiB: 8192, onboot: false, digest: 'a'.repeat(40) })
  assert.deepEqual(writes, [{ cores: 4, memory: 8192, onboot: false, digest: 'a'.repeat(40) }])
  assert.equal(config.sockets, 2)
  assert.equal(config.description, 'Keep this note')
  assert.equal(config.net0, 'do not change')
  assert.equal(result.memoryMiB, 8192)
  assert.equal(result.digest, 'b'.repeat(40))
})

test('running, pending and unverifiable pending states disable writes without any power actions', async () => {
  const f = fixture()
  const patch = { cores: 4, memoryMiB: 8192, onboot: false, digest: 'a'.repeat(40) }
  f.setStatus('running')
  assert.equal((await loadResourceSettings(f.client, guest)).editable, false)
  await assert.rejects(saveResourceSettings(f.client, guest, patch), /Shut down/)
  f.setStatus('stopped')
  f.setPending([{ key: 'sockets', value: 2, pending: 4 }])
  assert.equal((await loadResourceSettings(f.client, guest)).pending, true)
  await assert.rejects(saveResourceSettings(f.client, guest, patch), /pending changes/)
  f.setPending({ unexpected: true })
  await assert.rejects(saveResourceSettings(f.client, guest, patch), /verify pending/)
  f.setPending([])
  const denied = { ...f.client, async get<T>(path: string): Promise<T> { if (path.endsWith('/pending')) throw new Error('Secret response'); return f.client.get<T>(path) } }
  assert.equal((await loadResourceSettings(denied, guest)).editable, false)
  assert.doesNotMatch(JSON.stringify(await loadResourceSettings(denied, guest)), /Secret response/)
  assert.equal(f.writes.length, 0)
})

test('dynamic memory and unknown original boot/CPU settings cannot be silently replaced', async () => {
  for (const unsupported of [{ memory: 'current=4096,max=8192' }, { cores: 0 }, { onboot: 'unexpected' }]) {
    const f = fixture()
    Object.assign(f.config, unsupported)
    const settings = await loadResourceSettings(f.client, guest)
    assert.equal(settings.editable, false)
    await assert.rejects(saveResourceSettings(f.client, guest, { cores: 4, memoryMiB: 8192, onboot: false, digest: 'a'.repeat(40) }))
    assert.equal(f.writes.length, 0)
  }
})

test('stale and in-flight configuration conflicts return409 without losing a draft or accepting stale writes', async () => {
  const f = fixture()
  const patch = { cores: 4, memoryMiB: 8192, onboot: false, digest: 'a'.repeat(40) }
  f.config.digest = 'c'.repeat(40)
  await assert.rejects(saveResourceSettings(f.client, guest, patch), error => (error as { statusCode?: number }).statusCode === 409)
  assert.equal(f.writes.length, 0)
  f.config.digest = patch.digest
  const racing = { ...f.client, async put<T>(): Promise<T> { f.config.digest = 'd'.repeat(40); throw new Error('Upstream rejected digest') } }
  await assert.rejects(saveResourceSettings(racing, guest, patch), error => (error as { statusCode?: number }).statusCode === 409)
})

test('QEMU hotplug CPU configurations stay outside the editor so topology changes cannot prevent the next start', async () => {
  const f = fixture()
  f.config.cores = 4
  f.config.vcpus = 8
  const settings = await loadResourceSettings(f.client, guest)
  assert.equal(settings.editable, false)
  assert.match(settings.reason ?? '', /hotplug/)
  await assert.rejects(saveResourceSettings(f.client, guest, { cores: 2, memoryMiB: 8192, onboot: true, digest: 'a'.repeat(40) }), /hotplug/)
  assert.equal(f.writes.length, 0)
  assert.equal(f.config.vcpus, 8)
})

test('explicit NUMA CPU and memory mappings stay in Proxmox so allocation edits cannot invalidate the next start', async () => {
  const f = fixture()
  f.config.numa = 1
  f.config.numa0 = 'cpus=0-3,memory=4096'
  assert.equal((await loadResourceSettings(f.client, guest)).editable, false)
  await assert.rejects(saveResourceSettings(f.client, guest, { cores: 2, memoryMiB: 2048, onboot: true, digest: 'a'.repeat(40) }), /NUMA/)
  assert.equal(f.writes.length, 0)
  assert.equal(f.config.numa0, 'cpus=0-3,memory=4096')
})
