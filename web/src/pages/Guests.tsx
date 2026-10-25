import { Plus, Search, Server } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { EmptyState } from '@/components/EmptyState'
import { GuestTable } from '@/components/GuestTable'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/form'
import { useGuestIps, useGuests } from '@/lib/queries'
import { cn } from '@/lib/utils'

type Filter = 'all' | 'running' | 'stopped' | 'lxc' | 'qemu'
const filters: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'stopped', label: 'Stopped' },
  { id: 'lxc', label: 'Containers' },
  { id: 'qemu', label: 'VMs' },
]

export function Guests() {
  const { guests, data, isLoading } = useGuests()
  const clusterIds = data?.clusters.filter((c) => c.ok).map((c) => c.id) ?? []
  const ips = useGuestIps(clusterIds)
  const [params] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [filter, setFilter] = useState<Filter>('all')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return guests
      .filter((g) => !g.template)
      .filter((g) =>
        filter === 'all' ? true : filter === 'running' ? g.status === 'running' : filter === 'stopped' ? g.status !== 'running' : g.type === filter,
      )
      .filter((g) => {
        if (!q) return true
        const ip = ips.data?.[g.clusterId]?.[`${g.type}/${g.vmid}`] ?? ''
        return [g.name, String(g.vmid), g.node, g.tags, ip].some((v) => v?.toLowerCase().includes(q))
      })
      .sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || a.vmid - b.vmid)
  }, [guests, filter, query, ips.data])

  const counts = (f: Filter) =>
    guests.filter((g) => !g.template).filter((g) => (f === 'all' ? true : f === 'running' ? g.status === 'running' : f === 'stopped' ? g.status !== 'running' : g.type === f)).length

  return (
    <>
      <PageHeader
        title="Guests"
        description="Virtual machines and containers across all connections"
        actions={
          <Link to="/create">
            <Button variant="primary">
              <Plus strokeWidth={1.5} />
              Create
            </Button>
          </Link>
        }
      />
      <div className="space-y-4 px-8 pb-10 max-md:px-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-72 max-w-full max-sm:w-full">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" strokeWidth={1.5} />
            <Input className="pl-8" placeholder="Search name, ID, IP, tag…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="flex max-w-full overflow-x-auto rounded-md border border-border p-0.5 [scrollbar-width:none]">
            {filters.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  'h-7 shrink-0 whitespace-nowrap rounded-sm px-2.5 text-[12px] text-muted transition-colors hover:text-foreground',
                  filter === f.id && 'bg-hover font-medium text-foreground',
                )}
              >
                {f.label} <span className="tnum text-faint">{counts(f.id)}</span>
              </button>
            ))}
          </div>
        </div>
        <Card>
          {isLoading ? (
            <div className="space-y-3 p-4">
              {[40, 65, 50].map((w) => (
                <div key={w} className="h-4 animate-pulse rounded-sm bg-hover" style={{ width: `${w}%` }} />
              ))}
            </div>
          ) : visible.length ? (
            <GuestTable guests={visible} ips={ips.data ?? {}} showCluster={(data?.clusters.length ?? 0) > 1} />
          ) : (
            <EmptyState
              icon={Server}
              title={guests.length ? 'Nothing matches' : 'No guests yet'}
              action={
                !guests.length && (
                  <Link to="/create">
                    <Button variant="primary">Create from a template</Button>
                  </Link>
                )
              }
            >
              {guests.length
                ? 'Try a different search or filter.'
                : 'VMs and containers on your connected Proxmox hosts will be listed here with live status, address and usage.'}
            </EmptyState>
          )}
        </Card>
      </div>
    </>
  )
}
