import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Box, MonitorCog, MoreHorizontal, Play, Power, RefreshCw, RotateCw, Square, SquareTerminal, Star, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api, type Guest, type Job } from '@/lib/api'
import { cn, formatBytes, formatUptime, pct } from '@/lib/utils'
import { guestHref, guestKey } from '@/lib/guest-workspace'
import { useGuestMetadata, useSaveGuestMetadata } from '@/lib/queries'
import { ConfirmDialog, type ConfirmRequest } from './ConfirmDialog'
import { CopyButton } from './CopyButton'
import { Meter } from './Meter'
import { SshDialog, type SshRequest } from './SshDialog'
import { StatusDot } from './StatusDot'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'

type Action = 'start' | 'shutdown' | 'stop' | 'reboot'
const verbs: Record<Action, string> = { start: 'Starting', shutdown: 'Shutting down', stop: 'Stopping', reboot: 'Rebooting' }

const guestPath = (g: Guest) => `/clusters/${g.clusterId}/guests/${g.node}/${g.type}/${g.vmid}`

export function useGuestAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ guest, action }: { guest: Guest; action: Action }) => api.post(`${guestPath(guest)}/${action}`),
    onMutate: ({ guest, action }) => {
      toast.loading(`${verbs[action]} ${guest.name ?? guest.vmid}…`, { id: `${guest.id}-${action}` })
    },
    onSuccess: (_d, { guest, action }) => {
      toast.success(`${verbs[action]} ${guest.name ?? guest.vmid}: sent`, { id: `${guest.id}-${action}` })
      qc.invalidateQueries({ queryKey: ['overview'] })
      qc.invalidateQueries({ queryKey: ['ips'] })
    },
    onError: (err, { guest, action }) => toast.error(err.message, { id: `${guest.id}-${action}` }),
  })
}

export function useGuestUpdate() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: (guest: Guest) => api.post<Job>('/updates', { clusterId: guest.clusterId, node: guest.node, type: guest.type, vmid: guest.vmid }),
    onMutate: (guest) => {
      toast.loading(`Updating ${guest.name ?? guest.vmid}…`, { id: `${guest.id}-update` })
    },
    onSuccess: (job, guest) => {
      toast.success(`Update started for ${guest.name ?? guest.vmid}`, { id: `${guest.id}-update` })
      qc.invalidateQueries({ queryKey: ['jobs'] })
      navigate(`/activity/${job.id}`)
    },
    onError: (err, guest) => toast.error(err.message, { id: `${guest.id}-update` }),
  })
}

const templateTag = (g: Guest) =>
  g.tags
    ?.split(/[;,]/)
    .map((t) => t.trim())
    .filter((t) => t && t !== 'proxmiu')

