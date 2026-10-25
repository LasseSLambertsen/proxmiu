import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@/lib/utils'

export const Switch = ({ className, ...props }: SwitchPrimitive.SwitchProps) => (
  <SwitchPrimitive.Root
    className={cn(
      'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-border-strong p-0.5 transition-colors duration-200 data-[state=checked]:bg-brand disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="block size-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] data-[state=checked]:translate-x-4" />
  </SwitchPrimitive.Root>
)
