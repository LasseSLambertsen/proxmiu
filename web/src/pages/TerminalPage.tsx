import { useSearchParams } from 'react-router-dom'
import { Terminal } from '@/components/Terminal'

/** Full-window terminal, opened from the SSH dialog's "Open in tab". Uses the Proxmiu key. */
export function TerminalPage() {
  const [params] = useSearchParams()
  const host = params.get('host') ?? ''
  const username = params.get('user') ?? 'root'
  document.title = `${username}@${host} · Proxmiu`
  return (
    <div className="h-full bg-[#0b0b0d]">
      <Terminal target={{ host, username, port: Number(params.get('port') ?? 22), useAppKey: true }} />
    </div>
  )
}
