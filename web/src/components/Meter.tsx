import { cn } from '@/lib/utils'

export function Meter({ value, className }: { value: number; className?: string }) {
  const tone = value > 90 ? 'bg-destructive' : value > 75 ? 'bg-warning' : 'bg-brand'
  return (
    <div className={cn('h-1 w-full overflow-hidden rounded-full bg-hover', className)}>
      <div className={cn('h-full rounded-full transition-[width] duration-700 ease-out', tone)} style={{ width: `${Math.max(value, 1.5)}%` }} />
    </div>
  )
}
