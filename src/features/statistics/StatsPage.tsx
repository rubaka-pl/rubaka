/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { PageContainer } from '@/components/layout/AppShell'
import { PosterImage } from '@/components/media/PosterImage'
import { StarRating } from '@/components/ratings/StarRating'
import { ErrorState, PillTabs, SectionHeader, Skeleton } from '@/components/ui/misc'
import { Select } from '@/components/ui/select'
import { useSettings } from '@/features/settings/settings-store'
import { CATEGORY_CONFIG, CATEGORY_LIST, statusLabel } from '@/lib/categories'
import { formatDate } from '@/lib/dates'
import { formatDuration, toDays } from '@/lib/time'
import { ScrollRow } from '@/components/ui/ScrollRow'
import { fetchLibrary } from '@/features/tracking/api'
import { starsText } from '@/lib/rating'
import { posterSrc, supabase, unwrap } from '@/lib/supabase'
import { STATUSES, type LibraryStatus, type MediaCategory } from '@/types/db'
import { useState } from 'react'
import { BarChart, Heatmap, HBarChart } from './charts'

interface MiniItem { entry_id: string; media_id: string; title: string; category: MediaCategory; poster_url: string | null; custom_poster_path: string | null; rating: number | null; repeat_count?: number; completed_on?: string; year?: number }
interface Stats {
  overview: Record<string, number | null>
  by_category: { category: MediaCategory; total: number; completed: number; in_progress: number; average_rating: number | null }[]
  rating_distribution: { rating: number; count: number }[]
  status_distribution: Partial<Record<LibraryStatus, number>>
  completed_by_year: { year: number; count: number }[]
  added_by_year: { year: number; count: number }[]
  top_genres: { name: string; count: number; average_rating: number | null }[]
  highest_rated: MiniItem[]
  most_revisited: MiniItem[]
  year: number
  year_completed: MiniItem[]
  available_years: number[]
  heatmap: Record<string, number>
}

