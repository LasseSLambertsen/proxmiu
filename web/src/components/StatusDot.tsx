import { cn } from '@/lib/utils'

const tones: Record<string, string> = {
  running: 'bg-success',
  online: 'bg-success',
  stopped: 'bg-faint',
  offline: 'bg-destructive',
  paused: 'bg-warning',
  suspended: 'bg-warning',
}

export function StatusDot({ status, className }: { status: string; className?: string }) {
  const live = status === 'running' || status === 'online'
  return (
    <span className={cn('relative inline-flex size-2 shrink-0', className)} title={status}>
      {live && <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-30 [animation-duration:2.5s]" />}
      <span className={cn('relative inline-block size-2 rounded-full', tones[status] ?? 'bg-faint')} />
    </span>
  )
}
