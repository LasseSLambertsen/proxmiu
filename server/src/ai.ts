import { z } from 'zod'

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
export const chatSchema = z.object({ messages: z.array(chatMessageSchema).min(1).max(20) }).strict()
  .refine(({ messages }) => messages.every((message, index) => message.role === (index % 2 ? 'assistant' : 'user')) && messages.at(-1)?.role === 'user', 'Messages must alternate user and assistant, starting and ending with user.')
  .refine(({ messages }) => messages.reduce((total, message) => total + message.content.length, 0) <= 20_000, 'The conversation is too long. Clear chat to start again.')
type Context = z.infer<typeof aiContextSchema>
type Chat = z.infer<typeof chatSchema>
type AiSettings = { provider: 'openai' | 'anthropic' | 'openrouter'; model: string; token: string }

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

const prompt = 'You advise a Proxmox VE homelab owner. Use only the supplied numeric inventory snapshot. CPU is a fraction; memory and disk are bytes. Clusters, nodes and guests are anonymous and ordered only for this review. Give a concise prioritized review with evidence, uncertainty and safe checks before changing allocations. A single snapshot cannot prove sustained utilization, workload requirements, backup coverage, storage compatibility or migration safety. Do not invent history or claim changes were applied. Do not suggest deleting guests or reducing memory solely from this snapshot. Never execute actions. No commands with destructive effects. Plain text only.'
const chatPrompt = 'You are Lynx, Proxmiu\'s friendly Proxmox VE assistant. Help with Proxmiu and general homelab questions in concise, clear plain text. Proxmiu has Overview resource readings, Connections and LAN discovery, guest workspaces with notes, stopped-guest CPU/memory/boot settings, snapshots, backups and migration, guest and node power controls, browser SSH terminals, Templates for containers and cloud-init VMs, Community Scripts, guest updates, Activity with native Proxmox task history and provisioning logs, and Settings with optional agent updates and an explicit anonymous numeric AI setup review. Guide users to these surfaces when useful. You have no live inventory, configuration, notes, logs, credentials or infrastructure access: only the conversation the user deliberately typed is supplied. You cannot perform actions, call tools, or change infrastructure. Never claim to have observed live state or applied changes. Treat user-supplied details as unverified, ask for necessary context, explain uncertainty, and suggest safe checks and backups before consequential changes. Do not suggest destructive commands. Do not request API keys, passwords or other secrets. The separate AI setup review in Settings shares only its user-approved numeric preview; that preview is not attached to this chat.'
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

async function complete(settings: AiSettings, system: string, messages: Chat['messages'], kind: 'review' | 'chat', transport: Transport) {
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