export function GuestTable({ guests, ips, showCluster, selected, onSelect, selectionDisabled = false }: { guests: Guest[]; ips: Record<string, Record<string, string>>; showCluster: boolean; selected?: Set<string>; onSelect?: (guest: Guest, checked: boolean) => void; selectionDisabled?: boolean }) {
  const action = useGuestAction()
  const update = useGuestUpdate()
  const qc = useQueryClient()
  const [ssh, setSsh] = useState<SshRequest | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const metadata = useGuestMetadata()
  const saveMetadata = useSaveGuestMetadata()
  const pinButton = (guest: Guest) => {
    const pinned = metadata.data?.[guestKey(guest)]?.favorite ?? false
    return <Button size="icon-sm" variant="ghost" title={pinned ? 'Unpin guest' : 'Pin guest'} aria-label={`${pinned ? 'Unpin' : 'Pin'} ${guest.name ?? guest.vmid}`} aria-pressed={pinned} disabled={metadata.isPending || !!metadata.error || saveMetadata.isPending} className={pinned ? 'text-brand' : 'text-faint'} onClick={() => saveMetadata.mutate({ guest, patch: { favorite: !pinned } }, { onError: error => toast.error(error.message) })}><Star className={pinned ? 'fill-current' : ''} strokeWidth={1.5} /></Button>
  }

  const ipOf = (g: Guest) => ips[g.clusterId]?.[`${g.type}/${g.vmid}`]
  const run = (guest: Guest, a: Action) => action.mutate({ guest, action: a })
  const isProxmiu = (g: Guest) => g.tags?.split(/[;,]/).includes('proxmiu')

  const ask = (guest: Guest, a: Action) => {
    const name = guest.name ?? String(guest.vmid)
    if (a === 'start') return run(guest, a)
    const copy = {
      shutdown: ['Shut down', 'Sends an ACPI shutdown so the guest can stop cleanly.'],
      reboot: ['Reboot', 'The guest restarts and will be unreachable for a moment.'],
      stop: ['Force stop', 'Stops the guest immediately, like pulling the power cord. Unsaved data is lost.'],
    }[a]
    setConfirm({
      title: `${copy[0]} ${name}?`,
      body: copy[1],
      confirmLabel: copy[0],
      destructive: a === 'stop',
      onConfirm: () => run(guest, a),
    })
  }

  const askUpdate = (guest: Guest) => {
    const name = guest.name ?? String(guest.vmid)
    setConfirm({
      title: `Update ${name}?`,
      body: "Runs the template's update script inside the guest. Options use their defaults; secrets saved during setup stay in place. The app may restart while it updates; SSH stays available.",
      confirmLabel: 'Update',
      onConfirm: () => update.mutate(guest),
    })
  }

  const destroy = (guest: Guest) => {
    const name = guest.name ?? String(guest.vmid)
    setConfirm({
      title: `Delete ${name}?`,
      body: `This stops ${guest.type === 'lxc' ? 'container' : 'VM'} ${guest.vmid} and permanently deletes it, including its disks. There is no undo.`,
      confirmLabel: 'Delete permanently',
      destructive: true,
      typeToConfirm: name,
      onConfirm: async () => {
        const id = toast.loading(`Deleting ${name}…`)
        try {
          await api.del(guestPath(guest))
          toast.success(`${name} deleted`, { id })
          qc.invalidateQueries({ queryKey: ['overview'] })
        } catch (err) {
          toast.error((err as Error).message, { id })
          throw err
        }
      },
    })
  }

  const renderActions = (g: Guest) => {
    const running = g.status === 'running'
    const ip = ipOf(g)
    return (
        <div className="flex items-center justify-end gap-1">
          {running ? (
            <Button
              size="icon-sm"
              variant="ghost"
              title={ip ? `SSH to ${ip}` : 'Waiting for an IP address'}
              disabled={!ip}
              onClick={() => ip && setSsh({ host: ip, label: g.name ?? String(g.vmid), defaultUser: isProxmiu(g) ? 'dev' : 'root' })}
            >
              <SquareTerminal strokeWidth={1.5} />
            </Button>
          ) : (
            <Button size="icon-sm" variant="ghost" title="Start" onClick={() => run(g, 'start')}>
              <Play strokeWidth={1.5} />
            </Button>
          )}
          {running && (
            <Button size="icon-sm" variant="ghost" title="Reboot" onClick={() => ask(g, 'reboot')}>
              <RotateCw strokeWidth={1.5} />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" title="More">
                <MoreHorizontal strokeWidth={1.5} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>{g.type === 'lxc' ? 'Container' : 'Virtual machine'} {g.vmid}</DropdownMenuLabel>
              <DropdownMenuItem disabled={running} onSelect={() => run(g, 'start')}>
                <Play />
                Start
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!running} onSelect={() => ask(g, 'reboot')}>
                <RotateCw />
                Reboot
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!running} onSelect={() => ask(g, 'shutdown')}>
                <Power />
                Shut down
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!running} onSelect={() => ask(g, 'stop')}>
                <Square />
                Force stop
              </DropdownMenuItem>
              {isProxmiu(g) && (
                <DropdownMenuItem disabled={!running} onSelect={() => askUpdate(g)}>
                  <RefreshCw />
                  Update…
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => destroy(g)}>
                <Trash2 />
                Delete…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
    )
  }

  return (
    <>
      <ul className="divide-y divide-border-subtle sm:hidden">
        {guests.map((g) => {
          const ip = ipOf(g)
          const tags = templateTag(g)
          return (
            <li key={`${g.clusterId}-${g.id}`} className="space-y-2.5 px-4 py-3">
              <div className="flex items-start gap-2.5">
                {onSelect && <label className="-m-1 mt-0 cursor-pointer p-1"><input type="checkbox" aria-label={`Select ${g.name ?? g.vmid}`} checked={selected?.has(guestKey(g)) ?? false} disabled={selectionDisabled} onChange={event => onSelect(g, event.target.checked)} className="size-4 shrink-0 cursor-pointer accent-brand disabled:cursor-not-allowed" /></label>}
                <StatusDot status={g.status} className="mt-1.5" />
                <div className="min-w-0 flex-1">
                  <Link to={guestHref(g)} className="break-words font-medium text-foreground hover:text-brand hover:underline underline-offset-4">{g.name ?? `VM ${g.vmid}`}</Link>
                  <div className="tnum mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-muted"><span>{g.vmid} · {g.node}</span>{ip && <span className="inline-flex items-center gap-0.5"><span>{ip}</span><CopyButton text={ip} /></span>}</div>
                </div>
                {pinButton(g)}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex min-w-0 flex-wrap items-center gap-2"><span className="text-[11px] text-faint">{g.status === 'running' ? `${((g.cpu ?? 0) * 100).toFixed(0)}% CPU` : g.status}</span>{tags?.slice(0, 1).map(tag => <Badge key={tag} tone={isProxmiu(g) ? 'brand' : 'neutral'}>{tag}</Badge>)}</div>{renderActions(g)}</div>
            </li>
          )
        })}
      </ul>
      <div className="overflow-x-auto max-sm:hidden">
        <table className="w-full min-w-[860px] text-[13px]">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-border text-left">
              {onSelect && <th scope="col" className="w-9 pl-4"><span className="sr-only">Selection</span></th>}
              <th className="eyebrow px-4 py-2 font-medium">Name</th>
              <th className="eyebrow px-3 py-2 font-medium">Node</th>
              <th className="eyebrow px-3 py-2 font-medium">Address</th>
              <th className="eyebrow w-32 px-3 py-2 font-medium">CPU</th>
              <th className="eyebrow w-36 px-3 py-2 font-medium">Memory</th>
              <th className="eyebrow px-3 py-2 font-medium">Uptime</th>
              <th className="w-24 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {guests.map((g) => {
              const running = g.status === 'running'
              const ip = ipOf(g)
              const tags = templateTag(g)
              const Icon = g.type === 'lxc' ? Box : MonitorCog
              return (
                <tr key={`${g.clusterId}-${g.id}`} className="group h-11 border-b border-border-subtle last:border-0 hover:bg-hover">
                  {onSelect && <td className="pl-4"><input type="checkbox" aria-label={`Select ${g.name ?? g.vmid}`} checked={selected?.has(guestKey(g)) ?? false} disabled={selectionDisabled} onChange={event => onSelect(g, event.target.checked)} className="size-4 cursor-pointer accent-brand disabled:cursor-not-allowed" /></td>}
                  <td className="px-4">
                    <div className="flex items-center gap-2.5">
                      <StatusDot status={g.status} />
                      <Icon className="size-4 shrink-0 text-faint" strokeWidth={1.5} />
                      {pinButton(g)}
                      <Link to={guestHref(g)} className="truncate font-medium hover:text-brand hover:underline underline-offset-4">{g.name ?? `VM ${g.vmid}`}</Link>
                      <span className="tnum font-mono text-[12px] text-faint">{g.vmid}</span>
                      {tags?.slice(0, 2).map((t) => (
                        <Badge key={t} tone={isProxmiu(g) ? 'brand' : 'neutral'}>
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 text-muted">
                    {g.node}
                    {showCluster && <span className="text-faint"> · {g.clusterName}</span>}
                  </td>
                  <td className="px-3">
                    {ip ? (
                      <span className="inline-flex items-center gap-0.5">
                        <span className="tnum font-mono text-[12px]">{ip}</span>
                        <span className="opacity-0 transition-opacity group-hover:opacity-100">
                          <CopyButton text={ip} />
                        </span>
                      </span>
                    ) : (
                      <span className="text-faint">{running ? '…' : '—'}</span>
                    )}
                  </td>
                  <td className="px-3">
                    {running ? (
                      <div className="space-y-1">
                        <div className="tnum text-[12px] text-muted">
                          {((g.cpu ?? 0) * 100).toFixed(0)}% <span className="text-faint">of {g.maxcpu}</span>
                        </div>
                        <Meter value={(g.cpu ?? 0) * 100} />
                      </div>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="px-3">
                    {running ? (
                      <div className="space-y-1">
                        <div className="tnum text-[12px] text-muted">
                          {formatBytes(g.mem, 1)} <span className="text-faint">/ {formatBytes(g.maxmem, 0)}</span>
                        </div>
                        <Meter value={pct(g.mem, g.maxmem)} />
                      </div>
                    ) : (
                      <span className="text-faint">{formatBytes(g.maxmem, 0)}</span>
                    )}
                  </td>
                  <td className="tnum px-3 text-muted">{running ? formatUptime(g.uptime) : <span className="text-faint">{g.status}</span>}</td>
                  <td className="px-3">
                    {renderActions(g)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <SshDialog request={ssh} onClose={() => setSsh(null)} />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}
