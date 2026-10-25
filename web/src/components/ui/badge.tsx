import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '@/lib/utils'

const badgeVariants = cva('inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11.5px] font-medium', {
  variants: {
    tone: {
      neutral: 'bg-hover text-muted ring-1 ring-inset ring-border-subtle',
      brand: 'bg-brand-soft text-brand',
      success: 'bg-success-soft text-success',
      warning: 'bg-warning-soft text-warning',
      destructive: 'bg-destructive-soft text-destructive',
      info: 'bg-info-soft text-info',
    },
  },
  defaultVariants: { tone: 'neutral' },
})

export const Badge = ({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) => (
  <span className={cn(badgeVariants({ tone }), className)} {...props} />
)
