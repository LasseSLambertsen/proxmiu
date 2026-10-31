import { Globe, Loader2, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogBody, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/form'
import { api, type CommunityScript, type Template } from '@/lib/api'
import { useCommunityScripts } from '@/lib/queries'

export function CommunityScriptBrowser({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (template: Template) => void
}) {
  const scripts = useCommunityScripts(open)
  const [q, setQ] = useState('')
  const [picking, setPicking] = useState<string>()

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = scripts.data?.scripts ?? []
    if (!needle) return list
    return list.filter((s) => `${s.name} ${s.slug} ${s.description} ${s.category ?? ''}`.toLowerCase().includes(needle))
  }, [q, scripts.data])

  const pick = async (script: CommunityScript) => {
    setPicking(script.slug)
    try {
      const { template } = await api.get<{ template: Template }>(`/community-scripts/${script.slug}`)
      onPick(template)
      onOpenChange(false)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setPicking(undefined)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Community scripts" description="Containers from community-scripts.org, ready to customise and create." className="max-w-2xl">
        <DialogBody className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" strokeWidth={2} />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Docker, Jellyfin, Immich…" className="pl-8" autoFocus />
          </div>
          {scripts.isLoading && (
            <div className="flex items-center gap-2 py-8 text-[13px] text-muted">
              <Loader2 className="size-4 animate-spin" strokeWidth={2} />
              Loading the catalogue…
            </div>
          )}
          {scripts.error && <p className="py-4 text-[13px] text-destructive">{scripts.error.message}</p>}
          {scripts.data && (
            <div className="divide-y divide-border-subtle overflow-hidden rounded-md border border-border">
              {filtered.slice(0, 300).map((s) => (
                <button
                  key={s.slug}
                  type="button"
                  onClick={() => pick(s)}
                  disabled={!!picking}
                  className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-hover disabled:opacity-60"
                >
                  <Globe className="mt-0.5 size-4 shrink-0 text-faint" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13px] font-medium">{s.name}</span>
                      {s.category && <Badge>{s.category}</Badge>}
                      {s.updateable && <Badge tone="info">updateable</Badge>}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[12px] leading-relaxed text-muted">{s.description}</span>
                  </span>
                  <span className="tnum mt-0.5 shrink-0 text-right font-mono text-[11px] text-faint">
                    {picking === s.slug ? (
                      <Loader2 className="ml-auto size-3.5 animate-spin" strokeWidth={2} />
                    ) : (
                      <>
                        <span className="block">{s.resources.cpu} vCPU</span>
                        <span className="block">{Math.round((s.resources.ram / 1024) * 10) / 10} GiB</span>
                        <span className="block">{s.resources.hdd} GiB</span>
                      </>
                    )}
                  </span>
                </button>
              ))}
              {!filtered.length && <p className="px-3 py-6 text-center text-[12px] text-faint">No scripts match “{q}”.</p>}
            </div>
          )}
          <p className="text-[11.5px] leading-relaxed text-faint">
            Scripts come from{' '}
            <a href="https://community-scripts.org" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
              community-scripts.org
            </a>{' '}
            and run as root inside the new container. Review the upstream script if you are unsure.
          </p>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
