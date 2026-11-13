import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/form'
import { getAgent } from '@/lib/agent'
import { ApiError, api, type BootDevice, type BootOrderReview, type BootOrderResult, type Guest, type GuestBootOrder } from '@/lib/api'
import { guestApiPath, guestKey } from '@/lib/guest-workspace'
import { bootOrderKey } from '@/lib/queries'

const sameOrder = (a: BootDevice[] | undefined, b: BootDevice[]) => Array.isArray(a) && a.length === b.length && a.every((device, i) => !!device && device.id === b[i].id && device.identity === b[i].identity && device.kind === b[i].kind && device.label === b[i].label)
function OrderList({ label, order }: { label: string; order: BootDevice[] }) {
  return <ol aria-label={label} className="space-y-2">{order.map((device, i) => <li key={device.id} data-device={device.id} className="min-w-0"><p className="font-mono font-medium">{i + 1}. {device.id} · {device.kind}</p><p className="break-all text-[12px] text-muted">{device.label}</p>{device.warning && <p className="break-words text-[12px] text-warning">{device.warning}</p>}</li>)}</ol>
}

export function GuestBootOrderDialog({ guest, initial, unavailable, observationUnavailable, onClose }: { guest: Guest; initial: GuestBootOrder; unavailable: boolean; observationUnavailable: boolean; onClose: () => void }) {
  const qc = useQueryClient(), path = guestApiPath(guest)
  const source = useRef(getAgent()), mounted = useRef(true), admission = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const sameAgent = () => mounted.current && source.current === getAgent()
  const requireSource = () => { if (!sameAgent()) throw new Error('The agent changed. Close and inspect boot order again.') }
  const [draft, setDraft] = useState(initial.order)
  const [plan, setPlan] = useState<BootOrderReview | null>(null)
  const [confirm, setConfirm] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [replaced, setReplaced] = useState(false)
  const [ready, setReady] = useState(initial.ready)
  const [reason, setReason] = useState(initial.reason)
  const [conflict, setConflict] = useState<string | null>(null)
  const [result, setResult] = useState<BootOrderResult | null>(null)
  const [lastObserved, setLastObserved] = useState<{ inventory: GuestBootOrder; at: number } | null>(null)
  const [now, setNow] = useState(Date.now)
  const [announcement, setAnnouncement] = useState('')
  const rowRefs = useRef(new Map<string, HTMLLIElement>())
  const current = useMutation({ mutationFn: async () => { requireSource(); return api.get<GuestBootOrder>(`${path}/boot-order`) }, onSuccess: inventory => {
    if (!sameAgent()) return
    qc.setQueryData(bootOrderKey(guest), inventory)
    if (inventory.sourceIdentity !== initial.sourceIdentity || inventory.name !== initial.name || !sameOrder(inventory.order, initial.order)) { setReplaced(true); setNeedsRefresh(true); return }
    setReady(inventory.ready); setReason(inventory.reason ?? inventory.errors.join(' ')); setNeedsRefresh(false)
  }, onError: () => { if (sameAgent()) setNeedsRefresh(true) } })
  const review = useMutation({ mutationFn: async (proposed: BootDevice[]) => {
    requireSource()
    return api.post<BootOrderReview>(`${path}/boot-order-review`, { sourceIdentity: initial.sourceIdentity, order: proposed.map(d => d.id) })
  }, onSuccess: (value, proposed) => {
    if (!sameAgent()) return
    if (value.sourceIdentity !== initial.sourceIdentity || value.name !== initial.name || value.node !== guest.node || value.type !== 'qemu' || value.vmid !== guest.vmid || !sameOrder(value.currentOrder, initial.order) || !sameOrder(value.proposedOrder, proposed) || !value.reviewId || !Number.isFinite(value.expiresAt)) { setReplaced(true); setNeedsRefresh(true); return }
    setPlan(value); setConfirm(''); setConflict(null); setNow(Date.now())
  }, onError: () => { if (sameAgent()) setNeedsRefresh(true) } })
  const execute = useMutation({ mutationFn: async ({ value, confirmation }: { value: BootOrderReview; confirmation: string }) => {
    requireSource()
    const response = await api.post<BootOrderResult>(`${path}/boot-order`, { reviewId: value.reviewId, confirm: confirmation })
    if (response.verified !== true || response.name !== value.name || response.node !== guest.node || response.type !== 'qemu' || response.vmid !== guest.vmid || typeof response.sourceIdentity !== 'string' || !response.sourceIdentity || !Number.isFinite(response.observedAt) || !sameOrder(response.order, value.proposedOrder)) throw new ApiError('Boot order verification is unconfirmed. Inspect current configuration and pending changes.', 502)
    return response
  }, onSuccess: value => { if (sameAgent()) { setResult(value); setLastObserved({ inventory: { ...initial, sourceIdentity: value.sourceIdentity, order: value.order }, at: value.observedAt }) } }, onError: error => {
    if (!sameAgent()) return
    if (error instanceof ApiError && error.status === 409) { setConflict(error.message); setNeedsRefresh(true); setPlan(null); setConfirm(''); setSubmitted(false); admission.current = false }
  }, onSettled: (_value, error) => {
    if (!sameAgent() || error instanceof ApiError && error.status === 409) return
    // Refresh adjacent configuration even when a later deliberate observation fails.
    for (const prefix of ['guest-insights', 'guest-resource-settings', 'guest-notes', 'guest-operations']) qc.invalidateQueries({ queryKey: [prefix, guestKey(guest)] })
    qc.invalidateQueries({ queryKey: ['overview'] }); qc.invalidateQueries({ queryKey: bootOrderKey(guest) })
  } })
  const observationVersion = useRef(0)
  const observed = useMutation({ mutationFn: async () => {
    requireSource()
    const version = ++observationVersion.current, inventory = await api.get<GuestBootOrder>(`${path}/boot-order`)
    return { inventory, version, at: Date.now() }
  }, onSuccess: ({ inventory, version, at }) => {
    if (!sameAgent() || version !== observationVersion.current) return
    qc.setQueryData(bootOrderKey(guest), inventory)
    setLastObserved({ inventory, at })
  } })
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  const busy = current.isPending || review.isPending || execute.isPending
  const expired = !!plan && now >= plan.expiresAt
  const move = (id: string, delta: number) => {
    if (busy || unavailable || replaced || submitted || plan) return
    const index = draft.findIndex(device => device.id === id), nextIndex = index + delta
    if (index < 0 || nextIndex < 0 || nextIndex >= draft.length) return
    const next = [...draft]; [next[index], next[nextIndex]] = [next[nextIndex], next[index]]
    setDraft(next); setAnnouncement(`${id} moved to position ${nextIndex + 1} of ${next.length}`)
    window.requestAnimationFrame(() => {
      if (!sameAgent()) return
      const row = rowRefs.current.get(id)
      const preferred = row?.querySelector<HTMLButtonElement>(`button[data-direction="${delta < 0 ? 'up' : 'down'}"]:not(:disabled)`)
      ;(preferred ?? row?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus()
    })
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent title="Edit boot device order" description={<span className="break-all">{initial.name} · VM {guest.vmid} · {guest.node}</span>} closeDisabled={busy} onEscapeKeyDown={event => { if (busy) event.preventDefault() }} onPointerDownOutside={event => { if (busy) event.preventDefault() }}>
      <DialogBody className="space-y-4 text-[13px]">
        {!submitted && <>
          <div className="space-y-2 rounded-md bg-warning-soft p-3 text-warning"><p className="font-medium">Review what happens on the next VM start.</p><p className="text-[12px]">A different order may enter another OS or installer, or fail to boot. Media and PXE availability, bootloaders and successful OS startup are not verified.</p><p className="text-[12px]">Keep the VM stopped until saving finishes. Another administrator can still start it. Saving does not change power, device membership or firmware.</p></div>
          {!plan && <>
            <p className="text-[12px] text-muted">Move existing enabled devices up or down. Every enabled device stays in the order.</p>
            <ol aria-label="Draft boot order" className="space-y-2">{draft.map((device, i) => <li key={device.id} data-device={device.id} ref={element => { if (element) rowRefs.current.set(device.id, element); else rowRefs.current.delete(device.id) }} className="min-w-0 space-y-2 rounded-md bg-inset p-3">
              <div className="flex items-center justify-between gap-2"><p className="min-w-0 font-mono font-medium">{i + 1}. {device.id}</p><div className="flex shrink-0 gap-1"><Button size="sm" variant="outline" data-direction="up" aria-label={`Move ${device.id} up`} disabled={busy || unavailable || replaced || i === 0} onClick={() => move(device.id, -1)}><ArrowUp /></Button><Button size="sm" variant="outline" data-direction="down" aria-label={`Move ${device.id} down`} disabled={busy || unavailable || replaced || i === draft.length - 1} onClick={() => move(device.id, 1)}><ArrowDown /></Button></div></div><p className="break-all text-[12px] text-muted">{device.kind} · {device.label}</p>{device.warning && <p className="break-words text-[12px] text-warning">{device.warning}</p>}
            </li>)}</ol>
            <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
            <Button size="sm" variant="outline" disabled={busy || unavailable || replaced} onClick={() => { current.mutate(); review.reset() }}>Refresh current boot order</Button>
            {current.error && <p role="alert" className="text-destructive">{current.error.message}</p>}
            {review.error && <p role="alert" className="text-destructive">{review.error.message} Your draft is kept.</p>}
            {conflict && <p role="alert" className="text-warning">{conflict} Your draft is kept.</p>}
            {needsRefresh && !replaced && <p className="text-muted">Refresh current boot order, then review the retained draft again.</p>}
            {reason && <p className="text-warning">{reason}</p>}
            {replaced && <p role="alert" className="text-warning">The original boot configuration no longer matches this review. Close the dialog and inspect the current devices before selecting again.</p>}
          </>}
          {plan && <>
            <section aria-label="Reviewed boot change" className="space-y-4 rounded-md bg-inset p-3"><p className="break-all font-semibold">{plan.name} · VM {plan.vmid} · {plan.node}</p><div className="space-y-2"><h3 className="font-semibold">Before</h3><OrderList label="Current boot order" order={plan.currentOrder} /></div><div className="space-y-2"><h3 className="font-semibold">Proposed</h3><OrderList label="Proposed boot order" order={plan.proposedOrder} /></div></section>
            <p className="text-[12px] text-muted">Review expires at {new Date(plan.expiresAt).toLocaleTimeString()}. The agent checks the fixed device identities and stopped VM again before saving.</p>
            {expired ? <p role="alert" className="text-warning">This review expired. Edit the boot order and review again.</p> : <Field className="break-all" label={`Type ${plan.name} to confirm`}><Input aria-label={`Type ${plan.name} to confirm`} autoComplete="off" value={confirm} disabled={busy || unavailable} onChange={event => setConfirm(event.target.value)} /></Field>}
          </>}
        </>}
        {unavailable && <p role="alert" className="text-warning">The connection, VM location or stopped state changed. This dialog keeps its original devices and node; refresh the VM before another review.</p>}
        {submitted && !result && <section role={execute.error ? 'alert' : 'status'} className="space-y-2 rounded-md bg-warning-soft p-3 text-warning"><p>{execute.error?.message ?? 'Submitting and verifying boot order…'}</p>{execute.error && <p>The change may already have applied. Inspect current configuration and pending changes before another review. This request will not be retried or rolled back automatically.</p>}</section>}
        {result && <div role="status" className="space-y-2 rounded-md bg-inset p-3"><p className="font-semibold">Boot order saved and verified</p><p className="text-[12px] text-muted">Verified at {new Date(result.observedAt).toLocaleTimeString()}. This verifies configured order, not successful startup.</p><OrderList label="Verified boot order" order={result.order} /></div>}
        {submitted && !execute.isPending && <section aria-label="Observed boot order" className="space-y-2 rounded-md bg-inset p-3"><p className="font-semibold">Observed boot order</p>{observed.isPending && <p role="status">Reading current boot configuration…</p>}{lastObserved && <><OrderList label="Last observed boot order" order={lastObserved.inventory.order} /><p className="text-[12px] text-muted">Read at {new Date(lastObserved.at).toLocaleTimeString()}.</p>{lastObserved.inventory.reason && <p className="text-warning">{lastObserved.inventory.reason}</p>}{lastObserved.inventory.errors.map(error => <p key={error} className="text-warning">{error}</p>)}</>}{observed.error && <p role="alert" className="text-warning">{observed.error.message} The last successful observation is retained; current state is unconfirmed.</p>}<Button size="sm" variant="outline" disabled={observed.isPending || observationUnavailable} onClick={() => observed.mutate()}>Refresh observed boot order</Button></section>}
        {submitted && <p className="text-[12px] text-muted">This configuration update has no native task log. After closing or an agent restart, inspect the current order and pending changes again. Closing does not undo a submitted change.</p>}
      </DialogBody>
      <DialogFooter className="flex-wrap"><Button variant="outline" disabled={busy} onClick={onClose}>{submitted ? 'Close' : 'Cancel'}</Button>{!submitted && !plan && <Button loading={review.isPending} disabled={busy || unavailable || needsRefresh || replaced || !ready || sameOrder(draft, initial.order)} onClick={() => review.mutate([...draft])}>Review boot order</Button>}{!submitted && plan && <><Button variant="outline" disabled={busy} onClick={() => { setPlan(null); setConfirm(''); review.reset() }}>Edit boot order</Button><Button loading={execute.isPending} disabled={busy || unavailable || expired || confirm !== plan.name} onClick={() => { if (admission.current || Date.now() >= plan.expiresAt || !sameAgent()) return; admission.current = true; setSubmitted(true); execute.mutate({ value: plan, confirmation: confirm }) }}>Save boot order</Button></>}</DialogFooter>
    </DialogContent>
  </Dialog>
}
