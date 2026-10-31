import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal as XTerm } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ClipboardPaste, Copy, CornerDownLeft, Eraser, TextCursor, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { agentWsUrl, getAgent, isMixedContent } from '@/lib/agent'
import { cn } from '@/lib/utils'

export interface SshTarget {
  host: string
  port?: number
  username: string
  password?: string
  privateKey?: string
  useAppKey?: boolean
}

export type TerminalStatus = 'connecting' | 'connected' | 'closed' | 'error'

type Mods = { ctrl: boolean; alt: boolean; shift: boolean }
const NO_MODS: Mods = { ctrl: false, alt: false, shift: false }

const SHIFT_MAP: Record<string, string> = {
  '`': '~', '1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^', '7': '&', '8': '*', '9': '(', '0': ')',
  '-': '_', '=': '+', '[': '{', ']': '}', '\\': '|', ';': ':', "'": '"', ',': '<', '.': '>', '/': '?',
}

const applyMods = (data: string, mods: Mods) => {
  if (!mods.ctrl && !mods.alt && !mods.shift) return data
  let out = data

  if (out.length === 1) {
    if (mods.shift) out = SHIFT_MAP[out] ?? out.toUpperCase()
    if (mods.ctrl) {
      const code = out.toUpperCase().charCodeAt(0)
      if (out === '?') out = '\x7f'
      else if (out === '/') out = '\x1f'
      else if (code >= 64 && code <= 95) out = String.fromCharCode(code - 64)
      else if (out === ' ') out = '\x00'
    }
    if (mods.alt) out = `\x1b${out}`
    return out
  }

  const modifier = 1 + (mods.shift ? 1 : 0) + (mods.alt ? 2 : 0) + (mods.ctrl ? 4 : 0)
  const cursor = /^\x1b\[([ABCDHF])$/.exec(out)
  if (cursor) return `\x1b[1;${modifier}${cursor[1]}`
  const page = /^\x1b\[([56])~$/.exec(out)
  if (page) return `\x1b[${page[1]};${modifier}~`
  if (out === '\t') {
    if (mods.shift) return '\x1b[Z'
    if (mods.alt) return '\x1b\t'
    return out
  }
  if (mods.alt) return `\x1b${out}`
  return out
}

export function Terminal({ target, onStatus }: { target: SshTarget; onStatus?: (s: TerminalStatus, message?: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const selectionRef = useRef('')
  const modsRef = useRef<Mods>(NO_MODS)
  const [mods, setModsState] = useState<Mods>(NO_MODS)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteValue, setPasteValue] = useState('')
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus

  const setMods = (patch: Partial<Mods>) => {
    const next = { ...modsRef.current, ...patch }
    modsRef.current = next
    setModsState(next)
  }
  const clearMods = () => {
    modsRef.current = NO_MODS
    setModsState(NO_MODS)
  }
  const toggleMod = (key: keyof Mods) => {
    setMods({ [key]: !modsRef.current[key] })
    termRef.current?.focus()
  }

  const sendData = (data: string) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'data', data }))
    termRef.current?.focus()
  }
  const sendKey = (data: string) => {
    sendData(applyMods(data, modsRef.current))
    clearMods()
  }

  const copySelection = async () => {
    const term = termRef.current
    const text = term?.getSelection() || selectionRef.current
    if (!text) {
      toast.info('Select some terminal text first')
      term?.focus()
      return
    }
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
      else {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(area)
        if (!ok) throw new Error('copy failed')
      }
      toast.success('Copied to clipboard')
    } catch {
      toast.error('Could not copy. Select the text and use your browser copy shortcut.')
    }
    term?.focus()
  }

  const insertText = (text: string) => {
    if (!text) return
    clearMods()
    termRef.current?.paste(text)
    termRef.current?.focus()
  }

  const pasteClipboard = async () => {
    try {
      if (!navigator.clipboard?.readText) throw new Error('clipboard unavailable')
      const text = await navigator.clipboard.readText()
      if (!text) {
        toast.info('The clipboard is empty')
        return
      }
      insertText(text)
    } catch {
      setPasteOpen(true)
      toast.info('Clipboard access is blocked. Paste into the box.')
    }
  }

  useEffect(() => {
    selectionRef.current = ''
    const term = new XTerm({
      fontFamily: '"Geist Mono Variable", ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 5000,
      cursorBlink: true,
      allowProposedApi: true,
      macOptionIsMeta: true,
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
    termRef.current = term

    const ws = new WebSocket(agentWsUrl('/api/ssh'))
    wsRef.current = ws
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

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      const primary = event.ctrlKey || event.metaKey
      if (primary && event.shiftKey && event.code === 'KeyC') {
        event.preventDefault()
        void copySelection()
        return false
      }
      if (primary && event.shiftKey && event.code === 'KeyV') {
        event.preventDefault()
        void pasteClipboard()
        return false
      }
      if (primary && event.shiftKey && event.code === 'KeyA') {
        event.preventDefault()
        term.selectAll()
        return false
      }
      if (event.metaKey && event.code === 'KeyC' && term.hasSelection()) {
        event.preventDefault()
        void copySelection()
        return false
      }
      if (event.metaKey && event.code === 'KeyV') {
        event.preventDefault()
        void pasteClipboard()
        return false
      }
      if (event.ctrlKey && event.code === 'Insert') {
        event.preventDefault()
        void copySelection()
        return false
      }
      if (event.shiftKey && event.code === 'Insert') {
        event.preventDefault()
        void pasteClipboard()
        return false
      }
      return true
    })

    const data = term.onData((d) => {
      const active = modsRef.current
      const hasMods = active.ctrl || active.alt || active.shift
      send({ type: 'data', data: hasMods ? applyMods(d, active) : d })
      if (hasMods) clearMods()
    })
    const selection = term.onSelectionChange(() => {
      selectionRef.current = term.getSelection()
    })
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
      selection.dispose()
      resize.dispose()
      termRef.current = null
      wsRef.current = null
      ws.close()
      term.dispose()
    }
    // Reconnect only when the target identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.host, target.port, target.username, target.password, target.privateKey, target.useAppKey])

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[#0b0b0d]">
      {pasteOpen && (
        <div className="absolute inset-x-2 top-2 z-30 rounded-lg border border-white/10 bg-[#18181b] p-3 text-zinc-200 shadow-2xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[12px] font-medium">Paste text</span>
            <button
              type="button"
              className="rounded p-1 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
              onClick={() => setPasteOpen(false)}
              aria-label="Close paste box"
            >
              <X className="size-3.5" strokeWidth={2} />
            </button>
          </div>
          <textarea
            autoFocus
            value={pasteValue}
            onChange={(e) => setPasteValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setPasteOpen(false)
              }
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                sendPaste()
              }
            }}
            rows={4}
            spellCheck={false}
            placeholder="Paste here, then send it to the terminal."
            className="w-full resize-y rounded-md border border-white/10 bg-[#0b0b0d] px-2 py-1.5 font-mono text-[12px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-400/60"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="rounded-md px-2.5 py-1 text-[12px] text-zinc-400 hover:bg-white/10 hover:text-zinc-200" onClick={() => setPasteOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              disabled={!pasteValue}
              className="rounded-md bg-violet-500 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-violet-400 disabled:pointer-events-none disabled:opacity-40"
              onClick={sendPaste}
            >
              Send
            </button>
          </div>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-white/10 bg-[#111114] px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ToolButton title="Copy selection" onClick={() => void copySelection()}>
          <Copy className="size-3.5" strokeWidth={1.8} />
          <span className="max-sm:hidden">Copy</span>
        </ToolButton>
        <ToolButton title="Paste from clipboard" onClick={() => void pasteClipboard()}>
          <ClipboardPaste className="size-3.5" strokeWidth={1.8} />
          <span className="max-sm:hidden">Paste</span>
        </ToolButton>
        <ToolButton
          title="Select all"
          onClick={() => {
            termRef.current?.selectAll()
            termRef.current?.focus()
          }}
        >
          <TextCursor className="size-3.5" strokeWidth={1.8} />
        </ToolButton>
        <ToolButton
          title="Clear the terminal"
          onClick={() => {
            termRef.current?.clear()
            termRef.current?.focus()
          }}
        >
          <Eraser className="size-3.5" strokeWidth={1.8} />
        </ToolButton>

        <Divider />

        <ToolButton title="Control (sticky)" active={mods.ctrl} onClick={() => toggleMod('ctrl')}>
          Ctrl
        </ToolButton>
        <ToolButton title="Alt / Meta (sticky)" active={mods.alt} onClick={() => toggleMod('alt')}>
          Alt
        </ToolButton>
        <ToolButton title="Shift (sticky)" active={mods.shift} onClick={() => toggleMod('shift')}>
          Shift
        </ToolButton>

        <Divider />

        <ToolButton title="Escape" onClick={() => sendKey('\x1b')}>Esc</ToolButton>
        <ToolButton title="Tab" onClick={() => sendKey('\t')}>Tab</ToolButton>
        <ToolButton title="Home" onClick={() => sendKey('\x1b[H')}>Home</ToolButton>
        <ToolButton title="End" onClick={() => sendKey('\x1b[F')}>End</ToolButton>
        <ToolButton title="Page up" onClick={() => sendKey('\x1b[5~')}>PgUp</ToolButton>
        <ToolButton title="Page down" onClick={() => sendKey('\x1b[6~')}>PgDn</ToolButton>

        <Divider />

        <ToolButton title="Up arrow" onClick={() => sendKey('\x1b[A')}>
          <ArrowUp className="size-3.5" strokeWidth={1.8} />
        </ToolButton>
        <ToolButton title="Down arrow" onClick={() => sendKey('\x1b[B')}>
          <ArrowDown className="size-3.5" strokeWidth={1.8} />
        </ToolButton>
        <ToolButton title="Left arrow" onClick={() => sendKey('\x1b[D')}>
          <ArrowLeft className="size-3.5" strokeWidth={1.8} />
        </ToolButton>
        <ToolButton title="Right arrow" onClick={() => sendKey('\x1b[C')}>
          <ArrowRight className="size-3.5" strokeWidth={1.8} />
        </ToolButton>
        <ToolButton title="Enter" onClick={() => sendKey('\r')}>
          <CornerDownLeft className="size-3.5" strokeWidth={1.8} />
        </ToolButton>
        <ToolButton title="Backspace" onClick={() => sendKey('\x7f')}>
          <span className="text-[15px] leading-none">⌫</span>
        </ToolButton>
        <ToolButton title="Delete" onClick={() => sendKey('\x1b[3~')}>Del</ToolButton>

        <Divider />

        <ToolButton title="Interrupt (Ctrl+C)" onClick={() => sendKey('\x03')}>^C</ToolButton>
        <ToolButton title="End of file (Ctrl+D)" onClick={() => sendKey('\x04')}>^D</ToolButton>
      </div>

      <div ref={ref} className="min-h-0 flex-1 overflow-hidden p-2" />
    </div>
  )

  function sendPaste() {
    const text = pasteValue
    if (!text) return
    insertText(text)
    setPasteValue('')
    setPasteOpen(false)
  }
}

function Divider() {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-white/10" />
}

function ToolButton({
  title,
  active,
  onClick,
  children,
}: {
  title: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active === undefined ? undefined : active}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 shrink-0 select-none items-center justify-center gap-1 rounded-md px-2 text-[11.5px] font-medium text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100 active:scale-[0.98]',
        active && 'bg-violet-500/20 text-violet-200 ring-1 ring-inset ring-violet-400/40',
      )}
    >
      {children}
    </button>
  )
}
