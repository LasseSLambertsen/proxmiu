import { useQuery } from '@tanstack/react-query'
import { Activity as ActivityIcon, Check, CircleAlert, Loader2, SquareTerminal, X } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CopyButton } from '@/components/CopyButton'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { SshDialog, type SshRequest } from '@/components/SshDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api, type Job } from '@/lib/api'
import { cn, timeAgo } from '@/lib/utils'

const tone = { running: 'info', success: 'success', error: 'destructive' } as const

/** Renders `code` spans in template notes. */
function Notes({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        part.startsWith('`') ? (
          <code key={i} className="rounded-sm bg-hover px-1 py-0.5 text-foreground">
            {part.slice(1, -1)}
          </code>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

function JobDetail({ id }: { id: string }) {
  const { data: job, error } = useQuery({
    queryKey: ['job', id],
    queryFn: () => api.get<Job>(`/jobs/${id}`),
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 1000 : false),
  })
  const logRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [ssh, setSsh] = useState<SshRequest | null>(null)

  useEffect(() => {
    const el = logRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [job?.log?.length])

  if (error) return <p className="p-4 text-[13px] text-destructive">{error.message}</p>
  if (!job) return null
  const r = job.result
  const cmd = r?.ip ? `ssh ${r.user}@${r.ip}` : ''

  return (
    <div className="space-y-4">
      {r && (
        <Card className="border-success/40">
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 font-medium text-success">
              <Check className="size-4" strokeWidth={2} />
              {r.hostname} is ready
            </div>
            <p className="text-[13px] leading-relaxed text-muted">
              <Notes text={r.notes} />
            </p>
            {cmd && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center justify-between rounded-md border border-border bg-inset px-3 py-1.5">
                  <code className="truncate">{cmd}</code>
                  <CopyButton text={cmd} />
                </div>
                <Button variant="primary" onClick={() => setSsh({ host: r.ip!, label: r.hostname, defaultUser: r.user })}>
                  <SquareTerminal strokeWidth={1.5} />
                  Open terminal
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {job.status === 'success' && job.kind === 'update' && (
        <Card className="border-success/40">
          <CardContent className="flex items-center gap-2 font-medium text-success">
            <Check className="size-4" strokeWidth={2} />
            Update finished
          </CardContent>
        </Card>
      )}
      {job.error && (
        <div className="flex items-start gap-2.5 rounded-md bg-destructive-soft px-4 py-3 text-[13px] text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
          {job.error}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{job.title}</CardTitle>
          <Badge tone={tone[job.status]}>{job.status}</Badge>
        </CardHeader>
        <ol className="flex flex-wrap gap-x-5 gap-y-2 border-b border-border px-4 py-3">
          {job.steps.map((s) => (
            <li key={s.id} className={cn('flex items-center gap-1.5 text-[12px]', s.status === 'pending' ? 'text-faint' : 'text-muted')}>
              {s.status === 'done' ? (
                <Check className="size-3.5 text-success" strokeWidth={2} />
              ) : s.status === 'running' ? (
                <Loader2 className="size-3.5 animate-spin text-brand" strokeWidth={2} />
              ) : s.status === 'error' ? (
                <X className="size-3.5 text-destructive" strokeWidth={2} />
              ) : (
                <span className="size-1.5 rounded-full bg-faint" />
              )}
              <span className={cn(s.status === 'running' && 'font-medium text-foreground')}>{s.label}</span>
            </li>
          ))}
        </ol>
        <div
          ref={logRef}
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
          }}
          className="h-[460px] overflow-y-auto bg-[#0b0b0d] px-4 py-3 font-mono text-[12px] leading-[1.6] text-[#d4d4d8]"
        >
          {job.log?.map((line, i) => (
            <div
              key={i}
              className={cn(
                'whitespace-pre-wrap break-all',
                line.startsWith('==>') && 'font-medium text-[#a99dff]',
                line.startsWith('ERROR') && 'text-[#f87171]',
              )}
            >
              {line || ' '}
            </div>
          ))}
          {job.status === 'running' && <div className="mt-1 h-3 w-2 animate-pulse bg-[#a99dff]" />}
        </div>
      </Card>
      <SshDialog request={ssh} onClose={() => setSsh(null)} />
    </div>
  )
}

export function Activity() {
  const { jobId } = useParams()
  const { data: jobs } = useQuery({ queryKey: ['jobs'], queryFn: () => api.get<Job[]>('/jobs'), refetchInterval: 3000 })
  const selected = jobId ?? jobs?.[0]?.id

  return (
    <>
      <PageHeader title="Activity" description="Provisioning and update runs since Proxmiu started" />
      {!jobs?.length ? (
        <EmptyState
          icon={ActivityIcon}
          title="Nothing has run yet"
          action={
            <Link to="/create">
              <Button variant="primary">Create from a template</Button>
            </Link>
          }
        >
          When you create a VM or container, or update one from its template, each step and the full log show up here as it happens.
        </EmptyState>
      ) : (
        <div className="grid gap-6 px-8 pb-10 max-md:px-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Card className="self-start">
            {jobs.map((j) => (
              <Link
                key={j.id}
                to={`/activity/${j.id}`}
                className={cn('block border-b border-border-subtle px-4 py-3 last:border-0 hover:bg-hover', selected === j.id && 'bg-hover')}
              >
                <div className="flex items-center gap-2">
                  {j.status === 'running' ? (
                    <Loader2 className="size-3.5 animate-spin text-brand" strokeWidth={2} />
                  ) : j.status === 'success' ? (
                    <Check className="size-3.5 text-success" strokeWidth={2} />
                  ) : (
                    <X className="size-3.5 text-destructive" strokeWidth={2} />
                  )}
                  <span className="truncate text-[13px] font-medium">{j.title}</span>
                </div>
                <div className="mt-0.5 pl-5.5 text-[12px] text-faint">{timeAgo(j.createdAt)}</div>
              </Link>
            ))}
          </Card>
          {selected && <JobDetail id={selected} />}
        </div>
      )}
    </>
  )
}
