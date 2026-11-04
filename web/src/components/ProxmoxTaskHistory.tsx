import { CircleAlert, History, Loader2, RefreshCw, Search, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { GuestTaskLog } from '@/components/GuestTaskLog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/form'
import type { Guest, GuestTaskStatus, NativeTask, NativeTaskHistory } from '@/lib/api'
import { useLoadTaskHistory, useNativeTaskStatus, useOverview } from '@/lib/queries'
import { cn } from '@/lib/utils'

const tones = { running: 'info', success: 'success', warning: 'warning', error: 'destructive', unknown: 'neutral' } as const
const states = { running: 'Running', success: 'Completed', warning: 'Warnings', error: 'Failed', unknown: 'Unknown' }

function taskResult(task: NativeTask, live?: GuestTaskStatus): Pick<NativeTask, 'state' | 'status'> {
  if (!live) return task
  if (live.status === 'running') return { state: 'running', status: 'running' }
  if (live.status !== 'stopped' || !live.exitstatus?.trim() || live.exitstatus === 'unexpected status') return { state: 'unknown', status: live.exitstatus ?? '' }
  return { state: live.exitstatus === 'OK' ? 'success' : live.exitstatus.startsWith('WARNINGS') ? 'warning' : 'error', status: live.exitstatus }
}

function TaskDetail({ clusterId, task, unavailable, refresh, close, update }: { clusterId: string; task: NativeTask; unavailable: boolean; refresh: () => void; close: () => void; update: (task: NativeTask, status: GuestTaskStatus) => void }) {
  const live = useNativeTaskStatus(clusterId, task, task.state === 'running' && !unavailable)
  const heading = useRef<HTMLHeadingElement>(null)
  const result = taskResult(task, task.state === 'running' ? live.data : undefined)
  const label = result.state === 'running' ? 'Task running' : result.state === 'unknown' ? 'Result unknown' : result.state === 'success' ? 'Task completed' : result.state === 'warning' ? 'Task finished with warnings' : 'Task failed'
  useEffect(() => { heading.current?.focus() }, [])
  useEffect(() => { if (task.state === 'running' && live.data && !live.isFetching && !live.error) update(task, live.data) }, [task, live.data, live.isFetching, live.error, update])

  return <section aria-label="Selected Proxmox task" className="min-w-0 space-y-4 rounded-lg bg-inset p-4">
    <div className="flex items-center justify-between gap-3"><h4 ref={heading} tabIndex={-1} className="rounded-sm text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-brand">Selected task</h4><Button size="icon" variant="ghost" title="Close task details" aria-label="Close task details" onClick={close}><X /></Button></div>
    <div className="flex flex-wrap items-center gap-2"><Badge tone={tones[result.state]}>{label}</Badge><span className="text-[12px] text-muted">{task.type}{task.vmid !== undefined ? ` · Guest ${task.vmid}` : ''} · {task.node}</span>{live.isFetching && <Loader2 aria-label="Checking task status" className="size-3.5 animate-spin text-brand" />}</div>
    <code className="block break-all text-[11px] text-muted">{task.upid}</code>
    {result.status && <p className={cn('whitespace-pre-wrap break-all text-[12px]', result.state === 'error' ? 'text-destructive' : result.state === 'warning' ? 'text-warning' : 'text-muted')}>{result.status}</p>}
    {live.error && <div role="alert" className="space-y-1 text-[12px]"><p className="break-words text-destructive">{live.error.message}</p><p className="text-muted">Task status is stale. Refresh history and select the task again.</p></div>}
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="max-w-prose text-[12px] text-muted">After an agent restart or expired access, refresh history and select the task again to reopen its log.</p><Button variant="ghost" disabled={unavailable} onClick={refresh}>Refresh history</Button></div>
    <GuestTaskLog key={JSON.stringify([clusterId, task.node, task.upid])} clusterId={clusterId} task={task} unavailable={unavailable} />
  </section>
}

function HistoryPages({ clusterId, node, vmid, unavailable }: { clusterId: string; node: string; vmid?: number; unavailable: boolean }) {
  const { mutate, isPending } = useLoadTaskHistory(clusterId, node, vmid)
  const [history, setHistory] = useState<NativeTaskHistory | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [selected, setSelected] = useState<NativeTask | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const request = useRef(0)
  const read = useCallback((start: number, newest: boolean) => {
    const version = ++request.current
    setError(null)
    setRefreshing(newest)
    if (newest) setSelected(null)
    mutate(start, {
      onSuccess: value => {
        if (version !== request.current) return
        setHistory(previous => {
          const tasks = new Map((newest ? [] : previous?.tasks ?? []).map(task => [task.upid, task]))
          for (const task of value.tasks) if (!tasks.has(task.upid) && tasks.size < 200) tasks.set(task.upid, task)
          return { ...value, tasks: [...tasks.values()], warnings: [...new Set([...(newest ? [] : previous?.warnings ?? []), ...value.warnings])] }
        })
        setRefreshing(false)
      },
      onError: failure => {
        if (version !== request.current) return
        setError(failure)
        setRefreshing(false)
      },
    })
  }, [mutate])

  useEffect(() => {
    if (!unavailable) read(0, true)
    return () => { request.current++ }
  }, [read, unavailable])

  const capped = (history?.tasks.length ?? 0) >= 200
  const refresh = () => read(0, true)
  const update = useCallback((task: NativeTask, status: GuestTaskStatus) => {
    setHistory(previous => previous ? { ...previous, tasks: previous.tasks.map(item => item.upid === task.upid ? { ...item, ...taskResult(item, status) } : item) } : previous)
  }, [])
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="min-w-0 break-words text-[12px] text-muted">Source: <span className="font-medium text-foreground">{node}</span>{vmid !== undefined ? ` · Guest ${vmid}` : ' · All guests and node tasks'}</p><Button disabled={unavailable || isPending} loading={isPending && refreshing} onClick={refresh}>{!(isPending && refreshing) && <RefreshCw />}Refresh history</Button></div>
    {unavailable && <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-[12px] text-warning">This connection is unavailable. {history ? 'Showing stale history. Reconnect and refresh to check Proxmox.' : 'Reconnect to load its Proxmox history.'}</p>}
    {error && <div role="alert" className="flex items-start gap-2 rounded-md bg-destructive-soft px-3 py-2 text-[12px]"><CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" /><div className="min-w-0 space-y-1"><p className="break-words text-destructive">{error.message}</p><p className="text-muted">{history ? 'Showing stale history. ' : ''}Refresh history to try again.</p></div></div>}
    {isPending && !history && <p role="status" className="py-4 text-[12px] text-muted">Loading Proxmox history…</p>}
    {refreshing && history && <p role="status" className="text-[12px] text-muted">Refreshing history; previously loaded tasks are stale.</p>}
    {!!history?.warnings.length && <div role="status" className="space-y-1 rounded-md bg-warning-soft px-3 py-2 text-[12px] text-warning">{history.warnings.map(warning => <p key={warning} className="break-words">{warning}</p>)}</div>}
    {history && !history.tasks.length && !error && !isPending && <p className="py-5 text-[13px] text-muted">{history.warnings.length ? 'Some history could not be read. Refresh or check permissions in Proxmox.' : 'No tasks found for this source.'}</p>}
    {selected && <TaskDetail key={selected.upid} clusterId={clusterId} task={selected} unavailable={unavailable} refresh={refresh} close={() => setSelected(null)} update={update} />}
    {!!history?.tasks.length && <ul aria-label="Proxmox tasks" tabIndex={0} className="max-h-[32rem] divide-y divide-border-subtle overflow-auto rounded-md focus-visible:outline-2 focus-visible:outline-brand">
      {history.tasks.map(task => <li key={task.upid} className={cn('flex min-w-0 items-start justify-between gap-3 px-1 py-3', selected?.upid === task.upid && 'rounded-md bg-hover')}>
        <div className="min-w-0 space-y-1.5"><div className="flex flex-wrap items-center gap-2"><span className="break-all text-[13px] font-medium">{task.type}</span><Badge tone={tones[task.state]}>{states[task.state]}</Badge></div><p className="tnum flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted">{task.vmid !== undefined && <span className="font-mono">Guest {task.vmid}</span>}<time dateTime={new Date(task.starttime * 1000).toISOString()}>{new Date(task.starttime * 1000).toLocaleString()}</time></p><p className="break-all text-[12px] text-muted">{task.status || (task.state === 'unknown' ? 'Proxmox did not report a terminal result.' : 'No result reported yet.')}</p></div>
        <Button className="mt-0.5 shrink-0" size="sm" variant={selected?.upid === task.upid ? 'primary' : 'ghost'} aria-label={`Inspect ${task.type} task${task.vmid !== undefined ? ` for guest ${task.vmid}` : ''}`} aria-pressed={selected?.upid === task.upid} disabled={unavailable || refreshing} onClick={() => setSelected(task)}><Search /><span className="max-sm:sr-only">Inspect</span></Button>
      </li>)}
    </ul>}
    {history && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-3"><p className="tnum text-[12px] text-muted">{capped ? 'Showing the display limit of 200 tasks. Narrow the source or refresh for newest tasks.' : `${history.tasks.length} tasks loaded${!history.hasMore && !history.warnings.length && !error ? ' · End of available history' : ''}`}</p>{(history.hasMore || capped) && <Button disabled={unavailable || isPending || !!error || capped} loading={isPending && !refreshing} onClick={() => read(history.next, false)}>Load more tasks</Button>}</div>}
  </div>
}

export function ProxmoxTaskHistory({ guest, unavailable = false }: { guest?: Guest; unavailable?: boolean }) {
  const overview = useOverview()
  const [connectionId, setConnectionId] = useState('')
  const [selectedNode, setSelectedNode] = useState('')
  const [draftId, setDraftId] = useState('')
  const [vmid, setVmid] = useState<number | undefined>()
  const lastNodes = useRef<Record<string, string>>({})
  const clusters = overview.data?.clusters ?? []
  const connection = guest ? clusters.find(cluster => cluster.id === guest.clusterId) : connectionId ? clusters.find(cluster => cluster.id === connectionId) : clusters.find(cluster => cluster.ok && cluster.nodes.length) ?? clusters[0]
  const sourceId = guest?.clusterId ?? (connectionId || connection?.id || '')
  const liveNode = connection?.nodes.some(item => item.node === selectedNode) ? selectedNode : connection?.nodes[0]?.node
  if (sourceId && liveNode) lastNodes.current[sourceId] = liveNode
  const node = guest?.node ?? liveNode ?? lastNodes.current[sourceId] ?? ''
  const sourceVmid = guest?.vmid ?? vmid
  const offline = unavailable || !!overview.error || !connection || connection.ok === false
  const validId = draftId === '' || /^[1-9]\d*$/.test(draftId) && Number.isSafeInteger(Number(draftId))
  const key = JSON.stringify([sourceId, node, sourceVmid])
  useEffect(() => { if (!guest && !connectionId && connection?.id) setConnectionId(connection.id) }, [guest, connectionId, connection?.id])

  return <Card role="region" aria-label="Proxmox task history" className="min-w-0">
    <CardHeader><CardTitle className="flex items-center gap-2"><History className="size-4 text-brand" />Proxmox task history</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="max-w-prose text-[12px] leading-relaxed text-muted">Tasks retained by Proxmox, including operations started outside Proxmiu. Availability depends on Proxmox retention and your permissions. Refresh for newest tasks; active tasks can move between pages.</p>
      {!guest && !!clusters.length && <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); if (validId) setVmid(draftId ? Number(draftId) : undefined) }}>
        <Field label="Connection" className="min-w-0 flex-1 basis-44"><Select aria-label="History connection" value={sourceId} onChange={event => { setConnectionId(event.target.value); setSelectedNode('') }}>{sourceId && !connection && <option value={sourceId}>Unavailable connection</option>}{clusters.map(cluster => <option key={cluster.id} value={cluster.id}>{cluster.name}{cluster.ok ? '' : ' · Unavailable'}</option>)}</Select></Field>
        <Field label="Node" className="min-w-0 flex-1 basis-32"><Select aria-label="History node" value={node} disabled={!connection?.nodes.length} onChange={event => setSelectedNode(event.target.value)}>{connection?.nodes.length ? connection.nodes.map(item => <option key={item.node} value={item.node}>{item.node}</option>) : <option value={node}>{node ? `${node} · Unavailable` : 'No nodes available'}</option>}</Select></Field>
        <Field label="Guest ID" className="min-w-0 basis-28 grow"><Input aria-label="Guest ID" inputMode="numeric" placeholder="All guests" value={draftId} aria-invalid={!validId} onChange={event => setDraftId(event.target.value)} /></Field>
        <Button type="submit" disabled={!validId || (draftId ? Number(draftId) : undefined) === vmid}>Apply filter</Button>
        {!validId && <p role="status" className="w-full text-[12px] text-warning">Enter a positive whole guest ID without leading zeroes, or leave it blank.</p>}
      </form>}
      {guest && <p className="text-[12px] text-muted">Connection: {guest.clusterName}</p>}
      {sourceId && node ? <HistoryPages key={key} clusterId={sourceId} node={node} vmid={sourceVmid} unavailable={offline} /> : <p role="status" className="py-4 text-[12px] text-muted">{overview.isPending ? 'Loading available connections…' : overview.error ? 'Connections could not load. Refresh the inventory to reconnect.' : 'Connect a Proxmox host with an available node to browse its task history.'}</p>}
    </CardContent>
  </Card>
}
