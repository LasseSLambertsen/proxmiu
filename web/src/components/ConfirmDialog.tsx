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
  const close = () => {
    setTyped('')
    onClose()
  }
  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && close()}>
      {request && (
        <DialogContent title={request.title} className="max-w-md">
          <DialogBody className="space-y-3 text-[13px] text-muted">
            <div>{request.body}</div>
            {request.typeToConfirm && (
              <div className="space-y-1.5">
                <div>
                  Type <code className="text-foreground">{request.typeToConfirm}</code> to confirm.
                </div>
                <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button onClick={close}>Cancel</Button>
            <Button
              variant={request.destructive ? 'destructive' : 'primary'}
              loading={busy}
              disabled={!!request.typeToConfirm && typed !== request.typeToConfirm}
              onClick={async () => {
                setBusy(true)
                try {
                  await request.onConfirm()
                  close()
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
