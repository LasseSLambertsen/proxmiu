import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.PROXMIU_DATA_DIR = mkdtempSync(join(tmpdir(), 'proxmiu-ai-test-'))
const { store } = await import('../src/store.js')

test('AI token is encrypted on disk, redacted on reads, preserved only for the same provider and removable', () => {
  store.saveAiSettings({ provider: 'openai', model: 'gpt-4o-mini', token: 'secret-test-token' })
  assert.deepEqual(store.aiSettings(), { configured: true, provider: 'openai', model: 'gpt-4o-mini' })
  assert.doesNotMatch(readFileSync(join(process.env.PROXMIU_DATA_DIR!, 'state.json'), 'utf8'), /secret-test-token/)
  store.saveAiSettings({ provider: 'openai', model: 'gpt-4.1-mini' })
  assert.equal(store.aiCredentials().token, 'secret-test-token')
  assert.throws(() => store.saveAiSettings({ provider: 'anthropic', model: 'claude-sonnet-4-5' }), /new token/)
  assert.equal(store.aiSettings().provider, 'openai')
  store.removeAiSettings()
  assert.equal(store.aiSettings().configured, false)
  assert.throws(() => store.aiCredentials(), /AI token/)
})

test('AI context contains only numeric resources and bounded status/type, never identity/config/notes', async () => {
  const { buildAiContext, reviewSchema } = await import('../src/ai.js')
  const context = buildAiContext([{ resources: [{ type: 'node', node: 'secret-node', name: 'private', ip: '10.0.0.1', cpu: .4, mem: 100, maxmem: 200 }, { type: 'lxc', vmid: 100, name: 'private-service', status: 'running', maxcpu: 2, description: 'super secret', secret: 'token', maxmem: 1024, mem: NaN }] }, { error: true }])
  assert.deepEqual(context, { clusters: [{ nodes: [{ cpu: .4, mem: 100, maxmem: 200 }], guests: [{ type: 'lxc', status: 'running', maxcpu: 2, maxmem: 1024 }] }], unavailableConnections: 1 })
  assert.doesNotMatch(JSON.stringify(context), /secret|private|vmid|10.0.0.1/)
  assert.equal(reviewSchema.safeParse({ consent: false, context }).success, false)
  assert.equal(reviewSchema.safeParse({ consent: true, context: { ...context, notes: 'secret' } }).success, false)
  assert.equal(reviewSchema.safeParse({ consent: true, context: { ...context, clusters: [{ nodes: [], guests: [{ type: 'lxc', cpu: Infinity }] }] } }).success, false)
})

test('AI review uses fixed provider URLs, no tools, bounded plain advice, and sanitized failures', async () => {
  const { reviewSetup } = await import('../src/ai.js')
  const context = { clusters: [], unavailableConnections: 0 }
  const settings = { provider: 'openai' as const, model: 'gpt-4o-mini', token: 'credential-never-exposed' }
  let request: { url: string; init: RequestInit } | undefined
  const transport = async (url: string, init: RequestInit) => {
    request = { url, init }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Review memory allocation before changing it.' } }] }))
  }
  assert.deepEqual(await reviewSetup(settings, context, transport), { advice: 'Review memory allocation before changing it.' })
  assert.equal(request?.url, 'https://api.openai.com/v1/chat/completions')
  assert.equal(JSON.parse(String(request?.init.body)).tools, undefined)
  assert.equal(JSON.parse(String(request?.init.body)).max_tokens, 1600)
  await assert.rejects(reviewSetup(settings, context, async () => new Response('credential-never-exposed', { status: 401 })), /token was rejected/)
  await assert.rejects(reviewSetup(settings, context, async () => { throw new Error('credential-never-exposed') }), error => !String(error).includes('credential-never-exposed'))
  await assert.rejects(reviewSetup(settings, context, async () => new Response(JSON.stringify({ choices: [] }))), /usable advice/)
  const result = await reviewSetup({ ...settings, provider: 'anthropic' }, context, async (url) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages')
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Check CPU headroom.' }] }))
  })
  assert.equal(result.advice, 'Check CPU headroom.')
})
