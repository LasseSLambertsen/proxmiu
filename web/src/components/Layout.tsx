import { useQuery } from '@tanstack/react-query'
import { Activity, LayoutDashboard, LayoutTemplate, LogOut, Menu, Moon, Network, Plus, Search, Server, Settings, Sun, Unplug } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { getAgent } from '@/lib/agent'
import { api, type Job } from '@/lib/api'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { CommandPalette } from './CommandPalette'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'

const nav = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/guests', label: 'Guests', icon: Server },
  { to: '/create', label: 'Create', icon: Plus },
  { to: '/templates', label: 'Templates', icon: LayoutTemplate },
  { to: '/activity', label: 'Activity', icon: Activity },
  { to: '/connections', label: 'Connections', icon: Network },
  { to: '/settings', label: 'Settings', icon: Settings },
]

const LOGO = `${import.meta.env.BASE_URL}logo.svg`

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <img src={LOGO} alt="" width={size} height={size} className="shrink-0 rounded-[7px] shadow-[0_2px_8px_-2px_rgba(91,63,228,0.6)]" />
      <span className="text-[15px] font-semibold tracking-[-0.02em]">Proxmiu</span>
    </div>
  )
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function Layout({ authRequired, onLogout, onDisconnect }: { authRequired: boolean; onLogout: () => void; onDisconnect?: () => void }) {
  const { dark, toggle } = useTheme()
  const [palette, setPalette] = useState(false)
  const { data: jobs } = useQuery({ queryKey: ['jobs'], queryFn: () => api.get<Job[]>('/jobs'), refetchInterval: 4000 })
  const running = jobs?.filter((j) => j.status === 'running').length ?? 0
  const agentUrl = getAgent()?.url

  const footerBtn = 'flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] text-muted transition-colors hover:bg-hover hover:text-foreground'

  return (
    <div className="flex h-full">
      <aside className="flex w-[232px] shrink-0 flex-col border-r border-border-subtle bg-sidebar max-lg:w-[60px] max-sm:hidden">
        <div className="flex h-16 items-center px-4 max-lg:justify-center max-lg:px-0">
          <span className="max-lg:hidden">
            <Logo />
          </span>
          <img src={LOGO} alt="Proxmiu" className="hidden size-7 rounded-[7px] max-lg:block" />
        </div>
        <div className="px-3 pb-2 max-lg:px-2">
          <button
            onClick={() => setPalette(true)}
            className="flex h-8 w-full items-center gap-2 rounded-md border border-border bg-card px-2.5 text-[13px] text-faint shadow-[var(--shadow-card)] transition-colors hover:border-border-strong hover:text-muted max-lg:justify-center max-lg:px-0"
          >
            <Search className="size-[15px]" strokeWidth={2} />
            <span className="max-lg:hidden">Search</span>
            <kbd className="ml-auto rounded border border-border px-1 font-mono text-[10.5px] max-lg:hidden">{isMac ? '⌘' : 'Ctrl '}K</kbd>
          </button>
        </div>
        <nav className="flex-1 space-y-px px-3 py-1 max-lg:px-2">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={label}
              className={({ isActive }) =>
                cn(
                  'group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] text-muted transition-colors hover:bg-hover hover:text-foreground max-lg:justify-center max-lg:px-0',
                  isActive && 'bg-hover font-medium text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={cn('size-4 shrink-0 transition-colors', isActive ? 'text-brand' : 'text-faint group-hover:text-muted')} strokeWidth={2} />
                  <span className="max-lg:hidden">{label}</span>
                  {to === '/activity' && running > 0 && (
                    <span className="tnum ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[11px] font-semibold text-white max-lg:hidden">
                      {running}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-px border-t border-border-subtle p-3 max-lg:p-2">
          <div className="mb-1.5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] text-faint max-lg:hidden" title={agentUrl || 'Agent serving this page'}>
            <span className="size-1.5 shrink-0 rounded-full bg-success shadow-[0_0_0_3px_var(--success-soft)]" />
            <span className="truncate">{agentUrl ? agentUrl.replace(/^https?:\/\//, '') : 'Local agent'}</span>
          </div>
          <button onClick={toggle} className={cn(footerBtn, 'max-lg:justify-center max-lg:px-0')} title="Toggle theme">
            {dark ? <Sun className="size-4" strokeWidth={2} /> : <Moon className="size-4" strokeWidth={2} />}
            <span className="max-lg:hidden">{dark ? 'Light mode' : 'Dark mode'}</span>
          </button>
          {authRequired && (
            <button onClick={onLogout} className={cn(footerBtn, 'max-lg:justify-center max-lg:px-0')} title="Log out">
              <LogOut className="size-4" strokeWidth={2} />
              <span className="max-lg:hidden">Log out</span>
            </button>
          )}
          {onDisconnect && (
            <button onClick={onDisconnect} className={cn(footerBtn, 'max-lg:justify-center max-lg:px-0')} title="Switch agent">
              <Unplug className="size-4" strokeWidth={2} />
              <span className="max-lg:hidden">Switch agent</span>
            </button>
          )}
        </div>
      </aside>
      <main className="relative min-w-0 flex-1 overflow-y-auto max-sm:pb-[calc(64px+env(safe-area-inset-bottom))]">
        <MobileTopBar onSearch={() => setPalette(true)} />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_70%_100%_at_50%_0%,var(--glow),transparent)]" />
        <div className="relative">
          <Outlet />
        </div>
      </main>
      <MobileTabBar running={running} dark={dark} toggleTheme={toggle} authRequired={authRequired} onLogout={onLogout} onDisconnect={onDisconnect} />
      <CommandPalette open={palette} onOpenChange={setPalette} dark={dark} toggleTheme={toggle} />
    </div>
  )
}

function MobileTopBar({ onSearch }: { onSearch: () => void }) {
  return (
    <div className="sticky top-0 z-30 hidden h-[calc(52px+env(safe-area-inset-top))] items-end border-b border-border-subtle bg-background/80 px-4 pb-2.5 backdrop-blur-xl max-sm:flex">
      <Logo size={26} />
      <button onClick={onSearch} className="ml-auto flex size-9 items-center justify-center rounded-full text-muted active:bg-hover" aria-label="Search">
        <Search className="size-[18px]" strokeWidth={2} />
      </button>
    </div>
  )
}

const tabs = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/guests', label: 'Guests', icon: Server },
  { to: '/create', label: 'Create', icon: Plus },
  { to: '/activity', label: 'Activity', icon: Activity },
]

function MobileTabBar({
  running,
  dark,
  toggleTheme,
  authRequired,
  onLogout,
  onDisconnect,
}: {
  running: number
  dark: boolean
  toggleTheme: () => void
  authRequired: boolean
  onLogout: () => void
  onDisconnect?: () => void
}) {
  const navigate = useNavigate()
  const tab = 'flex flex-1 flex-col items-center justify-center gap-1 text-[10.5px] font-medium text-faint transition-colors'
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 hidden border-t border-border-subtle bg-sidebar/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl max-sm:flex">
      {tabs.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => cn(tab, 'relative h-16', isActive && 'text-foreground')}>
          {({ isActive }) => (
            <>
              <Icon className={cn('size-[22px]', isActive && 'text-brand')} strokeWidth={isActive ? 2.25 : 1.75} />
              {label}
              {to === '/activity' && running > 0 && (
                <span className="absolute right-[calc(50%-18px)] top-2 size-2 rounded-full bg-brand ring-2 ring-sidebar" />
              )}
            </>
          )}
        </NavLink>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(tab, 'h-16 outline-none')}>
          <Menu className="size-[22px]" strokeWidth={1.75} />
          More
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" sideOffset={8} className="mb-1 min-w-56">
          <DropdownMenuItem onSelect={() => navigate('/templates')}><LayoutTemplate />Templates</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate('/connections')}><Network />Connections</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate('/settings')}><Settings />Settings</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={toggleTheme}>{dark ? <Sun /> : <Moon />}{dark ? 'Light mode' : 'Dark mode'}</DropdownMenuItem>
          {authRequired && <DropdownMenuItem onSelect={onLogout}><LogOut />Log out</DropdownMenuItem>}
          {onDisconnect && <DropdownMenuItem onSelect={onDisconnect}><Unplug />Switch agent</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  )
}
