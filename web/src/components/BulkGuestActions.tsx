import { CheckCircle2, Circle, Loader2, MinusCircle, Play, Power, RotateCw, X, XCircle } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api, type Guest } from '@/lib/api'
import { runGuestBatch, type BatchResult, type BulkAction } from '@/lib/bulk-actions'
import { guestApiPath, guestKey } from '@/lib/guest-workspace'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from './ui/dialog'

const labels: Record<BulkAction, string> = { start: 'Start', shutdown: 'Shut down', reboot: 'Reboot' }

export function BulkGuestActions({ guests, onClear, onBusyChange }: { guests: Guest[]; onClear: () => void; onBusyChange: (busy: boolean) => void }) {
  const qc = useQueryClient()
  const [operation, setOperation] = useState<{ action: BulkAction; targets: Guest[] } | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<BatchResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort() } }, [])
  const eligible = (action: BulkAction, targets: Guest[]) => targets.filter(guest => action === 'start' ? guest.status === 'stopped' : guest.status === 'running').length
  const choose = (action: BulkAction) => { setOperation({ action, targets: guests.map(guest => ({ ...guest })) }); setResults(null); setError(null); setOpen(true) }
  const sent = results?.filter(row => row.status === 'sent').length ?? 0
  const failed = results?.filter(row => row.status === 'error').length ?? 0
  const skipped = results?.filter(row => row.status === 'skipped').length ?? 0
  const completed = sent + failed + skipped

  const run = async () => {
    if (!operation || busy) return
    const batch = new AbortController()
    controller.current = batch
    setBusy(true)
    onBusyChange(true)
    setError(null)
    try {
      const finished = await runGuestBatch(operation.targets, operation.action, (guest, action) => api.post(`${guestApiPath(guest)}/${action}`), rows => { if (mounted.current) setResults(rows) }, batch.signal)
      if (mounted.current) setResults(finished)
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'The batch could not start.')
    } finally {
      qc.invalidateQueries({ queryKey: ['overview'] })
      qc.invalidateQueries({ queryKey: ['ips'] })
      if (mounted.current) { setBusy(false); onBusyChange(false) }
    }
  }

  if (!guests.length && !results) return null
  return <>
    {guests.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-brand-soft px-4 py-3" role="region" aria-label="Selected guests">
      <div className="flex items-center gap-2 text-[13px]"><span className="font-semibold">{guests.length} selected</span><Button variant="ghost" size="icon-sm" aria-label="Clear guest selection" disabled={busy} onClick={() => { onClear(); setResults(null) }}><X /></Button></div>
      <div className="flex flex-wrap gap-2"><Button disabled={busy || !eligible('start', guests) || guests.length > 50} onClick={() => choose('start')}><Play />Start</Button><Button disabled={busy || !eligible('reboot', guests) || guests.length > 50} onClick={() => choose('reboot')}><RotateCw />Reboot</Button><Button disabled={busy || !eligible('shutdown', guests) || guests.length > 50} onClick={() => choose('shutdown')}><Power />Shut down</Button></div>
    </div>}
    {results && !open && <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-inset px-3 py-2 text-[12px] text-muted"><p>Last batch: {sent} sent · {failed} failed · {skipped} skipped.</p><div className="flex items-center gap-1"><Button variant="ghost" onClick={() => setOpen(true)}>View results</Button><Button variant="ghost" size="icon-sm" aria-label="Dismiss batch results" onClick={() => setResults(null)}><X /></Button></div></div>}
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value) }}>
      {operation && <DialogContent title={results ? busy ? 'Sending requests…' : 'Batch results' : `${labels[operation.action]} selected guests?`} description={results ? 'Requests accepted by Proxmox may take time to finish. Live status refreshes separately.' : `${eligible(operation.action, operation.targets)} of ${operation.targets.length} selected guests can receive this request.`} onEscapeKeyDown={event => { if (busy) event.preventDefault() }} onInteractOutside={event => { if (busy) event.preventDefault() }}>
        <DialogBody>
          {!results && <p className="mb-4 text-[13px] text-muted">{operation.action === 'start' ? 'The stopped guests below will be started.' : 'Services on these guests will be temporarily unavailable. Check the targets before continuing.'} Guests in other states will be skipped.</p>}
          {results && <div className="mb-4"><div className="mb-2 flex justify-between text-[12px] text-muted"><span>{sent} sent · {failed} failed · {skipped} skipped</span><span>{completed}/{operation.targets.length}</span></div><div role="progressbar" aria-label="Batch progress" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={operation.targets.length} className="h-1.5 overflow-hidden rounded-full bg-hover"><div className="h-full rounded-full bg-brand transition-[width] motion-reduce:transition-none" style={{ width: `${completed / operation.targets.length * 100}%` }} /></div></div>}
          <ul className="max-h-72 divide-y divide-border-subtle overflow-y-auto rounded-lg bg-inset px-3">
            {(results ?? operation.targets.map(guest => ({ guest, status: 'pending' as const }))).map(row => {
              const StatusIcon = row.status === 'sent' ? CheckCircle2 : row.status === 'error' ? XCircle : row.status === 'skipped' ? MinusCircle : row.status === 'running' ? Loader2 : Circle
              return <li key={guestKey(row.guest)} className="flex items-start gap-3 py-3"><StatusIcon className={cn('mt-0.5 size-4 shrink-0', row.status === 'sent' ? 'text-success' : row.status === 'error' ? 'text-destructive' : 'text-faint', row.status === 'running' && 'animate-spin motion-reduce:animate-none')} /><div className="min-w-0 flex-1"><div className="break-words text-[13px] font-medium">{row.guest.name ?? row.guest.vmid}</div><div className="mt-0.5 text-[11px] text-muted">{row.guest.vmid} · {row.guest.node} · {row.guest.clusterName}</div>{'message' in row && row.message && <p className={cn('mt-1 break-words text-[12px]', row.status === 'error' ? 'text-destructive' : 'text-muted')}>{row.message}</p>}</div><span className="text-[11px] text-faint">{row.guest.status}</span></li>
            })}
          </ul>
          {busy && <p className="mt-3 text-[12px] text-muted">Keep this window open while requests are sent. Requests already sent cannot be cancelled.</p>}
          {error && <p role="alert" className="mt-3 text-[12px] text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter>{results ? <Button disabled={busy} onClick={() => setOpen(false)}>Done</Button> : <><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={busy || !eligible(operation.action, operation.targets)} onClick={run}>{labels[operation.action]} {eligible(operation.action, operation.targets)} guest{eligible(operation.action, operation.targets) === 1 ? '' : 's'}</Button></>}</DialogFooter>
      </DialogContent>}
    </Dialog>
  </>
}
