import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, RefreshCw, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ConfirmDialog, type ConfirmRequest } from '@/components/ConfirmDialog'
import { CopyButton } from '@/components/CopyButton'
import { HostUpdaterRecovery } from '@/components/HostUpdaterRecovery'
import { PageBody, PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/form'
import { getAgent } from '@/lib/agent'
import { api, ApiError } from '@/lib/api'
import type { HostJob, HostTarget } from '@/lib/host-updates'

export function HostUpdates() {
  const { clusterId = '', node = '' } = useParams()
  const [agent, setAgent] = useState(() => JSON.stringify(getAgent()))
  useEffect(() => {
    const change = () => setAgent(JSON.stringify(getAgent()))
    window.addEventListener('proxmiu-agent-change', change)
    return () => window.removeEventListener('proxmiu-agent-change', change)
  }, [])
  return <HostUpdateTarget key={`${agent}/${clusterId}/${node}`} clusterId={clusterId} node={node} agent={agent} />
}

function HostUpdateTarget({ clusterId, node, agent }: { clusterId: string; node: string; agent: string }) {
  const qc = useQueryClient()
  const base = `/clusters/${encodeURIComponent(clusterId)}/nodes/${encodeURIComponent(node)}/updater`
  const queryKey = ['host-updater', agent, clusterId, node]
  const [typed, setTyped] = useState('')
  const [clock, setClock] = useState(Date.now())
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const saved = useQuery({ queryKey: ['host-updaters', agent], queryFn: () => api.get<HostTarget[]>('/host-updaters'), retry: false })
  const info = useQuery({ queryKey, queryFn: () => api.get<HostTarget>(base), retry: false, refetchInterval: query => query.state.data?.configured ? 3000 : false })
  const target = info.data ?? saved.data?.find(t => t.clusterId === clusterId && t.node === node)
  const job = target?.job
  const plan = job?.state === 'review' ? job.plan : undefined
  const expired = !!plan && Date.parse(plan.expiresAt) <= clock
  const unresolved = !!target?.unresolved || job?.state === 'running'
  const unknown = !!info.error && !(info.error instanceof ApiError && info.error.status === 404 && !target)
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const updateTarget = (value: HostTarget) => { setTyped(''); qc.setQueryData(queryKey, value); qc.invalidateQueries({ queryKey: ['host-updaters', agent] }) }
  const updateJob = (value: HostJob) => {
    setTyped('')
    qc.setQueryData<HostTarget>(queryKey, previous => previous ? { ...previous, job: value, unresolved: value.state === 'running' } : previous)
    info.refetch()
  }
  const prepare = useMutation({ mutationFn: () => api.post<HostTarget>(base + '/setup'), onSuccess: updateTarget, retry: false })
  const check = useMutation({ mutationFn: () => api.post<HostJob>(base + '/check'), onSuccess: updateJob, onError: () => { setTyped(''); info.refetch(); saved.refetch() }, retry: false })
  const install = useMutation({ mutationFn: () => {
    if (!plan || expired || typed !== node) throw new Error('Review a current plan and type the node name first.')
    return api.post<HostJob>(base + '/apply', { planId: plan.id, digest: plan.digest, confirmNode: typed })
  }, onSuccess: updateJob, onError: () => { setTyped(''); info.refetch(); saved.refetch() }, retry: false })
  const pending = prepare.isPending || check.isPending || install.isPending
  const actionError = prepare.error ?? check.error ?? install.error
  const forget = () => setConfirm({ title: 'Forget updater access?', body: <>Removes this node’s updater key from Proxmiu. Revoke access on the host by removing its dedicated public key from <code>authorized_keys</code>. Other host keys stay in place.</>, typeToConfirm: node, confirmLabel: 'Forget local access', destructive: true, onConfirm: async () => {
    await api.del(base + '/configuration', { confirmNode: node })
    qc.removeQueries({ queryKey }); await saved.refetch(); info.refetch()
  } })

  return <>
    <PageHeader title="Node updates" description={<><span className="font-mono break-all">{node}</span> · Review and install updates within the current Proxmox release.</>} />
    <PageBody className="max-w-5xl space-y-4">
      <Link to="/settings" className="inline-flex items-center gap-2 text-[13px] text-muted hover:text-foreground"><ArrowLeft className="size-4" /> Settings and recovery</Link>
      {unknown && <div role="alert" className="rounded-xl border border-warning/30 bg-warning-soft p-4 text-[13px] text-warning">Live host status is unavailable. Saved information may be stale; accepted work can continue. <Button onClick={() => info.refetch()} loading={info.isFetching}>Recover status</Button></div>}
      {actionError && <p role="alert" className="rounded-xl bg-destructive-soft p-4 text-[13px] text-destructive">{actionError.message}</p>}
      {!target ? <Card><CardHeader><CardTitle>Opt in to restricted host updates</CardTitle></CardHeader><CardContent className="space-y-4 text-[13px] text-muted">
        <p>Keep the normal Proxmox connection limited. A dedicated key can inspect, check and install reviewed updates through a node-bound root helper.</p>
        <p>An administrator enrolls the helper on this node once. Host services may restart during installation; reboots remain a separate manual action.</p>
        <Button variant="primary" onClick={() => prepare.mutate()} loading={prepare.isPending} disabled={info.isPending || unknown}>Prepare restricted access</Button>
      </CardContent></Card> : <>
        {target.configured ? <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4 text-brand" /> Restricted updater access</CardTitle><Badge tone={target.info?.ready ? 'success' : 'warning'}>{target.info?.ready ? 'Ready' : 'Needs attention'}</Badge></CardHeader><CardContent className="space-y-3 text-[13px]">
          <p className="text-muted">Proxmox {target.info?.proxmoxVersion || 'version unavailable'} · {target.info?.codename || 'OS unavailable'} · <span className="font-mono break-all">{target.configuration?.host}:{target.configuration?.port}</span></p>
          {target.info?.reason && <p role="alert" className="text-warning">{target.info.reason.message}</p>}
          <div className="flex flex-wrap gap-2"><Button variant="primary" onClick={() => check.mutate()} loading={check.isPending} disabled={pending || unresolved || unknown || !target.info?.ready}><RefreshCw /> Check updates</Button><Button onClick={() => info.refetch()} loading={info.isFetching}>Refresh status</Button><Button variant="ghost" disabled={pending || unresolved} onClick={forget}>Forget access…</Button></div>
        </CardContent></Card> : <AccessSetup key={target.revision} target={target} base={base} onSaved={updateTarget} />}
        {job && <Card><CardHeader><CardTitle>{job.phase === 'check' ? 'Update check' : 'Reviewed installation'}</CardTitle><Badge tone={job.state === 'failed' || job.state === 'interrupted' ? 'destructive' : job.state === 'success' ? 'success' : 'warning'}>{({ running: 'Running', review: 'Ready to review', success: 'Succeeded', failed: 'Failed', interrupted: 'Interrupted' })[job.state]}</Badge></CardHeader><CardContent className="space-y-4 text-[13px]">
          {(unresolved || job.state === 'running') && <p className="text-muted">Accepted work continues on the host when you leave this page.</p>}
          {target.unresolved && job.state !== 'running' && <p className="text-warning">The latest admission is unresolved. Recover status before another operation.</p>}
          {job.error && <p role="alert" className="text-destructive">{job.error.message}</p>}
          {job.state === 'success' && job.phase === 'check' && !job.plan?.packages.length && <p className="text-success">No package updates were proposed.</p>}
          <div role="log" aria-label="Host update events" className="space-y-1 rounded-lg bg-inset p-3 font-mono text-[12px] text-muted">{job.log.map((line, index) => <p key={index} className="break-words">{line}</p>)}</div>
          {job.logTruncated && <p className="text-muted">Older events were omitted to keep this view bounded. Inspect detailed diagnostics on the host.</p>}
          {(job.rebootSuggested || target.info?.rebootSuggested) && <p className="rounded-lg bg-warning-soft p-3 text-warning">A reboot may be needed. Review guest availability and reboot the node manually when ready.</p>}
        </CardContent></Card>}
        {plan && <Card><CardHeader><CardTitle>Review {plan.packages.length} package changes</CardTitle><Badge>Proxmox {plan.proxmoxMajor}</Badge></CardHeader><CardContent className="space-y-4 text-[13px]">
          <p className="text-muted">The complete plan includes new dependencies. Installation uses these exact versions and may restart host services. Existing configuration defaults are kept.</p>
          <p className={expired ? 'text-warning' : 'text-muted'}>{expired ? 'This plan expired. Check updates again before installing.' : `Review expires at ${new Date(plan.expiresAt).toLocaleTimeString()}. Host state must still match.`}</p>
          <ul aria-label="Reviewed packages" className="divide-y divide-border-subtle rounded-lg border border-border-subtle">{plan.packages.map(pkg => <li key={`${pkg.name}:${pkg.architecture}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 p-3 max-sm:grid-cols-1">
            <div className="min-w-0"><p className="break-all font-medium">{pkg.name}</p><span className="font-mono text-[12px] text-muted">{pkg.architecture}</span>{pkg.installed === null && <Badge className="ml-2" tone="info">New dependency</Badge>}</div>
            <p className="min-w-0 break-all font-mono text-[12px] text-muted">{pkg.installed ?? 'Not installed'} <span aria-label="to">→</span> <span className="text-foreground">{pkg.candidate}</span></p>
          </li>)}</ul>
          {plan.kernelChange && <p className="text-warning">Kernel packages are included. Plan a manual reboot after a verified installation.</p>}
          <Field label="Confirm node name" help={<>Type <code>{node}</code> to authorize this reviewed installation.</>}><Input aria-label="Confirm node name" value={typed} onChange={event => setTyped(event.target.value)} autoComplete="off" disabled={expired || pending || unresolved || unknown} /></Field>
          <Button variant="primary" onClick={() => install.mutate()} loading={install.isPending} disabled={typed !== node || expired || pending || unresolved || unknown || !target.info?.ready}>Install reviewed updates</Button>
        </CardContent></Card>}
        <HostUpdaterRecovery target={target} unresolved={unresolved} />
      </>}
    </PageBody>
    <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
  </>
}

function AccessSetup({ target, base, onSaved }: { target: HostTarget; base: string; onSaved: (target: HostTarget) => void }) {
  const [host, setHost] = useState(target.configuration?.host ?? '')
  const [port, setPort] = useState(String(target.configuration?.port ?? 22))
  const [fingerprint, setFingerprint] = useState(target.configuration?.fingerprint ?? '')
  const verify = useMutation({ mutationFn: () => api.put<HostTarget>(base + '/configuration', { host: host.trim(), port: Number(port), fingerprint: fingerprint.trim(), revision: target.revision }), onSuccess: onSaved, retry: false })
  return <Card><CardHeader><CardTitle>Enroll this node once</CardTitle></CardHeader><CardContent className="space-y-4 text-[13px]">
    <p className="text-muted">Run the setup command as root on <code>{target.node}</code>. It installs a restricted helper and this dedicated public key. Review the downloaded project source before running it.</p>
    <div><div className="mb-2 flex items-center justify-between"><span className="font-medium">Administrator setup command</span><CopyButton text={target.setupCommand} label="Copy command" /></div><pre className="whitespace-pre-wrap break-all rounded-lg bg-inset p-3 font-mono text-[12px] text-muted">{target.setupCommand}</pre></div>
    <div><span className="font-medium">Dedicated public key</span><div className="mt-2 flex items-start gap-2 rounded-lg bg-inset p-3"><code className="min-w-0 flex-1 break-all text-[12px] text-muted">{target.publicKey}</code><CopyButton text={target.publicKey} /></div></div>
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); verify.mutate() }}>
      <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-3"><Field label="SSH host"><Input value={host} onChange={e => setHost(e.target.value)} required autoComplete="off" placeholder="192.168.1.10" /></Field><Field label="SSH port"><Input type="number" min={1} max={65535} value={port} onChange={e => setPort(e.target.value)} required /></Field></div>
      <Field label="Host fingerprint" help="Copy the SHA256 ed25519 host fingerprint from the trusted installer output. Proxmiu refuses a different key."><Input aria-label="Host fingerprint" value={fingerprint} onChange={e => setFingerprint(e.target.value)} required autoComplete="off" placeholder="SHA256:…" /></Field>
      {verify.error && <p role="alert" className="text-destructive">{verify.error.message}</p>}
      <Button type="submit" variant="primary" loading={verify.isPending}>Verify updater access</Button>
    </form>
  </CardContent></Card>
}
