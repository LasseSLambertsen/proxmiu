import { ExternalLink, KeyRound, Plug, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { CopyButton } from './CopyButton'
import { Terminal, type SshTarget, type TerminalStatus } from './Terminal'
import { Button } from './ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from './ui/dialog'
import { Field, Input, Select, Textarea } from './ui/form'

export interface SshRequest {
  host: string
  label: string
  defaultUser: string
}

type AuthMode = 'app' | 'password' | 'key'

export function SshDialog({ request, onClose }: { request: SshRequest | null; onClose: () => void }) {
  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()}>
      {request && <SshDialogInner key={request.host} request={request} />}
    </Dialog>
  )
}

function SshDialogInner({ request }: { request: SshRequest }) {
  const [username, setUsername] = useState(request.defaultUser)
  const [port, setPort] = useState(22)
  const [mode, setMode] = useState<AuthMode>('app')
  const [password, setPassword] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [target, setTarget] = useState<SshTarget | null>(null)
  const [status, setStatus] = useState<TerminalStatus>('connecting')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    api.get<{ username: string | null }>(`/ssh/user?host=${encodeURIComponent(request.host)}`).then((r) => {
      if (r.username) setUsername(r.username)
    })
  }, [request.host])

  const connect = () => {
    setTarget({
      host: request.host,
      port,
      username,
      useAppKey: mode === 'app',
      password: mode === 'password' ? password : undefined,
      privateKey: mode === 'key' ? privateKey : undefined,
    })
    setAttempt((a) => a + 1)
  }

  const command = `ssh ${port !== 22 ? `-p ${port} ` : ''}${username}@${request.host}`
  const popOut = () => {
    const params = new URLSearchParams({ host: request.host, user: username, port: String(port) })
    window.open(`/terminal?${params}`, '_blank', 'noopener')
  }

  if (target) {
    return (
      <DialogContent
        title={`${username}@${request.host}`}
        description={request.label}
        className="h-[min(760px,90vh)] max-w-[min(1200px,calc(100vw-32px))]"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="min-h-0 flex-1">
          <Terminal key={attempt} target={target} onStatus={setStatus} />
        </div>
        <DialogFooter className="justify-between">
          <span className={cn('flex items-center gap-2 text-[12px]', status === 'error' ? 'text-destructive' : 'text-faint')}>
            <span className={cn('size-1.5 rounded-full', status === 'connected' ? 'bg-success' : status === 'error' ? 'bg-destructive' : 'bg-faint')} />
            {status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting…' : status === 'error' ? 'Connection failed' : 'Disconnected'}
          </span>
          <div className="flex gap-2">
            {mode === 'app' && <Button onClick={popOut}><ExternalLink strokeWidth={1.5} />Open in tab</Button>}
            <Button onClick={() => setTarget(null)}>Change login</Button>
            <Button onClick={() => setAttempt((a) => a + 1)}>
              <RotateCcw strokeWidth={1.5} />
              Reconnect
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    )
  }

  return (
    <DialogContent title={`SSH to ${request.label}`} description={request.host}>
      <form
        className="contents"
        onSubmit={(e) => {
          e.preventDefault()
          connect()
        }}
      >
        <DialogBody className="space-y-3">
          <div className="grid grid-cols-[1fr_88px] gap-3">
            <Field label="User">
              <Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            </Field>
            <Field label="Port">
              <Input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
            </Field>
          </div>
          <Field label="Authentication">
            <Select value={mode} onChange={(e) => setMode(e.target.value as AuthMode)}>
              <option value="app">Proxmiu key (guests created here)</option>
              <option value="password">Password</option>
              <option value="key">Private key</option>
            </Select>
          </Field>
          {mode === 'password' && (
            <Field label="Password">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          )}
          {mode === 'key' && (
            <Field label="Private key" help="Used for this session only; never stored.">
              <Textarea rows={5} className="font-mono text-[12px]" value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
            </Field>
          )}
          <div className="flex items-center justify-between rounded-md border border-border bg-inset px-3 py-2">
            <code className="truncate text-muted">{command}</code>
            <CopyButton text={command} />
          </div>
        </DialogBody>
        <DialogFooter>
          <span className="mr-auto flex items-center gap-1.5 text-[12px] text-faint">
            <KeyRound className="size-3.5" strokeWidth={1.5} />
            Add the Proxmiu public key to a host under Settings.
          </span>
          <Button variant="primary" type="submit" disabled={!username}>
            <Plug strokeWidth={1.5} />
            Connect
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
