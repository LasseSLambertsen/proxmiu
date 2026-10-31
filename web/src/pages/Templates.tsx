import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, ExternalLink, Globe, Plus, Rocket, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { CommunityScriptBrowser } from '@/components/CommunityScriptBrowser'
import { PageHeader } from '@/components/PageHeader'
import { TemplateTile, templateIcons } from '@/components/TemplateIcon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import { Switch } from '@/components/ui/switch'
import { api, type Template, type TemplateOption } from '@/lib/api'
import { useTemplates } from '@/lib/queries'
import { cn } from '@/lib/utils'

const blank: Template = {
  id: '',
  name: '',
  description: '',
  icon: 'box',
  tags: [],
  kind: 'lxc',
  os: ['debian-12', 'ubuntu-24.04'],
  resources: { cores: 2, memory: 2048, disk: 16, swap: 512 },
  nesting: true,
  privileged: false,
  user: 'dev',
  options: [],
  script: '# Runs as root after the base setup (packages updated, user created).\n# Helpers: log, apt_install, as_user, as_user_sh, persist_env, install_node\n\nlog "Installing my stuff"\napt_install nginx\n',
  notes: 'Connect with `ssh {user}@{ip}`.',
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export function Templates() {
  const templates = useTemplates()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [editing, setEditing] = useState<{ template: Template; isNew: boolean } | null>(null)
  const [browser, setBrowser] = useState(false)

  const duplicate = (t: Template) =>
    setEditing({ template: { ...structuredClone(t), id: `${t.id}-copy`, name: `${t.name} (copy)`, builtin: false }, isNew: true })

  const addFromCommunity = async (t: Template) => {
    try {
      await api.put(`/templates/${t.id}`, t)
      qc.invalidateQueries({ queryKey: ['templates'] })
      navigate(`/create/${t.id}`)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <>
      <PageHeader
        title="Templates"
        description="Reusable recipes for new VMs and containers. Each one is a resource preset plus a bash script run over SSH."
        actions={
          <>
            <Button onClick={() => setBrowser(true)}>
              <Globe strokeWidth={1.5} />
              Community scripts
            </Button>
            <Button variant="primary" onClick={() => setEditing({ template: structuredClone(blank), isNew: true })}>
              <Plus strokeWidth={1.5} />
              New template
            </Button>
          </>
        }
      />
      <div className="grid gap-4 px-8 pb-10 max-md:px-4 md:grid-cols-2 xl:grid-cols-3">
        {templates.data?.map((t) => (
          <Card key={t.id} className="flex flex-col p-4">
            <div className="flex items-start gap-3">
              <TemplateTile icon={t.icon} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 font-medium">
                  {t.name}
                  <TemplateSourceBadge template={t} />
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">{t.description}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {t.options.slice(0, 4).map((o) => (
                <Badge key={o.key}>{o.label}</Badge>
              ))}
              {t.options.length > 4 && <Badge>+{t.options.length - 4}</Badge>}
            </div>
            <div className="mt-auto flex items-center gap-1 pt-4">
              <Button variant="primary" onClick={() => navigate(`/create/${t.id}`)}>
                <Rocket strokeWidth={1.5} />
                Use
              </Button>
              <Button variant="ghost" onClick={() => (t.builtin ? setEditing({ template: t, isNew: false }) : setEditing({ template: structuredClone(t), isNew: false }))}>
                {t.builtin ? 'View' : 'Edit'}
              </Button>
              <Button variant="ghost" onClick={() => duplicate(t)} className="ml-auto" title="Duplicate">
                <Copy strokeWidth={1.5} />
              </Button>
            </div>
          </Card>
        ))}
      </div>
      <CommunityScriptBrowser open={browser} onOpenChange={setBrowser} onPick={addFromCommunity} />
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <TemplateEditor
            key={editing.template.id + String(editing.isNew)}
            initial={editing.template}
            isNew={editing.isNew}
            onDuplicate={() => duplicate(editing.template)}
            onDone={() => setEditing(null)}
          />
        )}
      </Dialog>
    </>
  )
}

function TemplateSourceBadge({ template }: { template: Template }) {
  if (template.builtin) return <Badge>built-in</Badge>
  if (template.source?.type === 'community-scripts') return <Badge tone="brand">community</Badge>
  if (template.source?.type === 'github') return <Badge tone="info">GitHub</Badge>
  return <Badge tone="info">custom</Badge>
}

