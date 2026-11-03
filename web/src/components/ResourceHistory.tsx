import { Activity, ArrowDownUp, Cpu, HardDrive, MemoryStick } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { GuestInsights } from '@/lib/api'
import { metricValue, type MetricKind } from '@/lib/guest-workspace'
import { cn, formatBytes } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

const kinds: { id: MetricKind; name: string; icon: typeof Cpu }[] = [
  { id: 'cpu', name: 'CPU', icon: Cpu },
  { id: 'memory', name: 'Memory', icon: MemoryStick },
  { id: 'network', name: 'Network', icon: ArrowDownUp },
  { id: 'disk', name: 'Disk I/O', icon: HardDrive },
]

export function ResourceHistory({ metrics, loading, error }: { metrics: GuestInsights['metrics']; loading: boolean; error?: string }) {
  const [kind, setKind] = useState<MetricKind>('cpu')
  const [active, setActive] = useState<number | null>(null)
  const points = useMemo(() => metrics.map(sample => ({ time: sample.time, value: metricValue(sample, kind) })), [metrics, kind])
  const values = points.flatMap(point => point.value === null ? [] : [point.value])
  const percent = kind === 'cpu' || kind === 'memory'
  const maximum = percent ? 100 : Math.max(1, ...values) * 1.12
  const width = 640, height = 180
  const first = points[0]?.time ?? 0, last = points.at(-1)?.time ?? first
  const span = Math.max(1, last - first)
  const x = (time: number) => (time - first) / span * width
  const y = (value: number) => height - value / maximum * height
  let started = false
  const line = points.map(point => {
    if (point.value === null) { started = false; return '' }
    const command = started ? 'L' : 'M'
    started = true
    return `${command}${x(point.time).toFixed(2)},${y(point.value).toFixed(2)}`
  }).join(' ')
  const format = (value: number) => percent ? `${value.toFixed(1)}%` : `${formatBytes(value)}/s`
  const time = (value: number) => new Date(value * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const selected = active !== null ? points[active] : undefined
  const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
  const move = (clientX: number, left: number, available: number) => setActive(Math.min(points.length - 1, Math.max(0, Math.round((clientX - left) / available * (points.length - 1)))))

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="size-4 text-brand" />Performance history</CardTitle><span className="text-[11px] text-faint">Proxmox RRD · average</span></CardHeader>
      <CardContent>
        <div className="mb-5 flex flex-wrap gap-1" role="group" aria-label="History metric">
          {kinds.map(({ id, name, icon: Icon }) => <button key={id} onClick={() => { setKind(id); setActive(null) }} aria-pressed={kind === id} className={cn('flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] transition-colors', kind === id ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-hover')}><Icon className="size-3.5" />{name}</button>)}
        </div>
        {loading ? <div className="flex h-[230px] items-center justify-center text-[13px] text-muted">Loading resource history…</div> : !values.length ? (
          <div className="flex h-[230px] flex-col items-center justify-center gap-2 text-center"><Activity className="size-7 text-faint" /><p className="text-[13px] font-medium">No history available</p><p className="max-w-sm text-[12px] text-muted">{error ?? 'This host has not recorded samples for this metric yet. Current usage is still shown above.'}</p></div>
        ) : (
          <>
            <div className="mb-4 flex min-h-10 items-start justify-between gap-3 text-[12px]">
              <div><div className="text-faint">{selected ? time(selected.time) : 'Average usage'}</div><div className="tnum mt-0.5 text-[20px] font-semibold tracking-tight">{selected ? selected.value === null ? 'No sample' : format(selected.value) : format(average)}</div></div>
              <div className="text-right text-muted"><div>Peak <span className="tnum font-medium text-foreground">{format(Math.max(...values))}</span></div><div className="mt-1 text-faint">{kind === 'network' ? 'Received + sent' : kind === 'disk' ? 'Read + written' : 'Of allocated resources'}</div></div>
            </div>
            <div tabIndex={0} role="group" aria-label={`${kinds.find(k => k.id === kind)!.name} chart. Use left and right arrows to inspect samples.`} className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand" onPointerMove={event => { const box = event.currentTarget.getBoundingClientRect(); move(event.clientX, box.left, box.width) }} onPointerLeave={() => setActive(null)} onKeyDown={event => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; event.preventDefault(); setActive(index => Math.max(0, Math.min(points.length - 1, (index ?? points.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1)))) }}>
              <svg viewBox={`0 0 ${width} ${height + 6}`} className="h-[186px] w-full overflow-visible" preserveAspectRatio="none" aria-hidden="true">
                {[0, .25, .5, .75, 1].map(tick => <line key={tick} x1="0" x2={width} y1={tick * height} y2={tick * height} stroke="currentColor" className="text-border" strokeDasharray="3 6" vectorEffect="non-scaling-stroke" />)}
                <path d={line} fill="none" stroke="currentColor" className="text-brand" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                {points.length === 1 && points[0].value !== null && <circle cx={x(points[0].time)} cy={y(points[0].value)} r="3" className="fill-brand" />}
                {selected && <g><line x1={x(selected.time)} x2={x(selected.time)} y1="0" y2={height} stroke="currentColor" className="text-muted" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />{selected.value !== null && <circle cx={x(selected.time)} cy={y(selected.value)} r="4" className="fill-brand stroke-card-elevated" strokeWidth="2" vectorEffect="non-scaling-stroke" />}</g>}
              </svg>
            </div>
            <div className="mt-3 flex justify-between gap-3 text-[10.5px] text-faint"><span>{time(first)}</span><span>{time(last)}</span></div>
            {error && <p role="status" className="mt-3 text-[12px] text-warning">{error}</p>}
          </>
        )}
      </CardContent>
    </Card>
  )
}
