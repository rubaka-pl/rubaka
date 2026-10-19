import { Tabs as RTabs } from 'radix-ui'
import { CircleAlert, RotateCcw } from 'lucide-react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { friendlyError } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { Button } from './button'

export function Badge({ children, className, tone = 'default' }: { children: ReactNode; className?: string; tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger' }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 whitespace-nowrap rounded px-1.5 text-[11px] font-medium',
        tone === 'default' && 'bg-surface-hover text-fg-2',
        tone === 'accent' && 'bg-accent-soft text-accent-hover',
        tone === 'success' && 'bg-success/15 text-success',
        tone === 'warning' && 'bg-warning/15 text-warning',
        tone === 'danger' && 'bg-danger/15 text-danger',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn('relative overflow-hidden rounded-md bg-surface-2', className)} style={style} aria-hidden />
}

export function ProgressBar({ ratio, className, label }: { ratio: number | null; className?: string; label?: string }) {
  // Unknown totals render an indeterminate-looking short bar rather than 0%.
  const pct = ratio == null ? null : Math.round(Math.min(1, Math.max(0, ratio)) * 100)
  return (
    <div
      className={cn('h-1 w-full overflow-hidden rounded-full bg-progress-track', className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
    >
      <div
        className={cn('h-full rounded-full bg-progress transition-[width] duration-300', pct == null && 'opacity-50')}
        style={{ width: pct == null ? '18%' : `${pct}%` }}
      />
    </div>
  )
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-6 py-14 text-center', className)}>
      {icon && <div className="mb-3 text-fg-3 [&_svg]:size-8">{icon}</div>}
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-md text-[13px] text-fg-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('flex flex-col items-center gap-3 rounded-lg border border-danger/30 bg-danger/5 px-6 py-8 text-center', className)}>
      <CircleAlert className="size-6 text-danger" />
      <p className="max-w-md text-[13px] text-fg-2">{friendlyError(error)}</p>
      {onRetry && <Button size="sm" onClick={onRetry}><RotateCcw /> Retry</Button>}
    </div>
  )
}

export function SectionHeader({ title, action, className }: { title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-2.5 flex items-center justify-between gap-3', className)}>
      <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      {action}
    </div>
  )
}

// ---------------------------------------------------------------- Tabs
export const Tabs = RTabs.Root
export const TabsContent = RTabs.Content
export function TabsList({ className, ...props }: ComponentPropsWithoutRef<typeof RTabs.List>) {
  return <RTabs.List className={cn('flex gap-1 overflow-x-auto border-b border-line scrollbar-none', className)} {...props} />
}
export function TabsTrigger({ className, ...props }: ComponentPropsWithoutRef<typeof RTabs.Trigger>) {
  return (
    <RTabs.Trigger
      className={cn(
        '-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-fg-3 transition-colors hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg',
        className,
      )}
      {...props}
    />
  )
}

/** Pill-style segmented tabs used for status tabs on category pages. */
export function PillTabs<T extends string>({ value, onChange, items, className }: {
  value: T; onChange: (v: T) => void; items: { value: T; label: string; count?: number }[]; className?: string
}) {
  return (
    // One scrollable row on phones, wrapping on wider screens.
    <div role="tablist" className={cn('-mx-4 flex gap-1 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0', className)}>
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cn(
            'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
            value === it.value ? 'bg-accent-soft text-fg ring-1 ring-accent/50' : 'text-fg-3 hover:bg-surface-hover hover:text-fg',
          )}
        >
          {it.label}
          {it.count != null && (
            <span className={cn('rounded px-1 text-[11px] tabular-nums', value === it.value ? 'bg-accent/30 text-fg' : 'bg-surface-hover text-fg-3')}>
              {it.count.toLocaleString()}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
