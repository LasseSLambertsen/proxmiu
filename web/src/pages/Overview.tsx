import { useMutation } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Cpu, MemoryStick, MoreHorizontal, Network, Plus, Power, RotateCw, Server, SquareTerminal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ConfirmDialog, type ConfirmRequest } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { Meter } from '@/components/Meter'
import { Sparkline } from '@/components/Sparkline'
import { PageHeader } from '@/components/PageHeader'
import { SshDialog, type SshRequest } from '@/components/SshDialog'
import { StatusDot } from '@/components/StatusDot'
import { TemplateTile } from '@/components/TemplateIcon'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { api, type Resource } from '@/lib/api'
import { useOverview, useTemplates } from '@/lib/queries'
import { formatBytes, formatUptime, pct } from '@/lib/utils'

// Usage samples across refreshes, so the stat cards can show a short trend.
const history: { cpu: number[]; mem: number[] } = { cpu: [], mem: [] }
const pushSample = (key: 'cpu' | 'mem', v: number) => {
  history[key].push(v)
  if (history[key].length > 40) history[key].shift()
}

function Stat({ label, value, sub, icon: Icon, trend }: { label: string; value: React.ReactNode; sub?: React.ReactNode; icon: typeof Cpu; trend?: number[] }) {
  return (
    <Card className="flex flex-col overflow-hidden p-4">
      <div className="flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        <Icon className="size-4 text-faint" strokeWidth={1.75} />
      </div>
      <div className="tnum mt-3 text-[30px] font-semibold leading-none tracking-[-0.035em]">{value}</div>
      {sub && <div className="mt-2 text-[12.5px] text-faint">{sub}</div>}
      {trend && <Sparkline values={trend} className="-mx-4 -mb-4 mt-auto h-10 w-[calc(100%+2rem)] pt-2" />}
    </Card>
  )
}

