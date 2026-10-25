import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog, type ConfirmRequest } from '@/components/ConfirmDialog'
import { CopyButton } from '@/components/CopyButton'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import { timeAgo } from '@/lib/utils'

interface Settings {
  sshPublicKey: string
  sshKeyCreatedAt: string
  authRequired: boolean
}

export function SettingsPage() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings') })
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const regenerate = useMutation({
    mutationFn: () => api.post('/settings/ssh-key/regenerate'),
    onSuccess: () => {
      toast.success('New key generated')
      qc.invalidateQueries({ queryKey: ['settings'] })
    },
  })
  const install = data ? `mkdir -p ~/.ssh && echo '${data.sshPublicKey}' >> ~/.ssh/authorized_keys` : ''

  return (
    <>
      <PageHeader title="Settings" />
      <div className="max-w-3xl space-y-4 px-8 pb-10 max-md:px-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-faint" strokeWidth={1.5} />
              Proxmiu SSH key
            </CardTitle>
            <Button
              onClick={() =>
                setConfirm({
                  title: 'Generate a new key?',
                  body: 'Guests and nodes that only trust the current key will stop accepting the in-browser terminal until you add the new one.',
                  confirmLabel: 'Generate new key',
                  destructive: true,
                  onConfirm: () => regenerate.mutateAsync(),
                })
              }
            >
              <RefreshCw strokeWidth={1.5} />
              Regenerate
            </Button>
          </CardHeader>
          <CardContent className="space-y-4 text-[13px]">
            <p className="text-muted">
              Added to every VM and container Proxmiu creates, so the in-browser terminal and provisioning can log in. Add it to your Proxmox
              nodes to open terminals on them too.
            </p>
            <div className="flex items-start gap-2 rounded-md border border-border bg-inset p-3">
              <code className="min-w-0 flex-1 break-all text-[12px]">{data?.sshPublicKey}</code>
              {data && <CopyButton text={data.sshPublicKey} />}
            </div>
            <div>
              <div className="eyebrow mb-1.5">Trust it on a host</div>
              <div className="flex items-start gap-2 rounded-md border border-border bg-inset p-3">
                <code className="min-w-0 flex-1 break-all text-[12px] text-muted">{install}</code>
                {data && <CopyButton text={install} />}
              </div>
            </div>
            {data && <p className="text-[12px] text-faint">Created {timeAgo(data.sshKeyCreatedAt)}.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {data?.authRequired ? (
                <ShieldCheck className="size-4 text-success" strokeWidth={1.5} />
              ) : (
                <ShieldAlert className="size-4 text-warning" strokeWidth={1.5} />
              )}
              Access
            </CardTitle>
          </CardHeader>
          <CardContent className="text-[13px] text-muted">
            {data?.authRequired ? (
              'A password is required to use this app. Change it with the PROXMIU_PASSWORD environment variable.'
            ) : (
              <>
                No password is set, so Proxmiu only listens on this machine. To use it from other devices on your network, start it with{' '}
                <code className="text-foreground">PROXMIU_PASSWORD</code> set.
              </>
            )}
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}
