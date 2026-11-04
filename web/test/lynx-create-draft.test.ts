import assert from 'node:assert/strict'
import { test } from 'node:test'

test('Lynx creation handoffs are one-use, copied and bound to agent and built-in template', async () => {
  const helper = await import('../src/lib/lynx-create-draft.js')
  const draft = { templateId: 'docker-host', templateName: 'Docker host', kind: 'lxc' as const, cores: 4, memoryMiB: 8192, diskGiB: 64 }
  const template = { id: 'docker-host', builtin: true, kind: 'lxc' as const }
  helper.stageLynxCreateDraft(draft, 'agent-a', 1000)
  draft.cores = 8
  assert.equal(helper.takeLynxCreateDraft('agent-a', template, 1001).draft?.cores, 4)
  assert.equal(helper.takeLynxCreateDraft('agent-a', template, 1002).draft, null)
  for (const [agent, selected, time] of [
    ['agent-b', template, 1001], ['agent-a', { ...template, id: 'base' }, 1001],
    ['agent-a', { ...template, builtin: false }, 1001], ['agent-a', { ...template, kind: 'qemu' }, 1001],
    ['agent-a', undefined, 1001], ['agent-a', template, 601000],
  ] as const) {
    helper.stageLynxCreateDraft(draft, 'agent-a', 1000)
    const rejected = helper.takeLynxCreateDraft(agent, selected, time)
    assert.equal(rejected.draft, null)
    assert.match(rejected.error!, /draft|template|agent/i)
    assert.equal(helper.takeLynxCreateDraft('agent-a', template, 1002).draft, null)
  }
  helper.stageLynxCreateDraft(draft, 'agent-a', 1000)
  helper.stageLynxCreateDraft({ ...draft, templateId: 'base' }, 'agent-a', 1000)
  assert.equal(helper.takeLynxCreateDraft('agent-a', { ...template, id: 'base' }, 1001).draft?.templateId, 'base')
  helper.stageLynxCreateDraft(draft, 'agent-a', 1000)
  helper.clearLynxCreateDraft()
  assert.equal(helper.takeLynxCreateDraft('agent-a', template, 1001).draft, null)
})

test('Lynx handoffs reject extra fields and invalid resource values before changing the form', async () => {
  const helper = await import('../src/lib/lynx-create-draft.js')
  const valid = { templateId: 'docker-host', templateName: 'Docker host', kind: 'lxc', cores: 4, memoryMiB: 8192, diskGiB: 64 }
  for (const input of [null, {}, { ...valid, kind: ['lxc'] }, { ...valid, cores: 129 }, { ...valid, cores: 1.5 }, { ...valid, memoryMiB: 255 }, { ...valid, memoryMiB: 1048577 }, { ...valid, diskGiB: 1 }, { ...valid, diskGiB: 65537 }, { ...valid, password: 'secret' }, { ...valid, options: {} }, { ...valid, clusterId: 'untrusted' }]) {
    assert.throws(() => helper.stageLynxCreateDraft(input, 'agent-a'), /draft/i)
  }
})
