import { ArrowLeft, Box, Cpu, HardDrive, MemoryStick, MonitorCog, Play, Power, RefreshCw, RotateCw, Save, Star, SquareTerminal, Timer } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ConfirmDialog, type ConfirmRequest } from '@/components/ConfirmDialog'
import { CopyButton } from '@/components/CopyButton'
import { EmptyState } from '@/components/EmptyState'
import { useGuestAction } from '@/components/GuestTable'
import { Meter } from '@/components/Meter'
import { ResourceHistory } from '@/components/ResourceHistory'
import { SshDialog, type SshRequest } from '@/components/SshDialog'
import { StatusDot } from '@/components/StatusDot'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, Textarea } from '@/components/ui/form'
import type { Guest } from '@/lib/api'
import { guestKey, isGuestType, type HistoryRange } from '@/lib/guest-workspace'
import { useGuestInsights, useGuestIps, useGuestMetadata, useGuests, useSaveGuestMetadata } from '@/lib/queries'
import { formatBytes, formatUptime, pct } from '@/lib/utils'

function GuestNotes({ guest }: { guest: Guest }) {
  const metadata = useGuestMetadata()
  const save = useSaveGuestMetadata()
  const stored = metadata.data?.[guestKey(guest)]?.notes ?? ''
  const [notes, setNotes] = useState(stored)
  const [dirty, setDirty] = useState(false)
  useEffect(() => { if (!dirty) setNotes(stored) }, [stored, dirty])
  return <Card>
    <CardHeader><CardTitle>Guest notes</CardTitle><span className="text-[11px] text-faint">Saved on your agent</span></CardHeader>
    <CardContent>
      <label htmlFor="guest-notes" className="sr-only">Guest notes</label>
      <Textarea id="guest-notes" value={notes} maxLength={4000} rows={6} disabled={metadata.isPending || !!metadata.error || save.isPending} placeholder="What runs here? Add a service URL, backup reminder or useful command…" onChange={event => { setNotes(event.target.value); setDirty(true) }} className="resize-y" />
      <div className="mt-3 flex items-center justify-between gap-2"><span className="text-[11px] text-faint">{dirty ? 'Unsaved changes' : 'Notes sync across your browsers'}</span><Button disabled={!dirty || !!metadata.error} loading={save.isPending} onClick={() => save.mutate({ guest, patch: { notes } }, { onSuccess: () => { setDirty(false); toast.success('Notes saved') }, onError: error => toast.error(`Notes were not saved: ${error.message}`) })}><Save />Save notes</Button></div>
      {metadata.error && <p role="alert" className="mt-3 text-[12px] text-destructive">Notes could not load. <button onClick={() => metadata.refetch()} className="underline">Try again</button></p>}
    </CardContent>
  </Card>
}

