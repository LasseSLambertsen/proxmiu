import type { AiCreateDraft, GuestType } from './api'

const fields = new Set(['templateId', 'templateName', 'kind', 'cores', 'memoryMiB', 'diskGiB'])
let pending: { draft: AiCreateDraft; agent: string; expires: number } | null = null
const integer = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

/** The handoff never enters a URL, browser history, storage or a provisioning request. */
export function stageLynxCreateDraft(input: unknown, agent: string, now = Date.now()) {
  pending = null
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('This creation draft is invalid. Ask Lynx for a fresh draft.')
  const draft = input as Record<string, unknown>
  if (Object.keys(draft).length !== fields.size || Object.keys(draft).some(key => !fields.has(key)) ||
      typeof draft.templateId !== 'string' || !/^[a-z0-9-]{1,80}$/.test(draft.templateId) ||
      typeof draft.templateName !== 'string' || !draft.templateName.trim() || draft.templateName.length > 200 ||
      (draft.kind !== 'qemu' && draft.kind !== 'lxc') || !integer(draft.cores, 1, 128) ||
      !integer(draft.memoryMiB, 256, 1048576) || !integer(draft.diskGiB, 2, 65536)) {
    throw new Error('This creation draft is invalid. Ask Lynx for a fresh draft.')
  }
  pending = { draft: structuredClone(input as AiCreateDraft), agent, expires: now + 600_000 }
}

export function takeLynxCreateDraft(agent: string, template: { id: string; builtin?: boolean; kind?: GuestType } | undefined, now = Date.now()): { draft: AiCreateDraft | null; error?: string } {
  const entry = pending
  pending = null
  if (!entry) return { draft: null }
  if (entry.agent !== agent || entry.expires <= now || !template?.builtin || template.id !== entry.draft.templateId || template.kind !== entry.draft.kind) {
    return { draft: null, error: 'This Lynx draft expired or no longer matches this agent and built-in template. Ask Lynx for a fresh draft, or choose a template manually.' }
  }
  return { draft: structuredClone(entry.draft) }
}

export function clearLynxCreateDraft() { pending = null }
