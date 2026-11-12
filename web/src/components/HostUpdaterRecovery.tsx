import { CopyButton } from '@/components/CopyButton'
import type { HostTarget } from '@/lib/host-updates'

const packageLogs = [
  'tail -n 100 /var/log/apt/term.log',
  'tail -n 100 /var/log/apt/history.log',
  'tail -n 100 /var/log/dpkg.log',
].join('\n')

export function HostUpdaterRecovery({ target, unresolved }: { target: HostTarget; unresolved: boolean }) {
  const worker = target.job ? `journalctl --no-pager -u proxmiu-host-update-${target.job.id} -n 100` : undefined

  return (
    <details className="rounded-xl border border-border-subtle p-4 text-[13px]">
      <summary className="cursor-pointer font-medium">Enrollment and manual recovery</summary>
      <div className="mt-4 space-y-5 text-muted">
        {target.configured && (
          <section className="space-y-3" aria-label="Refresh host helper">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium text-foreground">Refresh the host helper</h3>
              <CopyButton text={target.setupCommand} label="Copy helper command" />
            </div>
            <p>Run the full command as root on <code className="break-all text-foreground">{target.node}</code> to refresh its helper with the same dedicated key. Updating the Proxmiu agent alone does not update host helpers.</p>
            {unresolved && <p role="status" className="text-warning">An update is active or unresolved. Wait for a verified terminal result before refreshing the helper.</p>}
            <pre className="whitespace-pre-wrap break-all rounded-lg bg-inset p-3 font-mono text-[12px]">{target.setupCommand}</pre>
            <p>After the command succeeds, use Refresh status and Check updates to build a new plan.</p>
          </section>
        )}

        <section className="space-y-3" aria-label="Dedicated updater key">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium text-foreground">Dedicated updater public key</h3>
            <CopyButton text={target.publicKey} label="Copy public key" />
          </div>
          <code className="block break-all rounded-lg bg-inset p-3 text-[12px]">{target.publicKey}</code>
          <p>This key is separate from guest access. To revoke enrollment, remove this exact key from the host’s authorized_keys file.</p>
        </section>

        <section className="space-y-3 border-t border-border-subtle pt-4" aria-label="Worker service events">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium text-foreground">Worker service events</h3>
            {worker && <CopyButton text={worker} label="Copy worker command" />}
          </div>
          {worker ? <pre className="whitespace-pre-wrap break-all rounded-lg bg-inset p-3 font-mono text-[12px]">{worker}</pre> : <p>A job-specific service command will appear after an update check is accepted.</p>}
          <p>The service journal shows worker events. Detailed package errors may be in the APT or dpkg logs below.</p>
        </section>

        <section className="space-y-3" aria-label="Package details on the host">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium text-foreground">Package details on the host</h3>
            <CopyButton text={packageLogs} label="Copy package log commands" />
          </div>
          <pre className="whitespace-pre-wrap break-all rounded-lg bg-inset p-3 font-mono text-[12px]">{packageLogs}</pre>
          <p>Copy these commands and run them on the Proxmox node. These host-wide logs may include other maintenance; Proxmiu does not collect their output.</p>
          <p>Failed or interrupted work needs local inspection. Proxmiu does not run package repair or reboot automatically.</p>
        </section>
      </div>
    </details>
  )
}