export function StatsPage() {
  const settings = useSettings()
  const [category, setCategory] = useState<'all' | MediaCategory>('all')
  const [year, setYear] = useState<number>(new Date().getFullYear())
  const q = useQuery({
    queryKey: ['stats', category, year, settings.timezone],
    queryFn: async () => unwrap(await supabase.rpc('library_stats', { p_category: category === 'all' ? null : category, p_year: year, p_tz: settings.timezone }), 'stats') as Stats,
    placeholderData: (p) => p,
  })
  const s = q.data
  const years = Array.from(new Set([new Date().getFullYear(), ...(s?.available_years ?? [])])).sort((a, b) => b - a)

  return (
    <PageContainer className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Statistics</h1>
          <p className="text-[13px] text-fg-3">Computed from your library. Unknown dates are never guessed.</p>
        </div>
      </header>
      <PillTabs value={category} onChange={setCategory} items={[{ value: 'all' as const, label: 'All' }, ...CATEGORY_LIST.map((c) => ({ value: c.id, label: c.label }))]} />

      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !s ? (
        <div className="grid gap-3 sm:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : (
        <>
          <section aria-label="Overview" className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-8">
            <Tile label="Entries" value={s.overview.total} />
            <Tile label="Completed" value={s.overview.completed} />
            <Tile label="In progress" value={s.overview.in_progress} />
            <Tile label="Dropped" value={s.overview.dropped} />
            <Tile label="Wishlist" value={s.overview.wishlist} />
            <Tile label="Favorites" value={s.overview.favorites} />
            <Tile label="Repeats completed" value={s.overview.repeats_completed} hint={s.overview.repeats_undated ? `${s.overview.repeats_undated} undated (imported)` : undefined} />
            <Tile label="Average rating" value={s.overview.average_rating != null ? `${s.overview.average_rating}★` : '—'} hint={`${s.overview.rated ?? 0} rated`} />
          </section>

          <TimeSpentCard category={category} />

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <BarChart title="Rating distribution" data={s.rating_distribution.map((r) => ({ label: starsText(r.rating), value: Number(r.count), hint: `${starsText(r.rating)} stars: ${r.count}` }))} />
            </Card>
            <Card>
              <HBarChart title="Status" data={STATUSES.map((st) => ({ label: statusLabel(st, category === 'all' ? undefined : category), value: Number(s.status_distribution[st] ?? 0) }))} />
              {Number(s.overview.completed_without_date) > 0 && (
                <p className="mt-3 text-[11px] text-fg-3">{s.overview.completed_without_date} completed titles have no completion date and are not shown in “Completed by year”.</p>
              )}
            </Card>
            <Card>
              <BarChart title="Completed by year" data={fillYears(s.completed_by_year)} emptyText="No completion dates recorded yet" />
            </Card>
            <Card>
              <BarChart title="Added by year" data={fillYears(s.added_by_year)} />
            </Card>
          </div>

          <Card>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="sr-only">Year</span>
              <Select aria-label="Year" value={String(year)} onValueChange={(v) => setYear(Number(v))} options={years.map((y) => ({ value: String(y), label: String(y) }))} className="w-28" size="sm" />
            </div>
            <Heatmap year={s.year} counts={s.heatmap} />
          </Card>

          {category === 'all' && (
            <Card>
              <h2 className="mb-2 text-[13px] font-semibold">By category</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-[13px]">
                  <thead className="text-left text-xs text-fg-3"><tr><th className="py-1.5 font-medium">Category</th><th className="font-medium">Entries</th><th className="font-medium">Completed</th><th className="font-medium">In progress</th><th className="font-medium">Avg rating</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {s.by_category.map((c) => {
                      const cfg = CATEGORY_CONFIG[c.category]
                      return (
                        <tr key={c.category}>
                          <td className="py-1.5"><Link to={`/${cfg.slug}`} className="inline-flex items-center gap-1.5 hover:text-accent-hover"><cfg.icon className="size-3.5" /> {cfg.label}</Link></td>
                          <td className="tabular-nums">{c.total}</td><td className="tabular-nums">{c.completed}</td><td className="tabular-nums">{c.in_progress}</td>
                          <td className="tabular-nums">{c.average_rating != null ? `${c.average_rating}★` : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card><HBarChart title="Most common genres" data={s.top_genres.map((g) => ({ label: g.name, value: Number(g.count), hint: g.average_rating ? `Average ${g.average_rating}★` : undefined }))} /></Card>
            <Card>
              <SectionHeader title="Highest rated" />
              <PosterRow items={s.highest_rated} render={(i) => <StarRating value={i.rating} size="xs" />} />
            </Card>
          </div>
          <MostRevisited category={category} />
          <Card>
            <SectionHeader title={`Completed in ${s.year} (${s.year_completed.length})`} />
            <PosterRow items={s.year_completed} render={(i) => <span className="text-[11px] text-fg-3">{formatDate(i.completed_on)}</span>} empty={`Nothing with a completion date in ${s.year}.`} wrap />
          </Card>
        </>
      )}
    </PageContainer>
  )
}

/** All revisited titles (not just a top 12): total counts, swipeable row, link to the full filtered list. */
function MostRevisited({ category }: { category: 'all' | MediaCategory }) {
  const q = useQuery({
    queryKey: ['library', 'stats-revisited', category],
    queryFn: () => fetchLibrary({ category: category === 'all' ? undefined : category, minRepeats: 1, sort: 'repeats_desc', limit: 40 }),
  })
  const items = q.data?.items ?? []
  const totalTitles = q.data?.total ?? 0
  // "See all" opens the category list filtered to repeats ≥ 1, most repeated first.
  const target = category !== 'all' ? category : items[0]?.category
  const cats = new Set(items.map((i) => i.category))
  return (
    <Card>
      <SectionHeader
        title={<>Most revisited{totalTitles > 0 && <span className="ml-2 text-xs font-normal text-fg-3">{totalTitles} titles</span>}</>}
        action={target && totalTitles > 0 && (cats.size <= 1 || category !== 'all') ? (
          <Link to={`/${CATEGORY_CONFIG[target].slug}?repeats=1&sort=repeats_desc`} className="text-xs text-accent hover:text-accent-hover">See all →</Link>
        ) : null}
      />
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.isLoading ? <Skeleton className="h-40" /> : (
        <PosterRow items={items.map((i) => ({ ...i, repeat_count: i.repeat_count }))}
          render={(i) => <span className="text-[11px] text-fg-3">{i.repeat_count}× {CATEGORY_CONFIG[i.category].repeatLabel.toLowerCase()}</span>}
          empty="No repeats recorded yet." />
      )}
    </Card>
  )
}

interface TimeRow { category: MediaCategory; minutes: number; counted: number; manual: number; missing: number }

/** MAL/Shikimori-style time spent: total days + per category. */
function TimeSpentCard({ category }: { category: 'all' | MediaCategory }) {
  const q = useQuery({
    queryKey: ['stats', 'time'],
    queryFn: async () => unwrap(await supabase.rpc('time_stats'), 'time stats') as TimeRow[],
  })
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const rows = (q.data ?? []).filter((r) => category === 'all' || r.category === category).filter((r) => r.minutes > 0 || r.missing > 0)
  const total = rows.reduce((n, r) => n + Number(r.minutes), 0)
  const missing = rows.reduce((n, r) => n + Number(r.missing), 0)
  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-semibold">Time spent</h2>
          {/* Under a day, days would read "0": show hours/minutes as the headline instead. */}
          <div className="mt-1 text-3xl font-bold tabular-nums">
            {total >= 1440 ? <>{toDays(total).toLocaleString()} <span className="text-base font-medium text-fg-3">days</span></> : formatDuration(total)}
          </div>
          <div className="text-xs text-fg-3">{total >= 1440 ? `${formatDuration(total)} · ` : ''}estimated like MyAnimeList; your own times are used where set</div>
        </div>
      </div>
      {rows.length > 0 && (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => {
            const cfg = CATEGORY_CONFIG[r.category]
            return (
              <li key={r.category} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                <cfg.icon className="size-4 shrink-0 text-accent-hover" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">{cfg.label}</div>
                  <div className="text-[11px] text-fg-3">
                    {formatDuration(Number(r.minutes))}{Number(r.manual) > 0 && ` · ${r.manual} set by you`}{Number(r.missing) > 0 && ` · ${r.missing} without length`}
                  </div>
                </div>
                <div className="text-right text-lg font-bold tabular-nums">
                  {Number(r.minutes) >= 1440 ? <>{toDays(Number(r.minutes))}<span className="ml-0.5 text-[11px] font-normal text-fg-3">d</span></> : <span className="text-sm">{formatDuration(Number(r.minutes))}</span>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {missing > 0 && <p className="mt-3 text-[11px] text-fg-3">{missing} {missing === 1 ? 'title has' : 'titles have'} no known length (no data in any database) and are not counted. Open one and set “Time” yourself to include it.</p>}
    </Card>
  )
}

function fillYears(rows: { year: number; count: number }[]) {
  if (!rows.length) return []
  const min = Math.min(...rows.map((r) => r.year)), max = Math.max(...rows.map((r) => r.year))
  const m = new Map(rows.map((r) => [r.year, Number(r.count)]))
  return Array.from({ length: max - min + 1 }, (_, i) => ({ label: String(min + i), value: m.get(min + i) ?? 0 }))
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-lg border border-line bg-surface p-4">{children}</section>
}

function Tile({ label, value, hint }: { label: string; value: number | string | null | undefined; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
      <div className="text-[11px] text-fg-3">{label}</div>
      <div className="text-xl font-bold tabular-nums">{typeof value === 'number' ? value.toLocaleString() : value ?? 0}</div>
      {hint && <div className="text-[10px] text-fg-3">{hint}</div>}
    </div>
  )
}

function PosterRow({ items, render, empty = 'Nothing yet.', wrap }: { items: MiniItem[]; render: (i: MiniItem) => React.ReactNode; empty?: string; wrap?: boolean }) {
  if (!items.length) return <p className="text-[13px] text-fg-3">{empty}</p>
  const cards = items.map((i) => (
    <Link key={i.entry_id} to={`/media/${i.media_id}`} role={wrap ? undefined : 'listitem'}
      className={wrap ? 'group flex min-w-0 flex-col gap-1' : 'group flex w-[104px] shrink-0 flex-col gap-1 sm:w-[112px]'}>
      <PosterImage src={posterSrc(i)} title={i.title} category={i.category} className="rounded-lg transition-transform group-hover:-translate-y-0.5" />
      <span className="line-clamp-1 text-[11px] font-medium group-hover:text-accent-hover">{i.title}</span>
      {render(i)}
    </Link>
  ))
  if (wrap) return <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-3">{cards}</div>
  // Swipeable row with arrows (same as the dashboard shelves).
  return <ScrollRow deps={[items.length]}>{cards}</ScrollRow>
}
