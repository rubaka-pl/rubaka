import { Minus, Plus } from 'lucide-react'
import { PER_ROW_MAX, PER_ROW_MIN, usePerRow, useSettingsStore } from '@/features/settings/settings-store'
import { cn } from '@/lib/utils'

/** "Per row: − 6 +" — how many posters per row everywhere (remembered on this device). */
export function PerRowControl({ className }: { className?: string }) {
  const n = usePerRow()
  const set = useSettingsStore((s) => s.setPerRow)
  const btn = 'flex size-7 items-center justify-center rounded text-fg-3 transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent'
  return (
    <div className={cn('flex items-center gap-0.5 rounded-md border border-line bg-surface-2 p-0.5', className)} role="group" aria-label="Posters per row">
      <span className="px-1.5 text-[11px] text-fg-3">Per row</span>
      <button type="button" className={btn} onClick={() => set(n - 1)} disabled={n <= PER_ROW_MIN} aria-label="Fewer per row"><Minus className="size-3.5" /></button>
      <span className="w-5 text-center text-[13px] font-semibold tabular-nums" aria-live="polite">{n}</span>
      <button type="button" className={btn} onClick={() => set(n + 1)} disabled={n >= PER_ROW_MAX} aria-label="More per row"><Plus className="size-3.5" /></button>
    </div>
  )
}
