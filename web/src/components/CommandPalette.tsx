import { Command } from 'cmdk'
import { Activity, LayoutDashboard, LayoutTemplate, Moon, Network, Plus, Server, Settings, Sun } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGuests, useTemplates } from '@/lib/queries'
import { StatusDot } from './StatusDot'
import { TemplateIcon } from './TemplateIcon'

function Item({ children, onSelect, value }: { children: ReactNode; onSelect: () => void; value: string }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-[13px] text-muted data-[selected=true]:bg-hover data-[selected=true]:text-foreground [&_svg]:size-4 [&_svg]:text-faint"
    >
      {children}
    </Command.Item>
  )
}

const groupClass =
  'px-1.5 pb-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-faint'

export function CommandPalette({ open, onOpenChange, dark, toggleTheme }: { open: boolean; onOpenChange: (o: boolean) => void; dark: boolean; toggleTheme: () => void }) {
  const navigate = useNavigate()
  const { guests } = useGuests()
  const templates = useTemplates()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  const go = (path: string) => {
    onOpenChange(false)
    navigate(path)
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command menu"
      overlayClassName="fixed inset-0 z-50 bg-[var(--overlay)] backdrop-blur-[3px] animate-fade-in"
      contentClassName="fixed left-1/2 top-[18vh] z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl bg-card-elevated shadow-[var(--shadow-float)]"
    >
      <Command.Input
        placeholder="Search guests, templates and pages…"
        className="h-12 w-full border-b border-border-subtle bg-transparent px-4 text-[14px] outline-none placeholder:text-faint"
      />
      <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto pb-1.5">
        <Command.Empty className="px-4 py-8 text-center text-[13px] text-faint">No results</Command.Empty>
        <Command.Group heading="Create" className={groupClass}>
          {templates.data?.map((t) => (
            <Item key={t.id} value={`create ${t.name}`} onSelect={() => go(`/create/${t.id}`)}>
              <TemplateIcon name={t.icon} />
              Create {t.name}
            </Item>
          ))}
        </Command.Group>
        {guests.length > 0 && (
          <Command.Group heading="Guests" className={groupClass}>
            {guests
              .filter((g) => !g.template)
              .map((g) => (
                <Item key={`${g.clusterId}-${g.id}`} value={`guest ${g.name} ${g.vmid} ${g.node}`} onSelect={() => go(`/guests?q=${encodeURIComponent(g.name ?? String(g.vmid))}`)}>
                  <StatusDot status={g.status} className="mx-1" />
                  <span className="text-foreground">{g.name}</span>
                  <span className="tnum ml-auto font-mono text-[12px] text-faint">
                    {g.vmid} · {g.node}
                  </span>
                </Item>
              ))}
          </Command.Group>
        )}
        <Command.Group heading="Go to" className={groupClass}>
          <Item value="overview" onSelect={() => go('/')}><LayoutDashboard />Overview</Item>
          <Item value="guests list" onSelect={() => go('/guests')}><Server />Guests</Item>
          <Item value="create new" onSelect={() => go('/create')}><Plus />Create</Item>
          <Item value="templates" onSelect={() => go('/templates')}><LayoutTemplate />Templates</Item>
          <Item value="activity jobs" onSelect={() => go('/activity')}><Activity />Activity</Item>
          <Item value="connections scan network" onSelect={() => go('/connections')}><Network />Connections</Item>
          <Item value="settings ssh key" onSelect={() => go('/settings')}><Settings />Settings</Item>
          <Item value="toggle theme dark light" onSelect={() => { toggleTheme(); onOpenChange(false) }}>
            {dark ? <Sun /> : <Moon />}
            Switch to {dark ? 'light' : 'dark'} mode
          </Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  )
}