function TemplateEditor({ initial, isNew, onDone, onDuplicate }: { initial: Template; isNew: boolean; onDone: () => void; onDuplicate: () => void }) {
  const qc = useQueryClient()
  const [t, setT] = useState(initial)
  const [browser, setBrowser] = useState(false)
  const readOnly = !!initial.builtin
  const sourceType = t.source?.type ?? 'inline'
  const set = <K extends keyof Template>(k: K, v: Template[K]) => setT((s) => ({ ...s, [k]: v }))
  const setRes = (k: keyof Template['resources'], v: number) => setT((s) => ({ ...s, resources: { ...s.resources, [k]: v } }))
  const setOpt = (i: number, patch: Partial<TemplateOption>) =>
    setT((s) => ({ ...s, options: s.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) }))
  const setSource = (type: 'inline' | 'github' | 'community-scripts') => {
    if (type === 'inline') set('source', undefined)
    else if (type === 'github') set('source', t.source?.type === 'github' ? t.source : { type, repo: '', ref: 'main', path: '' })
    else set('source', t.source?.type === 'community-scripts' ? t.source : { type, slug: '', ref: 'main' })
  }
  const patchSource = (patch: Partial<{ repo: string; ref: string; path: string; slug: string }>) =>
    setT((s) => (s.source ? { ...s, source: { ...s.source, ...patch } as Template['source'] } : s))
  const applyCommunity = (ct: Template) =>
    setT((s) => ({
      ...s,
      source: ct.source,
      name: s.name || ct.name,
      id: s.id || ct.id,
      description: s.description || ct.description,
      resources: ct.resources,
      os: ct.os,
      privileged: ct.privileged,
      user: ct.user,
      options: ct.options,
      notes: s.notes || ct.notes,
    }))

  const save = useMutation({
    mutationFn: () => api.put(`/templates/${t.id}`, t),
    onSuccess: () => {
      toast.success('Template saved')
      qc.invalidateQueries({ queryKey: ['templates'] })
      onDone()
    },
  })
  const remove = useMutation({
    mutationFn: () => api.del(`/templates/${initial.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] })
      onDone()
    },
  })

  return (
    <DialogContent
      title={readOnly ? initial.name : isNew ? 'New template' : `Edit ${initial.name}`}
      description={readOnly ? 'Built-in templates are read-only. Duplicate one to customise it.' : undefined}
      className="max-w-3xl"
    >
      <form
        className="contents"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <DialogBody>
          <fieldset disabled={readOnly} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_140px]">
              <Field label="Name">
                <Input
                  value={t.name}
                  required
                  onChange={(e) => {
                    const name = e.target.value
                    setT((s) => ({ ...s, name, id: isNew && (!s.id || s.id === slug(s.name)) ? slug(name) : s.id }))
                  }}
                />
              </Field>
              <Field label="ID">
                <Input value={t.id} required pattern="[a-z0-9-]+" disabled={!isNew || readOnly} onChange={(e) => set('id', slug(e.target.value))} className="font-mono" />
              </Field>
              <Field label="Icon">
                <Select value={t.icon} onChange={(e) => set('icon', e.target.value)}>
                  {Object.keys(templateIcons).map((i) => (
                    <option key={i}>{i}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Description">
              <Input value={t.description} onChange={(e) => set('description', e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-5">
              <Field label="Default type">
                <Select value={t.kind} onChange={(e) => set('kind', e.target.value as Template['kind'])}>
                  <option value="lxc">Container</option>
                  <option value="qemu">VM</option>
                </Select>
              </Field>
              <Field label="vCPU">
                <Input type="number" min={1} value={t.resources.cores} onChange={(e) => setRes('cores', Number(e.target.value))} />
              </Field>
              <Field label="Memory (MiB)">
                <Input type="number" min={256} step={256} value={t.resources.memory} onChange={(e) => setRes('memory', Number(e.target.value))} />
              </Field>
              <Field label="Disk (GiB)">
                <Input type="number" min={2} value={t.resources.disk} onChange={(e) => setRes('disk', Number(e.target.value))} />
              </Field>
              <Field label="User">
                <Input value={t.user} onChange={(e) => set('user', e.target.value)} className="font-mono" />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Field label="Preferred OS templates" help="Comma-separated prefixes, tried in order, e.g. debian-12, ubuntu-24.04">
                <Input
                  value={t.os.join(', ')}
                  onChange={(e) => set('os', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                  className="font-mono"
                />
              </Field>
              <div className="flex flex-col gap-2 self-end pb-2">
                <label className="flex items-center gap-2 text-[13px]">
                  <Switch checked={t.nesting} onCheckedChange={(v) => set('nesting', v)} disabled={readOnly} />
                  Nesting (Docker in LXC)
                </label>
                <label className="flex items-center gap-2 text-[13px]">
                  <Switch checked={t.privileged} onCheckedChange={(v) => set('privileged', v)} disabled={readOnly} />
                  Privileged container
                </label>
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[12px] font-medium tracking-[0.02em] text-muted">Options</span>
                {!readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => set('options', [...t.options, { key: 'MY_OPTION', label: 'My option', type: 'text' }])}
                  >
                    <Plus strokeWidth={1.5} />
                    Add option
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                {t.options.map((o, i) => (
                  <div key={i} className="grid grid-cols-[160px_1fr_110px_auto] gap-2">
                    <Input value={o.key} onChange={(e) => setOpt(i, { key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })} className="font-mono" title="Available to the script as $OPT_<KEY>" />
                    <Input value={o.label} onChange={(e) => setOpt(i, { label: e.target.value })} />
                    <Select value={o.type} onChange={(e) => setOpt(i, { type: e.target.value as TemplateOption['type'] })}>
                      <option value="text">Text</option>
                      <option value="secret">Secret</option>
                      <option value="boolean">Toggle</option>
                    </Select>
                    <Button type="button" size="icon" variant="ghost" className={cn(readOnly && 'invisible')} onClick={() => set('options', t.options.filter((_, j) => j !== i))}>
                      <X strokeWidth={1.5} />
                    </Button>
                  </div>
                ))}
                {!t.options.length && <p className="text-[12px] text-faint">No options. Options show up as fields when creating, and reach the script as $OPT_KEY.</p>}
                {sourceType === 'community-scripts' && t.options.length > 0 && (
                  <p className="text-[12px] text-faint">Community Scripts options are exported as their own `var_*` environment variables.</p>
                )}
              </div>
            </div>

            <Field label="Install script from" help="Fetch the script from a GitHub repository, or reuse an installer from community-scripts.org.">
              <Select value={sourceType} onChange={(e) => setSource(e.target.value as 'inline' | 'github' | 'community-scripts')}>
                <option value="inline">Inline bash</option>
                <option value="github">GitHub repository</option>
                <option value="community-scripts">Community Scripts</option>
              </Select>
            </Field>

            {sourceType === 'inline' && (
              <Field label="Install script" help="Bash, runs as root after base setup. $PM_USER, $PM_HOSTNAME and $OPT_* are set.">
                <Textarea rows={12} value={t.script} onChange={(e) => set('script', e.target.value)} className="font-mono text-[12px]" spellCheck={false} />
              </Field>
            )}

            {sourceType === 'github' && t.source?.type === 'github' && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Repository" help="For example community-scripts/ProxmoxVE">
                    <Input value={t.source.repo} onChange={(e) => patchSource({ repo: e.target.value.trim() })} placeholder="owner/repository" className="font-mono" />
                  </Field>
                  <Field label="Branch or tag">
                    <Input value={t.source.ref} onChange={(e) => patchSource({ ref: e.target.value.trim() })} placeholder="main" className="font-mono" />
                  </Field>
                  <Field label="Script path" className="sm:col-span-2" help="Fetched from raw.githubusercontent.com when the guest is created, then run as root after the base setup.">
                    <Input value={t.source.path} onChange={(e) => patchSource({ path: e.target.value.trim() })} placeholder="scripts/install.sh" className="font-mono" />
                  </Field>
                </div>
                <p className="text-[12px] leading-relaxed text-faint">
                  Only the script file is fetched. Keep secrets in options instead of committing them to the repository.
                </p>
              </>
            )}

            {sourceType === 'community-scripts' && t.source?.type === 'community-scripts' && (
              <div className="space-y-2">
                <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
                  <Field label="Script slug" help="The last part of its community-scripts.org URL, e.g. docker or jellyfin.">
                    <Input value={t.source.slug} onChange={(e) => patchSource({ slug: slug(e.target.value) })} placeholder="docker" className="font-mono" />
                  </Field>
                  <Field label="Branch or tag">
                    <Input value={t.source.ref} onChange={(e) => patchSource({ ref: e.target.value.trim() })} placeholder="main" className="font-mono" />
                  </Field>
                  <Button type="button" variant="ghost" className="mb-px" onClick={() => setBrowser(true)}>
                    <Globe strokeWidth={1.5} />
                    Browse
                  </Button>
                </div>
                <p className="text-[12px] leading-relaxed text-faint">
                  Proxmiu runs the matching install script inside the container with the Community Scripts engine. Apps from that catalogue expect root inside the container.
                </p>
                {t.source.slug && (
                  <a
                    href={`https://community-scripts.org/scripts/${t.source.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[12px] text-muted underline-offset-2 hover:text-foreground hover:underline"
                  >
                    View {t.source.slug} on community-scripts.org
                    <ExternalLink className="size-3" strokeWidth={2} />
                  </a>
                )}
              </div>
            )}

            <Field label="Notes after creation" help="Shown when it is ready. {ip}, {user} and {hostname} are filled in; `backticks` render as code.">
              <Input value={t.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </fieldset>
          {(save.error || remove.error) && <p className="mt-3 text-[13px] text-destructive">{(save.error ?? remove.error)?.message}</p>}
        </DialogBody>
        <DialogFooter>
          {readOnly ? (
            <Button type="button" variant="primary" onClick={onDuplicate}>
              <Copy strokeWidth={1.5} />
              Duplicate to edit
            </Button>
          ) : (
            <>
              {!isNew && (
                <Button type="button" variant="destructive" className="mr-auto" onClick={() => remove.mutate()} loading={remove.isPending}>
                  <Trash2 strokeWidth={1.5} />
                  Delete
                </Button>
              )}
              <Button type="button" onClick={onDone}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={save.isPending} disabled={!t.id || !t.name}>
                Save template
              </Button>
            </>
          )}
        </DialogFooter>
      </form>
      <CommunityScriptBrowser open={browser} onOpenChange={setBrowser} onPick={applyCommunity} />
    </DialogContent>
  )
}