export function GuestDetail() {
  const params = useParams()
  const overview = useGuests()
  const identity = JSON.stringify([params.clusterId, params.type, params.vmid])
  const snapshot = useRef<{ identity: string; guest: Guest } | null>(null)
  const currentGuest = overview.guests.find(g => g.clusterId === params.clusterId && g.type === params.type && String(g.vmid) === params.vmid)
  const connection = overview.data?.clusters.find(cluster => cluster.id === params.clusterId)
  const unavailable = !!overview.error || connection?.ok === false
  if (currentGuest) snapshot.current = { identity, guest: currentGuest }
  const guest = currentGuest ?? (unavailable && snapshot.current?.identity === identity ? snapshot.current.guest : undefined)
  const valid = isGuestType(params.type) && /^\d+$/.test(params.vmid ?? '')
  const [range, setRange] = useState<HistoryRange>('hour')
  const insights = useGuestInsights(valid ? guest : undefined, range, !unavailable)
  const metadata = useGuestMetadata()
  const save = useSaveGuestMetadata()
  const ips = useGuestIps(guest ? [guest.clusterId] : [])
  const action = useGuestAction()
  const [ssh, setSsh] = useState<SshRequest | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)

  if (overview.isLoading) return <div className="px-8 py-12 text-[13px] text-muted" role="status">Opening guest workspace…</div>
  if (!guest || !valid) return <div className="p-8"><EmptyState icon={Box} title="Guest unavailable" action={<Link to="/guests"><Button><ArrowLeft />All guests</Button></Link>}>The guest may have moved, been removed, or belong to an offline connection. Refresh the inventory to find its current location.</EmptyState></div>

  const pinned = metadata.data?.[guestKey(guest)]?.favorite ?? false
  const running = guest.status === 'running'
  const ip = ips.data?.[guest.clusterId]?.[`${guest.type}/${guest.vmid}`]
  const config = insights.data?.config
  const Icon = guest.type === 'lxc' ? Box : MonitorCog
  const pin = () => save.mutate({ guest, patch: { favorite: !pinned } }, { onError: error => toast.error(error.message) })
  const ask = (verb: 'start' | 'shutdown' | 'reboot') => {
    if (verb === 'start') { action.mutate({ guest, action: verb }); return }
    setConfirm({ title: `${verb === 'reboot' ? 'Reboot' : 'Shut down'} ${guest.name ?? guest.vmid}?`, body: verb === 'reboot' ? 'The guest restarts and will be temporarily unreachable.' : 'Sends a graceful shutdown request. Services on this guest will become unavailable.', confirmLabel: verb === 'reboot' ? 'Reboot' : 'Shut down', onConfirm: () => action.mutateAsync({ guest, action: verb }) })
  }
  const tags = guest.tags?.split(/[;,]/).filter(Boolean) ?? []
  const facts = [
    ['Connection', guest.clusterName], ['Node', guest.node], ['Guest ID', String(guest.vmid)], ['Operating system', config?.ostype ?? '—'],
    ['Start at boot', config?.onboot === undefined ? '—' : config.onboot ? 'Enabled' : 'Disabled'],
    ...(guest.type === 'lxc' ? [['Isolation', config?.unprivileged === undefined ? '—' : config.unprivileged ? 'Unprivileged container' : 'Privileged container']] : []),
  ]

  return <>
    <div className="px-8 pt-7 max-md:px-4 max-md:pt-4"><Link to="/guests" className="inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-foreground"><ArrowLeft className="size-3.5" />All guests</Link></div>
    <header className="flex flex-wrap items-start justify-between gap-4 px-8 pb-6 pt-4 max-md:px-4">
      <div className="min-w-0"><div className="flex min-w-0 items-center gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand"><Icon className="size-5" /></span><div className="min-w-0"><h1 className="break-words text-[28px] font-semibold leading-tight tracking-[-0.03em] max-sm:text-[24px]">{guest.name ?? `Guest ${guest.vmid}`}</h1><div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted"><StatusDot status={guest.status} /><span className="capitalize">{guest.status}</span><span className="text-faint">·</span><span>{guest.type === 'lxc' ? 'Container' : 'Virtual machine'} {guest.vmid} · {guest.node}</span></div></div></div></div>
      <div className="flex flex-wrap items-center gap-2"><Button onClick={pin} aria-pressed={pinned} disabled={metadata.isPending || !!metadata.error || save.isPending} className={pinned ? 'text-brand' : ''}><Star className={pinned ? 'fill-current' : ''} />{pinned ? 'Pinned' : 'Pin guest'}</Button><Button size="icon" variant="ghost" title="Refresh guest" aria-label="Refresh guest" onClick={() => { overview.refetch(); insights.refetch(); ips.refetch() }}><RefreshCw className={overview.isFetching ? 'animate-spin' : ''} /></Button></div>
    </header>
    <div className="space-y-5 px-8 pb-10 max-md:px-4">
      {unavailable && <p role="status" className="rounded-lg bg-warning-soft px-4 py-3 text-[12px] text-warning">This connection is unavailable. Showing the last known guest details; your unsaved notes are kept here. <button className="underline underline-offset-4" onClick={() => overview.refetch()}>Try reconnecting</button></p>}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-inset px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13px]">{ip ? <><span className="tnum font-mono">{ip}</span><CopyButton text={ip} /></> : <span className="text-muted">{running ? 'Waiting for an IP address' : 'Address available when running'}</span>}{tags.map(tag => <Badge key={tag} tone={tag === 'proxmiu' ? 'brand' : 'neutral'}>{tag}</Badge>)}</div>
        <div className="flex flex-wrap gap-2"><Button disabled={!running || !ip || unavailable} onClick={() => ip && setSsh({ host: ip, label: guest.name ?? String(guest.vmid), defaultUser: tags.includes('proxmiu') ? 'dev' : 'root' })}><SquareTerminal />Open terminal</Button>{running ? <><Button disabled={action.isPending || unavailable} onClick={() => ask('reboot')}><RotateCw />Reboot</Button><Button disabled={action.isPending || unavailable} variant="ghost" onClick={() => ask('shutdown')}><Power />Shut down</Button></> : <Button variant="primary" disabled={action.isPending || unavailable} onClick={() => ask('start')}><Play />Start guest</Button>}</div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'CPU', value: running && guest.cpu !== undefined ? `${(guest.cpu * 100).toFixed(0)}%` : '—', hint: `${guest.maxcpu ?? config?.cores ?? '—'} vCPU allocated`, icon: Cpu, meter: running && guest.cpu !== undefined ? guest.cpu * 100 : undefined },
          { label: 'Memory', value: running && guest.mem !== undefined ? formatBytes(guest.mem) : '—', hint: guest.maxmem ? `${formatBytes(guest.maxmem)} allocated` : 'Allocation not reported', icon: MemoryStick, meter: running && guest.mem !== undefined ? pct(guest.mem, guest.maxmem) : undefined },
          { label: 'Disk allocation', value: guest.maxdisk ? formatBytes(guest.maxdisk) : '—', hint: guest.type === 'lxc' && guest.disk !== undefined ? `${formatBytes(guest.disk)} used` : 'Virtual disk capacity', icon: HardDrive },
          { label: 'Uptime', value: running ? formatUptime(guest.uptime) : 'Stopped', hint: running ? 'Since last start' : 'Ready when you are', icon: Timer },
        ].map(({ label, value, hint, icon: StatIcon, meter }) => <Card key={label} className="min-w-0 p-4"><div className="flex items-center justify-between text-[12px] text-muted"><span>{label}</span><StatIcon className="size-4 text-faint" /></div><div className="tnum mt-3 truncate text-[24px] font-semibold tracking-tight">{value}</div><p className="mt-1 text-[11px] text-faint">{hint}</p>{meter !== undefined && <div className="mt-3"><Meter value={meter} /></div>}</Card>)}
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]">
        <div className="min-w-0 space-y-4"><div className="flex items-center justify-between gap-3"><h2 className="text-[15px] font-semibold">A closer look</h2><label className="flex items-center gap-2 text-[12px] text-muted"><span className="max-sm:sr-only">History range</span><Select aria-label="History range" value={range} onChange={event => setRange(event.target.value as HistoryRange)} className="w-32"><option value="hour">Last hour</option><option value="day">Last 24 hours</option><option value="week">Last 7 days</option></Select></label></div><ResourceHistory metrics={insights.data?.metrics ?? []} loading={insights.isLoading} error={insights.error?.message ?? insights.data?.metricsError} /><GuestNotes key={guestKey(guest)} guest={guest} /></div>
        <div className="min-w-0 space-y-4"><Card><CardHeader><CardTitle>Configuration</CardTitle></CardHeader><CardContent><dl className="space-y-4">{facts.map(([label, value]) => <div key={label} className="flex justify-between gap-4 text-[12px]"><dt className="shrink-0 text-muted">{label}</dt><dd className="break-all text-right">{value}</dd></div>)}</dl>{config?.description && <p className="mt-5 whitespace-pre-wrap break-words rounded-md bg-inset p-3 text-[12px] text-muted">{config.description}</p>}{insights.data?.configError && <p role="status" className="mt-4 text-[12px] text-warning">{insights.data.configError}</p>}{insights.error && <p role="alert" className="mt-4 text-[12px] text-warning">Configuration could not load. <button className="underline" onClick={() => insights.refetch()}>Retry</button></p>}</CardContent></Card>
          {([{ title: 'Network interfaces', entries: config?.networks }, { title: 'Attached disks', entries: config?.disks }]).map(({ title, entries }) => <Card key={title}><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent>{entries?.length ? <dl className="space-y-3">{entries.map(entry => <div key={entry.name}><dt className="font-mono text-[11px] text-brand">{entry.name}</dt><dd className="mt-1 break-all font-mono text-[11px] leading-relaxed text-muted">{entry.value}</dd></div>)}</dl> : <p className="text-[12px] text-muted">{insights.isLoading ? 'Loading configuration…' : 'No configuration reported.'}</p>}</CardContent></Card>)}
        </div>
      </div>
    </div>
    <SshDialog request={ssh} onClose={() => setSsh(null)} /><ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
  </>
}
