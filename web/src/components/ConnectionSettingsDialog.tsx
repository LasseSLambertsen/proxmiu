import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/form'
import { Switch } from '@/components/ui/switch'
import { api, ApiError, type Connection } from '@/lib/api'

type Settings = Connection & { revision: string }
type Draft = Pick<Settings, 'revision' | 'name' | 'authType' | 'username' | 'verifyTls'> & { secret: string }

export function ConnectionSettingsDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient()
  const alive = useRef(true)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [saved, setSaved] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pending, setPending] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [tested, setTested] = useState(false)
  const path = `/clusters/${encodeURIComponent(id)}/settings`
  useEffect(() => {
    alive.current = true
    const close = () => { alive.current = false; closeRef.current() }
    window.addEventListener('proxmiu-agent-change', close)
    return () => { alive.current = false; window.removeEventListener('proxmiu-agent-change', close) }
  }, [id])
  async function load() {
    setPending(true); setError(null)
    try {
      const value = await api.get<Settings>(path)
      if (!alive.current) return
      setSaved(value); setDraft({ revision: value.revision, name: value.name, authType: value.authType, username: value.username, verifyTls: value.verifyTls, secret: '' }); setTested(false)
    } catch (e) { if (alive.current) setError(e instanceof ApiError && e.status === 404 ? new ApiError('Connection settings are unavailable. Update the Proxmiu agent and try again.', 404) : e as ApiError) }
    finally { if (alive.current) setPending(false) }
  }
  useEffect(() => { void load() }, [id])
  function change<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft(d => d && { ...d, [key]: value }); setTested(false); setError(null)
  }
  async function submit(save: boolean) {
    if (!draft || pending) return
    setPending(true); setSaving(save); setTesting(!save); setError(null); setTested(false)
    const { secret, ...rest } = draft
    try {
      if (save) await api.put(path, { ...rest, ...(secret ? { secret } : {}) })
      else await api.post(path + '/test', { ...rest, ...(secret ? { secret } : {}) })
      if (!alive.current) return
      if (save) { void qc.invalidateQueries({ queryKey: ['connections'] }); void qc.invalidateQueries({ queryKey: ['overview'] }); onClose() }
      else setTested(true)
    } catch (e) { if (alive.current) setError(e as ApiError) }
    finally { if (alive.current) { setPending(false); setSaving(false); setTesting(false) } }
  }
  const needsSecret = !!draft && !!saved && (draft.authType !== saved.authType || draft.username !== saved.username) && !draft.secret
  return <Dialog open onOpenChange={open => !open && !saving && onClose()}>
    <DialogContent title="Edit connection" description="Update saved settings for this Proxmox connection." closeDisabled={saving} onEscapeKeyDown={e => { if (saving) e.preventDefault() }} onPointerDownOutside={e => { if (saving) e.preventDefault() }}>
      <DialogBody className="space-y-3">
        {!draft && pending && <p className="text-sm text-muted">Loading saved settings…</p>}
        {draft && saved && <>
          <p className="text-[13px] text-muted">Destination: <span className="break-all font-mono text-foreground">{saved.host}:{saved.port}</span></p>
          <Field label="Name"><Input value={draft.name} disabled={pending} onChange={e => change('name', e.target.value)} /></Field>
          <Field label="Authentication"><Select value={draft.authType} disabled={pending} onChange={e => change('authType', e.target.value as Draft['authType'])}><option value="token">API token</option><option value="password">Username &amp; password</option></Select></Field>
          <Field label={draft.authType === 'token' ? 'Token ID' : 'Username'}><Input value={draft.username} disabled={pending} onChange={e => change('username', e.target.value)} /></Field>
          <Field label="New secret" help="Leave blank to keep the saved credential."><Input type="password" autoComplete="new-password" value={draft.secret} disabled={pending} onChange={e => change('secret', e.target.value)} /></Field>
          {needsSecret && <p className="text-[12px] text-muted">Enter a new credential when changing authentication or username.</p>}
          <label className="flex items-center justify-between gap-3 text-[13px]"><span>Verify TLS certificate</span><Switch checked={draft.verifyTls} disabled={pending} onCheckedChange={v => change('verifyTls', v)} /></label>
          <p className="text-[12px] text-muted">Open terminals keep their current session. Revoke old credentials separately in Proxmox.</p>
          {tested && <p role="status" className="text-[13px] text-success">Connection verified.</p>}
        </>}
        {error && <p role="alert" className="text-[13px] text-destructive">{typeof error.message === 'string' && error.message ? error.message : 'Could not update connection settings.'}</p>}
        {error?.status === 409 && <Button type="button" disabled={pending} onClick={() => void load()}>Reload saved settings</Button>}
      </DialogBody>
      <DialogFooter>
        <Button type="button" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button type="button" disabled={!draft || pending || needsSecret} onClick={() => void submit(false)}>{testing ? 'Testing…' : 'Test'}</Button>
        <Button type="button" variant="primary" disabled={!draft || pending || needsSecret} onClick={() => void submit(true)}>{saving ? 'Saving…' : 'Save changes'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
