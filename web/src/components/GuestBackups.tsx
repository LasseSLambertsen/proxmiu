import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Select } from '@/components/ui/form'
import type { Guest } from '@/lib/api'
import { useGuestBackups } from '@/lib/queries'
import { formatBytes } from '@/lib/utils'

export function GuestBackups({ guest, storages, unavailable = false }: { guest: Guest; storages: string[]; unavailable?: boolean }) {
  const [storage, setStorage] = useState('')
  const selected = storages.includes(storage) ? storage : storages[0] ?? ''
  const query = useGuestBackups(guest, selected, !unavailable)

  return <section aria-label="Existing backups" className="space-y-3 border-t border-border-subtle pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-[13px] font-semibold">Existing backups</h4><Button variant="ghost" size="icon" aria-label="Refresh backup inventory" title="Refresh backup inventory" disabled={unavailable || !selected || query.isFetching} onClick={() => query.refetch()}><RefreshCw className={query.isFetching ? 'animate-spin' : ''} /></Button></div>
    <Field label="Browse backup storage" help="Lists this guest’s backups on an active backup storage."><Select aria-label="Browse backup storage" value={selected} disabled={unavailable || !storages.length} onChange={event => setStorage(event.target.value)}>{storages.length ? storages.map(value => <option key={value}>{value}</option>) : <option value="">No backup storage available</option>}</Select></Field>
    {!selected && <p className="text-[12px] text-muted">No eligible backup storage was returned. Check the operations warnings and Proxmox storage access.</p>}
    {selected && query.isPending && <p role="status" className="text-[12px] text-muted">Loading backup inventory…</p>}
    {query.error && <p role="alert" className="break-words text-[12px] text-destructive">Backup inventory could not load: {query.error.message} Refresh to try again.</p>}
    {!!query.data?.errors.length && <div role="alert" className="space-y-2 rounded-md bg-warning-soft p-3 text-[12px] text-warning">{query.data.errors.map((error, index) => <p className="break-words" key={index}>{error}</p>)}<p>Check Proxmox storage access, then refresh.</p></div>}
    {selected && query.data?.backups.length ? <ul className="divide-y divide-border-subtle">{query.data.backups.map(backup => <li key={`${backup.storage}/${backup.volid}`} className="space-y-2 py-3"><p className="break-all font-mono text-[11px] leading-relaxed">{backup.volid}</p><dl className="flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-muted"><div><dt className="sr-only">Created</dt><dd className="tnum">{backup.ctime === undefined ? 'Date unavailable' : new Date(backup.ctime * 1000).toLocaleString()}</dd></div><div><dt className="sr-only">Size</dt><dd className="tnum">{backup.size === undefined ? 'Size unavailable' : formatBytes(backup.size)}</dd></div><div><dt className="sr-only">Format</dt><dd>{backup.format || 'Format unavailable'}</dd></div></dl></li>)}</ul> : selected && query.data && !query.data.errors.length && !query.error && <p className="text-[12px] text-muted">No backups found on this storage.</p>}
    {selected && query.data?.truncated && <p role="status" className="text-[12px] text-warning">Showing the newest 500 backups. Open Proxmox to browse the full inventory.</p>}
  </section>
}
