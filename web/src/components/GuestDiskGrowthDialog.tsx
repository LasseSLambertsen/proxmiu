import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { GuestTaskLog } from '@/components/GuestTaskLog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/form'
import { getAgent } from '@/lib/agent'
import { ApiError, api, type DiskGrowthReview, type DiskGrowthTask, type Guest, type GuestDisk, type GuestDiskCapacity as Inventory } from '@/lib/api'
import { guestApiPath, guestKey } from '@/lib/guest-workspace'
import { diskCapacityKey, useGuestTask } from '@/lib/queries'
import { formatBytes } from '@/lib/utils'

const GiB = 1024 ** 3
const exactBytes = (bytes: number) => `${formatBytes(bytes)} (${bytes.toLocaleString('en-US')} bytes)`
export function GuestDiskGrowthDialog({ guest, disk: initialDisk, unavailable, onClose }: { guest: Guest; disk: GuestDisk; unavailable: boolean; onClose: () => void }) {
  const qc = useQueryClient(), path = guestApiPath(guest)
  const sourceAgent = useRef(getAgent())
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const sameAgent = () => mounted.current && sourceAgent.current === getAgent()
  const [disk, setDisk] = useState(initialDisk)
  const [target, setTarget] = useState(String(Math.floor((initialDisk.sizeBytes ?? 0) / GiB) + 1))
  const [plan, setPlan] = useState<DiskGrowthReview | null>(null)
  const [confirm, setConfirm] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [replaced, setReplaced] = useState(false)
  const [ready, setReady] = useState(true)
  const [reason, setReason] = useState<string>()
  const [task, setTask] = useState<DiskGrowthTask | null>(null)
  const [lastObserved, setLastObserved] = useState<{ inventory: Inventory; at: number } | null>(null)
  const [now, setNow] = useState(Date.now)
  const admission = useRef(false)
  const status = useGuestTask(guest, task)
  const current = useMutation({
    mutationFn: () => api.get<Inventory>(`${path}/disk-capacity`),
    onSuccess: inventory => {
      if (!sameAgent()) return
      qc.setQueryData(diskCapacityKey(guest), inventory)
      const fresh = inventory.disks.find(d => d.disk === initialDisk.disk)
      if (!fresh || fresh.volume !== initialDisk.volume) { setReplaced(true); setNeedsRefresh(true); return }
      setDisk(fresh); setReady(inventory.ready); setReason(inventory.reason); setNeedsRefresh(false)
    },
    onError: () => setNeedsRefresh(true),
  })
  const review = useMutation({
    mutationFn: () => api.post<DiskGrowthReview>(`${path}/disk-growth-review`, { disk: disk.disk, targetGiB: Number(target) }),
    onSuccess: value => {
      if (!sameAgent()) return
      if (value.disk !== initialDisk.disk || value.volume !== initialDisk.volume || value.storage !== initialDisk.storage || value.node !== guest.node || value.type !== guest.type || value.vmid !== guest.vmid || value.targetGiB !== Number(target)) {
        setReplaced(true); setNeedsRefresh(true); setPlan(null); setConfirm(''); return
      }
      setPlan(value); setConfirm(''); setConflict(null)
    },
    onError: () => setNeedsRefresh(true),
  })
  const execute = useMutation({
    mutationFn: (value: DiskGrowthReview) => api.post<DiskGrowthTask>(`${path}/disk-growth`, { reviewId: value.reviewId, confirm }),
    onSuccess: value => { if (sameAgent()) setTask(value) },
    onError: error => {
      if (error instanceof ApiError && error.status === 409) {
        setConflict(error.message); setNeedsRefresh(true); setPlan(null); setConfirm(''); setSubmitted(false); admission.current = false
      }
    },
  })
  // This is deliberately a new GET after the task, never a cached requested size.
  const observationVersion = useRef(0)
  const observed = useMutation({
    mutationFn: async () => {
      const version = ++observationVersion.current
      const inventory = await api.get<Inventory>(`${path}/disk-capacity`)
      return { inventory, version, at: Date.now() }
    },
    onSuccess: ({ inventory, version, at }) => {
      if (!sameAgent() || version !== observationVersion.current) return
      setLastObserved({ inventory, at })
      qc.setQueryData(diskCapacityKey(guest), inventory)
    },
  })
  const stopped = !status.error && status.data?.status === 'stopped'
  const exit = status.data?.exitstatus
  const observedFor = useRef('')
  useEffect(() => {
    if (!task || !stopped || !sameAgent()) return
    const key = `${task.upid}:${exit ?? ''}`
    if (observedFor.current === key) return
    observedFor.current = key
    // Resize may change native configuration even when the capacity read fails.
    for (const prefix of ['guest-insights', 'guest-resource-settings', 'guest-notes', 'guest-operations']) qc.invalidateQueries({ queryKey: [prefix, guestKey(guest)] })
    qc.invalidateQueries({ queryKey: ['overview'] })
    qc.invalidateQueries({ queryKey: ['native-task-status', guest.clusterId] })
    observed.mutate()
  }, [task, stopped, exit])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const busy = review.isPending || current.isPending || execute.isPending
  const valid = /^[1-9]\d*$/.test(target) && Number(target) <= 65536 && disk.sizeBytes !== null && Number(target) * GiB > disk.sizeBytes
  const expired = !!plan && now >= plan.expiresAt
  const outcome = status.error || !status.data ? 'Disk growth status unavailable' : status.data.status === 'running' ? 'Disk growth running' : !stopped ? 'Disk growth outcome unknown' : exit === 'OK' ? 'Disk growth task completed' : exit?.startsWith('WARNINGS') ? 'Disk growth completed with warnings' : !exit || exit === 'unexpected status' ? 'Disk growth outcome unknown' : 'Disk growth failed'
  const actual = lastObserved?.inventory.disks.find(d => d.disk === initialDisk.disk && d.volume === initialDisk.volume)
  const edit = () => { setPlan(null); setConfirm(''); review.reset() }

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent title="Grow disk" description={`${guest.name || guest.vmid} · ${guest.type === 'qemu' ? 'VM' : 'container'} ${guest.vmid} · ${guest.node}`} closeDisabled={busy} onEscapeKeyDown={e => { if (busy) e.preventDefault() }} onPointerDownOutside={e => { if (busy) e.preventDefault() }}>
      <DialogBody className="space-y-4 text-[13px]">
        <section aria-label="Selected disk" className="space-y-2 rounded-md bg-inset p-3">
          <p className="font-semibold">{initialDisk.disk} · {plan?.storage ?? disk.storage}</p>
          <p className="break-all font-mono text-[11px] text-muted">{initialDisk.volume}</p>
          <p>{plan ? 'Reviewed capacity' : 'Inspected capacity'}: <span className="tnum font-medium">{(plan?.currentBytes ?? disk.sizeBytes) === null ? 'Unverified' : exactBytes(plan?.currentBytes ?? disk.sizeBytes!)}</span></p>
          <p className="text-[12px] text-muted">Read from storage metadata. Configuration size hints and guest filesystem usage can differ.</p>
        </section>
        {!submitted && <>
          <div className="space-y-2 rounded-md bg-warning-soft p-3 text-warning">
            <p className="font-medium">Growth cannot be undone here.</p>
            <p className="text-[12px]">Keep the guest stopped until the task ends. State is checked before submission; another administrator can still start the guest.</p>
            <p className="text-[12px]">{guest.type === 'qemu' ? 'This grows the virtual disk. Expand the guest partition and filesystem separately using the guest operating system.' : (plan?.format ?? disk.format) === 'subvol' ? 'Proxmox adjusts the ZFS subvolume quota.' : 'For raw container volumes, Proxmox may check and repair the filesystem and then expand it. Volume growth can succeed even if the filesystem step fails.'}</p>
          </div>
          {!plan && <>
            <Field label="Target capacity (GiB)" help="Absolute final capacity, in whole GiB. Must be larger than the actual current disk; maximum 65,536 GiB."><Input aria-label="Target capacity (GiB)" type="number" min={Math.floor((disk.sizeBytes ?? 0) / GiB) + 1} max={65536} step={1} value={target} disabled={busy || unavailable || replaced} onChange={e => setTarget(e.target.value)} /></Field>
            <Button size="sm" variant="outline" disabled={busy || unavailable || replaced} onClick={() => { current.mutate(); review.reset() }}>Refresh current capacity</Button>
            {current.error && <p role="alert" className="text-destructive">{current.error.message}</p>}
            {review.error && <p role="alert" className="text-destructive">{review.error.message} Your target is kept.</p>}
            {conflict && <p role="alert" className="text-warning">{conflict} Your target is kept.</p>}
            {needsRefresh && !replaced && <p className="text-muted">Refresh current capacity, then review the retained target again.</p>}
            {reason && <p className="text-warning">{reason}</p>}
            {replaced && <p role="alert" className="text-warning">The selected disk volume changed or disappeared. Close this dialog and inspect the current disks before selecting another volume.</p>}
          </>}
          {plan && <>
            <section aria-label="Reviewed disk growth" className="space-y-2 rounded-md bg-inset p-3">
              <p className="break-words font-semibold">{plan.name} · {plan.type === 'qemu' ? 'VM' : 'container'} {plan.vmid} · {plan.node}</p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]"><dt>Target capacity</dt><dd className="tnum font-semibold">{plan.targetGiB.toLocaleString()} GiB</dd><dt>Requested increase</dt><dd className="tnum">{formatBytes(plan.deltaBytes)}</dd><dt>Available on storage</dt><dd className="tnum">{plan.availableBytes === null ? 'Unknown' : formatBytes(plan.availableBytes)}</dd></dl>
              <p className="text-[12px] text-muted">Available capacity is a point-in-time estimate, not a reservation. Other workloads and thin provisioning affect the space actually available.</p>
              {plan.shortfall && <p role="alert" className="text-warning">Reported available space is less than the requested increase. Inspect storage capacity before continuing.</p>}
            </section>
            <p className="text-[12px] text-muted">Review expires at {new Date(plan.expiresAt).toLocaleTimeString()}. Disk ownership, capacity, configuration and readiness are checked again on submission.</p>
            {expired ? <p role="alert" className="text-warning">This review expired. Edit the target and review again.</p> : <Field label={`Type ${plan.name} to confirm`}><Input aria-label={`Type ${plan.name} to confirm`} autoComplete="off" value={confirm} disabled={busy || unavailable} onChange={e => setConfirm(e.target.value)} /></Field>}
          </>}
        </>}
        {unavailable && <p role="alert" className="text-warning">The connection, guest location or stopped state changed. Refresh the guest before reviewing another change; this dialog keeps its original disk and node.</p>}
        {submitted && !task && <section role={execute.error ? 'alert' : 'status'} className="space-y-2 rounded-md bg-warning-soft p-3 text-warning"><p>{execute.error?.message ?? 'Submitting reviewed disk growth…'}</p>{execute.error && <p>Inspect Activity → Proxmox tasks on {guest.node} for guest {guest.vmid} and read actual capacity before another review. This request will not be retried automatically.</p>}</section>}
        {task && <section aria-label="Disk growth task" className="space-y-3">
          <div role="status" aria-live="polite" className="space-y-2 rounded-md bg-inset p-3">
            <p className="font-semibold">{outcome}</p>
            {stopped && exit && <p className="whitespace-pre-wrap break-words">{exit}</p>}
            {status.error && <p className="text-warning">{status.error.message} Completion is unconfirmed.</p>}
            <p className="text-[12px] text-muted">The disk may already have grown even if a later step failed or warned. Inspect its actual capacity and filesystem before another request.</p>
            <Button size="sm" variant="outline" disabled={status.isFetching} onClick={() => status.refetch()}>Refresh growth status</Button>
          </div>
          {(stopped || lastObserved || observed.error) && <section aria-label="Observed capacity" className="space-y-2 rounded-md bg-inset p-3">
            <p className="font-semibold">Observed capacity</p><p>Requested: {plan?.targetGiB.toLocaleString()} GiB</p>
            {observed.isPending && <p role="status">Reading actual capacity from storage…</p>}
            {lastObserved && <><p className="tnum">Last observed: {actual?.sizeBytes ? exactBytes(actual.sizeBytes) : 'The reviewed volume or its capacity could not be verified.'}</p><p className="text-[12px] text-muted">Read at {new Date(lastObserved.at).toLocaleTimeString()}.</p></>}
            {observed.error && <p role="alert" className="text-warning">{observed.error.message} Previously observed values are retained; current capacity is unconfirmed.</p>}
            <Button size="sm" variant="outline" disabled={observed.isPending} onClick={() => observed.mutate()}>Refresh observed capacity</Button>
          </section>}
          <GuestTaskLog clusterId={guest.clusterId} task={task} />
          <p className="text-[12px] text-muted">Closing does not cancel accepted work. After an agent restart, use Activity → Proxmox tasks on {task.node} for guest {task.vmid} to reopen retained results and logs.</p>
          <Link to="/activity" onClick={onClose} className="inline-block text-brand underline underline-offset-4">Open Activity</Link>
        </section>}
      </DialogBody>
      <DialogFooter className="flex-wrap">
        <Button variant="outline" disabled={busy} onClick={onClose}>{submitted ? 'Close' : 'Cancel'}</Button>
        {!submitted && !plan && <Button loading={review.isPending} disabled={busy || unavailable || !valid || !ready || !disk.canGrow || needsRefresh || replaced} onClick={() => review.mutate()}>Review disk growth</Button>}
        {!submitted && plan && <><Button variant="outline" disabled={busy} onClick={edit}>Edit target</Button><Button loading={execute.isPending} disabled={busy || unavailable || expired || confirm !== plan.name} onClick={() => { if (admission.current) return; admission.current = true; setSubmitted(true); execute.mutate(plan) }}>Grow disk</Button></>}
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
