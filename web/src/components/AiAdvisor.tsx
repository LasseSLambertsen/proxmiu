import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye, Save, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ConfirmDialog, type ConfirmRequest } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/form'
import { api, type AiContext, type AiSettings } from '@/lib/api'
import { useAiSettings } from '@/lib/queries'

const defaultModels: Record<AiSettings['provider'], string> = { openai: 'gpt-4o-mini', anthropic: 'claude-sonnet-4-5' }

export function AiAdvisor() {
  const qc = useQueryClient()
  const settings = useAiSettings()
  const [provider, setProvider] = useState<AiSettings['provider']>('openai')
  const [model, setModel] = useState(defaultModels.openai)
  const [token, setToken] = useState('')
  const [edited, setEdited] = useState(false)
  const [preview, setPreview] = useState<AiContext | null>(null)
  const [consent, setConsent] = useState(false)
  const [advice, setAdvice] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)

  useEffect(() => {
    if (settings.data && !edited) {
      setProvider(settings.data.provider)
      setModel(settings.data.model)
    }
  }, [settings.data, edited])

  const save = useMutation({
    mutationFn: () => api.put<AiSettings>('/ai/settings', { provider, model: model.trim(), ...(token ? { token } : {}) }),
    onSuccess: data => {
      setToken('')
      setEdited(false)
      setConsent(false)
      qc.setQueryData(['ai-settings'], data)
    },
  })
  const remove = useMutation({
    mutationFn: () => api.del<AiSettings>('/ai/settings'),
    onSuccess: data => {
      qc.setQueryData(['ai-settings'], data)
      setToken('')
      setEdited(false)
      setConsent(false)
      setPreview(null)
      setAdvice(null)
      save.reset()
    },
  })
  const inventory = useMutation({
    mutationFn: () => api.get<AiContext>('/ai/context'),
    onSuccess: data => { setPreview(data); setConsent(false); setAdvice(null); review.reset() },
  })
  const review = useMutation({
    mutationFn: (context: AiContext) => api.post<{ advice: string }>('/ai/review', { consent: true, context }),
    onSuccess: data => setAdvice(data.advice),
  })
  const tokenRequired = !settings.data?.configured || settings.data.provider !== provider
  const configured = !!settings.data?.configured
  const busy = save.isPending || remove.isPending || review.isPending
  const providerLabel = settings.data?.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'

  return <Card>
    <CardHeader className="items-start py-4">
      <div className="flex items-center gap-3"><img src={`${import.meta.env.BASE_URL}logo.png`} alt="Proxmiu lynx" className="size-14 shrink-0 object-contain" /><div><CardTitle>AI optimization advisor</CardTitle><p className="mt-1 text-[12px] text-muted">A second look at your homelab’s resources.</p></div></div>
    </CardHeader>
    <CardContent className="space-y-5 text-[13px]">
      <p className="leading-relaxed text-muted">Choose a provider and save an API token encrypted on your agent. Each review sends only the inventory you preview below. AI offers suggestions; you decide what to change.</p>
      {settings.isPending && <p role="status" className="text-[12px] text-muted">Loading AI settings…</p>}
      {settings.error && <p role="alert" className="text-[12px] text-destructive">AI settings could not load: {settings.error.message} <button className="underline underline-offset-4" onClick={() => settings.refetch()}>Try again</button></p>}
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); save.mutate() }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Provider"><Select aria-label="Provider" value={provider} disabled={!settings.data || busy} onChange={event => { const value = event.target.value as AiSettings['provider']; setProvider(value); setModel(defaultModels[value]); setToken(''); setEdited(true); setConsent(false) }}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></Select></Field>
          <Field label="Model" help="Use a model available to your provider account."><Input aria-label="Model" value={model} maxLength={100} required disabled={!settings.data || busy} onChange={event => { setModel(event.target.value); setEdited(true); setConsent(false) }} /></Field>
        </div>
        <Field label="API token" help={tokenRequired ? 'A token is required for this provider. It is never sent back to your browser after saving.' : 'Leave empty to keep the saved token, or enter a replacement.'}>
          <Input aria-label="API token" type="password" autoComplete="new-password" spellCheck={false} value={token} required={tokenRequired} maxLength={1000} disabled={!settings.data || busy} placeholder={configured && !tokenRequired ? 'Saved token kept private' : 'Paste your provider API token'} onChange={event => { setToken(event.target.value); setEdited(true) }} />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span role="status" className={`text-[12px] ${configured ? 'text-success' : 'text-muted'}`}>{configured ? 'Token saved on your agent' : 'No AI token configured'}</span>
          <div className="flex flex-wrap gap-2">{configured && <Button type="button" variant="destructive" disabled={busy} onClick={() => setConfirm({ title: 'Remove the saved AI token?', body: 'The agent will remove the encrypted token. Add a token again before requesting another review.', confirmLabel: 'Remove token', destructive: true, onConfirm: () => remove.mutateAsync() })}><Trash2 />Remove token</Button>}<Button type="submit" loading={save.isPending} disabled={!settings.data || busy || !model.trim() || (tokenRequired && !token.trim()) || !edited}><Save />Save AI settings</Button></div>
        </div>
        {save.error && <p role="alert" className="text-[12px] text-destructive">Settings were not saved: {save.error.message}</p>}
      </form>
      <section aria-label="Inventory review" className="space-y-4 border-t border-border-subtle pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1 basis-48"><h4 className="text-[13px] font-semibold">Review resource usage</h4><p className="mt-1 text-[12px] leading-relaxed text-muted">Preview guest types, status and numeric resource readings. Names, IP addresses, notes, logs and credentials are excluded. Your provider may charge for a review.</p></div><Button loading={inventory.isPending} disabled={!configured || busy || edited} onClick={() => { setConsent(false); inventory.mutate() }}><Eye />Preview inventory</Button></div>
        {edited && <p className="text-[12px] text-warning">Save your AI settings before preparing a review.</p>}
        {inventory.error && <p role="alert" className="text-[12px] text-destructive">Inventory could not load: {inventory.error.message} Try previewing again.</p>}
        {preview && <>
          <p className="text-[12px] text-muted">This exact inventory will be sent to {providerLabel} using <span className="break-all font-mono">{settings.data?.model}</span>.{preview.unavailableConnections > 0 && ` ${preview.unavailableConnections} connection${preview.unavailableConnections === 1 ? ' is' : 's are'} unavailable; advice will be based on partial inventory.`}</p>
          <pre aria-label="Inventory preview" tabIndex={0} className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-inset p-3 font-mono text-[11px] leading-relaxed text-muted">{JSON.stringify(preview, null, 2)}</pre>
          <label className="flex cursor-pointer items-start gap-2.5 text-[12px] leading-relaxed"><input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-brand" checked={consent} disabled={!configured || busy || edited || inventory.isPending} onChange={event => setConsent(event.target.checked)} /><span>Send this inventory to the configured AI provider for this review.</span></label>
          <Button variant="primary" loading={review.isPending} disabled={!configured || !consent || busy || edited || inventory.isPending} onClick={() => { setConsent(false); setAdvice(null); review.mutate(preview) }}><Sparkles />Request advice</Button>
          {review.error && <p role="alert" className="text-[12px] text-destructive">{review.error.message}</p>}
          {review.isPending && <p role="status" className="text-[12px] text-muted">Reviewing this inventory. No changes are being made.</p>}
        </>}
        {advice !== null && <div className="space-y-3 rounded-md bg-inset p-4"><h4 className="flex items-center gap-2 text-[13px] font-semibold"><Sparkles className="size-4 text-brand" />Suggestions for your review</h4><p aria-label="AI advice" className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{advice}</p><p className="text-[12px] text-muted">Check each suggestion against your workloads and Proxmox configuration before making changes.</p></div>}
      </section>
    </CardContent>
    <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
  </Card>
}
