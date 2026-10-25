import * as Menu from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'

export const DropdownMenu = Menu.Root
export const DropdownMenuTrigger = Menu.Trigger

export const DropdownMenuContent = ({ className, ...props }: Menu.DropdownMenuContentProps) => (
  <Menu.Portal>
    <Menu.Content
      sideOffset={6}
      align="end"
      className={cn('z-50 min-w-48 rounded-lg bg-card-elevated p-1 shadow-[var(--shadow-float)] data-[state=open]:animate-fade-in', className)}
      {...props}
    />
  </Menu.Portal>
)

export const DropdownMenuItem = ({ className, destructive, ...props }: Menu.DropdownMenuItemProps & { destructive?: boolean }) => (
  <Menu.Item
    className={cn(
      'flex h-8 cursor-pointer select-none items-center gap-2.5 rounded-md px-2 text-[13px] outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-hover [&_svg]:size-4 [&_svg]:text-faint',
      destructive && 'text-destructive data-[highlighted]:bg-destructive-soft [&_svg]:text-destructive',
      className,
    )}
    {...props}
  />
)

export const DropdownMenuSeparator = () => <Menu.Separator className="-mx-1 my-1 h-px bg-border-subtle" />
export const DropdownMenuLabel = ({ className, ...props }: Menu.DropdownMenuLabelProps) => (
  <Menu.Label className={cn('px-2 pb-1 pt-1.5 text-[11.5px] font-medium text-faint', className)} {...props} />
)
