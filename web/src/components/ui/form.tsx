import * as React from 'react'
import { cn } from '@/lib/utils'

const field =
  'w-full rounded-md border border-border bg-inset px-3 text-[13px] text-foreground shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)] placeholder:text-faint transition-[border-color,box-shadow] duration-150 hover:border-border-strong focus:border-brand focus:ring-[3px] focus:ring-brand-soft disabled:cursor-not-allowed disabled:opacity-55'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(field, 'h-9', className)} {...props} />
))
Input.displayName = 'Input'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(field, 'py-2 leading-relaxed', className)} {...props} />
))
Textarea.displayName = 'Textarea'

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      field,
      'h-9 cursor-pointer appearance-none bg-[length:14px] bg-[right_10px_center] bg-no-repeat pr-8',
      "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m7 15 5 5 5-5M7 9l5-5 5 5'/%3E%3C/svg%3E\")]",
      className,
    )}
    {...props}
  />
))
Select.displayName = 'Select'

export function Field({ label, help, children, className }: { label: React.ReactNode; help?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="block text-[12.5px] font-medium text-muted">{label}</span>
      {children}
      {help && <span className="block text-[12px] leading-relaxed text-faint">{help}</span>}
    </label>
  )
}
