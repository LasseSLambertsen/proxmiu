import { FileText, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { GuestTask, GuestTaskLog as LogPage } from '@/lib/api'
import { useLoadGuestTaskLog } from '@/lib/queries'

export function GuestTaskLog({ clusterId, task, unavailable = false }: { clusterId: string; task: GuestTask; unavailable?: boolean }) {
  const load = useLoadGuestTaskLog(clusterId, task)
  const [lines, setLines] = useState<LogPage['lines']>([])
  const [cursor, setCursor] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const limit = lines.length >= 2000
  const read = () => load.mutate(cursor, { onSuccess: value => {
    setLines(previous => {
      const existing = new Set(previous.map(line => line.n))
      return [...previous, ...value.lines.filter(line => !existing.has(line.n)).slice(0, 200).map(line => ({ n: line.n, t: line.t.slice(0, 2000) }))].slice(0, 2000)
    })
    setCursor(value.next)
    setLoaded(true)
    setTruncated(previous => previous || value.truncated)
  } })

  return <section aria-label="Task log" className="space-y-3 rounded-md bg-inset p-3 text-foreground">
    <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="flex items-center gap-2 text-[13px] font-semibold"><FileText className="size-4 text-brand" />Task log</h4>{loaded && <Button size="icon" variant="ghost" aria-label="Refresh task log" title="Refresh task log" disabled={unavailable || load.isPending || limit} onClick={read}><RefreshCw className={load.isPending ? 'animate-spin' : ''} /></Button>}</div>
    <p className="text-[12px] text-muted">Diagnostic output from Proxmox on {task.node}. Load and refresh when needed.</p>
    {loaded && <div aria-label="Task log lines" role="log" aria-live="off" tabIndex={0} className="max-h-80 overflow-auto rounded-md bg-inset p-3 font-mono text-[11px] leading-relaxed focus-visible:outline-2 focus-visible:outline-brand">{lines.length ? lines.map(line => <div key={line.n} className="flex items-start gap-3"><span aria-hidden="true" className="tnum shrink-0 select-none text-faint">{line.n}</span><span className="min-w-0 whitespace-pre-wrap break-all">{line.t}</span></div>) : <p className="font-sans text-muted">No log lines have been returned yet. Refresh to check for output.</p>}</div>}
    {load.error && <div role="alert" className="space-y-1 text-[12px] text-destructive"><p className="break-words">{load.error.message}</p><p className="text-muted">Previously loaded lines are kept. Try loading again.</p></div>}
    {(truncated || limit) && <p role="status" className="text-[12px] text-warning">{limit ? 'The display limit of 2,000 lines has been reached. ' : 'Some Proxmox log output was truncated. '}Open Proxmox for the full task log.</p>}
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="tnum text-[11px] text-muted">{lines.length.toLocaleString()} of 2,000 lines loaded</span><Button loading={load.isPending} disabled={unavailable || limit} onClick={read}>{loaded ? 'Load more log lines' : 'Load task log'}</Button></div>
  </section>
}
