import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { GuestBootOrderDialog } from '@/components/GuestBootOrderDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Guest, GuestBootOrder as BootInventory } from '@/lib/api'
import { getAgent } from '@/lib/agent'
import { guestKey } from '@/lib/guest-workspace'
import { useGuestBootOrder } from '@/lib/queries'

export function GuestBootOrder({ guest, unavailable }: { guest: Guest; unavailable: boolean }) {
  const [inspected, setInspected] = useState(false)
  const inventory = useGuestBootOrder(guest, inspected && !unavailable)
  const [selected, setSelected] = useState<{ guest: Guest; inventory: BootInventory; agent: ReturnType<typeof getAgent> } | null>(null)
  useEffect(() => {
    const close = () => { setSelected(null); setInspected(false) }
    window.addEventListener('proxmiu-agent-change', close)
    return () => window.removeEventListener('proxmiu-agent-change', close)
  }, [])
  const targetChanged = !!selected && (guestKey(guest) !== guestKey(selected.guest) || guest.node !== selected.guest.node || selected.agent !== getAgent())
  const changed = targetChanged || guest.status !== 'stopped'
  if (guest.type !== 'qemu') return null
  return <Card role="region" aria-label="Boot device order">
    <CardHeader><CardTitle>Boot device order</CardTitle>{inspected && <Button size="sm" variant="ghost" disabled={unavailable || inventory.isFetching} onClick={() => inventory.refetch()}><RefreshCw className={inventory.isFetching ? 'animate-spin' : ''} />Refresh boot order</Button>}</CardHeader>
    <CardContent className="space-y-3 text-[12px]">
      <p className="text-muted">Reorder the same enabled devices for the VM’s next start. Keep the VM stopped while editing. Configured order does not prove that a device or operating system will boot.</p>
      {!inspected && <Button variant="outline" disabled={unavailable} onClick={() => setInspected(true)}>Inspect boot order</Button>}
      {inspected && inventory.isPending && <p role="status" className="text-muted">Reading boot configuration…</p>}
      {inspected && inventory.error && <p role="alert" className="text-destructive">{inventory.error.message} Refresh boot order before reviewing a change.</p>}
      {inspected && inventory.data && <>
        {inventory.data.reason && <p role="status" className="text-warning">{inventory.data.reason}</p>}
        {inventory.data.errors.map(error => <p key={error} className="text-warning">{error}</p>)}
        {inventory.data.order.length ? <ol aria-label="Enabled boot devices" className="space-y-2">{inventory.data.order.map((device, i) => <li key={device.id} className="min-w-0 space-y-1 rounded-md bg-inset p-3"><p className="font-mono font-medium">{i + 1}. {device.id} · {device.kind}</p><p className="break-all text-muted">{device.label}</p>{device.warning && <p className="break-words text-warning">{device.warning}</p>}</li>)}</ol> : <p className="text-muted">No explicit enabled boot order was reported.</p>}
        {!!inventory.data.excluded.length && <div className="space-y-1 text-muted"><p className="font-medium">Other configured devices (not selectable)</p>{inventory.data.excluded.map(entry => <p key={entry.id} className="break-words"><span className="font-mono">{entry.id}</span> · {entry.reason}</p>)}</div>}
        <Button variant="outline" disabled={unavailable || guest.status !== 'stopped' || inventory.isFetching || !!inventory.error || !inventory.data.ready || !inventory.data.sourceIdentity || inventory.data.order.length < 2} onClick={() => setSelected({ guest: { ...guest }, inventory: { ...inventory.data!, order: inventory.data!.order.map(d => ({ ...d })) }, agent: getAgent() })}>Edit boot order</Button>
        <p className="text-[11px] text-muted">Last inspected {new Date(inventory.dataUpdatedAt).toLocaleTimeString()}. Adding or disabling devices and legacy boot settings remain in Proxmox.</p>
      </>}
      {unavailable && <p className="text-warning">The connection is unavailable. Refresh the guest inventory before inspecting boot order.</p>}
    </CardContent>
    {selected && <GuestBootOrderDialog guest={selected.guest} initial={selected.inventory} unavailable={unavailable || changed} observationUnavailable={unavailable || targetChanged} onClose={() => setSelected(null)} />}
  </Card>
}
