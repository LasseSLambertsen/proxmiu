import { z } from 'zod'

export const aiSettingsSchema = z.object({
  provider: z.enum(['openai', 'anthropic']),
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
type Context = z.infer<typeof aiContextSchema>

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
const fail = (message: string, statusCode = 502) => Object.assign(new Error(message), { statusCode })
type Transport = (url: string, init: RequestInit) => Promise<Response>

export async function reviewSetup(settings: { provider: 'openai' | 'anthropic'; model: string; token: string }, input: Context, transport: Transport = fetch) {
  const context = aiContextSchema.parse(input)
  const anthropic = settings.provider === 'anthropic'
  let res: Response
  try {
    res = await transport(anthropic ? 'https://api.anthropic.com/v1/messages' : 'https://api.openai.com/v1/chat/completions', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45_000),
      headers: { 'Content-Type': 'application/json', ...(anthropic ? { 'x-api-key': settings.token, 'anthropic-version': '2023-06-01' } : { Authorization: `Bearer ${settings.token}` }) },
      body: JSON.stringify({ model: settings.model, max_tokens: 1600, ...(anthropic ? { system: prompt, messages: [{ role: 'user', content: JSON.stringify(context) }] } : { messages: [{ role: 'system', content: prompt }, { role: 'user', content: JSON.stringify(context) }] }) }),
    })
  } catch {
    throw fail('The AI provider could not be reached. Check connectivity and try again.')
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    if (res.status === 401 || res.status === 403) throw fail('The AI token was rejected. Check the provider and token in Settings.')
    if (res.status === 429) throw fail('The AI provider rate limit or account quota was reached. Check billing or try later.', 429)
    throw fail('The AI provider rejected the review. Check the model name and provider availability.')
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
    return { advice: advice.split(settings.token).join('[redacted]').trim().slice(0, 16_000) }
  } catch {
    throw fail('The AI provider did not return usable advice. Try again or choose a different model.')
  }
}
