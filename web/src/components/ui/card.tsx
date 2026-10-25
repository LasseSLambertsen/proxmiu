import * as React from 'react'
import { cn } from '@/lib/utils'

export const Card = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('rounded-xl border border-border bg-card shadow-[var(--shadow-card)]', className)} {...props} />
)

export const CardHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex min-h-12 items-center justify-between gap-3 border-b border-border-subtle px-4 py-2.5', className)} {...props} />
)

export const CardTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn('text-[13px] font-semibold tracking-[-0.01em]', className)} {...props} />
)

export const CardContent = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('p-4', className)} {...props} />
