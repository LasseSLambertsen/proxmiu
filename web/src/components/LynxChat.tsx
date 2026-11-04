import { Loader2, Send, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, type AiSettings } from '@/lib/api'
import { getAgent } from '@/lib/agent'
import { useAiSettings } from '@/lib/queries'
import { Button } from './ui/button'
import { Dialog, DialogContent } from './ui/dialog'
import { Textarea } from './ui/form'

const providerLabels: Record<AiSettings['provider'], string> = { openai: 'OpenAI', anthropic: 'Anthropic', openrouter: 'OpenRouter' }

type Message = { role: 'user' | 'assistant'; content: string }
type WakeEvent = CustomEvent<{ trigger: HTMLElement; moveFocus: boolean }>

export function LynxChat() {
  const { data: settings } = useAiSettings()
  if (!settings?.configured) return null
  // A changed provider, model or agent starts a new memory-only conversation.
  return <ChatSession key={`${getAgent()?.url ?? ''}:${settings.provider}:${settings.model}`} settings={settings} />
}

function ChatSession({ settings }: { settings: AiSettings }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const transcript = useRef<HTMLDivElement>(null)
  const busy = useRef(false)
  const generation = useRef(0)
  const provider = providerLabels[settings.provider]
  const content = draft.trim()
  const conversationLimit = messages.length >= 20 || messages.some(message => message.content.length > 4000)
  const totalLimit = messages.reduce((sum, message) => sum + message.content.length, 0) + content.length > 20000
  const tooLong = content.length > 4000
  const canSend = !!content && !pending && !conversationLimit && !totalLimit && !tooLong

  useEffect(() => {
    const onWake = (event: Event) => {
      const wake = event as WakeEvent
      wake.preventDefault()
      trigger.current = wake.detail.trigger
      document.dispatchEvent(new CustomEvent('proxmiu:lynx-dismiss'))
      setOpen(true)
    }
    document.addEventListener('proxmiu:lynx-wake', onWake)
    return () => {
      document.removeEventListener('proxmiu:lynx-wake', onWake)
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
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: 'instant' })
  }, [messages, pending, open])

  async function send() {
    if (!canSend || busy.current) return
    busy.current = true
    const current = ++generation.current
    const outbound: Message[] = [...messages, { role: 'user', content }]
    setPending(true)
    setError(null)
    try {
      const { reply } = await api.post<{ reply: string }>('/ai/chat', { messages: outbound })
      if (current !== generation.current) return
      setMessages([...outbound, { role: 'assistant', content: reply }])
      setDraft('')
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

  function clear() {
    generation.current++
    busy.current = false
    setPending(false)
    setMessages([])
    setDraft('')
    setError(null)
    input.current?.focus({ preventScroll: true })
  }

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogContent
      id="proxmiu-lynx-chat"
      title="Chat with Lynx"
      description={<span className="break-words">{provider} · {settings.model}</span>}
      className="h-[min(680px,calc(100dvh-32px))] max-h-[calc(100dvh-32px)] max-w-xl motion-reduce:animate-none"
      onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus({ preventScroll: true }) }}
      onCloseAutoFocus={event => { event.preventDefault(); if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }) }}
    >
      <p className="px-5 pb-3 pt-2 text-[12px] leading-relaxed text-muted">Your messages and conversation are sent to {provider}. No setup data is attached automatically. Chat stays in memory until cleared or AI settings change.</p>
      <div ref={transcript} role="log" aria-label="Conversation with Lynx" aria-live="polite" aria-relevant="additions text" className="min-h-0 flex-1 space-y-4 overflow-y-auto border-y border-border-subtle px-5 py-4">
        {messages.length === 0 && !pending && <div className="flex gap-3 py-3">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="size-10 shrink-0 rounded-lg" />
          <div className="min-w-0"><p className="font-medium">Hi, I’m Lynx.</p><p className="mt-1 text-[13px] leading-relaxed text-muted">Ask me about Proxmiu, Proxmox or your homelab. I can help you think through a change; you decide what to do.</p><p className="mt-2 text-[12px] leading-relaxed text-muted">I can’t see your live setup or make changes. Avoid sharing credentials or other secrets.</p></div>
        </div>}
        {messages.map((message, index) => <div key={index} data-chat-message={message.role} className={message.role === 'user' ? 'ml-6 rounded-xl bg-inset px-3 py-2.5' : 'mr-2 py-1'}>
          <p className="mb-1 text-[12px] font-medium text-muted">{message.role === 'user' ? 'You' : 'Lynx'}</p>
          <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed [overflow-wrap:anywhere]">{message.content}</p>
        </div>)}
        {pending && <>
          <div className="ml-6 rounded-xl bg-inset px-3 py-2.5"><p className="mb-1 text-[12px] font-medium text-muted">You</p><p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed [overflow-wrap:anywhere]">{content}</p></div>
          <p aria-label="Lynx is replying" className="flex items-center gap-2 text-[12px] text-muted"><Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />Lynx is thinking…</p>
        </>}
      </div>
      <form className="space-y-2.5 bg-inset px-5 py-3" onSubmit={event => { event.preventDefault(); void send() }}>
        {error && <div role="alert" className="space-y-2 text-[12px] text-destructive"><p>{error}</p><Button type="button" size="sm" disabled={!canSend} onClick={() => void send()}>Retry message</Button></div>}
        {conversationLimit && <p className="text-[12px] text-warning">This conversation reached its message limit. Clear it to start a new conversation.</p>}
        {totalLimit && <p className="text-[12px] text-warning">This conversation is too long to send. Shorten your message or clear the conversation.</p>}
        {tooLong && <p className="text-[12px] text-warning">Keep your message within 4,000 characters.</p>}
        <label className="block space-y-1.5"><span className="text-[12px] font-medium text-muted">Message Lynx</span><Textarea ref={input} rows={3} value={draft} readOnly={pending} placeholder="Ask about your homelab…" className="max-h-32 min-h-20 resize-y" onChange={event => { setDraft(event.target.value); setError(null) }} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
            event.preventDefault()
            void send()
          }
        }} /></label>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="ghost" onClick={clear} disabled={!messages.length && !draft && !pending}><Trash2 />Clear conversation</Button>
          <Button type="submit" variant="primary" size="md" disabled={!canSend} aria-label="Send message"><Send />Send</Button>
        </div>
        <p className="text-[11px] text-muted">Enter to send · Shift+Enter for a new line. AI can be wrong; check advice before acting.</p>
      </form>
    </DialogContent>
  </Dialog>
}
