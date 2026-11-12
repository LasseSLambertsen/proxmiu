import RFB from '@novnc/novnc'
import { useEffect, useRef, useState } from 'react'
import type { ConsoleTarget, TerminalStatus } from './Terminal'
import { Button } from './ui/button'
import { Field, Input, Textarea } from './ui/form'
import { agentWsUrl, getAgent } from '@/lib/agent'

export default function GraphicalConsole({ target, onStatus }: { target: ConsoleTarget; onStatus: (status: TerminalStatus, message?: string) => void }) {
  const display = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<RFB | null>(null)
  const statusRef = useRef(onStatus)
  statusRef.current = onStatus
  const [connected, setConnected] = useState(false)
  const [fit, setFit] = useState(true)
  const [textOpen, setTextOpen] = useState(false)
  const [text, setText] = useState('')
  const [textSent, setTextSent] = useState(false)
  const clipboardBytes = new TextEncoder().encode(text).length

  useEffect(() => {
    let active = true, failed = false, handedOff = false
    let rfb: RFB | undefined
    const socket = new WebSocket(agentWsUrl('/api/graphical-console'))
    socket.binaryType = 'arraybuffer'
    const reportError = (message: string) => {
      if (!active) return
      failed = true; setConnected(false)
      statusRef.current('error', message)
      rfb?.disconnect(); socket.close()
    }
    statusRef.current('connecting')
    socket.onopen = () => {
      if (!active) return
      socket.send(JSON.stringify({ type: 'connect', clusterId: target.clusterId, node: target.node, guestType: target.guestType, vmid: target.vmid, token: getAgent()?.token }))
    }
    socket.onmessage = event => {
      if (!active || handedOff) return
      try {
        if (typeof event.data !== 'string' || event.data.length > 8192) throw new Error('Invalid setup frame')
        const message = JSON.parse(event.data)
        if (message.type === 'error') return reportError(typeof message.message === 'string' ? message.message.slice(0, 1000) : 'The graphical console could not connect.')
        if (message.type === 'status' && message.status === 'connecting') return
        if (message.type !== 'ready' || !display.current) throw new Error('Invalid setup frame')
        // The package is loaded before this component mounts; attach synchronously
        // so the next binary event belongs entirely to noVNC.
        handedOff = true
        rfb = new RFB(display.current, socket, { shared: true })
        rfbRef.current = rfb
        rfb.resizeSession = false; rfb.scaleViewport = true; rfb.focusOnClick = true
        rfb.addEventListener('connect', () => {
          if (!active) return
          setConnected(true); statusRef.current('connected'); rfb?.focus()
        })
        rfb.addEventListener('disconnect', event => {
          if (!active || failed) return
          setConnected(false)
          const clean = (event as CustomEvent<{ clean: boolean }>).detail?.clean
          statusRef.current(clean ? 'closed' : 'error', clean ? undefined : 'The graphical console disconnected. Reconnect deliberately.')
        })
        rfb.addEventListener('securityfailure', () => reportError('Graphical console authentication failed. Reconnect deliberately.'))
        rfb.addEventListener('credentialsrequired', () => reportError('The graphical console requested unsupported authentication.'))
      } catch { reportError('The graphical console could not initialize. Reconnect deliberately.') }
    }
    socket.onerror = () => reportError('Could not reach the graphical console. Check the agent connection and HTTPS settings.')
    socket.onclose = () => { if (active && !failed) { setConnected(false); statusRef.current('closed') } }
    return () => {
      active = false
      rfbRef.current = null
      rfb?.disconnect()
      // noVNC needs its close handler to finish teardown and clear its timer.
      if (!rfb) { socket.onmessage = null; socket.onopen = null; socket.onclose = null; socket.onerror = () => {} }
      socket.close()
    }
  }, [target.clusterId, target.node, target.guestType, target.vmid])

  const sendKeys = (value: string) => {
    if (!connected) return
    for (const char of value.slice(0, 256)) {
      const code = char.codePointAt(0)!
      rfbRef.current?.sendKey(code === 10 || code === 13 ? 0xff0d : code <= 255 ? code : 0x01000000 | code)
    }
  }
  return <div className="flex h-full min-h-0 flex-col overflow-hidden">
    <div className="flex shrink-0 flex-wrap gap-2 border-b border-border-subtle bg-inset px-4 py-2">
      <Button size="sm" variant="ghost" disabled={!connected} onClick={() => rfbRef.current?.focus()}>Focus display</Button>
      <Button size="sm" variant="ghost" disabled={!connected} onClick={() => rfbRef.current?.sendCtrlAltDel()}>Ctrl+Alt+Delete</Button>
      <Button size="sm" variant="ghost" disabled={!connected} onClick={() => { const next = !fit; setFit(next); if (rfbRef.current) rfbRef.current.scaleViewport = next }}>{fit ? 'Actual size' : 'Fit display'}</Button>
      <Button size="sm" variant="ghost" disabled={!connected} aria-expanded={textOpen} onClick={() => setTextOpen(value => !value)}>Send text to guest</Button>
    </div>
    {textOpen && <section aria-label="Keyboard and text" className="min-h-0 max-h-[40vh] shrink space-y-3 overflow-y-auto bg-inset px-4 py-3">
      <Field label="Type into guest" help="Characters are sent as keys. Works without guest clipboard support."><Input aria-label="Type into guest" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} maxLength={256} disabled={!connected} placeholder="Open your phone keyboard here" onChange={event => { sendKeys(event.target.value); event.target.value = '' }} onKeyDown={event => {
        const key = { Enter: 0xff0d, Backspace: 0xff08, Tab: 0xff09, Escape: 0xff1b, ArrowLeft: 0xff51, ArrowUp: 0xff52, ArrowRight: 0xff53, ArrowDown: 0xff54 }[event.key]
        if (connected && key) { event.preventDefault(); event.stopPropagation(); rfbRef.current?.sendKey(key) }
      }} /></Field>
      <div className="flex flex-wrap gap-2">{[['Enter', 0xff0d], ['Tab', 0xff09], ['Backspace', 0xff08], ['Escape', 0xff1b]].map(([label, key]) => <Button key={label} size="sm" variant="outline" disabled={!connected} onClick={() => rfbRef.current?.sendKey(Number(key))}>{label}</Button>)}</div>
      <Field label="Clipboard text" help="Send deliberately; guest clipboard support is required. Your system clipboard is never read or changed automatically."><Textarea aria-label="Clipboard text" rows={2} maxLength={65536} value={text} disabled={!connected} onChange={event => { setText(event.target.value); setTextSent(false) }} /></Field>
      {clipboardBytes > 65536 && <p role="alert" className="text-[12px] text-warning">Clipboard text must be at most 64 KiB.</p>}
      <div className="flex flex-wrap items-center gap-3"><Button size="sm" variant="outline" disabled={!connected || !text || clipboardBytes > 65536} onClick={() => { rfbRef.current?.clipboardPasteFrom(text); setText(''); setTextSent(true) }}>Send clipboard text</Button>{textSent && <p role="status" className="text-[12px] text-muted">Text sent to the console clipboard.</p>}</div>
    </section>}
    <div ref={display} aria-label="Graphical console display" role="application" tabIndex={0} onFocus={event => { if (event.target === event.currentTarget) rfbRef.current?.focus() }} className="min-h-[80px] flex-1 overflow-auto bg-inset focus-within:ring-2 focus-within:ring-inset focus-within:ring-brand" />
  </div>
}
