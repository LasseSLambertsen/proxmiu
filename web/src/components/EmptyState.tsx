import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="relative mb-5">
        <div className="absolute inset-0 -m-3 rounded-full bg-brand-soft blur-xl" />
        <div className="relative flex size-12 items-center justify-center rounded-xl border border-border bg-card-elevated shadow-[var(--shadow-card)]">
          <Icon className="size-5 text-muted" strokeWidth={1.75} />
        </div>
      </div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {children && <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted">{children}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
