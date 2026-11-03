import { BookmarkPlus, Download, Plus, RefreshCw, Search, Server, SlidersHorizontal, Star, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { BulkGuestActions } from '@/components/BulkGuestActions'
import { EmptyState } from '@/components/EmptyState'
import { GuestTable } from '@/components/GuestTable'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/form'
import { getAgent } from '@/lib/agent'
import type { Guest } from '@/lib/api'
import { defaultFilters, filterGuests, inventoryCsv, parseWorkspace, workspaceStorageKey, type InventoryFilters, type SavedView } from '@/lib/guest-inventory'
import { guestKey } from '@/lib/guest-workspace'
import { useGuestIps, useGuestMetadata, useGuests } from '@/lib/queries'
import { cn } from '@/lib/utils'

export function Guests() {
  const overview = useGuests()
  const { guests, data, isLoading } = overview
  const metadata = useGuestMetadata()
  const clusterIds = data?.clusters.filter(cluster => cluster.ok).map(cluster => cluster.id) ?? []
  const ips = useGuestIps(clusterIds)
  const [params, setParams] = useSearchParams()
  const storageKey = workspaceStorageKey(getAgent()?.url || location.origin)
  const [initial] = useState(() => { try { return parseWorkspace(localStorage.getItem(storageKey)) } catch { return parseWorkspace(null) } })
  const [filters, setFilters] = useState<InventoryFilters>(() => ({ ...initial.filters, ...(params.has('q') ? { query: params.get('q')! } : {}), ...(params.get('pinned') === '1' ? { pinnedOnly: true } : {}) }))
  const [views, setViews] = useState<SavedView[]>(initial.views)
  const [storageUnavailable, setStorageUnavailable] = useState(false)
  const [savingView, setSavingView] = useState(false)
  const [viewName, setViewName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const urlQuery = params.get('q')
  const urlPinned = params.get('pinned')

  useEffect(() => { if (urlQuery !== null) { setFilters(previous => ({ ...previous, query: urlQuery })); setSelected(new Set()) } }, [urlQuery])
  useEffect(() => { if (urlPinned === '1') { setFilters(previous => ({ ...previous, pinnedOnly: true })); setSelected(new Set()) } }, [urlPinned])
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ version: 1, filters, views })); setStorageUnavailable(false) }
    catch { setStorageUnavailable(true) }
  }, [storageKey, filters, views])

  const visible = useMemo(() => filterGuests(guests, filters, ips.data ?? {}, metadata.data ?? {}), [guests, filters, ips.data, metadata.data])
  const visibleKeys = visible.map(guestKey).join('|')
  useEffect(() => {
    if (busy) return
    const current = new Set(visibleKeys.split('|'))
    setSelected(previous => [...previous].every(key => current.has(key)) ? previous : new Set([...previous].filter(key => current.has(key))))
  }, [visibleKeys, busy])
  const selectedGuests = visible.filter(guest => selected.has(guestKey(guest)))
  const total = guests.filter(guest => !guest.template).length
  const offline = data?.clusters.filter(cluster => !cluster.ok).length ?? 0
  const nodes = [...new Map(guests.map(guest => [`${guest.clusterId}/${guest.node}`, { value: `${guest.clusterId}/${guest.node}`, label: (data?.clusters.length ?? 0) > 1 ? `${guest.clusterName} · ${guest.node}` : guest.node }])).values()].sort((a, b) => a.label.localeCompare(b.label))
  const change = (patch: Partial<InventoryFilters>) => { setFilters(previous => ({ ...previous, ...patch })); setSelected(new Set()) }
  const reset = () => { setFilters({ ...defaultFilters }); setSelected(new Set()); setParams(previous => { const next = new URLSearchParams(previous); next.delete('q'); next.delete('pinned'); return next }, { replace: true }) }
  const activeFilters = Object.entries(defaultFilters).some(([key, value]) => filters[key as keyof InventoryFilters] !== value)
  const activeView = views.find(view => Object.keys(defaultFilters).every(key => view.filters[key as keyof InventoryFilters] === filters[key as keyof InventoryFilters]))
  const chooseView = (view: SavedView) => { setFilters({ ...view.filters }); setSelected(new Set()); setParams({}, { replace: true }) }
  const select = (guest: Guest, checked: boolean) => {
    if (busy) return
    if (checked && selected.size >= 50) { toast.error('Select up to 50 guests per batch.'); return }
    setSelected(previous => { const next = new Set(previous); if (checked) next.add(guestKey(guest)); else next.delete(guestKey(guest)); return next })
  }
  const exportVisible = () => {
    const blob = new Blob([inventoryCsv(visible, ips.data ?? {}, metadata.data ?? {})], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `proxmiu-inventory-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <>
    <PageHeader title="Guests" description="A workspace for every machine in your homelab" actions={<Link to="/create"><Button variant="primary"><Plus />Create guest</Button></Link>} />
    <div className="space-y-4 px-8 pb-10 max-md:px-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="group" aria-label="Saved inventory views"><button disabled={busy} onClick={reset} className={cn('h-8 rounded-md px-3 text-[12px]', !activeFilters ? 'bg-primary text-primary-foreground' : 'text-muted hover:bg-hover')}>All guests</button><button disabled={busy} onClick={() => change({ pinnedOnly: !filters.pinnedOnly })} aria-pressed={filters.pinnedOnly} className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px]', filters.pinnedOnly ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-hover')}><Star className={cn('size-3.5', filters.pinnedOnly && 'fill-current')} />Pinned</button>{views.map(view => <span key={view.id} className={cn('inline-flex max-w-full items-center rounded-md', activeView?.id === view.id ? 'bg-hover text-foreground' : 'text-muted')}><button disabled={busy} onClick={() => chooseView(view)} className="h-8 max-w-40 truncate px-2 text-[12px]" title={view.name}>{view.name}</button><button disabled={busy} aria-label={`Delete view ${view.name}`} title={`Delete view ${view.name}`} onClick={() => setViews(previous => previous.filter(item => item.id !== view.id))} className="mr-1 rounded p-1 text-faint hover:bg-hover hover:text-destructive"><X className="size-3" /></button></span>)}</div>
        <div className="flex flex-wrap gap-2"><Button disabled={busy || views.length >= 20} title={views.length >= 20 ? 'Delete a saved view to add another' : 'Save the current filters and sorting'} onClick={() => { setViewName(''); setSavingView(true) }}><BookmarkPlus />Save view</Button><Button onClick={exportVisible} disabled={!visible.length || busy}><Download />Export CSV</Button></div>
      </div>
      {storageUnavailable && <p role="status" className="text-[12px] text-warning">Browser storage is unavailable. Your views will last for this visit only.</p>}
      <Card className="p-4"><div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[180px] flex-1"><span className="mb-1.5 block text-[11px] text-muted">Search guests</span><div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" /><Input aria-label="Search guests" placeholder="Name, ID, IP, node or tag…" maxLength={200} value={filters.query} disabled={busy} onChange={event => change({ query: event.target.value })} className="pl-8" /></div></label>
        <Button className="sm:hidden" disabled={busy} aria-expanded={showFilters} onClick={() => setShowFilters(value => !value)}><SlidersHorizontal />Filters</Button>
        <div className={cn('contents', !showFilters && 'max-sm:hidden')}>
        <Field label="Status" className="min-w-28 flex-1 sm:max-w-36"><Select aria-label="Filter by status" value={filters.status} disabled={busy} onChange={event => change({ status: event.target.value as InventoryFilters['status'] })}><option value="all">Any status</option><option value="running">Running</option><option value="stopped">Stopped</option></Select></Field>
        <Field label="Type" className="min-w-28 flex-1 sm:max-w-36"><Select aria-label="Filter by type" value={filters.kind} disabled={busy} onChange={event => change({ kind: event.target.value as InventoryFilters['kind'] })}><option value="all">All types</option><option value="lxc">Containers</option><option value="qemu">Virtual machines</option></Select></Field>
        <Field label="Node" className="min-w-32 flex-1 sm:max-w-44"><Select aria-label="Filter by node" value={filters.node} disabled={busy} onChange={event => change({ node: event.target.value })}><option value="all">All nodes</option>{nodes.map(node => <option key={node.value} value={node.value}>{node.label}</option>)}{filters.node !== 'all' && !nodes.some(node => node.value === filters.node) && <option value={filters.node}>Unavailable node</option>}</Select></Field>
        <Field label="Sort" className="min-w-32 flex-1 sm:max-w-40"><Select aria-label="Sort guests" value={filters.sort} disabled={busy} onChange={event => change({ sort: event.target.value as InventoryFilters['sort'] })}><option value="status">Running first</option><option value="name">Name</option><option value="id">Guest ID</option><option value="cpu">Highest CPU</option><option value="memory">Highest memory</option></Select></Field>
        </div>
      </div></Card>
      {(offline > 0 || overview.error) && <p role="status" className="rounded-lg bg-warning-soft p-3 text-[12px] text-warning">{overview.error ? 'The agent could not refresh the inventory.' : `${offline} connection${offline === 1 ? ' is' : 's are'} unavailable. Some guests may be missing.`} <Link to="/connections" className="underline underline-offset-4">View connections</Link></p>}
      {metadata.error && <p role="status" className="text-[12px] text-warning">Pins and notes could not load. <button className="underline" onClick={() => metadata.refetch()}>Retry</button></p>}
      <div className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-muted"><div className="flex items-center gap-3"><span className="tnum">{visible.length} of {total} guests</span>{activeFilters && <button disabled={busy} onClick={reset} className="text-brand hover:underline">Reset filters</button>}{!!visible.length && <label className="flex items-center gap-1.5" title={visible.length > 50 ? 'Filter to 50 guests or fewer to select all' : 'Select the visible guests'}><input type="checkbox" aria-label="Select all visible guests" disabled={busy || visible.length > 50} checked={visible.length > 0 && selectedGuests.length === visible.length} ref={input => { if (input) input.indeterminate = selectedGuests.length > 0 && selectedGuests.length < visible.length }} onChange={event => setSelected(event.target.checked ? new Set(visible.map(guestKey)) : new Set())} className="size-3.5 cursor-pointer accent-brand" />Select visible</label>}</div><div className="flex items-center gap-2"><span className="text-[11px] text-faint">{overview.dataUpdatedAt ? `Updated ${new Date(overview.dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Connecting…'}</span><Button variant="ghost" size="icon-sm" aria-label="Refresh inventory" disabled={busy || overview.isFetching} onClick={() => { overview.refetch(); ips.refetch() }}><RefreshCw className={overview.isFetching ? 'animate-spin motion-reduce:animate-none' : ''} /></Button></div></div>
      <BulkGuestActions guests={selectedGuests} onClear={() => setSelected(new Set())} onBusyChange={setBusy} />
      <Card>{isLoading ? <div className="space-y-3 p-4">{[40, 65, 50].map(width => <div key={width} role="status" aria-label="Loading guests" className="h-4 animate-pulse rounded-sm bg-hover" style={{ width: `${width}%` }} />)}</div> : visible.length ? <GuestTable guests={visible} ips={ips.data ?? {}} showCluster={(data?.clusters.length ?? 0) > 1} selected={selected} onSelect={select} selectionDisabled={busy} /> : <EmptyState icon={Server} title={total ? 'Nothing matches this view' : offline || overview.error ? 'Connections unavailable' : 'No guests yet'} action={total ? <Button onClick={reset}>Reset filters</Button> : offline || overview.error ? <Link to="/connections"><Button>View connections</Button></Link> : <Link to="/create"><Button variant="primary">Create from a template</Button></Link>}>{total ? 'Adjust your search, filters or pinned selection to see more guests.' : offline || overview.error ? 'Reconnect your Proxmox hosts to see their virtual machines and containers.' : 'Your virtual machines and containers will appear here with live status, addresses and resource usage.'}</EmptyState>}</Card>
    </div>
    <Dialog open={savingView} onOpenChange={setSavingView}><DialogContent title="Save inventory view" description="Keep this search, filters and sorting in this browser."><form onSubmit={event => { event.preventDefault(); if (!viewName.trim() || views.length >= 20) return; const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; setViews(previous => [...previous, { id, name: viewName.trim(), filters: { ...filters } }]); setSavingView(false); toast.success('View saved') }}><DialogBody><Field label="View name"><Input value={viewName} onChange={event => setViewName(event.target.value)} maxLength={40} placeholder="For example, running AI boxes" autoFocus /></Field></DialogBody><DialogFooter><Button type="button" onClick={() => setSavingView(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={!viewName.trim()}>Save view</Button></DialogFooter></form></DialogContent></Dialog>
  </>
}
