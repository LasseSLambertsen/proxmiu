import { lazy, Suspense, useEffect, useState } from 'react'
import { Terminal, type ConsoleTarget, type TerminalStatus } from './Terminal'
import { Button } from './ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from './ui/dialog'
import { Field, Select } from './ui/form'

function GraphicalUnavailable({ onStatus }: { target: ConsoleTarget; onStatus: (status: TerminalStatus, message?: string) => void }) {
  useEffect(() => { onStatus('error', 'Graphical display could not load. Reload Proxmiu and reconnect.') }, [])
  return <p role="alert" className="p-5 text-[13px] text-muted">Choose Serial text, or reload Proxmiu to retry the graphical display.</p>
}
const GraphicalConsole = lazy(() => import('./GraphicalConsole').catch(() => ({ default: GraphicalUnavailable })))

export function GuestConsoleDialog({ target, onClose }: { target: ConsoleTarget | null; onClose: () => void }) {
  return <Dialog open={!!target} onOpenChange={open => !open && onClose()}>
    {target && <ConsoleSession key={`${target.clusterId}:${target.node}:${target.guestType}:${target.vmid}`} target={target} />}
  </Dialog>
}

function ConsoleSession({ target }: { target: ConsoleTarget }) {
  const [transport, setTransport] = useState<'graphical' | 'serial'>(target.guestType === 'qemu' ? 'graphical' : 'serial')
  const [attempt, setAttempt] = useState(0)
  const [active, setActive] = useState(false)
  const [status, setStatus] = useState<TerminalStatus>('closed')
  const [error, setError] = useState('')
  const connect = () => { setError(''); setStatus('connecting'); setAttempt(n => n + 1); setActive(true) }
  return <DialogContent title={`Console · ${target.guestType.toUpperCase()} ${target.vmid}`} description={`Node ${target.node} · Native Proxmox console`} className={active ? 'h-[min(760px,90vh)] max-w-[min(1200px,calc(100vw-32px))]' : ''} onInteractOutside={e => e.preventDefault()}>
    {target.guestType === 'qemu' && <div className="px-5 py-2"><Field label="Console type"><Select aria-label="Console type" value={transport} onChange={event => { setTransport(event.target.value as 'graphical' | 'serial'); setActive(false); setStatus('closed'); setError('') }}><option value="graphical">Graphical display</option><option value="serial">Serial text</option></Select></Field></div>}
    {active ? <div className="min-h-0 flex-1">{transport === 'graphical' ? <Suspense fallback={<p role="status" className="p-5 text-[13px] text-muted">Loading graphical display…</p>}><GraphicalConsole key={attempt} target={target} onStatus={(s, message) => { setStatus(s); if (message) setError(message) }} /></Suspense> : <Terminal key={attempt} target={target} onStatus={(s, message) => { setStatus(s); if (message) setError(message) }} />}</div> : <DialogBody><p className="text-[13px] text-muted">{transport === 'graphical' ? 'Connect to this VM’s graphical display. You may need to log in to the guest. Connecting does not start or configure it.' : 'Connect to the guest’s native text console. You may need to log in to the guest. Virtual machines require an existing serial socket.'}</p>{error && <p role="alert" className="mt-3 text-[13px] text-destructive">{error}</p>}</DialogBody>}
    <DialogFooter className="flex-wrap justify-between"><span role="status" className="text-[12px] text-muted">{error || (active ? status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Disconnected' : 'Ready to connect')}</span><div className="flex gap-2">{active && <Button onClick={() => { setActive(false); setStatus('closed') }}>Disconnect</Button>}<Button variant="primary" onClick={connect}>{active || attempt ? 'Reconnect' : 'Connect'}</Button></div></DialogFooter>
  </DialogContent>
}
