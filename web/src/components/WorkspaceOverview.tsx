import { AlertTriangle, ArrowRight, CheckCircle2, Cpu, Star } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { ClusterOverview, Guest } from '@/lib/api'
import { guestHref, guestKey } from '@/lib/guest-workspace'
import { healthWarnings } from '@/lib/health'
import { useGuestMetadata } from '@/lib/queries'
import { cn, formatBytes } from '@/lib/utils'
import { StatusDot } from './StatusDot'
import { Card } from './ui/card'

export function WorkspaceOverview({ clusters, loading, error, updatedAt, onRetry }: { clusters: ClusterOverview[]; loading: boolean; error?: string; updatedAt?: number; onRetry?: () => void }) {
  const metadata = useGuestMetadata()
  const [expanded, setExpanded] = useState(false)
  const warnings = healthWarnings(clusters)
  const nodes = clusters.flatMap(cluster => cluster.nodes)
  const guests: Guest[] = clusters.flatMap(cluster => cluster.guests.map(guest => ({ ...guest, vmid: guest.vmid!, clusterId: cluster.id, clusterName: cluster.name })))
  const pinned = guests.filter(guest => !guest.template && metadata.data?.[guestKey(guest)]?.favorite)
  return <div className="space-y-5">
    <div className={cn('rounded-xl px-4 py-3', warnings.length || error ? 'bg-warning-soft' : 'bg-inset')}>
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2 text-[12px] font-medium">{warnings.length || error ? <AlertTriangle className="size-4 text-warning" /> : <CheckCircle2 className="size-4 text-success" />}<span>{error ? 'Could not refresh your homelab' : loading ? 'Checking your homelab…' : warnings.length ? `${warnings.length} thing${warnings.length === 1 ? '' : 's'} to check` : nodes.length ? 'All connected nodes are online' : 'Waiting for node status'}</span></div><span className="text-[11px] text-muted">{error ? 'Showing last known readings' : 'Based on the latest host readings'}</span></div>
      {error && <p role="status" className="mt-2 text-[12px] text-warning">{error}{updatedAt ? ` Last updated ${new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : ''} <button className="underline underline-offset-4" onClick={onRetry}>Try again</button></p>}
      {warnings.length > 0 && <ul className="mt-3 space-y-1">{(expanded ? warnings : warnings.slice(0, 4)).map(warning => <li key={warning.id}><Link to={warning.href} className="group flex items-start justify-between gap-3 rounded-md py-2 text-[12px] hover:bg-hover"><div><div className={warning.severity === 'error' ? 'font-medium text-destructive' : 'font-medium'}>{warning.title}</div><div className="mt-0.5 text-muted">{warning.description}</div></div><ArrowRight className="mt-0.5 size-3.5 shrink-0 text-faint group-hover:text-brand" /></Link></li>)}</ul>}
      {warnings.length > 4 && <button className="mt-2 text-[12px] text-brand hover:underline" onClick={() => setExpanded(value => !value)}>{expanded ? 'Show fewer' : `Show all ${warnings.length}`}</button>}
    </div>
    <section aria-label="Pinned guests"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-[16px]"><Star className="size-4 text-brand" />Your pinned guests</h2><Link to="/guests?pinned=1" className="flex items-center gap-1 text-[12px] text-muted hover:text-foreground">View inventory<ArrowRight className="size-3.5" /></Link></div>
      <Card>{metadata.isLoading ? <p className="p-4 text-[12px] text-muted">Loading your workspace…</p> : pinned.length ? <div className="divide-y divide-border-subtle">{pinned.slice(0, 6).map(guest => <Link key={guestKey(guest)} to={guestHref(guest)} className="group flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-hover"><StatusDot status={guest.status} /><div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium group-hover:text-brand">{guest.name ?? `Guest ${guest.vmid}`}</div><div className="mt-0.5 text-[11px] text-faint">{guest.type === 'lxc' ? 'Container' : 'VM'} {guest.vmid} · {guest.node}</div></div><span className="tnum flex items-center gap-1 text-[12px] text-muted max-sm:hidden"><Cpu className="size-3.5 text-faint" />{guest.status === 'running' && guest.cpu !== undefined ? `${Math.round(guest.cpu * 100)}%` : guest.status}</span><span className="tnum w-24 text-right text-[12px] text-muted max-sm:hidden">{guest.status === 'running' && guest.mem !== undefined ? formatBytes(guest.mem) : '—'}</span><ArrowRight className="size-3.5 shrink-0 text-faint group-hover:text-brand" /></Link>)}</div> : <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-5 text-[12px]"><p className="text-muted">{metadata.error ? 'Your pinned guests could not load.' : 'Pin the machines you reach for first. They’ll be right here.'}</p>{metadata.error ? <button className="text-brand hover:underline" onClick={() => metadata.refetch()}>Try again</button> : <Link to="/guests" className="inline-flex items-center gap-1 text-brand hover:underline">Choose guests<ArrowRight className="size-3.5" /></Link>}</div>}</Card>
      {pinned.length > 6 && <p className="mt-2 text-[11px] text-faint">Showing 6 of {pinned.length} pinned guests.</p>}
    </section>
  </div>
}
