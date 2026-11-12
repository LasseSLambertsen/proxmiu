import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { GuestTaskLog } from '@/components/GuestTaskLog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/form'
import { api, type Guest, type GuestBackups, type RestoreOptions, type RestoreReview, type RestoreTask } from '@/lib/api'
import { guestApiPath, guestHref } from '@/lib/guest-workspace'
import { useGuestTask } from '@/lib/queries'
import { formatBytes } from '@/lib/utils'

type Backup = GuestBackups['backups'][number]
export function GuestRestoreDialog({ guest, backup, unavailable, onClose }: { guest: Guest; backup: Backup; unavailable: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const path = guestApiPath(guest)
  const options = useQuery({ queryKey: ['restore-options', path], queryFn: () => api.get<RestoreOptions>(`${path}/restore-options`), enabled: !unavailable, retry: false, refetchOnWindowFocus: false })
  const [vmid, setVmid] = useState('')
  const [storage, setStorage] = useState('')
  const [plan, setPlan] = useState<RestoreReview | null>(null)
  const [confirm, setConfirm] = useState('')
  const [task, setTask] = useState<RestoreTask | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [now, setNow] = useState(Date.now)
  const status = useGuestTask(guest, task)
  const selectedStorage = storage || options.data?.storages[0] || ''
  const review = useMutation({
    mutationFn: () => api.post<RestoreReview>(`${path}/restore-review`, { sourceStorage: backup.storage, archive: backup.volid, vmid: Number(vmid), storage: selectedStorage }),
    onSuccess: value => { setPlan(value); setConfirm('') },
  })
  const execute = useMutation({
    mutationFn: (value: RestoreReview) => api.post<RestoreTask>(`${path}/restore`, { reviewId: value.reviewId, confirm }),
    onSuccess: value => { setTask(value); qc.invalidateQueries({ queryKey: ['overview'] }) },
  })
  useEffect(() => { if (options.data && !vmid) setVmid(String(options.data.suggestedVmid)) }, [options.data, vmid])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (status.data?.status === 'stopped') qc.invalidateQueries({ queryKey: ['overview'] })
  }, [status.data?.status, qc])

  const stopped = status.data?.status === 'stopped'
  const exit = status.data?.exitstatus
  const outcome = !status.data || status.error ? 'Restore status unavailable' : !stopped ? 'Restore running' : exit === 'OK' ? 'Restore task completed' : exit?.startsWith('WARNINGS') ? 'Restore completed with warnings' : !exit || exit === 'unexpected status' ? 'Restore outcome unknown' : 'Restore failed'
  const valid = /^[1-9]\d{2,8}$/.test(vmid) && Number(vmid) !== guest.vmid && !!selectedStorage
  const expired = !!plan && now >= plan.expiresAt
  const busy = review.isPending || execute.isPending
  const source = plan ?? { ...backup, archive: backup.volid }

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent title="Restore into a new guest" description={`Backup of ${guest.name || guest.vmid} · ${guest.node}`} closeDisabled={busy} onEscapeKeyDown={event => { if (busy) event.preventDefault() }} onPointerDownOutside={event => { if (busy) event.preventDefault() }}>
      <DialogBody className="space-y-4 text-[13px]">
        <section aria-label="Restore source" className="space-y-2 rounded-md bg-inset p-3">
          <p className="font-medium">Source backup</p>
          <p className="break-all font-mono text-[11px] leading-relaxed">{source.archive}</p>
          <p className="text-[12px] text-muted">{source.ctime === undefined ? 'Date unavailable' : new Date(source.ctime * 1000).toLocaleString()} · {source.size === undefined ? 'Archive size unavailable' : formatBytes(source.size) + ' archive'}</p>
          <p className="text-[12px] text-muted">Archive size is not the restored disk allocation. Confirm sufficient space on the destination.</p>
        </section>
        {!plan && !submitted && <>
          <p className="text-muted">Choose a new ID and disk storage on {guest.node}. Proxmox will create a separate guest; this source guest stays in place.</p>
          {options.isPending && <p role="status">Loading restore destinations…</p>}
          {options.error && <div role="alert" className="space-y-2 text-destructive"><p>{options.error.message}</p><Button variant="outline" disabled={unavailable || options.isFetching} onClick={() => options.refetch()}>Refresh destinations</Button></div>}
          {options.data && <div className="grid gap-4 sm:grid-cols-2">
            <Field label="New guest ID" help="An unused cluster-wide ID, 100–999999999."><Input aria-label="New guest ID" type="number" min={100} max={999999999} value={vmid} disabled={busy || unavailable} onChange={event => setVmid(event.target.value)} /></Field>
            <Field label="Destination storage" help={guest.type === 'qemu' ? 'Storage for VM disks.' : 'Storage for the container root disk.'}><Select aria-label="Destination storage" value={selectedStorage} disabled={busy || unavailable || !options.data.storages.length} onChange={event => setStorage(event.target.value)}>{options.data.storages.length ? options.data.storages.map(s => <option key={s}>{s}</option>) : <option value="">No eligible storage</option>}</Select></Field>
          </div>}
          {review.error && <p role="alert" className="break-words text-destructive">{review.error.message}</p>}
        </>}
        {plan && <>
          <section aria-label="Restore destination" className="space-y-2 rounded-md bg-inset p-3">
            <p className="font-semibold">New {plan.type === 'qemu' ? 'VM' : 'container'} {plan.vmid} · {plan.node}</p>
            <p className="break-words text-muted">Disk storage: {plan.storage}</p>
            <p>Requested state: stopped. Start at boot: off.</p>
            <p className="text-[12px] text-muted">Source guest {guest.vmid} is retained. Existing guests cannot be overwritten here.</p>
          </section>
          {!submitted && <div className="space-y-2 rounded-md bg-warning-soft p-3 text-warning">
            <p className="font-medium">Check the restored identity before starting</p>
            <p>Network MAC addresses will change. Static IP addresses, hostnames, OS machine IDs and application credentials can remain the same. Inspect these in the restored guest before putting it on your network.</p>
          </div>}
          {!submitted && <>
            <p className="text-[12px] text-muted">Review expires at {new Date(plan.expiresAt).toLocaleTimeString()}. The agent checks the backup, storage and ID again before submitting.</p>
            {expired ? <p role="alert" className="text-warning">This review expired. Edit the destination and review again.</p> : <Field label={`Type ${plan.vmid} to confirm`}><Input aria-label={`Type ${plan.vmid} to confirm`} autoComplete="off" inputMode="numeric" value={confirm} disabled={busy || unavailable} onChange={event => setConfirm(event.target.value)} /></Field>}
          </>}
        </>}
        {unavailable && <p role="alert" className="text-warning">The source is unavailable or moved. Refresh the guest before reviewing another restore.</p>}
        {submitted && !task && <div role={execute.error ? 'alert' : 'status'} className="space-y-2 rounded-md bg-warning-soft p-3 text-warning">
          <p>{execute.error?.message ?? 'Submitting the reviewed restore…'}</p>
          {execute.error && <p>Inspect Activity → Proxmox tasks on {guest.node} and the new guest ID before attempting another restore. The request will not be retried automatically.</p>}
        </div>}
        {task && <section aria-label="Restore task" className="space-y-3">
          <div role="status" aria-live="polite" className="space-y-2 rounded-md bg-inset p-3">
            <p className="font-semibold">{outcome}</p>
            {stopped && exit && <p className="whitespace-pre-wrap break-words">{exit}</p>}
            {status.error && <p role="alert" className="text-warning">{status.error.message} Completion is unconfirmed.</p>}
            <p className="text-[12px] text-muted">Verify the new guest’s configuration and current state before starting it. Keep failed or partial restores for inspection; do not replay the request or delete them automatically.</p>
            <Button size="sm" variant="outline" disabled={status.isFetching} onClick={() => status.refetch()}>Refresh restore status</Button>
          </div>
          <GuestTaskLog clusterId={guest.clusterId} task={task} />
          <p className="text-[12px] text-muted">After closing or an agent restart, use Activity → Proxmox tasks on {task.node} for guest {task.vmid} to reopen the retained result and logs.</p>
          {stopped && <Link className="inline-block text-brand underline underline-offset-4" to={guestHref({ ...guest, ...task })} onClick={onClose}>Inspect guest {task.vmid}</Link>}
        </section>}
      </DialogBody>
      <DialogFooter className="flex-wrap">
        <Button variant="outline" disabled={busy} onClick={onClose}>{submitted ? 'Close' : 'Cancel'}</Button>
        {!submitted && !plan && <Button disabled={!valid || !options.data || !!options.error || unavailable} loading={review.isPending} onClick={() => review.mutate()}>Review restore</Button>}
        {!submitted && plan && <>
          <Button variant="outline" disabled={busy} onClick={() => { setPlan(null); setConfirm(''); review.reset() }}>Edit destination</Button>
          <Button disabled={unavailable || expired || confirm !== String(plan.vmid)} loading={execute.isPending} onClick={() => { setSubmitted(true); execute.mutate(plan) }}>Restore new guest</Button>
        </>}
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
