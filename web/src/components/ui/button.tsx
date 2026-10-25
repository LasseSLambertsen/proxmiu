import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'relative inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:bg-primary-hover',
        brand: 'bg-brand text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_rgba(0,0,0,0.2)] hover:brightness-110',
        outline: 'border border-border bg-card text-foreground shadow-[var(--shadow-card)] hover:border-border-strong hover:bg-hover',
        ghost: 'text-muted hover:bg-hover hover:text-foreground',
        destructive: 'bg-destructive-soft text-destructive hover:bg-destructive hover:text-white',
      },
      size: {
        sm: 'h-8 px-3',
        md: 'h-9 px-4',
        lg: 'h-10 px-5 text-[14px]',
        icon: 'size-8',
        'icon-sm': 'size-7 [&_svg]:size-[15px]',
      },
    },
    defaultVariants: { variant: 'outline', size: 'sm' },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, loading, asChild, children, disabled, ...props }, ref) => {
  if (asChild) return <Slot ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>{children}</Slot>
  return (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
      {loading && <Loader2 className="animate-spin" strokeWidth={2} />}
      {children}
    </button>
  )
})
Button.displayName = 'Button'
