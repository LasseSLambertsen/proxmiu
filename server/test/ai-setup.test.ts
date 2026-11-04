import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatSchema, chatWithSetup } from '../src/ai.js'
import { loadSetupSnapshot, SetupPreviewCache, verifySetupGuest } from '../src/ai-setup.js'

const settings = { provider: 'openai' as const, model: 'fixture', token: 'private-provider-token' }
const guest = { id: 'connection', node: 'pve', type: 'qemu' as const, vmid: 100 }
const now = 1_800_000_000_000
function client(overrides: Record<string, unknown> = {}) {
  return { get: async <T>(path: string): Promise<T> => {
    if (path in overrides) return overrides[path] as T
    if (path === '/cluster/resources') return [{ type: 'qemu', node: 'pve', vmid: 100, name: 'private-name', ip: '10.0.0.2' }] as T
    if (path.endsWith('/config')) return { cores: 2, sockets: 1, memory: 2048, onboot: 0, digest: 'abcdef', description: 'private-description', sshkeys: 'private-ssh-key', net0: 'private-network' } as T
    if (path.endsWith('/status/current')) return { status: 'stopped' } as T
    if (path.endsWith('/pending')) return [] as T
    if (path.endsWith('/rrddata')) return [{ time: now / 1000 - 600, cpu: .2, mem: 512 }, { time: now / 1000 - 300, cpu: .6, mem: 1024 }, { time: now / 1000 - 100000, cpu: 1, mem: 9999 }] as T
    throw new Error('Unexpected path')
  } }
}

test('setup snapshots share only allowlisted allocation and actual bounded history with a trusted local target', async () => {
  const snapshot = await loadSetupSnapshot(client(), guest, () => now)
  assert.equal(snapshot.target.name, 'private-name')
  assert.equal(snapshot.target.clusterId, guest.id)
  assert.equal(snapshot.before.digest, 'abcdef')
  assert.deepEqual(snapshot.context.allocation, { cores: 2, sockets: 1, memoryMiB: 2048, onboot: false })
  assert.equal(snapshot.context.history.samples, 2)
  assert.equal(snapshot.context.history.cpuMean, .4)
  assert.equal(snapshot.context.history.cpuPeak, .6)
  assert.equal(snapshot.context.history.memoryMeanBytes, 768)
  assert.doesNotMatch(JSON.stringify(snapshot.context), /private|10\.0\.0|abcdef|vmid|clusterId|description|sshkeys|net0/)
  await assert.rejects(verifySetupGuest(client({ '/cluster/resources': [{ type: 'qemu', node: 'moved', vmid: 100 }] }), guest), /moved|refresh/i)
  await assert.rejects(verifySetupGuest(client({ '/cluster/resources': [{ type: 'qemu', node: 'pve', vmid: 100, template: 1 }] }), guest), /template|refresh/i)
  const unavailable = await loadSetupSnapshot({ get: async <T>(path: string): Promise<T> => {
    if (path.endsWith('/rrddata')) throw new Error('private-error-and-token')
    return client().get<T>(path)
  } }, guest, () => now)
  assert.equal(unavailable.context.history.samples, 0)
  assert.match(unavailable.context.history.unavailable!, /unavailable/)
  assert.doesNotMatch(JSON.stringify(unavailable.context), /private-error/)
})

test('opaque previews expire, are bounded and are bound to exact provider, model and key', async () => {
  let time = now
  const cache = new SetupPreviewCache(() => time)
  const snapshot = await loadSetupSnapshot(client(), guest, () => now)
  const preview = cache.create(settings, snapshot)
  assert.equal(cache.resolve(preview.previewId, settings).context.history.cpuPeak, .6)
  for (const changed of [{ ...settings, model: 'other' }, { ...settings, provider: 'openrouter' as const }, { ...settings, token: 'replacement-key' }]) {
    assert.throws(() => cache.resolve(preview.previewId, changed), /changed|refresh/i)
  }
  time += 10 * 60 * 1000
  assert.throws(() => cache.resolve(preview.previewId, settings), /expired|refresh/i)
  const oldest = cache.create(settings, snapshot)
  for (let i = 0; i < 100; i++) cache.create(settings, snapshot)
  assert.throws(() => cache.resolve(oldest.previewId, settings), /expired|refresh/i)
  cache.clear()
  assert.throws(() => cache.resolve(preview.previewId, settings), /expired|refresh/i)
  assert.doesNotMatch(JSON.stringify(preview), /private-provider-token/)
})

