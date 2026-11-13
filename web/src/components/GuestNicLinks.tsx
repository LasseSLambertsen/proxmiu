import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { GuestNicLinkDialog } from '@/components/GuestNicLinkDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Guest, GuestNicLink } from '@/lib/api'
import { getAgent } from '@/lib/agent'
import { guestKey } from '@/lib/guest-workspace'
import { useGuestNicLinks } from '@/lib/queries'

export function GuestNicLinks({ guest, unavailable }: { guest: Guest; unavailable: boolean }) {
  const [inspected, setInspected] = useState(false)
  const inventory = useGuestNicLinks(guest, inspected && !unavailable)
  const [selected, setSelected] = useState<{ guest: Guest; nic: GuestNicLink; agent: string } | null>(null)
  useEffect(() => {
    const close = () => { setSelected(null); setInspected(false) }
    window.addEventListener('proxmiu-agent-change', close)
    return () => window.removeEventListener('proxmiu-agent-change', close)
  }, [])
  const changed = !!selected && (guestKey(guest) !== guestKey(selected.guest) || guest.node !== selected.guest.node || guest.status !== 'stopped' || selected.agent !== (getAgent()?.url ?? ''))
  return <Card role="region" aria-label="Network link state">
    <CardHeader><CardTitle>Network link state</CardTitle>{inspected && <Button size="sm" variant="ghost" disabled={unavailable || inventory.isFetching} onClick={() => inventory.refetch()}><RefreshCw className={inventory.isFetching ? 'animate-spin' : ''} />Refresh network links</Button>}</CardHeader>
    <CardContent className="space-y-3 text-[12px]">
      <p className="text-muted">Review whether an existing NIC connects on the guest’s next start. This shows configured state, not live network reachability. Keep the guest stopped while editing.</p>
      {!inspected && <Button variant="outline" disabled={unavailable} onClick={() => setInspected(true)}>Inspect network links</Button>}
      {inspected && inventory.isPending && <p role="status" className="text-muted">Reading interface configuration…</p>}
      {inspected && inventory.error && <p role="alert" className="text-destructive">{inventory.error.message} Refresh network links before reviewing a change.</p>}
      {inspected && inventory.data && <>
        {inventory.data.reason && <p role="status" className="text-warning">{inventory.data.reason}</p>}
        {inventory.data.errors.map(error => <p key={error} className="text-warning">{error}</p>)}
        {inventory.data.interfaces.length ? <ul className="space-y-3">{inventory.data.interfaces.map(nic => <li key={nic.nic} className="space-y-2 rounded-md bg-inset p-3">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-mono font-medium">{nic.nic}{nic.ifname ? ` · ${nic.ifname}` : nic.model ? ` · ${nic.model}` : ''}</p><p className="mt-1 font-medium">{nic.linkDown === null ? 'Link state unverified' : nic.linkDown ? 'Disconnected on next start' : 'Connected on next start'}</p></div><Button size="sm" variant="outline" aria-label={`Edit ${nic.nic} link`} disabled={unavailable || guest.status !== 'stopped' || inventory.isFetching || !!inventory.error || !inventory.data.ready || !nic.canEdit} onClick={() => setSelected({ guest: { ...guest }, nic: { ...nic }, agent: getAgent()?.url ?? '' })}>Edit link state</Button></div>
          {nic.mac && <p className="break-all font-mono text-[11px] text-muted">{nic.mac} · {nic.bridge}{nic.tag === null ? ' · untagged' : ` · VLAN ${nic.tag}`}</p>}
          {nic.reason && <p className="text-muted">{nic.reason}</p>}
        </li>)}</ul> : <p className="text-muted">No supported NIC slots were reported.</p>}
        <p className="text-[11px] text-muted">Last inspected {new Date(inventory.dataUpdatedAt).toLocaleTimeString()}. Advanced device, bridge and VLAN edits remain in Proxmox.</p>
      </>}
      {unavailable && <p className="text-warning">The connection is unavailable. Refresh the guest inventory before inspecting interfaces.</p>}
    </CardContent>
    {selected && <GuestNicLinkDialog guest={selected.guest} nic={selected.nic} unavailable={unavailable || changed} onClose={() => setSelected(null)} />}
  </Card>
}
