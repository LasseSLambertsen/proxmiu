import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: DialogPrimitive.DialogContentProps & { title: React.ReactNode; description?: React.ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--overlay)] backdrop-blur-[3px] data-[state=open]:animate-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-card-elevated shadow-[var(--shadow-float)] focus:outline-none data-[state=open]:animate-pop-in',
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 px-5 pb-1 pt-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-[15px] font-semibold tracking-[-0.01em]">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-0.5 text-[13px] text-muted">{description}</DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close className="-mr-1.5 rounded-md p-1.5 text-faint transition-colors hover:bg-hover hover:text-foreground">
            <X className="size-4" strokeWidth={2} />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export const DialogBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4', className)} {...props} />
)

export const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex items-center justify-end gap-2 border-t border-border-subtle bg-inset px-5 py-3', className)} {...props} />
)
