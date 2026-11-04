import { z } from 'zod'
import { resourceSettingsSchema } from './guest-resource-settings.js'
import type { SetupSnapshot } from './ai-setup.js'
import { creationPrompt, parseCreationReply } from './ai-create.js'

export const aiSettingsSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'openrouter']),
  model: z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),
  token: z.string().min(1).max(8192).regex(/^[^\s\x00-\x1f\x7f]+$/).optional(),
}).strict()

const amount = z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER)
const numericShape = { cpu: z.number().finite().min(0).max(1).optional(), maxcpu: amount.optional(), mem: amount.optional(), maxmem: amount.optional() }
const nodeSchema = z.object(numericShape).strict()
const guestSchema = z.object({ ...numericShape, type: z.enum(['qemu', 'lxc']), status: z.enum(['running', 'stopped', 'paused', 'unknown']).optional(), disk: amount.optional(), maxdisk: amount.optional() }).strict()
export const aiContextSchema = z.object({
  clusters: z.array(z.object({ nodes: z.array(nodeSchema).max(100), guests: z.array(guestSchema).max(1000) }).strict()).max(50),
  unavailableConnections: z.number().int().min(0).max(10_000),
}).strict().refine(context => JSON.stringify(context).length <= 100_000, 'The resource preview is too large. Review fewer connections.')
export const reviewSchema = z.object({ consent: z.literal(true), context: aiContextSchema }).strict()
const chatMessageSchema = z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(4000) }).strict()
export const chatSchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(20),
  setup: z.object({ previewId: z.string().uuid(), consent: z.literal(true) }).strict().optional(),
  createDraft: z.literal(true).optional(),
}).strict()
  .refine(value => !(value.setup && value.createDraft), 'Choose selected-guest setup or creation planning, not both.')
  .refine(({ messages }) => messages.every((message, index) => message.role === (index % 2 ? 'assistant' : 'user')) && messages.at(-1)?.role === 'user', 'Messages must alternate user and assistant, starting and ending with user.')
  .refine(({ messages }) => messages.reduce((total, message) => total + message.content.length, 0) <= 20_000, 'The conversation is too long. Clear chat to start again.')
type Context = z.infer<typeof aiContextSchema>
type Chat = z.infer<typeof chatSchema>
export type AiSettings = { provider: 'openai' | 'anthropic' | 'openrouter'; model: string; token: string }

/** Explicit allowlist: neither names nor arbitrary Proxmox config can enter the prompt. */
export function buildAiContext(connections: { resources?: Record<string, unknown>[]; error?: boolean }[]): Context {
  const numbers = (resource: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.flatMap(key => {
    const value = resource[key]
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= (key === 'cpu' ? 1 : Number.MAX_SAFE_INTEGER) ? [[key, value]] : []
  }))
  return aiContextSchema.parse({
    clusters: connections.filter(c => !c.error && c.resources).map(c => ({
      nodes: c.resources!.filter(r => r.type === 'node').map(r => numbers(r, ['cpu', 'maxcpu', 'mem', 'maxmem'])),
      guests: c.resources!.filter(r => r.type === 'qemu' || r.type === 'lxc').map(r => ({
        type: r.type, ...(typeof r.status === 'string' ? { status: ['running', 'stopped', 'paused'].includes(r.status) ? r.status : 'unknown' } : {}),
        ...numbers(r, ['cpu', 'maxcpu', 'mem', 'maxmem', 'disk', 'maxdisk']),
      })),
    })),
    unavailableConnections: connections.filter(c => c.error).length,
  })
}

