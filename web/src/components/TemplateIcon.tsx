import { Bot, Box, Container, Database, Globe, Server, Sparkles, Terminal, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export const templateIcons: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  terminal: Terminal,
  bot: Bot,
  container: Container,
  server: Server,
  box: Box,
  database: Database,
  globe: Globe,
}

/** Per-icon accent so templates are recognisable at a glance. */
const tints: Record<string, string> = {
  sparkles: 'from-orange-400/25 to-amber-500/5 text-orange-500 dark:text-orange-300',
  terminal: 'from-emerald-400/25 to-teal-500/5 text-emerald-600 dark:text-emerald-300',
  bot: 'from-violet-400/30 to-fuchsia-500/5 text-violet-600 dark:text-violet-300',
  container: 'from-sky-400/25 to-blue-500/5 text-sky-600 dark:text-sky-300',
  server: 'from-zinc-400/25 to-zinc-500/5 text-zinc-600 dark:text-zinc-300',
  database: 'from-rose-400/25 to-pink-500/5 text-rose-600 dark:text-rose-300',
  globe: 'from-cyan-400/25 to-sky-500/5 text-cyan-600 dark:text-cyan-300',
  box: 'from-zinc-400/25 to-zinc-500/5 text-zinc-600 dark:text-zinc-300',
}

export function TemplateIcon({ name, className }: { name: string; className?: string }) {
  const Icon = templateIcons[name] ?? Box
  return <Icon className={className} strokeWidth={1.75} />
}

export function TemplateTile({ icon, className }: { icon: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-b ring-1 ring-inset ring-border',
        tints[icon] ?? tints.box,
        className,
      )}
    >
      <TemplateIcon name={icon} className="size-[18px]" />
    </div>
  )
}
