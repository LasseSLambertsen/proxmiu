import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft, Box, Info, MonitorCog, Rocket } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { TemplateTile } from '@/components/TemplateIcon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import { Switch } from '@/components/ui/switch'
import { api, type CreateOptions, type GuestType, type Job, type Template } from '@/lib/api'
import { useConnections, useTemplates } from '@/lib/queries'
import { cn, formatBytes } from '@/lib/utils'

const KEYS_STORAGE = 'proxmiu-ssh-keys'
const readKeys = () => {
  try {
    return localStorage.getItem(KEYS_STORAGE) ?? ''
  } catch {
    return ''
  }
}

export function TemplateGrid({ templates, onPick }: { templates: Template[]; onPick: (t: Template) => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {templates.map((t) => (
        <button key={t.id} onClick={() => onPick(t)} className="group text-left">
          <Card className="flex h-full flex-col p-4 transition-colors group-hover:border-border-strong group-hover:bg-hover">
            <div className="flex items-start gap-3">
              <TemplateTile icon={t.icon} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 font-medium">
                  {t.name}
                  {t.builtin ? null : t.source?.type === 'community-scripts' ? <Badge tone="brand">community</Badge> : <Badge>{t.source?.type === 'github' ? 'GitHub' : 'custom'}</Badge>}
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">{t.description}</p>
              </div>
            </div>
            <div className="tnum mt-4 flex gap-3 font-mono text-[11px] text-faint">
              <span>{t.resources.cores} vCPU</span>
              <span>{t.resources.memory / 1024} GiB RAM</span>
              <span>{t.resources.disk} GiB disk</span>
            </div>
          </Card>
        </button>
      ))}
    </div>
  )
}

export function Create() {
  const { templateId } = useParams()
  const navigate = useNavigate()
  const templates = useTemplates()
  const connections = useConnections()
  const template = templates.data?.find((t) => t.id === templateId)

  if (!connections.isLoading && !connections.data?.length) {
    return (
      <>
        <PageHeader title="Create" />
        <EmptyState
          icon={Rocket}
          title="Connect a Proxmox host first"
          action={
            <Link to="/connections">
              <Button variant="primary">Go to connections</Button>
            </Link>
          }
        >
          New VMs and containers are created on one of your connected Proxmox hosts.
        </EmptyState>
      </>
    )
  }

  if (!template) {
    return (
      <>
        <PageHeader title="Create" description="Pick a template. You can adjust everything on the next step." />
        <div className="px-8 pb-10 max-md:px-4">{templates.data && <TemplateGrid templates={templates.data} onPick={(t) => navigate(`/create/${t.id}`)} />}</div>
      </>
    )
  }
  return <CreateForm key={template.id} template={template} />
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {aside}
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  )
}