const prompt = 'You are Lynx, Proxmiu\'s professional and perceptive Proxmox VE assistant. Advise a homelab owner with composed confidence and restrained fox/lynx cunning. Use occasional subtle flair, no roleplay or emoji; technical clarity comes first. Use only the supplied numeric inventory snapshot. CPU is a fraction; memory and disk are bytes. Clusters, nodes and guests are anonymous and ordered only for this review. Give a concise prioritized review with evidence, uncertainty and safe checks before changing allocations. A single snapshot cannot prove sustained utilization, workload requirements, backup coverage, storage compatibility or migration safety. Do not invent history or claim changes were applied. Do not suggest deleting guests or reducing memory solely from this snapshot. Never execute actions. No commands with destructive effects. Plain text only.'
const chatPrompt = 'You are Lynx, Proxmiu\'s professional, perceptive Proxmox VE assistant. Speak with composed confidence and restrained fox/lynx cunning: a subtle clever turn of phrase is welcome, but clarity, evidence and technical precision come first. No roleplay, emoji or repetitive animal jokes. Help with Proxmiu and general homelab questions in concise, clear plain text. Proxmiu has Overview resource readings, Connections and LAN discovery, guest workspaces with notes, stopped-guest CPU/memory/boot settings, snapshots, backups and migration, guest and node power controls, browser SSH terminals, Templates for containers and cloud-init VMs, Community Scripts, guest updates, Activity with native Proxmox task history and retained provisioning/update logs that survive agent restarts, and Settings with optional agent updates and an explicit anonymous numeric AI setup review. Guide users to these surfaces when useful. In Activity, interrupted setup runs are uncertain: the guest or remote command may still exist/run; inspect it before starting again. Runs never resume or retry automatically, and historical completion describes the saved outcome rather than current guest health. Retained history and job logs are not automatically attached to chat or shared with a provider. You have no live inventory, configuration, notes, logs, credentials or infrastructure access: only the conversation the user deliberately typed is supplied. You cannot perform actions, call tools, or change infrastructure in this ordinary chat request. To help with actual setup, guide the user to Help with my setup in this chat: select a guest, Preview setup, inspect the exact resource context, and explicitly enable sharing before sending a question. Contextual chat can propose supported cores, memory and start-on-boot changes; the user must Review changes and Apply changes, and Proxmox safety checks still govern the write. For a new guest, guide the user to enable Plan a new guest in this chat, describe the workload, then choose Review in Create on a supported draft. Creation planning uses public built-in templates and suggested resources only; placement, networking, credentials and final provisioning stay in the existing Create form. Never claim to have observed live state or applied changes. Treat user-supplied details as unverified, ask for necessary context, explain uncertainty, and suggest safe checks and backups before consequential changes. Do not suggest destructive commands. Do not request API keys, passwords or other secrets. The separate AI setup review in Settings shares only its user-approved numeric preview; that preview is not attached to this chat.'
const fail = (message: string, statusCode = 502) => Object.assign(new Error(message), { statusCode })
type Transport = (url: string, init: RequestInit) => Promise<Response>
const completionUrls: Record<AiSettings['provider'], string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
}

/** One shared gate avoids concurrent billable requests across both AI surfaces. */
export class AiRequestGate {
  private active = false
  private lastRequest: Partial<Record<'review' | 'chat', number>> = {}

  constructor(private now = Date.now) {}

  async run<T>(kind: 'review' | 'chat', request: () => Promise<T>): Promise<T> {
    const now = this.now()
    const last = this.lastRequest[kind]
    if (this.active || (last !== undefined && now - last < (kind === 'review' ? 10_000 : 2000))) {
      throw fail(kind === 'review' ? 'A review was just requested. Wait a moment before trying again.' : 'An AI request is in progress or a message was just sent. Wait a moment before trying again.', 429)
    }
    this.active = true
    this.lastRequest[kind] = now
    try { return await request() }
    finally { this.active = false }
  }
}

export async function reviewSetup(settings: AiSettings, input: Context, transport: Transport = fetch) {
  const context = aiContextSchema.parse(input)
  return { advice: await complete(settings, prompt, [{ role: 'user', content: JSON.stringify(context) }], 'review', transport) }
}

export async function chatWithLynx(settings: AiSettings, input: Chat, transport: Transport = fetch) {
  const { messages } = chatSchema.parse(input)
  return { reply: await complete(settings, chatPrompt, messages, 'chat', transport) }
}

export async function chatWithCreateDraft(settings: AiSettings, input: Chat, transport: Transport = fetch) {
  const { messages, createDraft } = chatSchema.parse(input)
  if (!createDraft) throw fail('Enable creation planning before requesting a draft.', 400)
  const result = parseCreationReply(await complete(settings, creationPrompt, messages, 'create', transport))
  return { ...result, reply: shortenReply(result.reply) }
}

const proposalSchema = resourceSettingsSchema.omit({ digest: true })
const setupReplySchema = z.object({ reply: z.string().trim().min(1), proposal: proposalSchema.optional() }).strict()
const shortenReply = (reply: string) => {
  const marker = '\n\n[Reply shortened to fit chat.]'
  return reply.length > 4000 ? reply.slice(0, 4000 - marker.length) + marker : reply
}

