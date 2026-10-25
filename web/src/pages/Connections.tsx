import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Plus, Radar, Server, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog, type ConfirmRequest } from '@/components/ConfirmDialog'
import { CopyButton } from '@/components/CopyButton'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/form'
import { Switch } from '@/components/ui/switch'
import { api, type DiscoveredHost } from '@/lib/api'
import { useConnections } from '@/lib/queries'
import { cn, timeAgo } from '@/lib/utils'

interface DiscoverResult {
  subnets: { iface: string; address: string; cidr: string }[]
  scanned: string[]
  hosts: DiscoveredHost[]
}

const TOKEN_CMD = 'pveum user token add root@pam proxmiu --privsep 0'
const TOKEN_HELP_URL = 'https://github.com/LasseSLambertsen/proxmiu#3-connect-proxmox'

export function Connections() {
  const qc = useQueryClient()
  const connections = useConnections()
  const [cidr, setCidr] = useState('')
  const [adding, setAdding] = useState<{ host: string; port: number } | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)

  const scan = useQuery({
    queryKey: ['discover', cidr],
    queryFn: () => api.get<DiscoverResult>(`/discover${cidr ? `?cidr=${encodeURIComponent(cidr)}` : ''}`),
    enabled: false,
    retry: false,
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/clusters/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connections'] })
      qc.invalidateQueries({ queryKey: ['overview'] })
    },
  })

  return (
    <>
      <PageHeader
        title="Connections"
        description="Proxmox VE hosts and clusters this app manages"
        actions={
          <Button variant="primary" onClick={() => setAdding({ host: '', port: 8006 })}>
            <Plus strokeWidth={1.5} />
            Add manually
          </Button>
        }
      />
      <div className="grid gap-6 px-8 pb-10 max-md:px-4 xl:grid-cols-2">
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Find on this network</CardTitle>
            <Button onClick={() => scan.refetch()} loading={scan.isFetching}>
              <Radar strokeWidth={1.5} />
              {scan.data ? 'Scan again' : 'Scan'}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              label="Range"
              help={
                scan.data
                  ? `Scanned ${scan.data.scanned.join(', ') || 'nothing'} for port 8006.`
                  : 'Leave empty to scan every subnet this machine is attached to, or enter ranges like 10.0.0.0/24.'
              }
            >
              <Input placeholder="Local subnets" value={cidr} onChange={(e) => setCidr(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && scan.refetch()} />
            </Field>
            {scan.error && <p className="text-[13px] text-destructive">{scan.error.message}</p>}
            {scan.data && (
              <div className="rounded-md border border-border">
                {scan.data.hosts.length === 0 && (
                  <p className="p-4 text-[13px] text-muted">
                    No hosts answered on port 8006. If Proxmiu runs in Docker, use host networking, or enter the Proxmox address manually.
                  </p>
                )}
                {scan.data.hosts.map((h) => (
                  <div key={h.ip} className="flex items-center gap-3 border-b border-border-subtle px-3 py-2.5 last:border-0">
                    <Server className="size-4 text-faint" strokeWidth={1.5} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="tnum font-mono text-[13px]">{h.ip}</span>
                        {h.proxmox ? <Badge tone="info">Proxmox VE{h.version ? ` ${h.version}` : ''}</Badge> : <Badge>port open</Badge>}
                      </div>
                      {h.hostname && <div className="truncate text-[12px] text-faint">{h.hostname}</div>}
                    </div>
                    {h.known ? (
                      <span className="flex items-center gap-1 text-[12px] text-success">
                        <CheckCircle2 className="size-3.5" strokeWidth={1.5} />
                        Connected
                      </span>
                    ) : (
                      <Button onClick={() => setAdding({ host: h.ip, port: h.port })}>Connect</Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>Connected</CardTitle>
          </CardHeader>
          {connections.data?.length ? (
            <div>
              {connections.data.map((c) => (
                <div key={c.id} className="flex items-center gap-3 border-b border-border-subtle px-4 py-3 last:border-0">
                  <span className="size-2 rounded-full bg-success" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{c.name}</div>
                    <div className="truncate text-[12px] text-faint">
                      <span className="font-mono">
                        {c.host}:{c.port}
                      </span>{' '}
                      · {c.username} · {c.authType === 'token' ? 'API token' : 'password'} · added {timeAgo(c.createdAt)}
                    </div>
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    title="Remove"
                    onClick={() =>
                      setConfirm({
                        title: `Remove ${c.name}?`,
                        body: 'Proxmiu forgets this connection and its credentials. Nothing changes on the Proxmox host.',
                        confirmLabel: 'Remove',
                        destructive: true,
                        onConfirm: () => remove.mutateAsync(c.id),
                      })
                    }
                  >
                    <Trash2 strokeWidth={1.5} />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Server} title="No connections yet">
              Scan the network or add a host manually. You need an API token or a user with admin rights on the Proxmox host.
            </EmptyState>
          )}
        </Card>
      </div>
      <AddConnectionDialog initial={adding} onClose={() => setAdding(null)} />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}

function AddConnectionDialog({ initial, onClose }: { initial: { host: string; port: number } | null; onClose: () => void }) {
  return (
    <Dialog open={!!initial} onOpenChange={(o) => !o && onClose()}>
      {initial && <AddConnectionForm key={initial.host} initial={initial} onClose={onClose} />}
    </Dialog>
  )
}

function AddConnectionForm({ initial, onClose }: { initial: { host: string; port: number }; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: '',
    host: initial.host,
    port: initial.port,
    authType: 'token' as 'token' | 'password',
    username: 'root@pam!proxmiu',
    secret: '',
    verifyTls: false,
  })
  const [tested, setTested] = useState<{ version: string; nodes: { node: string }[]; clusterName?: string } | null>(null)
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setTested(null)
  }

  const test = useMutation({
    mutationFn: () => api.post<{ version: string; nodes: { node: string }[]; clusterName?: string }>('/clusters/test', form),
    onSuccess: setTested,
  })
  const save = useMutation({
    mutationFn: () => api.post('/clusters', form),
    onSuccess: () => {
      toast.success('Connected')
      qc.invalidateQueries({ queryKey: ['connections'] })
      qc.invalidateQueries({ queryKey: ['overview'] })
      qc.invalidateQueries({ queryKey: ['discover'] })
      onClose()
    },
  })
  const error = test.error ?? save.error

  return (
    <DialogContent title="Connect to Proxmox" description="Credentials are encrypted at rest on the machine running Proxmiu.">
      <form
        className="contents"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <DialogBody className="space-y-3">
          <div className="grid grid-cols-[1fr_96px] gap-3">
            <Field label="Host">
              <Input value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="192.168.1.10" autoFocus={!form.host} />
            </Field>
            <Field label="Port">
              <Input type="number" value={form.port} onChange={(e) => set('port', Number(e.target.value))} />
            </Field>
          </div>
          <div className="flex rounded-md border border-border p-0.5">
            {(['token', 'password'] as const).map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => {
                  set('authType', t)
                  set('username', t === 'token' ? 'root@pam!proxmiu' : 'root@pam')
                }}
                className={cn('h-7 flex-1 rounded-sm text-[12px] text-muted', form.authType === t && 'bg-hover font-medium text-foreground')}
              >
                {t === 'token' ? 'API token (recommended)' : 'Username & password'}
              </button>
            ))}
          </div>
          {form.authType === 'token' ? (
            <>
              <Field label="Token ID" help="Format: user@realm!tokenname">
                <Input value={form.username} onChange={(e) => set('username', e.target.value)} autoFocus={!!form.host} />
              </Field>
              <Field label="Secret">
                <Input type="password" value={form.secret} onChange={(e) => set('secret', e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
              </Field>
              <div className="rounded-md border border-border bg-inset p-3 text-[12px] text-muted">
                Create one in a shell on the Proxmox host:
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <code className="truncate text-foreground">{TOKEN_CMD}</code>
                  <CopyButton text={TOKEN_CMD} />
                </div>
                <div className="mt-1.5">
                  This gives full root access. For a limited user, follow{' '}
                  <a className="text-brand hover:underline" href={TOKEN_HELP_URL} target="_blank" rel="noreferrer">
                    the README
                  </a>
                  , or run the Proxmox installer, which sets one up for you.
                </div>
              </div>
            </>
          ) : (
            <>
              <Field label="Username" help="Include the realm, e.g. root@pam">
                <Input value={form.username} onChange={(e) => set('username', e.target.value)} />
              </Field>
              <Field label="Password">
                <Input type="password" value={form.secret} onChange={(e) => set('secret', e.target.value)} />
              </Field>
            </>
          )}
          <Field label="Name" help="Defaults to the cluster or node name.">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={tested?.clusterName ?? tested?.nodes[0]?.node ?? 'homelab'} />
          </Field>
          <label className="flex items-center justify-between gap-3 text-[13px]">
            <span>
              Verify TLS certificate
              <span className="block text-[12px] text-faint">Leave off for Proxmox' default self-signed certificate.</span>
            </span>
            <Switch checked={form.verifyTls} onCheckedChange={(v) => set('verifyTls', v)} />
          </label>
          {tested && (
            <div className="flex items-center gap-2 rounded-md bg-success-soft px-3 py-2 text-[13px] text-success">
              <CheckCircle2 className="size-4" strokeWidth={1.5} />
              Proxmox VE {tested.version} · {tested.nodes.map((n) => n.node).join(', ')}
            </div>
          )}
          {error && <p className="text-[13px] text-destructive">{error.message}</p>}
        </DialogBody>
        <DialogFooter>
          <Button type="button" onClick={() => test.mutate()} loading={test.isPending} disabled={!form.host || !form.secret}>
            Test
          </Button>
          <Button variant="primary" type="submit" loading={save.isPending} disabled={!form.host || !form.secret}>
            Connect
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
