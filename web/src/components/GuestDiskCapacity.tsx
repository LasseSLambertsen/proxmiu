import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { GuestDiskGrowthDialog } from '@/components/GuestDiskGrowthDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getAgent } from '@/lib/agent'
import type { Guest, GuestDisk } from '@/lib/api'
import { guestKey } from '@/lib/guest-workspace'
import { useGuestDiskCapacity } from '@/lib/queries'
import { formatBytes } from '@/lib/utils'

export function GuestDiskCapacity({ guest, unavailable }: { guest: Guest; unavailable: boolean }) {
  const [inspected, setInspected] = useState(false)
  const inventory = useGuestDiskCapacity(guest, inspected && !unavailable)
  const [selected, setSelected] = useState<{ guest: Guest; disk: GuestDisk; agent: string } | null>(null)
  useEffect(() => {
    const close = () => { setSelected(null); setInspected(false) }
    window.addEventListener('proxmiu-agent-change', close)
    return () => window.removeEventListener('proxmiu-agent-change', close)
  }, [])
  const changed = !!selected && (guestKey(guest) !== guestKey(selected.guest) || guest.node !== selected.guest.node || guest.status !== 'stopped' || selected.agent !== (getAgent()?.url ?? ''))
  return <Card role="region" aria-label="Disk capacity">
    <CardHeader><CardTitle>Disk capacity</CardTitle>{inspected && <Button size="sm" variant="ghost" disabled={unavailable || inventory.isFetching} onClick={() => inventory.refetch()}><RefreshCw className={inventory.isFetching ? 'animate-spin' : ''} />Refresh capacity</Button>}</CardHeader>
    <CardContent className="space-y-3 text-[12px]">
      <p className="text-muted">Inspect actual storage metadata before growing an ordinary disk. Keep the guest stopped; shrinking, moving and detaching disks are outside this editor.</p>
      {!inspected && <Button variant="outline" disabled={unavailable} onClick={() => setInspected(true)}>Inspect disk capacity</Button>}
      {inspected && inventory.isPending && <p role="status" className="text-muted">Reading disk ownership and capacity…</p>}
      {inspected && inventory.error && <p role="alert" className="break-words text-destructive">{inventory.error.message} Refresh capacity before reviewing a change.</p>}
      {inspected && inventory.data && <>
        {inventory.data.reason && <p role="status" className="text-warning">{inventory.data.reason}</p>}
        {inventory.data.errors.map(error => <p key={error} className="text-warning">{error}</p>)}
        {inventory.data.disks.length ? <ul className="space-y-3">{inventory.data.disks.map(disk => <li key={disk.disk} className="rounded-md bg-inset p-3">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-mono text-[12px] font-medium">{disk.disk}</p><p className="tnum mt-1 font-semibold">{disk.sizeBytes === null ? 'Capacity unverified' : formatBytes(disk.sizeBytes)}</p></div><Button size="sm" variant="outline" aria-label={`Grow ${disk.disk}`} disabled={unavailable || guest.status !== 'stopped' || inventory.isFetching || !!inventory.error || !inventory.data.ready || !disk.canGrow} onClick={() => setSelected({ guest: { ...guest }, disk: { ...disk }, agent: getAgent()?.url ?? '' })}>Grow disk</Button></div>
          {disk.volume && <p className="mt-2 break-all font-mono text-[11px] text-muted">{disk.volume}</p>}
          {disk.reason && <p className="mt-2 text-muted">{disk.reason}</p>}
        </li>)}</ul> : <p className="text-muted">No ordinary disk slots were reported.</p>}
        <p className="text-[11px] text-muted">Last inspected {new Date(inventory.dataUpdatedAt).toLocaleTimeString()}. Capacity comes from storage metadata, independently of configuration size hints.</p>
      </>}
      {unavailable && <p className="text-warning">This connection is unavailable. Refresh the guest inventory before inspecting disks.</p>}
    </CardContent>
    {selected && <GuestDiskGrowthDialog guest={selected.guest} disk={selected.disk} unavailable={unavailable || changed} onClose={() => setSelected(null)} />}
  </Card>
}