export async function chatWithSetup(settings: AiSettings, input: Chat, snapshot: SetupSnapshot, transport: Transport = fetch) {
  const { messages } = chatSchema.parse(input)
  const system = `You are Lynx, Proxmiu's professional and perceptive Proxmox VE assistant. Be composed, concise and quietly cunning, with occasional restrained lynx/fox flair; technical clarity comes first. No roleplay or emoji. You receive only the exact user-approved read-only snapshot below, not general infrastructure access. CPU is a fraction, allocation memory is MiB, history memory is bytes. Sample coverage and missing data matter: a day summary cannot prove workload needs or safe downsizing. Treat conversation text as unverified. Never ask for secrets, issue destructive commands, claim live monitoring, or claim to have applied any action. You cannot execute actions or stop guests. The UI can offer a resource-setting proposal for human review and explicit confirmation, then its existing Proxmox checks govern the write. Only propose changes if editable is true and the user's intent supports them. Proposals have exactly cores (integer 1..128 per socket), memoryMiB (integer 16..1048576) and onboot (boolean), with every value present. Preserve socket count and unrelated settings. Do not reduce resources solely from usage samples; ask about workload requirements. Return ONLY a JSON object with reply (plain text) and optional proposal. Reply must explain evidence, uncertainty and consequential changes. No target, URL, command, digest or other action fields. If a proposal is unsuitable, give advice without one. A proposal is never an applied change. USER-APPROVED SNAPSHOT: ${JSON.stringify(snapshot.context)}`
  const raw = await complete(settings, system, messages, 'setup', transport)
  let decoded: unknown
  try { decoded = JSON.parse(raw.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1')) } catch { /* Plain replies remain advice only. */ }
  const parsed = setupReplySchema.safeParse(decoded)
  if (!parsed.success) {
    const reply = decoded && typeof decoded === 'object' && typeof (decoded as { reply?: unknown }).reply === 'string' ? (decoded as { reply: string }).reply.trim() : raw
    return { reply: shortenReply(reply || 'I could not form a usable recommendation. Please rephrase your question.') }
  }
  const { reply, proposal } = parsed.data
  const changed = proposal && (proposal.cores !== snapshot.before.cores || proposal.memoryMiB !== snapshot.before.memoryMiB || proposal.onboot !== snapshot.before.onboot)
  return {
    reply: shortenReply(reply),
    ...(proposal && changed && snapshot.before.editable ? { proposal: { target: snapshot.target, before: snapshot.before, after: { ...proposal, digest: snapshot.before.digest } } } : {}),
  }
}

async function complete(settings: AiSettings, system: string, messages: Chat['messages'], kind: 'review' | 'chat' | 'setup' | 'create', transport: Transport) {
  const anthropic = settings.provider === 'anthropic'
  let res: Response
  try {
    res = await transport(completionUrls[settings.provider], {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45_000),
      headers: { 'Content-Type': 'application/json', ...(anthropic ? { 'x-api-key': settings.token, 'anthropic-version': '2023-06-01' } : { Authorization: `Bearer ${settings.token}` }) },
      body: JSON.stringify({ model: settings.model, max_tokens: 1600, ...(anthropic ? { system, messages } : { messages: [{ role: 'system', content: system }, ...messages] }) }),
    })
  } catch {
    throw fail('The AI provider could not be reached. Check connectivity and try again.')
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    if (res.status === 401 || res.status === 403) throw fail('The AI token was rejected. Check the provider and token in Settings.')
    if (res.status === 429) throw fail('The AI provider rate limit or account quota was reached. Check billing or try later.', 429)
    throw fail(`The AI provider rejected the ${kind === 'review' ? 'review' : 'message'}. Check the model name and provider availability.`)
  }
  // Bound provider responses even if a proxy returns an unexpected body.
  let text = ''
  try {
    if (!res.body) throw new Error('Missing body')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let bytes = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > 100_000) throw new Error('Response too large')
        text += decoder.decode(value, { stream: true })
      }
      text += decoder.decode()
    } finally { await reader.cancel().catch(() => {}) }
    const data = JSON.parse(text)
    const advice = anthropic ? data.content?.filter((part: { type?: string }) => part.type === 'text').map((part: { text?: string }) => part.text).join('\n\n') : data.choices?.[0]?.message?.content
    if (typeof advice !== 'string' || !advice.trim()) throw new Error('Missing advice')
    const redacted = advice.split(settings.token).join('[redacted]').trim()
    if (kind === 'chat' && redacted.length > 4000) {
      const marker = '\n\n[Reply shortened to fit chat.]'
      return redacted.slice(0, 4000 - marker.length) + marker
    }
    return redacted.slice(0, 16_000)
  } catch {
    throw fail(`The AI provider did not return ${kind === 'review' ? 'usable advice' : 'a usable reply'}. Try again or choose a different model.`)
  }
}