export function Overview() {
  const { data, isLoading } = useOverview()
  const templates = useTemplates()
  const [ssh, setSsh] = useState<SshRequest | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const nodeAction = useMutation({
    mutationFn: ({ clusterId, node, action }: { clusterId: string; node: string; action: 'reboot' | 'shutdown' }) =>
      api.post(`/clusters/${clusterId}/nodes/${node}/${action}`),
    onSuccess: (_d, v) => toast.success(`${v.node}: ${v.action} requested`),
    onError: (e) => toast.error(e.message),
  })

  const clusters = data?.clusters ?? []
  const nodes = clusters.flatMap((c) => c.nodes.map((n) => ({ ...n, clusterId: c.id, clusterName: c.name })))
  const guests = clusters.flatMap((c) => c.guests).filter((g) => !g.template)
  const running = guests.filter((g) => g.status === 'running').length
  const online = nodes.filter((n) => n.status === 'online')
  const cpuTotal = online.reduce((a, n) => a + (n.maxcpu ?? 0), 0)
  const cpuUsed = online.reduce((a, n) => a + (n.cpu ?? 0) * (n.maxcpu ?? 0), 0)
  const memTotal = online.reduce((a, n) => a + (n.maxmem ?? 0), 0)
  const memUsed = online.reduce((a, n) => a + (n.mem ?? 0), 0)
  const cpuPct = pct(cpuUsed, cpuTotal)
  const memPct = pct(memUsed, memTotal)
  useEffect(() => {
    if (!data || !cpuTotal) return
    pushSample('cpu', cpuPct)
    pushSample('mem', memPct)
    // Sample once per overview refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])
  if (!isLoading && clusters.length === 0) {
    return (
      <>
        <PageHeader title="Overview" />
        <EmptyState
          icon={Network}
          title="Connect your first Proxmox host"
          action={
            <Link to="/connections">
              <Button variant="primary" size="md">
                Find hosts on this network
                <ArrowRight strokeWidth={1.5} />
              </Button>
            </Link>
          }
        >
          Proxmiu scans your local network for Proxmox VE. Once connected, your nodes, VMs and containers show up here with live usage.
        </EmptyState>
      </>
    )
  }

  const featured = (templates.data ?? []).filter((t) => t.tags.includes('ai')).slice(0, 3)

  const askNode = (n: Resource & { clusterId: string }, action: 'reboot' | 'shutdown') =>
    setConfirm({
      title: `${action === 'reboot' ? 'Reboot' : 'Shut down'} node ${n.node}?`,
      body:
        action === 'reboot'
          ? 'Every VM and container on this node is shut down and comes back according to its start-at-boot setting.'
          : 'Every guest on this node is shut down, and the node powers off. You need physical or IPMI access to turn it back on.',
      confirmLabel: action === 'reboot' ? 'Reboot node' : 'Shut down node',
      destructive: true,
      typeToConfirm: n.node,
      onConfirm: () => nodeAction.mutateAsync({ clusterId: n.clusterId, node: n.node, action }),
    })

  return (
    <>
      <PageHeader
        title="Overview"
        description={`${clusters.length} connection${clusters.length === 1 ? '' : 's'} · ${nodes.length} node${nodes.length === 1 ? '' : 's'}`}
        actions={
          <Link to="/create">
            <Button variant="primary">
              <Plus strokeWidth={1.5} />
              Create
            </Button>
          </Link>
        }
      />
      <div className="space-y-6 px-8 pb-10 max-md:px-4">
        {clusters
          .filter((c) => !c.ok)
          .map((c) => (
            <div key={c.id} className="flex items-start gap-3 rounded-md border border-border bg-destructive-soft px-4 py-3 text-[13px]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" strokeWidth={1.5} />
              <div>
                <span className="font-medium text-destructive">{c.name} is unreachable.</span> <span className="text-muted">{c.error}</span>
              </div>
            </div>
          ))}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Guests running" icon={Server} value={running} sub={`of ${guests.length} VMs and containers`} />
          <Stat label="Nodes online" icon={Network} value={online.length} sub={`of ${nodes.length}`} />
          <Stat
            label="CPU"
            icon={Cpu}
            value={`${cpuPct.toFixed(0)}%`}
            sub={`${cpuTotal} cores`}
            trend={history.cpu}
          />
          <Stat
            label="Memory"
            icon={MemoryStick}
            value={`${memPct.toFixed(0)}%`}
            sub={`${formatBytes(memUsed)} of ${formatBytes(memTotal, 0)}`}
            trend={history.mem}
          />
        </div>

        {featured.length > 0 && (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[16px]">Launch a remote agent</h2>
              <Link to="/templates" className="text-[13px] text-muted hover:text-foreground">
                All templates
              </Link>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {featured.map((t) => (
                <Link key={t.id} to={`/create/${t.id}`} className="group">
                  <Card className="flex h-full items-start gap-3 p-4 transition-colors group-hover:border-border-strong group-hover:bg-hover">
                    <TemplateTile icon={t.icon} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-medium">
                        {t.name}
                        <ArrowRight className="size-3.5 text-faint transition-transform group-hover:translate-x-0.5" strokeWidth={1.5} />
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[12px] text-muted">{t.description}</p>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Nodes</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {nodes.map((n) => (
              <div key={`${n.clusterId}-${n.id}`} className="grid grid-cols-[minmax(160px,1fr)_minmax(120px,180px)_minmax(120px,180px)_90px_auto] items-center gap-5 border-b border-border-subtle px-4 py-3 last:border-0 max-lg:grid-cols-[1fr_auto]">
                <div className="flex min-w-0 items-center gap-2.5">
                  <StatusDot status={n.status} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{n.node}</div>
                    <div className="truncate text-[12px] text-faint">
                      {n.clusterName}
                      {n.ip && <span className="font-mono"> · {n.ip}</span>}
                    </div>
                  </div>
                </div>
                <div className="space-y-1 max-lg:hidden">
                  <div className="tnum flex justify-between text-[12px] text-muted">
                    <span>CPU</span>
                    <span>{((n.cpu ?? 0) * 100).toFixed(0)}%</span>
                  </div>
                  <Meter value={(n.cpu ?? 0) * 100} />
                </div>
                <div className="space-y-1 max-lg:hidden">
                  <div className="tnum flex justify-between text-[12px] text-muted">
                    <span>Memory</span>
                    <span>{pct(n.mem, n.maxmem).toFixed(0)}%</span>
                  </div>
                  <Meter value={pct(n.mem, n.maxmem)} />
                </div>
                <div className="tnum text-[12px] text-muted max-lg:hidden">{n.status === 'online' ? `up ${formatUptime(n.uptime)}` : n.status}</div>
                <div className="flex justify-end gap-1">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    title={`SSH to ${n.node}`}
                    disabled={!n.ip}
                    onClick={() => n.ip && setSsh({ host: n.ip, label: n.node, defaultUser: 'root' })}
                  >
                    <SquareTerminal strokeWidth={1.5} />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-sm" variant="ghost" disabled={n.status !== 'online'}>
                        <MoreHorizontal strokeWidth={1.5} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={() => askNode(n, 'reboot')}>
                        <RotateCw />
                        Reboot node…
                      </DropdownMenuItem>
                      <DropdownMenuItem destructive onSelect={() => askNode(n, 'shutdown')}>
                        <Power />
                        Shut down node…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
            {isLoading && <div className="p-4 text-[13px] text-faint">Loading…</div>}
          </CardContent>
        </Card>
      </div>
      <SshDialog request={ssh} onClose={() => setSsh(null)} />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}
