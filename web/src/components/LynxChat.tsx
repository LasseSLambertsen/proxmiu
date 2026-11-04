import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Send, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, type AiChatReply, type AiSettings, type AiSetupPreview, type AiSetupProposal, type AiSetupTarget, type GuestResourceSettings } from '@/lib/api'
import { getAgent } from '@/lib/agent'
import { guestApiPath, guestKey } from '@/lib/guest-workspace'
import { useAiSettings, useGuests } from '@/lib/queries'
import { Button } from './ui/button'
import { Dialog, DialogContent } from './ui/dialog'
import { Field, Select, Textarea } from './ui/form'

const providerLabels: Record<AiSettings['provider'], string> = { openai: 'OpenAI', anthropic: 'Anthropic', openrouter: 'OpenRouter' }
type Message = { role: 'user' | 'assistant'; content: string; proposal?: AiSetupProposal; applied?: boolean }
type WakeEvent = CustomEvent<{ trigger: HTMLElement; moveFocus: boolean }>
const targetKey = (target: AiSetupTarget) => `${guestKey(target)}/${target.node}`
const targetLabel = (target: AiSetupTarget) => `${target.name} · ${target.type === 'qemu' ? 'VM' : 'CT'} ${target.vmid} · ${target.node} · Connection ${target.clusterId}`

export function LynxChat() {
  const { data: settings } = useAiSettings()
  if (!settings?.configured) return null
  return <ChatSession key={`${getAgent()?.url ?? ''}:${settings.provider}:${settings.model}`} settings={settings} />
}

