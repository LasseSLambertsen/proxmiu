import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.PROXMIU_DATA_DIR = mkdtempSync(join(tmpdir(), 'proxmiu-ai-create-'))
const ai = await import('../src/ai.js')
const settings = { provider: 'openai' as const, model: 'fixture', token: 'private-provider-token' }
const input = { messages: [{ role: 'user' as const, content: 'Plan a Docker host with 4 cores, 8192 MiB and 64 GiB disk.' }], createDraft: true as const }
const draft = { templateId: 'docker-host', cores: 4, memoryMiB: 8192, diskGiB: 64 }

test('creation planning is explicit and cannot combine with selected-guest evidence', () => {
  assert.equal(ai.chatSchema.safeParse(input).success, true)
  assert.equal(ai.chatSchema.safeParse({ ...input, createDraft: false }).success, false)
  assert.equal(ai.chatSchema.safeParse({ ...input, setup: { previewId: '00000000-0000-4000-8000-000000000000', consent: true } }).success, false)
  assert.equal(ai.chatSchema.safeParse({ ...input, templates: [] }).success, false)
})

test('creation plans use only the public built-in catalog with all three providers and trusted metadata', async () => {
  assert.equal(typeof ai.chatWithCreateDraft, 'function')
  for (const provider of ['openai', 'anthropic', 'openrouter'] as const) {
    const result = await ai.chatWithCreateDraft({ ...settings, provider }, input, async (url, init) => {
      assert.match(url, provider === 'openrouter' ? /openrouter\.ai/ : provider === 'anthropic' ? /anthropic\.com/ : /openai\.com/)
      const body = JSON.parse(String(init.body))
      const system = body.system ?? body.messages[0].content
      assert.match(system, /docker-host/)
      assert.match(system, /review/i)
      assert.doesNotMatch(system, /OPT_|GITHUB_TOKEN|TAILSCALE_AUTHKEY|installClaude|https:\/\/github|"script"|"options"|"source"/)
      assert.deepEqual(provider === 'anthropic' ? body.messages : body.messages.slice(1), input.messages)
      assert.equal(body.tools, undefined)
      const content = JSON.stringify({ reply: 'A sound starting point. Review placement before creating it.', createDraft: draft })
      return new Response(JSON.stringify(provider === 'anthropic' ? { content: [{ type: 'text', text: content }] } : { choices: [{ message: { content } }] }))
    })
    assert.deepEqual(result.createDraft, { ...draft, templateName: 'Docker host', kind: 'lxc' })
    assert.match(result.reply, /Review/)
  }
})

test('untrusted draft fields, templates and bounds produce advice only', async () => {
  assert.equal(typeof ai.chatWithCreateDraft, 'function')
  const run = (content: string) => ai.chatWithCreateDraft(settings, input, async () => new Response(JSON.stringify({ choices: [{ message: { content } }] })))
  for (const invalid of [
    { ...draft, templateId: 'custom-secret-script' }, { ...draft, templateId: '../base' },
    { ...draft, cores: 0 }, { ...draft, cores: 129 }, { ...draft, cores: 1.5 },
    { ...draft, memoryMiB: 255 }, { ...draft, memoryMiB: 1048577 }, { ...draft, diskGiB: 1 }, { ...draft, diskGiB: 65537 },
    ...['script', 'options', 'source', 'clusterId', 'node', 'password', 'kind', 'templateName'].map(key => ({ ...draft, [key]: 'untrusted' })),
    { templateId: 'docker-host' },
  ]) {
    const result = await run(JSON.stringify({ reply: 'Review requirements.', createDraft: invalid }))
    assert.equal(result.createDraft, undefined)
    assert.equal(result.reply, 'Review requirements.')
  }
  assert.equal((await run('Plain advice')).reply, 'Plain advice')
  assert.equal((await run('{broken')).createDraft, undefined)
  assert.equal((await run(JSON.stringify({ reply: 'Advice', createDraft: draft, tools: [] }))).createDraft, undefined)
  const result = await run('```json\n' + JSON.stringify({ reply: 'x'.repeat(8000), createDraft: draft }) + '\n```')
  assert.equal(result.reply.length, 4000)
  assert.equal(result.createDraft?.cores, 4, 'Structured response is parsed before shortening chat text')
})
