import type { ReactNode } from 'react'

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 px-8 pb-6 pt-8 max-md:px-4 max-md:pb-4 max-md:pt-5">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight tracking-[-0.03em] max-sm:text-[24px]">{title}</h1>
        {description && <p className="mt-1 text-[13.5px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 max-sm:hidden">{actions}</div>}
    </header>
  )
}

/** Standard page body padding, matching the header. */
export const PageBody = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`px-8 pb-10 max-md:px-4 ${className}`}>{children}</div>
)
