import { useState, type ReactNode } from 'react'
import { Button } from './ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from './ui/dialog'
import { Input } from './ui/form'

export interface ConfirmRequest {
  title: string
  body: ReactNode
  confirmLabel: string
  destructive?: boolean
  /** require typing this text to enable the confirm button */
  typeToConfirm?: string
  onConfirm: () => Promise<unknown> | void
}

export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = () => {
    setTyped('')
    setError(null)
    onClose()
  }
  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && !busy && close()}>
      {request && (
        <DialogContent title={request.title} className="max-w-md" onEscapeKeyDown={event => { if (busy) event.preventDefault() }} onInteractOutside={event => { if (busy) event.preventDefault() }}>
          <DialogBody className="space-y-3 text-[13px] text-muted">
            <div>{request.body}</div>
            {request.typeToConfirm && (
              <div className="space-y-1.5">
                <div>
                  Type <code className="text-foreground">{request.typeToConfirm}</code> to confirm.
                </div>
                <Input aria-label="Confirmation name" value={typed} onChange={(e) => setTyped(e.target.value)} disabled={busy} autoFocus />
              </div>
            )}
            {error && <p role="alert" className="text-destructive">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button onClick={close} disabled={busy}>Cancel</Button>
            <Button
              variant={request.destructive ? 'destructive' : 'primary'}
              loading={busy}
              disabled={!!request.typeToConfirm && typed !== request.typeToConfirm}
              onClick={async () => {
                setBusy(true)
                setError(null)
                try {
                  await request.onConfirm()
                  close()
                } catch (failure) {
                  setError(failure instanceof Error ? failure.message : 'The request failed. Try again.')
                } finally {
                  setBusy(false)
                }
              }}
            >
              {request.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
