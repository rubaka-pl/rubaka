import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

export interface Datum {
  label: string
  value: number
  /** Tooltip text (defaults to "label: value"). */
  hint?: string
}

/**
 * Single-series vertical bar chart: one accent hue (no legend needed — the
 * title names the series), 4px rounded data ends on the baseline, 2px gaps,
 * recessive axis, tooltip on hover/focus, and an accessible table toggle.
 */
export function BarChart({ data, height = 160, title, unit = '', emptyText = 'No data yet' }: {
  data: Datum[]; height?: number; title: string; unit?: string; emptyText?: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const max = Math.max(1, ...data.map((d) => d.value))
  const total = data.reduce((n, d) => n + d.value, 0)
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex items-center justify-between">
        <span className="text-[13px] font-semibold">{title}</span>
        <button className="text-[11px] text-fg-3 hover:text-fg" onClick={() => setTable(!table)} aria-pressed={table}>{table ? 'Chart' : 'Table'}</button>
      </figcaption>
      {total === 0 ? (
        <p className="flex items-center justify-center rounded-md border border-dashed border-line text-xs text-fg-3" style={{ height }}>{emptyText}</p>
      ) : table ? (
        <DataTable data={data} unit={unit} />
      ) : (
        <div className="relative">
          <div className="flex items-end gap-[2px] border-b border-line" style={{ height }} role="list" aria-label={title}>
            {data.map((d, i) => (
              <div key={d.label} role="listitem" tabIndex={0} aria-label={d.hint ?? `${d.label}: ${d.value}${unit}`}
                className="group relative flex h-full flex-1 cursor-default items-end outline-none"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
                <div className={cn('w-full rounded-t-[4px] bg-accent transition-opacity', hover != null && hover !== i && 'opacity-50')}
                  style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value > 0 ? 2 : 0 }} />
                {hover === i && (
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-fg px-2 py-1 text-[11px] font-medium text-bg shadow">
                    {d.hint ?? `${d.label}: ${d.value.toLocaleString()}${unit}`}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-[2px]" aria-hidden>
            {data.map((d, i) => (
              <span key={d.label} className={cn('flex-1 truncate text-center text-[10px] tabular-nums text-fg-3', data.length > 14 && i % Math.ceil(data.length / 12) !== 0 && 'invisible')}>{d.label}</span>
            ))}
          </div>
        </div>
      )}
    </figure>
  )
}

/** Horizontal bars for ranked categories (genres, statuses). Labels in text ink, value at the end. */
export function HBarChart({ data, title, unit = '' }: { data: Datum[]; title: string; unit?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-[13px] font-semibold">{title}</figcaption>
      {data.length === 0 ? <p className="text-xs text-fg-3">No data yet</p> : (
        <ul className="flex flex-col gap-1.5" aria-label={title}>
          {data.map((d) => (
            <li key={d.label} className="grid grid-cols-[120px_1fr_48px] items-center gap-2 text-xs" title={d.hint}>
              <span className="truncate text-fg-2">{d.label}</span>
              <span className="h-2 rounded-r-[4px] bg-accent" style={{ width: `${Math.max(1, (d.value / max) * 100)}%` }} aria-hidden />
              <span className="text-right tabular-nums text-fg-2">{d.value.toLocaleString()}{unit}</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  )
}

function DataTable({ data, unit }: { data: Datum[]; unit: string }) {
  return (
    <div className="max-h-48 overflow-y-auto rounded-md border border-line">
      <table className="w-full text-xs">
        <tbody className="divide-y divide-line">
          {data.map((d) => <tr key={d.label}><td className="px-2 py-1 text-fg-2">{d.label}</td><td className="px-2 py-1 text-right tabular-nums">{d.value.toLocaleString()}{unit}</td></tr>)}
        </tbody>
      </table>
    </div>
  )
}

/**
 * GitHub-style activity calendar for one year. Sequential single-hue ramp
 * (accent at increasing strength). Only real logged/known dates are counted.
 */
export function Heatmap({ year, counts }: { year: number; counts: Record<string, number> }) {
  const weeks = useMemo(() => {
    const start = new Date(Date.UTC(year, 0, 1))
    const offset = (start.getUTCDay() + 6) % 7 // weeks start on Monday
    const days: { date: string; count: number; inYear: boolean }[] = []
    for (let i = -offset; i < 371 - offset; i++) {
      const d = new Date(Date.UTC(year, 0, 1 + i))
      const iso = d.toISOString().slice(0, 10)
      days.push({ date: iso, count: counts[iso] ?? 0, inYear: d.getUTCFullYear() === year })
    }
    const out: (typeof days)[] = []
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7))
    return out.filter((w) => w.some((d) => d.inYear))
  }, [year, counts])
  const max = Math.max(1, ...Object.values(counts))
  const level = (n: number) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)))
  const LEVELS = ['bg-surface-2', 'bg-accent/30', 'bg-accent/55', 'bg-accent/80', 'bg-accent']
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const activeDays = Object.values(counts).filter((n) => n > 0).length
  const [hover, setHover] = useState<{ date: string; count: number } | null>(null)
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <span className="font-semibold">Activity in {year}</span>
        <span className="text-xs text-fg-3" aria-live="polite">
          {hover ? `${hover.date}: ${hover.count} ${hover.count === 1 ? 'event' : 'events'}` : `${total.toLocaleString()} events on ${activeDays} days`}
        </span>
      </figcaption>
      <div className="overflow-x-auto pb-1">
        <div className="flex gap-[2px]" role="grid" aria-label={`Activity calendar ${year}`}>
          {weeks.map((w, wi) => (
            <div key={wi} className="flex flex-col gap-[2px]" role="row">
              {w.map((d) => (
                <div key={d.date} role="gridcell" aria-label={`${d.date}: ${d.count}`}
                  onMouseEnter={() => d.inYear && setHover(d)} onMouseLeave={() => setHover(null)}
                  className={cn('size-[11px] rounded-[2px]', d.inYear ? LEVELS[level(d.count)] : 'bg-transparent')} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1 self-end text-[10px] text-fg-3" aria-hidden>
        Less {LEVELS.map((c) => <span key={c} className={cn('size-[10px] rounded-[2px]', c)} />)} More
      </div>
    </figure>
  )
}
