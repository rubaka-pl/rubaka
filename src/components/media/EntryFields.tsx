import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form-controls'
import { Select } from '@/components/ui/select'
import { CATEGORY_CONFIG, statusLabel } from '@/lib/categories'
import { cn } from '@/lib/utils'
import { STATUSES, type LibraryStatus, type MediaCategory } from '@/types/db'

export function StatusSelect({ category, value, onChange, className, id }: {
  category: MediaCategory; value: LibraryStatus; onChange: (s: LibraryStatus) => void; className?: string; id?: string
}) {
  return (
    <Select
      id={id}
      aria-label="Status"
      value={value}
      onValueChange={(v) => onChange(v as LibraryStatus)}
      options={STATUSES.map((s) => ({ value: s, label: statusLabel(s, category) }))}
      className={className}
    />
  )
}

/**
 * Counter with − / + buttons. `total` null = unknown (no upper bound, shown as "?").
 * Values never go below 0 or above a known total.
 */
export function ProgressStepper({ label, value, total, onChange, id }: {
  label: string; value: number; total: number | null | undefined; onChange: (v: number) => void; id: string
}) {
  const max = total ?? Number.MAX_SAFE_INTEGER
  const set = (v: number) => onChange(Math.max(0, Math.min(max, v)))
  return (
    <Field label={label} htmlFor={id}>
      <div className="flex items-center gap-1.5">
        <Button size="icon-sm" variant="outline" onClick={() => set(value - 1)} disabled={value <= 0} aria-label={`Decrease ${label}`}><Minus /></Button>
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          max={total ?? undefined}
          value={value}
          onChange={(e) => {
            const n = Math.trunc(Number(e.target.value))
            if (Number.isFinite(n)) set(n)
          }}
          className="w-20 text-center tabular-nums"
        />
        <Button size="icon-sm" variant="outline" onClick={() => set(value + 1)} disabled={total != null && value >= total} aria-label={`Increase ${label}`}><Plus /></Button>
        <span className="text-xs text-fg-3 tabular-nums">/ {total ?? '?'}</span>
        {total != null && value < total && (
          <Button size="sm" variant="ghost" onClick={() => set(total)} className="ml-auto">Max</Button>
        )}
      </div>
    </Field>
  )
}

export interface ProgressValues {
  episodes_watched: number
  chapters_read: number
  volumes_read: number
  routes_completed: number
  endings_completed: number
  current_season: number | null
  current_episode: number | null
}

export interface ProgressTotals {
  total_episodes: number | null
  total_chapters: number | null
  total_volumes: number | null
  total_routes: number | null
}

/** The progress inputs relevant for a category. */
export function ProgressFields({ category, values, totals, onChange, hasSeasonRows, className }: {
  category: MediaCategory
  values: ProgressValues
  totals: ProgressTotals
  onChange: (patch: Partial<ProgressValues>) => void
  /** TV: when per-season progress exists, overall counters are derived from it. */
  hasSeasonRows?: boolean
  className?: string
}) {
  const cfg = CATEGORY_CONFIG[category]
  if (cfg.progress === 'none' || cfg.progress === 'single') return null
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2', className)}>
      {cfg.progress === 'episodes' && !hasSeasonRows && (
        <ProgressStepper id="pf-ep" label="Episodes watched" value={values.episodes_watched} total={totals.total_episodes} onChange={(v) => onChange({ episodes_watched: v })} />
      )}
      {cfg.progress === 'episodes' && hasSeasonRows && (
        <p className="text-xs text-fg-3 sm:col-span-2">Episode progress is tracked per season on the details page.</p>
      )}
      {cfg.seasons && !hasSeasonRows && (
        <div className="flex gap-3">
          <Field label="Current season" htmlFor="pf-cs">
            <Input id="pf-cs" type="number" min={0} className="w-20 tabular-nums" value={values.current_season ?? ''}
              onChange={(e) => onChange({ current_season: e.target.value === '' ? null : Math.max(0, Math.trunc(Number(e.target.value))) })} />
          </Field>
          <Field label="Current episode" htmlFor="pf-ce">
            <Input id="pf-ce" type="number" min={0} className="w-20 tabular-nums" value={values.current_episode ?? ''}
              onChange={(e) => onChange({ current_episode: e.target.value === '' ? null : Math.max(0, Math.trunc(Number(e.target.value))) })} />
          </Field>
        </div>
      )}
      {cfg.progress === 'chapters' && (
        <ProgressStepper id="pf-ch" label="Chapters read" value={values.chapters_read} total={totals.total_chapters} onChange={(v) => onChange({ chapters_read: v })} />
      )}
      {cfg.volumes && (
        <ProgressStepper id="pf-vol" label="Volumes read" value={values.volumes_read} total={totals.total_volumes} onChange={(v) => onChange({ volumes_read: v })} />
      )}
      {cfg.progress === 'routes' && (
        <>
          <ProgressStepper id="pf-rt" label="Routes completed" value={values.routes_completed} total={totals.total_routes} onChange={(v) => onChange({ routes_completed: v })} />
          <ProgressStepper id="pf-end" label="Endings completed" value={values.endings_completed} total={null} onChange={(v) => onChange({ endings_completed: v })} />
        </>
      )}
    </div>
  )
}