test('setup envelope requires consent and accepts no caller context or chosen targets', () => {
  const messages = [{ role: 'user', content: 'Help me tune this guest' }]
  const setup = { previewId: '00000000-0000-4000-8000-000000000000', consent: true }
  assert.equal(chatSchema.safeParse({ messages, setup }).success, true)
  for (const invalid of [{ ...setup, consent: false }, { previewId: setup.previewId }, { ...setup, context: {} }, { ...setup, vmid: 200 }]) {
    assert.equal(chatSchema.safeParse({ messages, setup: invalid }).success, false)
  }
})

test('all providers get only previewed context and valid proposals gain trusted target/digest', async () => {
  const snapshot = await loadSetupSnapshot(client(), guest, () => now)
  for (const provider of ['openai', 'anthropic', 'openrouter'] as const) {
    const input = { messages: [{ role: 'user' as const, content: 'Give this guest 4 cores and 4096 MiB, enable boot.' }] }
    const result = await chatWithSetup({ ...settings, provider }, input, snapshot, async (url, init) => {
      assert.match(url, provider === 'openrouter' ? /openrouter\.ai/ : provider === 'anthropic' ? /anthropic\.com/ : /openai\.com/)
      const body = JSON.parse(String(init.body))
      const system = body.system ?? body.messages[0].content
      assert.match(system, /Lynx/)
      assert.match(system, /confirmation/i)
      assert.match(system, /"cpuPeak":0.6/)
      assert.doesNotMatch(system, /private-name|abcdef|connection|private-description/)
      assert.equal(body.tools, undefined)
      const content = JSON.stringify({ reply: 'A measured move. Review the allocation before applying.', proposal: { cores: 4, memoryMiB: 4096, onboot: true } })
      return new Response(JSON.stringify(provider === 'anthropic' ? { content: [{ type: 'text', text: content }] } : { choices: [{ message: { content } }] }))
    })
    assert.deepEqual(result.proposal?.target, snapshot.target)
    assert.deepEqual(result.proposal?.after, { cores: 4, memoryMiB: 4096, onboot: true, digest: 'abcdef' })
  }
})

test('malformed, unknown-action, unsupported, unchanged and read-only proposals never become actions', async () => {
  const snapshot = await loadSetupSnapshot(client(), guest, () => now)
  const complete = (content: string, chosen = snapshot) => chatWithSetup(settings, { messages: [{ role: 'user', content: 'Tune it' }] }, chosen, async () => new Response(JSON.stringify({ choices: [{ message: { content } }] })))
  for (const proposal of [{ cores: 0, memoryMiB: 16, onboot: false }, { cores: 4, memoryMiB: 4096, onboot: true, vmid: 200 }, { cores: 4 }, { action: 'delete' }, { cores: 2, memoryMiB: 2048, onboot: false }]) {
    assert.equal((await complete(JSON.stringify({ reply: 'Advice', proposal }))).proposal, undefined)
  }
  assert.equal((await complete('Plain advice')).proposal, undefined)
  assert.equal((await complete('{broken')).proposal, undefined)
  const valid = JSON.stringify({ reply: 'x'.repeat(8000), proposal: { cores: 4, memoryMiB: 4096, onboot: true } })
  const result = await complete(valid)
  assert.equal(result.reply.length, 4000)
  assert.equal(result.proposal?.after.cores, 4, 'JSON is parsed before limiting the reply')
  assert.equal((await complete(valid, { ...snapshot, before: { ...snapshot.before, editable: false } })).proposal, undefined)
})
