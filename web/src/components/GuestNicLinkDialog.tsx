import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/form'
import { getAgent } from '@/lib/agent'
import { ApiError, api, type Guest, type GuestNicLink, type GuestNicLinks, type NicLinkReview, type NicLinkResult } from '@/lib/api'
import { guestApiPath, guestKey } from '@/lib/guest-workspace'
import { nicLinksKey } from '@/lib/queries'

type Identity = Pick<GuestNicLink, 'nic' | 'mac' | 'bridge' | 'tag' | 'model' | 'ifname'>
const sameNic = (a: Identity | undefined, b: Identity) => !!a && a.nic === b.nic && typeof a.mac === 'string' && typeof b.mac === 'string' && a.mac.toUpperCase() === b.mac.toUpperCase() && a.bridge === b.bridge && a.tag === b.tag && a.model === b.model && a.ifname === b.ifname
const stateLabel = (down: boolean | null) => down === null ? 'Unverified' : down ? 'Disconnected on next start' : 'Connected on next start'
export function GuestNicLinkDialog({ guest, nic: initial, unavailable, onClose }: { guest: Guest; nic: GuestNicLink; unavailable: boolean; onClose: () => void }) {
  const qc = useQueryClient(), path = guestApiPath(guest)
  const source = useRef(getAgent()), mounted = useRef(true), admission = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const sameAgent = () => mounted.current && source.current === getAgent()
  const [nic, setNic] = useState(initial)
  const [linkDown, setLinkDown] = useState(initial.linkDown ?? false)
  const [plan, setPlan] = useState<NicLinkReview | null>(null)
  const [confirm, setConfirm] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [replaced, setReplaced] = useState(false)
  const [reason, setReason] = useState<string>()
  const [ready, setReady] = useState(true)
  const [conflict, setConflict] = useState<string | null>(null)
  const [result, setResult] = useState<NicLinkResult | null>(null)
  const [lastObserved, setLastObserved] = useState<{ entry: GuestNicLink | null; at: number; reason?: string } | null>(null)
  const [now, setNow] = useState(Date.now)
  const current = useMutation({ mutationFn: () => api.get<GuestNicLinks>(`${path}/nic-links`), onSuccess: inventory => {
    if (!sameAgent()) return
    qc.setQueryData(nicLinksKey(guest), inventory)
    const fresh = inventory.interfaces.find(n => n.nic === initial.nic)
    if (!sameNic(fresh, initial)) { setReplaced(true); setNeedsRefresh(true); return }
    setNic(fresh!); setReady(inventory.ready); setReason(inventory.reason); setNeedsRefresh(false)
  }, onError: () => setNeedsRefresh(true) })
  const review = useMutation({ mutationFn: () => api.post<NicLinkReview>(`${path}/nic-link-review`, { nic: initial.nic, linkDown }), onSuccess: value => {
    if (!sameAgent()) return
    if (!sameNic(value, initial) || value.node !== guest.node || value.type !== guest.type || value.vmid !== guest.vmid || value.linkDown !== linkDown || value.currentLinkDown !== nic.linkDown) { setReplaced(true); setNeedsRefresh(true); return }
    setPlan(value); setConfirm(''); setConflict(null)
  }, onError: () => setNeedsRefresh(true) })
  const execute = useMutation({
    mutationFn: async (value: NicLinkReview) => {
      const response = await api.post<NicLinkResult>(`${path}/nic-link`, { reviewId: value.reviewId, confirm })
      if (response.verified !== true || !sameNic(response.interface, initial) || response.interface.linkDown !== value.linkDown || response.node !== guest.node || response.type !== guest.type || response.vmid !== guest.vmid) throw new ApiError('Link change verification is unconfirmed. Inspect current NIC configuration and pending changes.', 502)
      return response
    },
    onSuccess: value => { if (sameAgent()) { setResult(value); setLastObserved({ entry: value.interface, at: value.observedAt }) } },
    onError: error => {
      if (!sameAgent()) return
      if (error instanceof ApiError && error.status === 409) { setConflict(error.message); setNeedsRefresh(true); setPlan(null); setConfirm(''); setSubmitted(false); admission.current = false }
    },
    onSettled: (_value, error) => {
      if (!sameAgent() || error instanceof ApiError && error.status === 409) return
      for (const prefix of ['guest-insights', 'guest-resource-settings', 'guest-notes', 'guest-operations']) qc.invalidateQueries({ queryKey: [prefix, guestKey(guest)] })
      qc.invalidateQueries({ queryKey: ['overview'] }); qc.invalidateQueries({ queryKey: nicLinksKey(guest) })
    },
  })
  const observationVersion = useRef(0)
  const observed = useMutation({ mutationFn: async () => {
    const version = ++observationVersion.current, inventory = await api.get<GuestNicLinks>(`${path}/nic-links`)
    return { inventory, version, at: Date.now() }
  }, onSuccess: ({ inventory, version, at }) => {
    if (!sameAgent() || version !== observationVersion.current) return
    qc.setQueryData(nicLinksKey(guest), inventory)
    const entry = inventory.interfaces.find(n => n.nic === initial.nic)
    setLastObserved({ entry: sameNic(entry, initial) ? entry! : null, at, reason: inventory.reason })
  } })
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  const busy = current.isPending || review.isPending || execute.isPending
  const expired = !!plan && now >= plan.expiresAt
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent title="Edit network link state" description={<span className="break-all">{guest.name || guest.vmid} · {guest.type === 'qemu' ? 'VM' : 'container'} {guest.vmid} · {guest.node}</span>} closeDisabled={busy} onEscapeKeyDown={event => { if (busy) event.preventDefault() }} onPointerDownOutside={event => { if (busy) event.preventDefault() }}>
      <DialogBody className="space-y-4 text-[13px]">
        <section aria-label="Selected interface" className="space-y-2 rounded-md bg-inset p-3"><p className="font-semibold">{initial.nic} · {initial.ifname ?? initial.model}</p><p className="break-all font-mono text-[12px]">{initial.mac}</p><p className="break-words text-muted">{initial.bridge} · {initial.tag === null ? 'Untagged' : `VLAN ${initial.tag}`}</p><p>{plan ? 'Reviewed state' : 'Inspected state'}: {stateLabel(plan?.currentLinkDown ?? nic.linkDown)}</p></section>
        {!submitted && <>
          <div className="space-y-2 rounded-md bg-warning-soft p-3 text-warning"><p className="font-medium">Review traffic on the next guest start.</p><p className="text-[12px]">A disconnected device will not carry guest traffic. Remote services may become unreachable. Existing addressing and network policies continue to apply.</p><p className="text-[12px]">Keep the guest stopped until the update finishes. Another administrator can still start it; Proxmiu does not change its power state.</p></div>
          {!plan && <>
            <Field label="Configured connection" help="Choose how this existing device connects on the next start. This does not test end-to-end network reachability."><Select aria-label="Configured connection" value={linkDown ? 'disconnected' : 'connected'} disabled={busy || unavailable || replaced} onChange={event => setLinkDown(event.target.value === 'disconnected')}><option value="connected">Connected on next start</option><option value="disconnected">Disconnected on next start</option></Select></Field>
            <Button size="sm" variant="outline" disabled={busy || unavailable || replaced} onClick={() => { current.mutate(); review.reset() }}>Refresh current interface</Button>
            {current.error && <p role="alert" className="text-destructive">{current.error.message}</p>}
            {review.error && <p role="alert" className="text-destructive">{review.error.message} Your draft is kept.</p>}
            {conflict && <p role="alert" className="text-warning">{conflict} Your draft is kept.</p>}
            {needsRefresh && !replaced && <p className="text-muted">Refresh current interface, then review the retained choice again.</p>}
            {reason && <p className="text-warning">{reason}</p>}
            {replaced && <p role="alert" className="text-warning">The original NIC identity no longer matches this review. Close the dialog and inspect the current interfaces before selecting again.</p>}
          </>}
          {plan && <>
            <section aria-label="Reviewed link change" className="space-y-3 rounded-md bg-inset p-3"><p className="break-words font-semibold">{plan.name} · {plan.type === 'qemu' ? 'VM' : 'container'} {plan.vmid} · {plan.node}</p><dl className="grid grid-cols-2 gap-3 text-[12px]"><dt>Before</dt><dd>{stateLabel(plan.currentLinkDown)}</dd><dt>Proposed</dt><dd className="font-semibold">{stateLabel(plan.linkDown)}</dd></dl></section>
            <p className="text-[12px] text-muted">Review expires at {new Date(plan.expiresAt).toLocaleTimeString()}. The agent checks this NIC and guest readiness again before submitting.</p>
            {expired ? <p role="alert" className="text-warning">This review expired. Edit the link state and review again.</p> : <Field className="break-all" label={`Type ${plan.name} to confirm`}><Input aria-label={`Type ${plan.name} to confirm`} autoComplete="off" value={confirm} disabled={busy || unavailable} onChange={event => setConfirm(event.target.value)} /></Field>}
          </>}
        </>}
        {unavailable && <p role="alert" className="text-warning">The connection, guest location or stopped state changed. This dialog keeps its original interface and node; refresh the guest before another review.</p>}
        {submitted && !result && <section role={execute.error ? 'alert' : 'status'} className="space-y-2 rounded-md bg-warning-soft p-3 text-warning"><p>{execute.error?.message ?? 'Submitting and verifying link state…'}</p>{execute.error && <p>The change may already have applied. Inspect current interface configuration and pending changes before another review. This request will not be retried or rolled back automatically.</p>}</section>}
        {result && <div role="status" className="space-y-2 rounded-md bg-inset p-3"><p className="font-semibold">Link state saved and verified</p><p className="text-[12px] text-muted">Verified at {new Date(result.observedAt).toLocaleTimeString()}. This records configuration, not live network reachability.</p></div>}
        {submitted && !execute.isPending && <section aria-label="Observed interface" className="space-y-2 rounded-md bg-inset p-3"><p className="font-semibold">Observed interface</p>{observed.isPending && <p role="status">Reading current interface configuration…</p>}{lastObserved && <><p>{lastObserved.entry ? `Last observed: ${stateLabel(lastObserved.entry.linkDown)}` : 'The reviewed NIC identity could not be verified in the current configuration.'}</p><p className="text-[12px] text-muted">Read at {new Date(lastObserved.at).toLocaleTimeString()}.</p>{lastObserved.reason && <p className="text-warning">{lastObserved.reason}</p>}</>}{observed.error && <p role="alert" className="text-warning">{observed.error.message} The last successful observation is retained; current state is unconfirmed.</p>}<Button size="sm" variant="outline" disabled={observed.isPending} onClick={() => observed.mutate()}>Refresh observed interface</Button></section>}
        {submitted && <p className="text-[12px] text-muted">This configuration update has no native task log. After closing or an agent restart, inspect the current interface and pending changes again. Closing does not undo a submitted change.</p>}
      </DialogBody>
      <DialogFooter className="flex-wrap"><Button variant="outline" disabled={busy} onClick={onClose}>{submitted ? 'Close' : 'Cancel'}</Button>{!submitted && !plan && <Button loading={review.isPending} disabled={busy || unavailable || needsRefresh || replaced || !ready || !nic.canEdit || nic.linkDown === linkDown} onClick={() => review.mutate()}>Review link state</Button>}{!submitted && plan && <><Button variant="outline" disabled={busy} onClick={() => { setPlan(null); setConfirm(''); review.reset() }}>Edit link state</Button><Button loading={execute.isPending} disabled={busy || unavailable || expired || confirm !== plan.name} onClick={() => { if (admission.current) return; admission.current = true; setSubmitted(true); execute.mutate(plan) }}>Save link state</Button></>}</DialogFooter>
    </DialogContent>
  </Dialog>
}
