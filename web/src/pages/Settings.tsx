import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CloudDownload, KeyRound, Loader2, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog, type ConfirmRequest } from '@/components/ConfirmDialog'
import { CopyButton } from '@/components/CopyButton'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api, type SelfUpdate } from '@/lib/api'
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
  const [waiting, setWaiting] = useState(false)
  const regenerate = useMutation({
    mutationFn: () => api.post('/settings/ssh-key/regenerate'),
    onSuccess: () => {
      toast.success('New key generated')
      qc.invalidateQueries({ queryKey: ['settings'] })
    },
  })
  const selfUpdate = useQuery({
    queryKey: ['self-update'],
    queryFn: () => api.get<SelfUpdate>('/self-update'),
    refetchInterval: (q) => (waiting || q.state.data?.status.state === 'running' ? 2000 : false),
  })
  const updateAgent = useMutation({
    mutationFn: () => api.post('/self-update'),
    onSuccess: () => {
      setWaiting(true)
      toast.success('Update started')
      selfUpdate.refetch()
    },
    onError: (err) => toast.error(err.message),
  })
  const status = selfUpdate.data?.status.state ?? 'idle'
  const showRunning = waiting || status === 'running'

  useEffect(() => {
    if (status === 'running') setWaiting(true)
  }, [status])

  useEffect(() => {
    if (!waiting) return
    if (status === 'success') {
      setWaiting(false)
      toast.success('Proxmiu updated')
      setTimeout(() => window.location.reload(), 800)
    } else if (status === 'failed') {
      setWaiting(false)
      toast.error('Update failed. Check journalctl -u proxmiu-self-update on the agent host.')
    }
  }, [status, waiting])

  const askUpdate = () =>
    setConfirm({
      title: 'Update Proxmiu?',
      body: 'Downloads the latest agent version, rebuilds it and restarts the service. Settings, data and connections are kept. This page reloads when the agent is back.',
      confirmLabel: 'Update agent',
      onConfirm: () => updateAgent.mutateAsync(),
    })

  const install = data ? `mkdir -p ~/.ssh && echo '${data.sshPublicKey}' >> ~/.ssh/authorized_keys` : ''
  const enableUpdate = [
    '# Proxmox LXC',
    'pct exec <CTID> -- env PROXMIU_ALLOW_SELF_UPDATE=1 /opt/proxmiu/scripts/install.sh',
    '# Debian or Ubuntu',
    'sudo env PROXMIU_ALLOW_SELF_UPDATE=1 /opt/proxmiu/scripts/install.sh',
  ].join('\n')

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
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CloudDownload className="size-4 text-faint" strokeWidth={1.5} />
              Updates
            </CardTitle>
            {selfUpdate.data?.enabled && (
              <Button onClick={askUpdate} loading={updateAgent.isPending || waiting} disabled={showRunning}>
                <CloudDownload strokeWidth={1.5} />
                Update agent
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3 text-[13px] text-muted">
            {showRunning ? (
              <p className="flex items-start gap-2 text-brand">
                <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" strokeWidth={2} />
                Updating Proxmiu… this can take a few minutes. The page reloads when the agent is back.
              </p>
            ) : selfUpdate.isError ? (
              <p className="text-destructive">{selfUpdate.error?.message}</p>
            ) : selfUpdate.isLoading ? (
              <p>Checking for updates…</p>
            ) : !selfUpdate.data?.enabled ? (
              <>
                <p>
                  Self-update is off. Re-run the installer with <code className="text-foreground">PROXMIU_ALLOW_SELF_UPDATE=1</code> to install the narrow helper used by this button.
                </p>
                <div className="flex items-start gap-2 rounded-md border border-border bg-inset p-3">
                  <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-[12px] text-muted">{enableUpdate}</pre>
                  <CopyButton text={enableUpdate} />
                </div>
              </>
            ) : (
              <>
                <p>Downloads the latest agent version, rebuilds it and restarts the service. Settings, data and connections are kept.</p>
                {status === 'success' && (
                  <p className="text-success">
                    Last update succeeded {selfUpdate.data.status.finishedAt ? timeAgo(selfUpdate.data.status.finishedAt) : 'just now'}.
                  </p>
                )}
                {status === 'failed' && (
                  <p className="text-destructive">
                    Last update failed{selfUpdate.data.status.finishedAt ? ` ${timeAgo(selfUpdate.data.status.finishedAt)}` : ''}. Check{' '}
                    <code className="text-foreground">journalctl -u proxmiu-self-update</code> on the agent host.
                  </p>
                )}
                {status === 'idle' && <p className="text-faint">No update has run from this page yet.</p>}
              </>
            )}
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}