function ChatSession({ settings }: { settings: AiSettings }) {
  const qc = useQueryClient()
  const inventory = useGuests()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<AiSetupTarget | null>(null)
  const [preview, setPreview] = useState<AiSetupPreview | null>(null)
  const [previewPending, setPreviewPending] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)
  const [clock, setClock] = useState(Date.now)
  const [reviewIndex, setReviewIndex] = useState<number | null>(null)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const transcript = useRef<HTMLDivElement>(null)
  const busy = useRef(false)
  const applyBusy = useRef(false)
  const generation = useRef(0)
  const provider = providerLabels[settings.provider]
  const content = draft.trim()
  const guests = inventory.guests.filter(guest => !guest.template && (guest.type === 'qemu' || guest.type === 'lxc'))
  const selectedLive = selected ? guests.find(guest => guestKey(guest) === guestKey(selected)) : undefined
  const moved = !!selectedLive && selectedLive.node !== selected?.node
  const expired = !!preview && Date.parse(preview.expiresAt) <= clock
  const conversationLimit = messages.length >= 20 || messages.some(message => message.content.length > 4000)
  const totalLimit = messages.reduce((sum, message) => sum + message.content.length, 0) + content.length > 20000
  const tooLong = content.length > 4000
  const canSend = !!content && !pending && !previewPending && !applying && !conversationLimit && !totalLimit && !tooLong && !(consent && expired)

  function discardActions() {
    setMessages(previous => previous.map(message => message.applied ? message : { ...message, proposal: undefined }))
    setReviewIndex(null)
    setApplyError(null)
  }

  function clear() {
    generation.current++
    busy.current = false
    setPending(false)
    setPreviewPending(false)
    setMessages([])
    setDraft('')
    setError(null)
    setPreview(null)
    setConsent(false)
    setSetupError(null)
    setReviewIndex(null)
    setApplyError(null)
    input.current?.focus({ preventScroll: true })
  }

  useEffect(() => {
    const onWake = (event: Event) => {
      const wake = event as WakeEvent
      wake.preventDefault()
      trigger.current = wake.detail.trigger
      document.dispatchEvent(new CustomEvent('proxmiu:lynx-dismiss'))
      setOpen(true)
    }
    const onSettings = () => clear()
    document.addEventListener('proxmiu:lynx-wake', onWake)
    window.addEventListener('proxmiu:ai-settings-changed', onSettings)
    return () => {
      document.removeEventListener('proxmiu:lynx-wake', onWake)
      window.removeEventListener('proxmiu:ai-settings-changed', onSettings)
      generation.current++
      document.querySelectorAll('[data-lynx-wake]').forEach(button => {
        button.setAttribute('aria-expanded', 'false')
        button.setAttribute('aria-controls', 'proxmiu-lynx')
      })
    }
  }, [])

  useEffect(() => {
    document.querySelectorAll('[data-lynx-wake]').forEach(button => {
      button.setAttribute('aria-expanded', String(open))
      button.setAttribute('aria-controls', open ? 'proxmiu-lynx-chat' : 'proxmiu-lynx')
    })
  }, [open])

  useEffect(() => {
    if (!preview) return
    setClock(Date.now())
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [preview])

  useEffect(() => {
    if (expired) { setConsent(false); discardActions() }
  }, [expired])

  useEffect(() => {
    if (moved) { clear(); setSetupError('This guest moved to another node. Select its current entry and preview again.') }
  }, [moved])

  useEffect(() => {
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: 'instant' })
  }, [messages, pending, open, reviewIndex])

  async function prepare() {
    if (!selected || pending || applying || previewPending || moved) return
    const current = ++generation.current
    setPreview(null)
    setConsent(false)
    discardActions()
    setSetupError(null)
    setPreviewPending(true)
    const query = new URLSearchParams({ id: selected.clusterId, node: selected.node, type: selected.type, vmid: String(selected.vmid) })
    try {
      const data = await api.get<AiSetupPreview>(`/ai/setup-context?${query}`)
      if (current !== generation.current) return
      setClock(Date.now())
      setPreview(data)
    } catch (failure) {
      if (current === generation.current) setSetupError(failure instanceof Error ? failure.message : 'Setup could not load. Check the connection and preview again.')
    } finally { if (current === generation.current) setPreviewPending(false) }
  }

  async function send() {
    if (!canSend || busy.current) return
    if (consent && (!preview || Date.parse(preview.expiresAt) <= Date.now())) {
      setClock(Date.now()); setConsent(false); discardActions(); setSetupError('This preview expired. Refresh it and review sharing consent again.'); return
    }
    busy.current = true
    const current = ++generation.current
    const outbound = [...messages, { role: 'user' as const, content }]
    const shared = consent ? preview : null
    setPending(true)
    setError(null)
    try {
      const result = await api.post<AiChatReply>('/ai/chat', {
        messages: outbound.map(({ role, content }) => ({ role, content })),
        ...(shared ? { setup: { previewId: shared.previewId, consent: true } } : {}),
      })
      if (current !== generation.current) return
      const valid = shared && Date.parse(shared.expiresAt) > Date.now()
      setMessages([...outbound, { role: 'assistant', content: result.reply, ...(valid && result.proposal ? { proposal: result.proposal } : {}) }])
      setDraft('')
      setReviewIndex(null)
    } catch (failure) {
      if (current !== generation.current) return
      setError(failure instanceof Error ? failure.message : 'The message could not be sent. Try again.')
    } finally {
      if (current === generation.current) {
        busy.current = false
        setPending(false)
        input.current?.focus({ preventScroll: true })
      }
    }
  }

  async function apply(index: number) {
    const proposal = messages[index]?.proposal
    if (!proposal || messages[index].applied || applyBusy.current || !consent || !preview || Date.parse(preview.expiresAt) <= Date.now() || reviewIndex !== index) return
    applyBusy.current = true
    setApplying(true)
    setApplyError(null)
    const current = generation.current
    try {
      const saved = await api.put<GuestResourceSettings>(`${guestApiPath(proposal.target)}/resource-settings`, proposal.after)
      qc.setQueryData(['guest-resource-settings', guestKey(proposal.target), proposal.target.node], saved)
      void qc.invalidateQueries({ queryKey: ['guest-insights', guestKey(proposal.target)] })
      void qc.invalidateQueries({ queryKey: ['overview'] })
      if (current !== generation.current) return
      setMessages(previous => previous.map((message, i) => i === index ? { ...message, applied: true } : { ...message, proposal: undefined }))
      setReviewIndex(null)
      setConsent(false)
      setPreview(null)
    } catch (failure) {
      if (current === generation.current) setApplyError(failure instanceof Error ? failure.message : 'The changes were not saved. Refresh the preview before trying again.')
    } finally {
      applyBusy.current = false
      setApplying(false)
    }
  }

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogContent
      id="proxmiu-lynx-chat"
      title="Chat with Lynx"
      description={<span className="break-words">{provider} · {settings.model}</span>}
      className="h-[min(760px,calc(100dvh-32px))] max-h-[calc(100dvh-32px)] max-w-xl motion-reduce:animate-none"
      onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus({ preventScroll: true }) }}
      onCloseAutoFocus={event => { event.preventDefault(); if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }) }}
    >
      <p className="px-5 pb-3 pt-2 text-[12px] leading-relaxed text-muted">Your messages and conversation are sent to {provider}. No setup data is attached automatically. Chat stays in memory until cleared or AI settings change.</p>
      <div ref={transcript} className="min-h-0 flex-1 overflow-y-auto border-y border-border-subtle px-5 py-4">
        <details className="mb-4 rounded-md bg-inset px-3 py-2.5" data-setup-controls>
          <summary className="cursor-pointer text-[13px] font-medium">Help with my setup</summary>
          <div className="mt-3 space-y-3">
            <p className="text-[12px] leading-relaxed text-muted">Choose one guest. I’ll inspect its resource settings and a day of available usage, then help plan a measured change. Preview first; sharing is your call.</p>
            <Field label="Guest to inspect"><Select aria-label="Guest to inspect" value={selected ? targetKey(selected) : ''} disabled={applying} onChange={event => {
              const guest = guests.find(item => targetKey({ ...item, type: item.type as 'qemu' | 'lxc', name: item.name || `Guest ${item.vmid}` }) === event.target.value)
              clear()
              setSelected(guest ? { clusterId: guest.clusterId, node: guest.node, type: guest.type as 'qemu' | 'lxc', vmid: guest.vmid, name: guest.name || `Guest ${guest.vmid}` } : null)
            }}>
              <option value="">Select a guest…</option>
              {selected && !guests.some(guest => `${guestKey(guest)}/${guest.node}` === targetKey(selected)) && <option value={targetKey(selected)}>{targetLabel(selected)} · last selected</option>}
              {guests.map(guest => <option key={`${guestKey(guest)}/${guest.node}`} value={`${guestKey(guest)}/${guest.node}`}>{guest.clusterName} / {guest.name || `Guest ${guest.vmid}`} · {guest.type === 'qemu' ? 'VM' : 'CT'} {guest.vmid} · {guest.node}</option>)}
            </Select></Field>
            {guests.length === 0 && <p className="text-[12px] text-muted">No guests are available. Check Connections, then refresh the inventory.</p>}
            {(inventory.error || (selected && !selectedLive)) && <p className="text-[12px] text-warning">Inventory is unavailable for this selection. It is kept here; the agent will verify it when you preview.</p>}
            <Button size="sm" type="button" disabled={!selected || pending || applying || moved} loading={previewPending} onClick={() => void prepare()}>{preview ? 'Refresh setup preview' : 'Preview setup'}</Button>
            {setupError && <p role="alert" className="text-[12px] text-destructive">{setupError}</p>}
            {preview && <section aria-label="Setup preview" className="space-y-2 text-[12px] leading-relaxed">
              <p className="break-words font-medium">{targetLabel(preview.target)}</p>
              <p className="text-muted">{preview.before.cores ?? 'Unknown'} cores per socket × {preview.before.sockets} sockets · {preview.before.memoryMiB ?? 'Unknown'} MiB · Start on boot {preview.before.onboot ? 'on' : 'off'} · {preview.before.status}</p>
              <p className="text-muted">{preview.context.history.samples} history samples in the last day. {preview.context.history.cpuPeak !== undefined && `CPU peak ${(preview.context.history.cpuPeak * 100).toFixed(1)}%. `}{preview.context.history.unavailable || 'Limited history cannot establish workload needs or safe downsizing.'}</p>
              {!preview.before.editable && <p className="text-warning">{preview.before.reason}</p>}
              <p className="text-muted">Only the exact resource context below is shared with {providerLabels[preview.provider]} · {preview.model}. Names, IDs, addresses, notes, logs and credentials stay out. Expires {new Date(preview.expiresAt).toLocaleTimeString()}.</p>
              <details><summary className="cursor-pointer font-medium">Inspect exact shared context</summary><pre aria-label="Exact setup context" tabIndex={0} className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-md bg-inset p-2 font-mono text-[11px]">{JSON.stringify(preview.context, null, 2)}</pre></details>
              {expired ? <p role="status" className="text-warning">This preview expired. Refresh it and review sharing consent again.</p> : <label className="flex cursor-pointer items-start gap-2.5"><input type="checkbox" aria-label="Share this setup snapshot" checked={consent} disabled={applying} className="mt-0.5 size-4 shrink-0 accent-brand" onChange={event => {
                setConsent(event.target.checked)
                if (!event.target.checked) { generation.current++; busy.current = false; setPending(false); discardActions() }
              }} /><span>Share this exact setup snapshot with {providerLabels[preview.provider]} when I send messages.</span></label>}
              <p className="text-muted">Turning sharing off stops new attachments and removes unapplied proposals. Previously sent data cannot be recalled. Clear chat to remove local conversation history.</p>
            </section>}
          </div>
        </details>
        <div role="log" aria-label="Conversation with Lynx" aria-live="polite" aria-relevant="additions text" className="space-y-4">
          {messages.length === 0 && !pending && <div className="flex gap-3 py-3">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="size-10 shrink-0 rounded-lg" />
            <div className="min-w-0"><p className="font-medium">Lynx, at your service.</p><p className="mt-1 text-[13px] leading-relaxed text-muted">A keen eye for your homelab. Ask me about Proxmiu or Proxmox, or share a setup preview and we’ll find the next sensible move.</p><p className="mt-2 text-[12px] leading-relaxed text-muted">I can inspect what you choose to share and propose supported resource changes. You review and confirm every write. Keep credentials and other secrets out of chat.</p></div>
          </div>}
          {messages.map((message, index) => <div key={index} data-chat-message={message.role} className={message.role === 'user' ? 'ml-6 rounded-xl bg-inset px-3 py-2.5' : 'mr-2 py-1'}>
            <p className="mb-1 text-[12px] font-medium text-muted">{message.role === 'user' ? 'You' : 'Lynx'}</p>
            <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed [overflow-wrap:anywhere]">{message.content}</p>
            {message.proposal && <section aria-label="Proposed resource changes" className="mt-3 space-y-3 rounded-md bg-inset p-3 text-[12px]">
              <p className="break-words font-medium">{message.applied ? 'Changes saved' : 'Proposed allocation'} · {targetLabel(message.proposal.target)}</p>
              <ProposalValues proposal={message.proposal} />
              {message.applied ? <p role="status" className="text-success">The agent saved these settings in Proxmox. Refresh the preview before planning another change.</p> : <>
                <p className="leading-relaxed text-muted">This affects guest capacity and boot behavior. Check workload needs and backups. The guest must remain stopped; its configuration and pending changes are checked again before saving. Sockets and other settings are preserved.</p>
                {reviewIndex === index ? <>
                  <p className="font-medium">Confirm this exact change for {message.proposal.target.name}?</p>
                  {applyError && <p role="alert" className="text-destructive">{applyError} The proposal is kept. Refresh the setup preview if the configuration changed.</p>}
                  <div className="flex flex-wrap gap-2"><Button type="button" size="sm" loading={applying} disabled={!consent || expired || pending} onClick={() => void apply(index)}>Apply changes</Button><Button type="button" size="sm" variant="ghost" disabled={applying} onClick={() => { setReviewIndex(null); setApplyError(null) }}>Cancel review</Button></div>
                </> : <Button type="button" size="sm" disabled={!consent || expired || pending || applying} onClick={() => { setReviewIndex(index); setApplyError(null) }}>Review changes</Button>}
              </>}
            </section>}
          </div>)}
          {pending && <>
            <div className="ml-6 rounded-xl bg-inset px-3 py-2.5"><p className="mb-1 text-[12px] font-medium text-muted">You</p><p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed [overflow-wrap:anywhere]">{content}</p></div>
            <p aria-label="Lynx is replying" className="flex items-center gap-2 text-[12px] text-muted"><Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />Lynx is thinking…</p>
          </>}
        </div>
      </div>
      <form className="space-y-2.5 bg-inset px-5 py-3" onSubmit={event => { event.preventDefault(); void send() }}>
        {consent && preview && !expired && <p className="break-words text-[11px] text-muted">Sharing the approved resource snapshot for {preview.target.name} with this message.</p>}
        {error && <div role="alert" className="space-y-2 text-[12px] text-destructive"><p>{error}</p><Button type="button" size="sm" disabled={!canSend} onClick={() => void send()}>Retry message</Button></div>}
        {conversationLimit && <p className="text-[12px] text-warning">This conversation reached its message limit. Clear it to start a new conversation.</p>}
        {totalLimit && <p className="text-[12px] text-warning">This conversation is too long to send. Shorten your message or clear the conversation.</p>}
        {tooLong && <p className="text-[12px] text-warning">Keep your message within 4,000 characters.</p>}
        <label className="block space-y-1.5"><span className="text-[12px] font-medium text-muted">Message Lynx</span><Textarea ref={input} rows={3} value={draft} readOnly={pending || applying} placeholder="Ask about your homelab…" className="max-h-32 min-h-20 resize-y" onChange={event => { setDraft(event.target.value); setError(null) }} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send() }
        }} /></label>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="ghost" onClick={clear} disabled={applying || (!messages.length && !draft && !pending && !preview && !previewPending)}><Trash2 />Clear conversation</Button>
          <Button type="submit" variant="primary" size="md" disabled={!canSend} aria-label="Send message"><Send />Send</Button>
        </div>
        <p className="text-[11px] text-muted">Enter to send · Shift+Enter for a new line. AI can be wrong; check advice before acting.</p>
      </form>
    </DialogContent>
  </Dialog>
}

function ProposalValues({ proposal }: { proposal: AiSetupProposal }) {
  const { before, after } = proposal
  return <dl className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 gap-y-1.5 text-[12px] tnum" aria-label="Before and after allocation">
    <dt className="text-muted">Setting</dt><dd className="text-muted">Before</dd><dd className="text-muted">After</dd>
    <dt>Cores per socket ({before.sockets} sockets)</dt><dd>{before.cores}</dd><dd>{after.cores}</dd>
    <dt>Memory (MiB)</dt><dd>{before.memoryMiB}</dd><dd>{after.memoryMiB}</dd>
    <dt>Start on boot</dt><dd>{before.onboot ? 'On' : 'Off'}</dd><dd>{after.onboot ? 'On' : 'Off'}</dd>
  </dl>
}
