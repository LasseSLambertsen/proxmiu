import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal as XTerm } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef } from 'react'
import { agentWsUrl, getAgent, isMixedContent } from '@/lib/agent'

export interface SshTarget {
  host: string
  port?: number
  username: string
  password?: string
  privateKey?: string
  useAppKey?: boolean
}

export type TerminalStatus = 'connecting' | 'connected' | 'closed' | 'error'

export function Terminal({ target, onStatus }: { target: SshTarget; onStatus?: (s: TerminalStatus, message?: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus

  useEffect(() => {
    const term = new XTerm({
      fontFamily: '"Geist Mono Variable", ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      theme: {
        background: '#0b0b0d',
        foreground: '#e4e4e7',
        cursor: '#8b7bff',
        cursorAccent: '#0b0b0d',
        selectionBackground: 'rgba(139,123,255,0.3)',
        black: '#18181b',
        brightBlack: '#71717a',
        red: '#f87171',
        brightRed: '#fca5a5',
        green: '#4ade80',
        brightGreen: '#86efac',
        yellow: '#facc15',
        brightYellow: '#fde047',
        blue: '#60a5fa',
        brightBlue: '#93c5fd',
        magenta: '#c084fc',
        brightMagenta: '#d8b4fe',
        cyan: '#22d3ee',
        brightCyan: '#67e8f9',
        white: '#d4d4d8',
        brightWhite: '#fafafa',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(ref.current!)
    fit.fit()
    term.focus()

    const ws = new WebSocket(agentWsUrl('/api/ssh'))
    const send = (msg: object) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg))
    let failed = false

    term.writeln(`\x1b[38;2;113;113;122mConnecting to ${target.username}@${target.host}…\x1b[0m`)
    onStatusRef.current?.('connecting')
    ws.onopen = () => send({ type: 'connect', ...target, token: getAgent()?.token, cols: term.cols, rows: term.rows })
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.type === 'data') term.write(msg.data)
      else if (msg.type === 'status') onStatusRef.current?.(msg.status)
      else if (msg.type === 'error') {
        failed = true
        term.writeln(`\r\n\x1b[38;2;248;113;113m${msg.message}\x1b[0m`)
        onStatusRef.current?.('error', msg.message)
      }
    }
    let opened = false
    ws.addEventListener('open', () => (opened = true))
    ws.onclose = () => {
      if (!opened) {
        term.writeln('\r\n\x1b[38;2;248;113;113mCould not open a connection to the agent.\x1b[0m')
        if (isMixedContent(agentWsUrl('').replace(/^ws/, 'http'))) {
          term.writeln('\x1b[38;2;113;113;122mThis page is https and the agent is http; the browser may block the terminal. Serve the agent over https (PROXMIU_TLS=1 or Tailscale).\x1b[0m')
        }
        onStatusRef.current?.('error', 'Could not connect')
      } else if (!failed) {
        term.writeln('\r\n\x1b[38;2;113;113;122m[connection closed]\x1b[0m')
        onStatusRef.current?.('closed')
      }
    }
    const data = term.onData((d) => send({ type: 'data', data: d }))
    const resize = term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }))
    const observer = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* element detached */
      }
    })
    observer.observe(ref.current!)

    return () => {
      observer.disconnect()
      data.dispose()
      resize.dispose()
      ws.close()
      term.dispose()
    }
    // Reconnect only when the target identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.host, target.port, target.username, target.password, target.privateKey, target.useAppKey])

  return <div ref={ref} className="h-full w-full overflow-hidden bg-[#0b0b0d] p-2" />
}
