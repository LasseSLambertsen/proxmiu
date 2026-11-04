import { z } from 'zod'
import { builtinTemplates } from './templates.js'

const draftSchema = z.object({
  templateId: z.string().refine(id => builtinTemplates.some(template => template.id === id)),
  cores: z.number().int().min(1).max(128),
  memoryMiB: z.number().int().min(256).max(1048576),
  diskGiB: z.number().int().min(2).max(65536),
}).strict()
const replySchema = z.object({ reply: z.string().trim().min(1), createDraft: draftSchema.optional() }).strict()

// Deliberately omit scripts, sources, options and custom templates, even if they are locally available.
const catalog = builtinTemplates.map(({ id, name, description, kind, resources }) => ({
  id, name, description, kind,
  defaults: { cores: resources.cores, memoryMiB: resources.memory, diskGiB: resources.disk },
}))
export const creationPrompt = `You are Lynx, Proxmiu's professional, perceptive Proxmox VE assistant. Be concise, composed and quietly cunning, with restrained fox/lynx flair and precise technical language. Help plan a new guest using only this public built-in template catalog and the user's deliberately typed conversation. You have no live infrastructure, inventory, storage, network, workload or credential access. Ask about unclear requirements; never invent compatibility or capacity. Never ask for secrets, supply destructive commands, execute actions or claim a guest has been created. A draft only opens the existing Create form: the user must review placement, networking, access credentials and template options, then explicitly create the guest. Return ONLY JSON with reply (plain text) and optional createDraft: {templateId, cores, memoryMiB, diskGiB}. Cores are integers 1..128, memory is integers 256..1048576 MiB, disk is integers 2..65536 GiB. Use exactly a catalog template ID and all four fields, no other draft fields. Preserve appropriate template defaults unless the user's requirements justify a change. Do not add scripts, URLs, template options, names, guest IDs, kind, connection, node, storage, networking or credentials. Explain assumptions and resource units in the reply. For unsupported software, offer guidance without a draft. A creation draft is never an applied change. PUBLIC BUILT-IN CATALOG: ${JSON.stringify(catalog)}`

export function parseCreationReply(raw: string) {
  let decoded: unknown
  try { decoded = JSON.parse(raw.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1')) } catch { /* Unstructured responses are advice only. */ }
  const parsed = replySchema.safeParse(decoded)
  if (!parsed.success) {
    const reply = decoded && typeof decoded === 'object' && typeof (decoded as { reply?: unknown }).reply === 'string' ? (decoded as { reply: string }).reply.trim() : raw
    return { reply: reply || 'I could not form a usable draft. Tell me what you want this guest to run.' }
  }
  const { reply, createDraft } = parsed.data
  if (!createDraft) return { reply }
  const template = builtinTemplates.find(template => template.id === createDraft.templateId)!
  return { reply, createDraft: { ...createDraft, templateName: template.name, kind: template.kind } }
}
