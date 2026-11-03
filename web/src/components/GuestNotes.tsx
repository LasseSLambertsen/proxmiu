import { Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog, type ConfirmRequest } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Textarea } from '@/components/ui/form'
import { ApiError, type Guest, type GuestNotes as Notes } from '@/lib/api'
import { useGuestNotes, useSaveGuestNotes } from '@/lib/queries'

export function GuestNotes({ guest, unavailable = false }: { guest: Guest; unavailable?: boolean }) {
  const query = useGuestNotes(guest, !unavailable)
  const save = useSaveGuestNotes(guest)
  const [baseline, setBaseline] = useState<Notes | null>(null)
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)

  useEffect(() => {
    if (query.data && !dirty && !conflict) {
      setBaseline(query.data)
      setDraft(query.data.notes)
    }
  }, [query.data, dirty, conflict])

  const reload = async () => {
    const result = await query.refetch()
    if (result.error) throw result.error
    if (result.data) {
      setBaseline(result.data)
      setDraft(result.data.notes)
      setDirty(false)
      setConflict(false)
      save.reset()
    }
  }
  const askReload = () => setConfirm({
    title: 'Reload Proxmox notes?',
    body: 'This replaces your unsaved draft with the current Proxmox description. Copy anything you want to keep before reloading.',
    confirmLabel: 'Reload notes',
    onConfirm: reload,
  })
  const recover = () => {
    const copy = () => { setDraft(query.data?.legacyNotes ?? ''); setDirty(true) }
    if (dirty) setConfirm({ title: 'Replace this draft?', body: 'The old agent notes will replace your unsaved draft. Proxmox notes stay unchanged until you save.', confirmLabel: 'Replace draft', onConfirm: copy })
    else copy()
  }

  return <Card>
    <CardHeader className="flex-wrap"><CardTitle>Guest notes</CardTitle><span className="text-[11px] text-muted">Saved in Proxmox</span></CardHeader>
    <CardContent>
      <Field label={<span className="sr-only">Guest notes</span>} help="Edits the guest description in Proxmox. An empty note clears the description.">
        <Textarea aria-label="Guest notes" id="guest-notes" value={draft} maxLength={64000} rows={6} disabled={!baseline || save.isPending} placeholder="What runs here? Add a service URL, backup reminder or useful command…" onChange={event => { setDraft(event.target.value); setDirty(true) }} className="resize-y" />
      </Field>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[12px] text-muted" role="status">{dirty ? 'Unsaved changes' : query.isPending ? 'Loading Proxmox notes…' : baseline ? 'Notes are up to date' : 'Notes have not loaded'}</span>
        <Button disabled={!dirty || !baseline || conflict || unavailable} loading={save.isPending} onClick={() => baseline && save.mutate({ notes: draft, digest: baseline.digest }, {
          onSuccess: value => { setBaseline(value); setDraft(value.notes); setDirty(false); toast.success('Notes saved') },
          onError: error => { if (error instanceof ApiError && error.status === 409) setConflict(true) },
        })}><Save />Save notes</Button>
      </div>
      {query.error && <p role="alert" className="mt-3 text-[12px] text-destructive">Notes could not load: {query.error.message} <button className="underline underline-offset-4" onClick={() => query.refetch()}>Try again</button></p>}
      {save.error && <div role="alert" className="mt-3 space-y-2 text-[12px] text-destructive"><p>{save.error.message}</p><p className="text-muted">Your unsaved draft is kept here.</p>{conflict && <Button onClick={askReload}>Reload Proxmox notes</Button>}</div>}
      {!!query.data?.legacyNotes && <details className="mt-4 rounded-md bg-inset p-3 text-[12px]">
        <summary className="cursor-pointer font-medium text-muted">Recover old agent notes</summary>
        <p className="mt-3 text-muted">These notes were saved on this agent before Proxmox notes were enabled. Copying creates a draft; review it before saving.</p>
        <pre className="my-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-sans">{query.data.legacyNotes}</pre>
        <Button disabled={!baseline || save.isPending} onClick={recover}>Copy old notes into draft</Button>
      </details>}
    </CardContent>
    <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
  </Card>
}
