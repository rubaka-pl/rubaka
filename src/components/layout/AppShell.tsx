/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { ChartColumn, ChevronDown, FileUp, LayoutDashboard, LogOut, Menu as MenuIcon, Network, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Drawer, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Tooltip } from '@/components/ui/overlays'
import { useAuth } from '@/features/auth/auth'
import { AddMediaDialog } from '@/features/discovery/AddMediaDialog'
import { CommandPalette } from '@/features/search/CommandPalette'
import { useSettingsStore } from '@/features/settings/settings-store'
import { CATEGORY_LIST } from '@/lib/categories'
import { cn } from '@/lib/utils'
import { Logo } from './Logo'
import { Mascot } from './Mascot'

interface NavItem { to: string; label: string; icon: React.ComponentType<{ className?: string }> }

const MAIN: NavItem[] = [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }]
const CATS: NavItem[] = CATEGORY_LIST.map((c) => ({ to: `/${c.slug}`, label: c.label, icon: c.icon }))
const TOOLS: NavItem[] = [
  { to: '/franchises', label: 'Franchises', icon: Network },
  { to: '/stats', label: 'Statistics', icon: ChartColumn },
  { to: '/import', label: 'Import', icon: FileUp },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function NavGroup({ items, collapsed, onNavigate }: { items: NavItem[]; collapsed: boolean; onNavigate?: () => void }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((it) => {
        const link = (
          <NavLink
            to={it.to}
            end={it.to === '/'}
            onClick={onNavigate}
            className={({ isActive }) => cn(
              'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
              collapsed && 'justify-center px-0',
              isActive ? 'bg-accent-soft text-fg ring-1 ring-inset ring-accent/40' : 'text-fg-2 hover:bg-surface-hover hover:text-fg',
            )}
          >
            <it.icon className="size-4 shrink-0" />
            {!collapsed && <span className="truncate">{it.label}</span>}
          </NavLink>
        )
        // The tooltip trigger wraps a span, not the NavLink: Radix Slot merges
        // className as strings and would break NavLink's className function.
        return <li key={it.to}>{collapsed ? <Tooltip content={it.label} side="right"><span className="block">{link}</span></Tooltip> : link}</li>
      })}
    </ul>
  )
}

function SidebarContent({ collapsed, onNavigate, onToggle }: { collapsed: boolean; onNavigate?: () => void; onToggle?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className={cn('flex h-14 shrink-0 items-center gap-2 px-3', collapsed && 'justify-center px-0')}>
        {onToggle && (
          <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        )}
        {!collapsed && <NavLink to="/" onClick={onNavigate} aria-label="RUBAKA home"><Logo /></NavLink>}
      </div>
      <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-3 scrollbar-none">
        <NavGroup items={MAIN} collapsed={collapsed} onNavigate={onNavigate} />
        <NavGroup items={CATS} collapsed={collapsed} onNavigate={onNavigate} />
        <div className="mx-2 h-px bg-line" />
        <NavGroup items={TOOLS} collapsed={collapsed} onNavigate={onNavigate} />
      </nav>
      {/* Desktop only, and only when there is room for it. */}
      {!collapsed && !onNavigate && <Mascot className="hidden shrink-0 pb-1 pt-2 lg:block [@media(max-height:700px)]:hidden" />}
      {!collapsed && (
        <footer className="shrink-0 px-4 py-4 text-[11px] leading-relaxed text-fg-3">
          <div className="font-semibold tracking-wider text-fg-2">RUBAKA</div>
          Created by RUBAKA © 2026
        </footer>
      )}
    </div>
  )
}

export function AppShell() {
  const collapsed = useSettingsStore((s) => s.sidebarCollapsed)
  const setCollapsed = useSettingsStore((s) => s.setSidebarCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  // Global keyboard shortcuts: Ctrl/Cmd+K search, "/" search, "n" add.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing = target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((o) => !o)
      } else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === '/') { e.preventDefault(); setSearchOpen(true) }
        if (e.key === 'n') { e.preventDefault(); setAddOpen(true) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    // relative: absolutely positioned descendants (e.g. sr-only file inputs) stay inside and never make the window scroll.
    <div className="relative flex h-dvh overflow-hidden">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-1.5 focus:text-white">
        Skip to content
      </a>
      <aside className={cn('hidden shrink-0 border-r border-line bg-sidebar transition-[width] duration-200 lg:block', collapsed ? 'w-[60px]' : 'w-[208px]')}>
        <SidebarContent collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      </aside>
      <Drawer open={mobileOpen} onOpenChange={setMobileOpen} title="Navigation">
        <SidebarContent collapsed={false} onNavigate={() => setMobileOpen(false)} />
      </Drawer>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-bg/95 px-3 backdrop-blur sm:px-5">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <MenuIcon />
          </Button>
          <span className="lg:hidden"><Logo collapsed /></span>
          <button
            onClick={() => setSearchOpen(true)}
            className="flex h-8 shrink-0 items-center justify-center gap-2 rounded-md border border-line bg-surface text-[13px] text-fg-3 transition-colors hover:border-line-strong hover:text-fg-2 max-sm:w-8 sm:w-full sm:max-w-md sm:justify-start sm:px-2.5"
            aria-label="Search your library"
          >
            <Search className="size-4" />
            <span className="hidden truncate sm:inline">Search anime, manga, movies…</span>
            <kbd className="ml-auto hidden rounded border border-line bg-surface-2 px-1.5 text-[10px] font-medium sm:inline">Ctrl K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="primary" size="md" onClick={() => setAddOpen(true)} aria-label="Add media">
              <Plus /> <span className="hidden sm:inline">Add</span>
            </Button>
            <Menu>
              <MenuTrigger asChild>
                <button className="flex items-center gap-1.5 rounded-md p-1 hover:bg-surface-hover" aria-label="Account menu">
                  <span className="flex size-7 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
                    {(user?.email ?? 'R')[0].toUpperCase()}
                  </span>
                  <ChevronDown className="hidden size-3.5 text-fg-3 sm:block" />
                </button>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>{user?.email}</MenuLabel>
                <MenuItem onSelect={() => navigate('/settings')}><Settings /> Settings</MenuItem>
                <MenuItem onSelect={() => navigate('/import')}><FileUp /> Import</MenuItem>
                <MenuSeparator />
                <MenuItem onSelect={() => void signOut()}><LogOut /> Sign out</MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </header>
        <main id="main" className="min-h-0 flex-1 overflow-y-auto" data-scroll-container>
          <Outlet />
        </main>
      </div>
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} onAdd={() => { setSearchOpen(false); setAddOpen(true) }} />
      <AddMediaDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  )
}

export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6', className)}>{children}</div>
}
