import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Archive, Camera, MoveRight, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ConfirmDialog, type ConfirmRequest } from '@/components/ConfirmDialog'
import { GuestBackups } from '@/components/GuestBackups'
import { GuestTaskLog } from '@/components/GuestTaskLog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import { api, type Guest, type GuestOperation, type GuestTask } from '@/lib/api'
import { guestApiPath, guestKey } from '@/lib/guest-workspace'
import { useGuestOperations, useGuestTask } from '@/lib/queries'

export function GuestOperations({ guest, unavailable = false }: { guest: Guest; unavailable?: boolean }) {
  const qc = useQueryClient()
  const query = useGuestOperations(guest, !unavailable)
  const [task, setTask] = useState<(GuestTask & { label: string; action: GuestOperation['action'] }) | null>(null)
  const status = useGuestTask(guest, task)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [storage, setStorage] = useState('')
  const [target, setTarget] = useState('')
  const completed = useRef<string | null>(null)
  const operation = useMutation({
    mutationFn: (body: GuestOperation) => api.post<GuestTask>(`${guestApiPath(guest)}/operations`, body),
    onSuccess: (value, body) => setTask({ ...value, action: body.action, label: ({ snapshot: 'Create snapshot', rollback: 'Roll back snapshot', 'delete-snapshot': 'Delete snapshot', backup: 'Create backup', migrate: 'Migrate guest' })[body.action] }),
  })
  const stopped = status.data?.status === 'stopped'
  const succeeded = stopped && status.data?.exitstatus === 'OK'
  const busy = operation.isPending || (!!task && !stopped)
  const disabled = busy || unavailable || !!query.error || !query.data
  const storages = query.data?.storages ?? []
  const targets = query.data?.targets ?? []
  const selectedStorage = storages.includes(storage) ? storage : storages[0] ?? ''
  const selectedTarget = targets.includes(target) ? target : targets[0] ?? ''
  const guestName = guest.name || String(guest.vmid)
  const online = guest.type === 'qemu' && guest.status === 'running'

  useEffect(() => {
    if (!stopped || !task || completed.current === task.upid) return
    completed.current = task.upid
    qc.invalidateQueries({ queryKey: ['guest-operations', guestKey(guest)] })
    qc.invalidateQueries({ queryKey: ['guest-insights', guestKey(guest)] })
    qc.invalidateQueries({ queryKey: ['overview'] })
    if (task.action === 'backup') qc.invalidateQueries({ queryKey: ['guest-backups', guestKey(guest)] })
    qc.invalidateQueries({ queryKey: ['guest-resource-settings', guestKey(guest)] })
  }, [stopped, task, qc, guest])

  const askSnapshot = (action: 'rollback' | 'delete-snapshot', snapshot: string) => setConfirm({
    title: action === 'rollback' ? `Roll back to ${snapshot}?` : `Delete snapshot ${snapshot}?`,
    body: action === 'rollback' ? 'Restores the guest to this snapshot and discards changes made since it was taken. Running services may be interrupted.' : 'Removes this restore point permanently. The current guest stays in place.',
    confirmLabel: action === 'rollback' ? 'Roll back' : 'Delete snapshot',
    destructive: true,
    typeToConfirm: guestName,
    onConfirm: () => operation.mutateAsync({ action, name: snapshot, confirm: guestName }),
  })

  return <Card>
    <CardHeader><CardTitle>Snapshots, backups & migration</CardTitle><Button variant="ghost" size="icon" aria-label="Refresh operations" title="Refresh operations" disabled={query.isFetching || unavailable} onClick={() => query.refetch()}><RefreshCw className={query.isFetching ? 'animate-spin' : ''} /></Button></CardHeader>
    <CardContent className="space-y-5">
      <p className="text-[12px] leading-relaxed text-muted">Create a restore point, send a backup to storage or move this guest to another node. Proxmox runs each operation and reports its final result below.</p>
      {query.isPending && <p role="status" className="text-[12px] text-muted">Loading guest operations…</p>}
      {query.error && <p role="alert" className="text-[12px] text-destructive">Operations could not load: {query.error.message} <button className="underline underline-offset-4" onClick={() => query.refetch()}>Try again</button></p>}
      {!!query.data?.errors.length && <div role="status" className="space-y-2 rounded-md bg-warning-soft p-3 text-[12px] text-warning">{query.data.errors.map(error => <p key={error}>{error}</p>)}<p>Refresh after checking the connection or Proxmox role permissions.</p></div>}
      {operation.error && <p role="alert" className="break-words text-[12px] text-destructive">The operation was not accepted: {operation.error.message}</p>}
      {task && <div role="status" aria-live="polite" className={`space-y-2 rounded-md p-3 text-[12px] ${stopped ? succeeded ? 'bg-success-soft text-success' : 'bg-destructive-soft text-destructive' : 'bg-brand-soft text-foreground'}`}>
        <p className="font-medium">{stopped ? succeeded ? 'Task completed' : 'Task failed' : status.data ? 'Task running' : 'Waiting for task status'}</p>
        <p>{task.label}</p>
        {stopped && !succeeded && <p className="whitespace-pre-wrap break-words">{status.data?.exitstatus ?? 'Proxmox stopped the task without reporting an exit status. Verify the result in Proxmox.'}</p>}
        {status.error && <div role="alert" className="space-y-2"><p>Task status could not refresh: {status.error.message}. Completion is unconfirmed; polling will retry.</p><Button onClick={() => status.refetch()}>Retry task status</Button></div>}
        <details><summary className="cursor-pointer">Task ID</summary><code className="mt-2 block break-all text-[11px]">{task.upid}</code></details>
        <GuestTaskLog key={task.upid} clusterId={guest.clusterId} task={task} unavailable={unavailable} />
      </div>}
      <section aria-label="Snapshots" className="space-y-4">
        <h4 className="flex items-center gap-2 text-[13px] font-semibold"><Camera className="size-4 text-brand" />Snapshots</h4>
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); operation.mutate({ action: 'snapshot', name, ...(description.trim() ? { description } : {}) }) }}>
          <Field label="Snapshot name" help="Start with a letter; use letters, numbers, underscores or hyphens. Up to 40 characters. “current” is reserved."><Input aria-label="Snapshot name" value={name} onChange={event => setName(event.target.value)} required maxLength={40} pattern={'[A-Za-z][A-Za-z0-9_\\-]*'} disabled={disabled} /></Field>
          <Field label="Snapshot description" help="Optional, up to 1,000 characters."><Textarea aria-label="Snapshot description" value={description} onChange={event => setDescription(event.target.value)} rows={2} maxLength={1000} disabled={disabled} /></Field>
          <Button type="submit" disabled={disabled || !/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(name) || name === 'current'}><Camera />Create snapshot</Button>
        </form>
        {query.data?.snapshots.length ? <ul className="divide-y divide-border-subtle">
          {query.data.snapshots.map(snapshot => <li key={snapshot.name} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0 flex-1 basis-40"><p className="break-words font-mono text-[12px]">{snapshot.name}</p>{snapshot.description && <p className="mt-1 whitespace-pre-wrap break-words text-[12px] text-muted">{snapshot.description}</p>}{snapshot.snaptime && <p className="tnum mt-1 text-[11px] text-faint">{new Date(snapshot.snaptime * 1000).toLocaleString()}</p>}</div>
            <div className="flex gap-2"><Button disabled={disabled} aria-label={`Roll back ${snapshot.name}`} onClick={() => askSnapshot('rollback', snapshot.name)}><RotateCcw />Roll back</Button><Button variant="destructive" size="icon" disabled={disabled} title={`Delete snapshot ${snapshot.name}`} aria-label={`Delete snapshot ${snapshot.name}`} onClick={() => askSnapshot('delete-snapshot', snapshot.name)}><Trash2 /></Button></div>
          </li>)}
        </ul> : query.data && <p className="text-[12px] text-muted">{query.data.errors.length ? 'No snapshots were returned. Check the warnings above before continuing.' : 'No snapshots yet. Create a restore point before your next change.'}</p>}
      </section>
      <section aria-label="Backups" className="space-y-3 border-t border-border-subtle pt-5">
        <h4 className="flex items-center gap-2 text-[13px] font-semibold"><Archive className="size-4 text-brand" />Backups</h4>
        <p className="text-[12px] text-muted">Uses Proxmox snapshot mode with Zstandard compression. Storage must support backups on this node.</p>
        <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); operation.mutate({ action: 'backup', storage: selectedStorage }) }}>
          <Field label="Backup storage" className="min-w-0 flex-1 basis-44"><Select aria-label="Backup storage" value={selectedStorage} onChange={event => setStorage(event.target.value)} disabled={disabled || !storages.length}>{storages.length ? storages.map(value => <option key={value}>{value}</option>) : <option value="">No backup storage available</option>}</Select></Field>
          <Button type="submit" disabled={disabled || !selectedStorage}><Archive />Create backup</Button>
        </form>
        <GuestBackups guest={guest} storages={storages} unavailable={unavailable || !!query.error || !query.data} />
      </section>
      <section aria-label="Migration" className="space-y-3 border-t border-border-subtle pt-5">
        <h4 className="flex items-center gap-2 text-[13px] font-semibold"><MoveRight className="size-4 text-brand" />Migration</h4>
        <p className="text-[12px] text-muted">{online ? 'Live migration for this running virtual machine. Proxmox checks storage and target compatibility.' : guest.type === 'lxc' && guest.status === 'running' ? 'Offline migration: this container stops during the move and restarts on the target. Services will be interrupted.' : 'Offline migration for this stopped guest. Proxmox checks storage and target compatibility.'}</p>
        <div className="flex flex-wrap items-end gap-3"><Field label="Target node" className="min-w-0 flex-1 basis-44"><Select aria-label="Target node" value={selectedTarget} onChange={event => setTarget(event.target.value)} disabled={disabled || !targets.length}>{targets.length ? targets.map(value => <option key={value}>{value}</option>) : <option value="">No migration targets available</option>}</Select></Field><Button disabled={disabled || !selectedTarget} onClick={() => setConfirm({ title: `Migrate ${guestName}?`, body: <>Move this guest from <strong>{guest.node}</strong> to <strong>{selectedTarget}</strong>. {online ? 'Proxmox will attempt live migration.' : 'The guest will be unavailable during offline migration.'}</>, confirmLabel: 'Migrate', onConfirm: () => operation.mutateAsync({ action: 'migrate', target: selectedTarget }) })}><MoveRight />Migrate guest</Button></div>
      </section>
    </CardContent>
    <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
  </Card>
}