function CreateForm({ template }: { template: Template }) {
  const navigate = useNavigate()
  const connections = useConnections()
  const [clusterId, setClusterId] = useState(connections.data?.[0]?.id ?? '')
  const [node, setNode] = useState<string>()
  const [kind, setKind] = useState<GuestType>(template.kind)
  const [hostname, setHostname] = useState(template.id)
  const [vmid, setVmid] = useState('')
  const [cores, setCores] = useState(template.resources.cores)
  const [memoryGiB, setMemoryGiB] = useState(template.resources.memory / 1024)
  const [disk, setDisk] = useState(template.resources.disk)
  const [storage, setStorage] = useState('')
  const [bridge, setBridge] = useState('')
  const [vlan, setVlan] = useState('')
  const [ipMode, setIpMode] = useState<'dhcp' | 'static'>('dhcp')
  const [ipCidr, setIpCidr] = useState('')
  const [gateway, setGateway] = useState('')
  const [osTemplate, setOsTemplate] = useState('')
  const [sourceVmid, setSourceVmid] = useState('')
  const [password, setPassword] = useState('')
  const [sshKeys, setSshKeys] = useState(readKeys)
  const [onboot, setOnboot] = useState(true)
  const [options, setOptions] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(template.options.map((o) => [o.key, o.default ?? (o.type === 'boolean' ? false : '')])),
  )

  useEffect(() => {
    if (!clusterId && connections.data?.[0]) setClusterId(connections.data[0].id)
  }, [connections.data, clusterId])

  const opts = useQuery({
    queryKey: ['create-options', clusterId, node],
    queryFn: () => api.get<CreateOptions>(`/clusters/${clusterId}/create-options${node ? `?node=${encodeURIComponent(node)}` : ''}`),
    enabled: !!clusterId,
  })
  const o = opts.data

  const storages = kind === 'lxc' ? o?.storages.rootdir : o?.storages.images
  useEffect(() => {
    if (!o) return
    if (!node) setNode(o.node)
    if (!storages?.some((s) => s.storage === storage)) {
      // Prefer the storage with most free space.
      setStorage([...(storages ?? [])].sort((a, b) => (b.avail ?? 0) - (a.avail ?? 0))[0]?.storage ?? '')
    }
    if (!o.bridges.includes(bridge)) setBridge(o.bridges.includes('vmbr0') ? 'vmbr0' : (o.bridges[0] ?? 'vmbr0'))
    if (kind === 'qemu' && !sourceVmid && o.vmTemplates[0]) setSourceVmid(String(o.vmTemplates[0].vmid))
  }, [o, kind, node, storage, storages, bridge, sourceVmid])

  const autoOs = useMemo(() => {
    if (!o) return undefined
    const base = (v: string) => v.split('/').pop() ?? v
    for (const prefix of template.os) {
      const local = o.osTemplates.downloaded.find((v) => base(v).startsWith(prefix))
      if (local) return base(local)
      const remote = o.osTemplates.available.find((v) => v.startsWith(prefix))
      if (remote) return `${remote} (downloads first)`
    }
    return undefined
  }, [o, template.os])

  const create = useMutation({
    mutationFn: () => {
      try {
        localStorage.setItem(KEYS_STORAGE, sshKeys)
      } catch {
        /* storage unavailable */
      }
      return api.post<Job>('/provision', {
        clusterId,
        node: node ?? o?.node,
        templateId: template.id,
        kind,
        hostname,
        vmid: vmid ? Number(vmid) : undefined,
        cores,
        memory: Math.round(memoryGiB * 1024),
        disk,
        swap: template.resources.swap,
        storage,
        bridge,
        vlan: vlan ? Number(vlan) : undefined,
        ipMode,
        ipCidr: ipMode === 'static' ? ipCidr : undefined,
        gateway: ipMode === 'static' ? gateway : undefined,
        osTemplate: kind === 'lxc' && osTemplate ? osTemplate : undefined,
        sourceVmid: kind === 'qemu' ? Number(sourceVmid) : undefined,
        password: password || undefined,
        sshKeys,
        onboot,
        options,
      })
    },
    onSuccess: (job) => navigate(`/activity/${job.id}`),
  })

  const canSubmit = !!clusterId && !!storage && !!hostname && (kind === 'lxc' || !!sourceVmid) && (ipMode === 'dhcp' || ipCidr.includes('/'))

  return (
    <>
      <PageHeader
        title={template.name}
        description={template.description}
        actions={
          <Link to="/create">
            <Button variant="ghost">
              <ArrowLeft strokeWidth={1.5} />
              Templates
            </Button>
          </Link>
        }
      />
      <form
        className="grid gap-6 px-8 pb-10 max-md:px-4 lg:grid-cols-[minmax(0,1fr)_300px]"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <div className="space-y-4">
          <Section title="Placement">
            <div className="grid gap-3 sm:grid-cols-2">
              {(connections.data?.length ?? 0) > 1 && (
                <Field label="Connection">
                  <Select
                    value={clusterId}
                    onChange={(e) => {
                      setClusterId(e.target.value)
                      setNode(undefined)
                    }}
                  >
                    {connections.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Node" help={kind === 'qemu' ? 'VMs are created on the node that holds the source template.' : undefined}>
                <Select value={node ?? o?.node ?? ''} onChange={(e) => setNode(e.target.value)} disabled={!o || kind === 'qemu'}>
                  {o?.nodes.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Hostname">
                <Input value={hostname} onChange={(e) => setHostname(e.target.value.replace(/[^a-zA-Z0-9-]/g, '-'))} required />
              </Field>
              <Field label="ID">
                <Input type="number" min={100} value={vmid} onChange={(e) => setVmid(e.target.value)} placeholder={o ? `${o.nextid} (next free)` : 'auto'} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(['lxc', 'qemu'] as const).map((k) => {
                const Icon = k === 'lxc' ? Box : MonitorCog
                return (
                  <button
                    type="button"
                    key={k}
                    onClick={() => setKind(k)}
                    className={cn(
                      'flex items-start gap-2.5 rounded-md border border-border p-3 text-left transition-colors hover:border-border-strong',
                      kind === k && 'border-brand bg-brand-soft hover:border-brand',
                    )}
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted" strokeWidth={1.5} />
                    <span>
                      <span className="block text-[13px] font-medium">{k === 'lxc' ? 'Container (LXC)' : 'Virtual machine'}</span>
                      <span className="block text-[12px] text-faint">
                        {k === 'lxc' ? 'Lightweight, boots in seconds. Recommended.' : 'Full isolation. Clones a cloud-init template.'}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
            {kind === 'lxc' ? (
              <Field label="Operating system" help={!osTemplate && autoOs ? `Automatic: ${autoOs}` : 'Debian and Ubuntu are supported by the built-in scripts.'}>
                <Select value={osTemplate} onChange={(e) => setOsTemplate(e.target.value)}>
                  <option value="">Automatic</option>
                  {!!o?.osTemplates.downloaded.length && (
                    <optgroup label="On this node">
                      {o.osTemplates.downloaded.map((v) => (
                        <option key={v} value={v}>
                          {v.split('/').pop()}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {!!o?.osTemplates.available.length && (
                    <optgroup label="Download from Proxmox">
                      {o.osTemplates.available.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </Select>
              </Field>
            ) : o && !o.vmTemplates.length ? (
              <div className="flex gap-2.5 rounded-md border border-border bg-warning-soft p-3 text-[12px] text-muted">
                <Info className="mt-0.5 size-4 shrink-0 text-warning" strokeWidth={1.5} />
                <div>
                  No VM templates found. Create one from a Debian or Ubuntu cloud image with a cloud-init drive, then convert it to a template in
                  Proxmox. See{' '}
                  <a className="text-foreground underline" href="https://pve.proxmox.com/wiki/Cloud-Init_Support" target="_blank" rel="noreferrer">
                    Cloud-Init Support
                  </a>
                  .
                </div>
              </div>
            ) : (
              <Field label="Source template" help="A cloud-init enabled Debian or Ubuntu VM template.">
                <Select
                  value={sourceVmid}
                  onChange={(e) => {
                    setSourceVmid(e.target.value)
                    const t = o?.vmTemplates.find((t) => String(t.vmid) === e.target.value)
                    if (t) setNode(t.node)
                  }}
                >
                  {o?.vmTemplates.map((t) => (
                    <option key={t.vmid} value={t.vmid}>
                      {t.name} ({t.vmid}) · {t.node}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </Section>

          <Section title="Resources">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="vCPU">
                <Input type="number" min={1} value={cores} onChange={(e) => setCores(Number(e.target.value))} />
              </Field>
              <Field label="Memory (GiB)">
                <Input type="number" min={0.25} step={0.25} value={memoryGiB} onChange={(e) => setMemoryGiB(Number(e.target.value))} />
              </Field>
              <Field label="Disk (GiB)">
                <Input type="number" min={2} value={disk} onChange={(e) => setDisk(Number(e.target.value))} />
              </Field>
            </div>
            <Field label="Storage">
              <Select value={storage} onChange={(e) => setStorage(e.target.value)}>
                {storages?.map((s) => (
                  <option key={s.storage} value={s.storage}>
                    {s.storage} ({s.type}){s.avail !== undefined ? ` · ${formatBytes(s.avail, 0)} free` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </Section>

          <Section title="Network">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Bridge">
                <Select value={bridge} onChange={(e) => setBridge(e.target.value)}>
                  {(o?.bridges.length ? o.bridges : ['vmbr0']).map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </Select>
              </Field>
              <Field label="VLAN tag">
                <Input type="number" min={1} max={4094} value={vlan} onChange={(e) => setVlan(e.target.value)} placeholder="none" />
              </Field>
              <Field label="Address">
                <Select value={ipMode} onChange={(e) => setIpMode(e.target.value as 'dhcp' | 'static')}>
                  <option value="dhcp">DHCP</option>
                  <option value="static">Static</option>
                </Select>
              </Field>
            </div>
            {ipMode === 'static' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="IP address (CIDR)">
                  <Input value={ipCidr} onChange={(e) => setIpCidr(e.target.value)} placeholder="192.168.1.50/24" className="font-mono" />
                </Field>
                <Field label="Gateway">
                  <Input value={gateway} onChange={(e) => setGateway(e.target.value)} placeholder="192.168.1.1" className="font-mono" />
                </Field>
              </div>
            )}
          </Section>

          <Section title="Access">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="User">
                <Input value={template.user} disabled className="font-mono" />
              </Field>
              <Field label="Password" help="Optional. Key login works without it.">
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              </Field>
            </div>
            <Field label="Your SSH public keys" help="One per line. The Proxmiu key is always added, so the in-browser terminal works.">
              <Textarea rows={3} className="font-mono text-[12px]" value={sshKeys} onChange={(e) => setSshKeys(e.target.value)} placeholder="ssh-ed25519 AAAA… you@laptop" />
            </Field>
          </Section>

          {template.options.length > 0 && (
            <Section title="Setup">
              {template.options.map((opt) =>
                opt.type === 'boolean' ? (
                  <label key={opt.key} className="flex items-center justify-between gap-4 py-1">
                    <span className="text-[13px]">
                      {opt.label}
                      {opt.help && <span className="block text-[12px] text-faint">{opt.help}</span>}
                    </span>
                    <Switch checked={!!options[opt.key]} onCheckedChange={(v) => setOptions((s) => ({ ...s, [opt.key]: v }))} />
                  </label>
                ) : (
                  <Field key={opt.key} label={opt.label} help={opt.help}>
                    <Input
                      type={opt.type === 'secret' ? 'password' : 'text'}
                      autoComplete="off"
                      value={String(options[opt.key] ?? '')}
                      placeholder={opt.placeholder}
                      onChange={(e) => setOptions((s) => ({ ...s, [opt.key]: e.target.value }))}
                    />
                  </Field>
                ),
              )}
            </Section>
          )}
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <TemplateTile icon={template.icon} />
                <div>
                  <div className="font-medium">{hostname || '—'}</div>
                  <div className="text-[12px] text-faint">{kind === 'lxc' ? 'Container' : 'Virtual machine'} on {node ?? o?.node ?? '…'}</div>
                </div>
              </div>
              <dl className="tnum grid grid-cols-2 gap-y-1.5 text-[12px]">
                <dt className="text-faint">vCPU</dt>
                <dd className="text-right font-mono">{cores}</dd>
                <dt className="text-faint">Memory</dt>
                <dd className="text-right font-mono">{memoryGiB} GiB</dd>
                <dt className="text-faint">Disk</dt>
                <dd className="text-right font-mono">
                  {disk} GiB
                </dd>
                <dt className="text-faint">Network</dt>
                <dd className="truncate text-right font-mono">{ipMode === 'dhcp' ? `${bridge} · DHCP` : ipCidr || '—'}</dd>
                <dt className="text-faint">Start at boot</dt>
                <dd className="text-right">
                  <Switch checked={onboot} onCheckedChange={setOnboot} />
                </dd>
              </dl>
              {create.error && <p className="text-[13px] text-destructive">{create.error.message}</p>}
              {opts.error && <p className="text-[13px] text-destructive">{opts.error.message}</p>}
              <Button variant="primary" size="md" className="w-full" type="submit" loading={create.isPending} disabled={!canSubmit}>
                <Rocket strokeWidth={1.5} />
                Create {kind === 'lxc' ? 'container' : 'VM'}
              </Button>
              <p className="text-[12px] text-faint">Takes 2–6 minutes. You can follow the install log and leave the page at any time.</p>
            </CardContent>
          </Card>
        </div>
      </form>
    </>
  )
}
