import { RefreshCw, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog, type ConfirmRequest } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/form'
import { Switch } from '@/components/ui/switch'
import { ApiError, type Guest, type GuestResourceSettings as Settings } from '@/lib/api'
import { useGuestResourceSettings, useSaveGuestResourceSettings } from '@/lib/queries'

const validInteger = (value: string, min: number, max: number) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max

export function GuestResourceSettings({ guest, unavailable = false }: { guest: Guest; unavailable?: boolean }) {
  const query = useGuestResourceSettings(guest, !unavailable)
  const save = useSaveGuestResourceSettings(guest)
  const [baseline, setBaseline] = useState<Settings | null>(null)
  const [cores, setCores] = useState('')
  const [memory, setMemory] = useState('')
  const [onboot, setOnboot] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const dirty = !!baseline && (cores !== String(baseline.cores ?? '') || memory !== String(baseline.memoryMiB ?? '') || onboot !== baseline.onboot)
  const coresValid = validInteger(cores, 1, 128)
  const memoryValid = validInteger(memory, 16, 1048576)
  const editable = !!baseline && baseline.cores !== null && baseline.memoryMiB !== null && query.data?.editable === true && query.data.status === 'stopped' && query.data.pending === false && !unavailable && !query.error
  const disabled = !editable || save.isPending

  const accept = (value: Settings) => {
    setBaseline(value)
    setCores(String(value.cores ?? ''))
    setMemory(String(value.memoryMiB ?? ''))
    setOnboot(value.onboot)
    setConflict(false)
  }

  useEffect(() => {
    if (query.data && !dirty && !conflict) accept(query.data)
  }, [query.data, dirty, conflict])

  const reload = async () => {
    const result = await query.refetch()
    if (result.error) throw result.error
    if (result.data) { accept(result.data); save.reset() }
  }
  const askReload = () => {
    if (dirty || conflict) setConfirm({ title: 'Reload resource settings?', body: 'This replaces your unsaved draft with the current Proxmox settings. Copy any values you want to keep before reloading.', confirmLabel: 'Reload settings', onConfirm: reload })
    else void reload().catch(() => {})
  }
  const review = () => {
    if (!baseline || disabled || conflict || !dirty || !coresValid || !memoryValid) return
    const update = { cores: Number(cores), memoryMiB: Number(memory), onboot, digest: baseline.digest }
    setConfirm({
      title: 'Apply resource changes?',
      body: <div className="space-y-3"><p>Review the allocation for <strong className="text-foreground">{guest.name || guest.vmid}</strong>. Changes take effect at the next full guest start.</p><dl className="space-y-2 text-[12px]"><div className="flex flex-wrap justify-between gap-2"><dt>Cores per socket</dt><dd className="tnum text-foreground">{baseline.cores} → {update.cores}</dd></div><div className="flex flex-wrap justify-between gap-2"><dt>Memory (MiB)</dt><dd className="tnum text-foreground">{baseline.memoryMiB} → {update.memoryMiB}</dd></div><div className="flex flex-wrap justify-between gap-2"><dt>Start at boot</dt><dd className="text-foreground">{baseline.onboot ? 'Enabled' : 'Disabled'} → {update.onboot ? 'Enabled' : 'Disabled'}</dd></div></dl><p>{baseline.sockets} {baseline.sockets === 1 ? 'socket' : 'sockets'} retained. The guest must still be stopped with no pending changes.</p></div>,
      confirmLabel: 'Apply resource changes',
      onConfirm: async () => {
        try {
          const value = await save.mutateAsync(update)
          accept(value)
          toast.success('Resource settings saved')
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) setConflict(true)
          throw error
        }
      },
    })
  }

  return <Card>
    <CardHeader className="flex-wrap"><CardTitle className="flex items-center gap-2"><SlidersHorizontal className="size-4 text-brand" />Resource settings</CardTitle><Button variant="ghost" size="icon" aria-label="Reload resource settings" title="Reload resource settings" disabled={unavailable || query.isFetching || save.isPending} onClick={askReload}><RefreshCw className={query.isFetching ? 'animate-spin' : ''} /></Button></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-[12px] leading-relaxed text-muted">Adjust CPU, memory and boot behavior while this guest is stopped. Changes take effect at its next full start.</p>
      {query.isPending && <p role="status" className="text-[12px] text-muted">Loading resource settings…</p>}
      {query.error && <p role="alert" className="break-words text-[12px] text-destructive">Resource settings could not load: {query.error.message}. Use reload to try again.</p>}
      {query.data && !query.data.editable && <p role="status" className="rounded-md bg-warning-soft p-3 text-[12px] text-warning">{query.data.reason || 'These resource settings cannot be edited. Check the guest status and pending changes in Proxmox.'}</p>}
      {query.data?.pending && <p className="text-[12px] text-warning">Proxmox reports pending configuration changes.</p>}
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); review() }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cores per socket" help={`${baseline?.sockets ?? '—'} ${baseline?.sockets === 1 ? 'socket' : 'sockets'}${baseline?.sockets ? ` · ${coresValid ? Number(cores) * baseline.sockets : '—'} maximum vCPUs` : ''}. Whole numbers from 1 to 128.`}><Input aria-label="Cores per socket" type="number" min={1} max={128} step={1} required inputMode="numeric" value={cores} disabled={disabled} placeholder={baseline?.cores === null ? 'Unsupported configuration' : undefined} aria-invalid={dirty && !coresValid} onChange={event => setCores(event.target.value)} /></Field>
          <Field label="Memory (MiB)" help="Whole numbers from 16 to 1,048,576 MiB."><Input aria-label="Memory (MiB)" type="number" min={16} max={1048576} step={1} required inputMode="numeric" value={memory} disabled={disabled} placeholder={baseline?.memoryMiB === null ? 'Unsupported configuration' : undefined} aria-invalid={dirty && !memoryValid} onChange={event => setMemory(event.target.value)} /></Field>
        </div>
        {dirty && (!coresValid || !memoryValid) && <p role="alert" className="text-[12px] text-destructive">Enter whole numbers within the ranges shown above.</p>}
        <Field label="Start at boot" help="Start this guest automatically when its Proxmox node boots."><Switch aria-label="Start at boot" checked={onboot} onCheckedChange={setOnboot} disabled={disabled} /></Field>
        <div className="flex flex-wrap items-center justify-between gap-3"><span role="status" className="text-[12px] text-muted">{conflict ? 'Reload required · draft kept' : dirty ? 'Unsaved resource changes' : baseline ? 'Resource settings are up to date' : 'Settings have not loaded'}</span><Button type="submit" disabled={disabled || conflict || !dirty || !coresValid || !memoryValid}>Review resource changes</Button></div>
      </form>
      {save.error && <div role="alert" className="space-y-2 text-[12px] text-destructive"><p className="break-words">{save.error.message}</p><p className="text-muted">Your unsaved draft is kept here.{conflict && ' Reload resource settings before trying again.'}</p></div>}
    </CardContent>
    <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
  </Card>
}
