import { useQuery } from '@tanstack/react-query'
import { Activity as ActivityIcon, Check, CircleAlert, CirclePause, Loader2, SquareTerminal, X } from 'lucide-react'
import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CopyButton } from '@/components/CopyButton'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { ProxmoxTaskHistory } from '@/components/ProxmoxTaskHistory'
import { SshDialog, type SshRequest } from '@/components/SshDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api, type Job, type JobHistoryStatus } from '@/lib/api'
import { cn, timeAgo } from '@/lib/utils'

const tone = { running: 'info', success: 'success', error: 'destructive', interrupted: 'warning' } as const
const statusLabel = { running: 'Running', success: 'Completed', error: 'Failed', interrupted: 'Interrupted' } as const

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
    <div className="min-w-0 space-y-4 lg:col-start-2">
      {job.status === 'interrupted' && (
        <div role="status" className="space-y-2 rounded-lg bg-warning-soft px-4 py-3 text-[13px] text-warning">
          <p className="flex items-center gap-2 font-medium"><CirclePause className="size-4 shrink-0" strokeWidth={1.5} />Run interrupted</p>
          <p>{job.recoveryGuidance ?? 'The guest or remote command may still exist/run; inspect it before starting again.'}</p>
          {job.interruptedAt && <p className="text-[12px]">Recorded after agent restart {timeAgo(job.interruptedAt)}. This run was not resumed.</p>}
        </div>
      )}
      {job.target && (
        <p className="break-words text-[12px] text-muted">Intended guest: {job.target.hostname} · {job.target.type === 'lxc' ? 'LXC' : 'VM'}{job.target.vmid === undefined ? ' (ID not saved)' : ` ${job.target.vmid}`} · {job.target.node}</p>
      )}
      <p className="break-all text-[12px] text-muted">Connection: <span className="font-mono">{job.clusterId}</span></p>
      {r && job.status === 'success' && (
        <Card className="border-success/40">
          <CardContent className="space-y-3 break-words">
            <div className="flex items-center gap-2 font-medium text-success">
              <Check className="size-4" strokeWidth={2} />
              {r.hostname} was ready when this run finished
            </div>
            <p className="text-[13px] leading-relaxed text-muted">
              <Notes text={r.notes} />
            </p>
            {cmd && (
              <div className="space-y-2">
                <p className="text-[12px] text-muted">Saved SSH address; verify the guest before connecting.</p>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center justify-between rounded-lg bg-inset px-3 py-1.5">
                    <code className="truncate">{cmd}</code>
                    <CopyButton text={cmd} />
                  </div>
                  <Button variant="primary" onClick={() => setSsh({ host: r.ip!, label: r.hostname, defaultUser: r.user })}>
                    <SquareTerminal strokeWidth={1.5} />
                    Open terminal
                  </Button>
                </div>
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
        <div className="flex items-start gap-2.5 break-words rounded-md bg-destructive-soft px-4 py-3 text-[13px] text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
          <span className="min-w-0">{job.error}</span>
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="min-w-0 break-words">{job.title}</CardTitle>
          <Badge tone={tone[job.status]}>{statusLabel[job.status]}</Badge>
        </CardHeader>
        <ol className="flex flex-wrap gap-x-5 gap-y-2 border-b border-border px-4 py-3">
          {job.steps.map((s) => (
            <li key={s.id} className={cn('flex items-center gap-1.5 text-[12px]', s.status === 'pending' ? 'text-faint' : 'text-muted')}>
              {s.status === 'done' ? (
                <Check className="size-3.5 text-success" strokeWidth={2} />
              ) : s.status === 'running' ? (
                <Loader2 className="size-3.5 animate-spin text-brand" strokeWidth={2} />
              ) : s.status === 'interrupted' ? (
                <CirclePause className="size-3.5 text-warning" strokeWidth={2} />
              ) : s.status === 'error' ? (
                <X className="size-3.5 text-destructive" strokeWidth={2} />
              ) : (
                <span className="size-1.5 rounded-full bg-faint" />
              )}
              <span className={cn(s.status === 'running' && 'font-medium text-foreground')}>{s.label}</span>
            </li>
          ))}
        </ol>
        {job.logTruncated && <p className="px-4 py-2 text-[12px] text-warning">Showing the newest saved log tail. Earlier output was truncated.</p>}
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
  const navigate = useNavigate()
  const [tab, setTab] = useState<'native' | 'provisioning'>(jobId ? 'provisioning' : 'native')
  const jobsQuery = useQuery({ queryKey: ['jobs'], queryFn: () => api.get<Job[]>('/jobs'), refetchInterval: 3000 })
  const { data: jobs } = jobsQuery
  const persistence = useQuery({ queryKey: ['jobs-status'], queryFn: () => api.get<JobHistoryStatus>('/jobs/status'), enabled: tab === 'provisioning', refetchInterval: 3000 })
  const status = persistence.data
  const readError = jobsQuery.error || persistence.error || status?.available === false
  const selected = jobId ?? jobs?.[0]?.id
  useEffect(() => { if (jobId) setTab('provisioning') }, [jobId])
  const switchTab = (value: 'native' | 'provisioning') => {
    setTab(value)
    if (value === 'native' && jobId) navigate('/activity')
  }
  const navigateTabs = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[1] : tabs[tab === 'native' ? 1 : 0]
    next.focus()
    next.click()
  }

  return (
    <>
      <PageHeader title="Activity" description="Proxmox task history and local provisioning runs" />
      <div className="px-8 pb-5 max-md:px-4"><div role="tablist" aria-label="Activity type" onKeyDown={navigateTabs} className="inline-flex gap-1 rounded-lg bg-inset p-1">{([{ value: 'native', label: 'Proxmox tasks' }, { value: 'provisioning', label: 'Provisioning' }] as const).map(item => <button key={item.value} id={`activity-${item.value}-tab`} type="button" role="tab" aria-selected={tab === item.value} aria-controls={`activity-${item.value}-panel`} tabIndex={tab === item.value ? 0 : -1} onClick={() => switchTab(item.value)} className={cn('rounded-md px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand', tab === item.value ? 'bg-hover text-foreground' : 'text-muted hover:text-foreground')}>{item.label}</button>)}</div></div>
      {tab === 'native' ? <div id="activity-native-panel" role="tabpanel" aria-labelledby="activity-native-tab" className="px-8 pb-10 max-md:px-4"><ProxmoxTaskHistory /></div> : <div id="activity-provisioning-panel" role="tabpanel" aria-labelledby="activity-provisioning-tab">
      <div className="space-y-3 px-8 pb-5 max-md:px-4">
        <p className="text-[12px] text-muted">Retained template creation and update runs on this agent. Native Proxmox history stays in its own tab.</p>
        {status && <div className={cn('space-y-1 rounded-lg bg-inset px-4 py-3 text-[12px]', !status.available || !status.writable ? 'text-warning' : 'text-muted')}>
          <p className="font-medium text-[13px]">{!status.available ? 'Provisioning history unavailable' : !status.writable ? 'History is not fully saved' : status.lastSavedAt ? 'History saved' : 'History ready'}</p>
          {status.warning && <p>{status.warning}</p>}
          {status.lastSavedAt && <p>Last saved {timeAgo(status.lastSavedAt)}.</p>}
          <p>Retains up to {status.retention.maxJobs} runs, {status.retention.maxLogLines.toLocaleString('en-US')} log lines and {Math.floor(status.retention.maxJobBytes / 1024)} KiB per run.</p>
        </div>}
        {(jobsQuery.error || persistence.error) && <div role="alert" className="space-y-2 rounded-lg bg-destructive-soft px-4 py-3 text-[13px] text-destructive">
          <p className="font-medium">{jobsQuery.error ? 'Could not read provisioning history' : 'Could not read history persistence status'}</p>
          <p className="break-words">{(jobsQuery.error ?? persistence.error)?.message}</p>
          {jobs?.length ? <p>Showing the last loaded runs. Their saved state may have changed.</p> : null}
          <Button variant="outline" size="sm" onClick={() => { void jobsQuery.refetch(); void persistence.refetch() }}>Try again</Button>
        </div>}
      </div>
      {!jobs?.length && !jobId && !readError && jobsQuery.isSuccess && persistence.isSuccess ? (
        <EmptyState
          icon={ActivityIcon}
          title="Nothing has run yet"
          action={
            <Link to="/create">
              <Button variant="primary">Create from a template</Button>
            </Link>
          }
        >
          When you create a VM or container, or update one from its template, its steps and a bounded diagnostic log appear here and remain after an agent restart.
        </EmptyState>
      ) : jobs?.length || jobId ? (
        <div className="grid gap-6 px-8 pb-10 max-md:px-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          {!!jobs?.length && <Card className="min-w-0 self-start">
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
                  ) : j.status === 'interrupted' ? (
                    <CirclePause className="size-3.5 shrink-0 text-warning" strokeWidth={2} />
                  ) : (
                    <X className="size-3.5 text-destructive" strokeWidth={2} />
                  )}
                  <span className="truncate text-[13px] font-medium">{j.title}</span>
                </div>
                <div className="mt-0.5 pl-5.5 text-[12px] text-faint">{statusLabel[j.status]} · {timeAgo(j.createdAt)}</div>
              </Link>
            ))}
          </Card>}
          {selected && <JobDetail id={selected} />}
        </div>
      ) : !readError ? <p className="px-8 pb-5 text-[13px] text-muted max-md:px-4">Loading provisioning history…</p> : null}
      </div>}
    </>
  )
}
