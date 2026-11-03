import { z } from 'zod'

export interface GuestMetadata {
  favorite: boolean
  notes: string
  updatedAt: string
}

export interface GuestInsights {
  config: {
    name?: string
    description?: string
    cores?: number
    sockets?: number
    memory?: number
    ostype?: string
    onboot?: boolean
    unprivileged?: boolean
    networks: { name: string; value: string }[]
    disks: { name: string; value: string }[]
  } | null
  metrics: {
    time: number
    cpu?: number
    mem?: number
    maxmem?: number
    netin?: number
    netout?: number
    diskread?: number
    diskwrite?: number
  }[]
  configError?: string
  metricsError?: string
}

export const guestMetadataPatchSchema = z.object({
  favorite: z.boolean().optional(),
  notes: z.string().max(4000).optional(),
}).strict().refine((value) => value.favorite !== undefined || value.notes !== undefined, 'Provide favorite or notes')

export const guestMetadataParamsSchema = z.object({
  id: z.string().min(1).max(200).regex(/^[\w-]+$/),
  type: z.enum(['qemu', 'lxc']),
  vmid: z.string().regex(/^[1-9]\d*$/).transform(Number).refine(Number.isSafeInteger, 'Invalid guest ID'),
})

export const guestInsightsParamsSchema = guestMetadataParamsSchema.extend({
  node: z.string().min(1).max(253).regex(/^[\w][\w.-]*$/),
})
export const guestInsightsQuerySchema = z.object({ timeframe: z.enum(['hour', 'day', 'week']).default('hour') }).strict()

const finiteNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value))) return
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

const networkOptions = new Set([
  'virtio', 'e1000', 'e1000e', 'rtl8139', 'vmxnet3', 'ne2k_pci', 'ne2k_isa', 'pcnet', 'i82551', 'i82557b', 'i82559er',
  'name', 'bridge', 'hwaddr', 'ip', 'ip6', 'gw', 'gw6', 'type', 'firewall', 'link_down', 'mtu', 'queues', 'rate', 'tag', 'trunks',
])
const diskOptions = new Set([
  'size', 'media', 'cache', 'discard', 'iothread', 'ssd', 'backup', 'replicate', 'aio', 'ro', 'shared', 'format',
  'mbps', 'mbps_rd', 'mbps_wr', 'iops', 'iops_rd', 'iops_wr', 'serial', 'wwn',
  'mp', 'acl', 'quota', 'efitype', 'pre-enrolled-keys', 'version',
])

function propertyString(value: unknown, disk: boolean): string | undefined {
  if (typeof value !== 'string') return
  const parts = value.split(',')
  const allowed = disk ? diskOptions : networkOptions
  // A disk's leading volume/path must not be a URI containing embedded credentials.
  if (disk && (!/^[\w./:@+-]+$/.test(parts[0]) || parts[0].includes('://') || parts[0].includes('@'))) return
  const safe = parts.filter((part, index) => {
    if (disk && index === 0) return true
    const equals = part.indexOf('=')
    return equals > 0 && allowed.has(part.slice(0, equals)) && !/[\r\n]/.test(part)
  })
  return safe.length ? safe.join(',') : undefined
}

export function normalizeGuestConfig(raw: unknown, type: 'qemu' | 'lxc'): NonNullable<GuestInsights['config']> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid guest configuration')
  const source = raw as Record<string, unknown>
  const result: NonNullable<GuestInsights['config']> = { networks: [], disks: [] }
  const name = type === 'lxc' ? source.hostname : source.name
  if (typeof name === 'string') result.name = name
  for (const key of ['description', 'ostype'] as const) {
    if (typeof source[key] === 'string') result[key] = source[key]
  }
  for (const key of ['cores', 'sockets', 'memory'] as const) {
    const number = finiteNumber(source[key])
    if (number !== undefined && Number.isInteger(number) && (key === 'memory' || number > 0)) result[key] = number
  }
  for (const key of ['onboot', 'unprivileged'] as const) {
    if (source[key] === true || source[key] === 1 || source[key] === '1') result[key] = true
    else if (source[key] === false || source[key] === 0 || source[key] === '0') result[key] = false
  }
  const diskPattern = type === 'lxc' ? /^(?:rootfs|mp\d+)$/ : /^(?:(?:ide|sata|scsi|virtio|unused)\d+|efidisk0|tpmstate0)$/
  for (const key of Object.keys(source).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) {
    const network = /^net\d+$/.test(key)
    if (!network && !diskPattern.test(key)) continue
    const value = propertyString(source[key], !network)
    if (value) (network ? result.networks : result.disks).push({ name: key, value })
  }
  return result
}

export function normalizeGuestMetrics(raw: unknown): GuestInsights['metrics'] {
  if (!Array.isArray(raw)) throw new Error('Invalid guest history')
  const byTime = new Map<number, GuestInsights['metrics'][number]>()
  for (const value of raw) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const row = value as Record<string, unknown>
    const time = finiteNumber(row.time)
    if (time === undefined || !Number.isSafeInteger(time) || time <= 0) continue
    const sample = byTime.get(time) ?? { time }
    for (const key of ['cpu', 'mem', 'maxmem', 'netin', 'netout', 'diskread', 'diskwrite'] as const) {
      const number = finiteNumber(row[key])
      if (number !== undefined && (key !== 'cpu' || number <= 1)) sample[key] = number
    }
    byTime.set(time, sample)
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time)
}

interface InsightsClient {
  get(path: string, params?: { timeframe: string; cf: string }): Promise<unknown>
}

export async function loadGuestInsights(
  client: InsightsClient,
  guest: { node: string; type: 'qemu' | 'lxc'; vmid: number },
  timeframe: 'hour' | 'day' | 'week',
): Promise<GuestInsights> {
  const base = `/nodes/${guest.node}/${guest.type}/${guest.vmid}`
  const [config, metrics] = await Promise.allSettled([
    client.get(`${base}/config`).then((raw) => normalizeGuestConfig(raw, guest.type)),
    client.get(`${base}/rrddata`, { timeframe, cf: 'AVERAGE' }).then(normalizeGuestMetrics),
  ])
  // Upstream errors can contain arbitrary response bodies or configuration values.
  return {
    config: config.status === 'fulfilled' ? config.value : null,
    metrics: metrics.status === 'fulfilled' ? metrics.value : [],
    ...(config.status === 'rejected' ? { configError: 'Guest configuration is unavailable. Check connection access and guest permissions.' } : {}),
    ...(metrics.status === 'rejected' ? { metricsError: 'Guest history is unavailable. Check connection access and guest permissions.' } : {}),
  }
}
