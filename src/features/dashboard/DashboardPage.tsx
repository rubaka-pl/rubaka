/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, FileUp, History, Plus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { PageContainer } from '@/components/layout/AppShell'
import { PosterCard, usePosterColumns } from '@/components/media/PosterCard'
import { PerRowControl } from '@/components/media/PosterSizeControl'
import { PosterImage } from '@/components/media/PosterImage'
import { StarRating } from '@/components/ratings/StarRating'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState, ProgressBar, SectionHeader, Skeleton } from '@/components/ui/misc'
import { usePerRow, useSettings } from '@/features/settings/settings-store'
import { canIncrement, useEntryActions } from '@/features/tracking/hooks'
import { fetchLibrary, useActivity, useDashboardSummary, type LibraryParams } from '@/features/tracking/api'
import { CATEGORY_CONFIG, primaryProgress } from '@/lib/categories'
import { timeAgo } from '@/lib/dates'
import { posterSrc } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { LibraryItem, MediaCategory } from '@/types/db'
import { activityText } from './activity-text'
import { AiringCalendar } from './AiringCalendar'

function useItems(key: string, params: LibraryParams) {
  return useQuery({ queryKey: ['library', 'dashboard', key, params], queryFn: () => fetchLibrary(params), staleTime: 20_000 })
}

/** In-progress titles plus completed titles with an active rewatch/reread/replay. */
function useCurrent() {
  return useQuery({
    queryKey: ['library', 'dashboard', 'current'],
    queryFn: async () => {
      const [active, repeats] = await Promise.all([
        fetchLibrary({ statuses: ['in_progress'], sort: 'activity_desc', limit: 16 }),
        fetchLibrary({ activeRepeat: true, sort: 'activity_desc', limit: 8 }),
      ])
      const seen = new Set<string>()
      return [...active.items, ...repeats.items]
        .filter((i) => (seen.has(i.entry_id) ? false : (seen.add(i.entry_id), true)))
        .sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at))
        .slice(0, 16)
    },
    staleTime: 20_000,
  })
}

const ACCENTS = ['text-[#f06a8a]', 'text-[#f0a33c]', 'text-[#d4b45a]', 'text-[#a48bf6]', 'text-[#f06a8a]', 'text-[#45b7e8]', 'text-[#c07cf0]', 'text-[#7c8cf8]']

export function DashboardPage() {
  const summary = useDashboardSummary()
  const current = useCurrent()
  const added = useItems('added', { sort: 'added_desc', limit: 10 })
  const completed = useItems('completed', { statuses: ['completed'], sort: 'completed_desc', limit: 10 })
  const activity = useActivity(12)
  const isEmpty = summary.data?.every((c) => c.total === 0)
  // 18+ categories stay off the dashboard unless enabled in Settings.
  const showAdult = useSettings().showAdultOnDashboard
  const ok = (c: MediaCategory | null | undefined) => showAdult || !c || !CATEGORY_CONFIG[c].adult
  const tiles = summary.data?.filter((c) => ok(c.category))
  const cur = { ...current, data: current.data?.filter((i) => ok(i.category)) }
  const recentAdded = added.data?.items.filter((i) => ok(i.category))
  const recentDone = completed.data?.items.filter((i) => ok(i.category))
  const acts = activity.data?.filter((a) => ok(a.category)).slice(0, 8)

  return (
    <PageContainer className="flex flex-col gap-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-[13px] text-fg-3">Your personal media library</p>
        </div>
        <PerRowControl />
      </header>

      {/* Category summary */}
      <section aria-label="Library summary">
        {summary.isError ? <ErrorState error={summary.error} onRetry={() => void summary.refetch()} /> : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-8">
            {(tiles ?? Array.from({ length: 8 }, () => null)).map((c, i) => {
              if (!c) return <Skeleton key={i} className="h-[92px]" />
              const cfg = CATEGORY_CONFIG[c.category]
              return (
                <Link key={c.category} to={`/${cfg.slug}`} className="group relative overflow-hidden rounded-xl border border-line bg-surface p-3 transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:bg-surface-hover">
                  <span className={cn('flex size-8 items-center justify-center rounded-lg bg-current/10', ACCENTS[i])}><cfg.icon className="size-[18px]" aria-hidden /></span>
                  <div className="mt-2 text-xs text-fg-2">{cfg.label}</div>
                  <div className="text-xl font-bold tabular-nums leading-tight">{c.total.toLocaleString()}</div>
                  <div className="text-[11px] text-fg-3">{cfg.activeLabel} {c.active}</div>
                  {/* Share of the category that is completed. */}
                  <ProgressBar ratio={c.total ? c.completed / c.total : 0} className="mt-2 h-[3px]" label={`${cfg.label}: ${c.completed} of ${c.total} completed`} />
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {isEmpty ? (
        <EmptyState
          title="Your library is empty"
          description="Start by importing your MyAnimeList, IMDb or Backloggd exports, or add titles one by one."
          action={<div className="flex flex-wrap justify-center gap-2"><Button variant="primary" asChild><Link to="/import"><FileUp /> Import lists</Link></Button></div>}
        />
      ) : (
        <>
          {cur.data?.[0] && <ContinueHero item={cur.data[0]} />}

          <section aria-labelledby="current-h">
            <SectionHeader title={<span id="current-h">Currently Watching / Reading / Playing</span>} />
            <Shelf query={cur} empty="Nothing in progress. Start something from your wishlist!" size="lg" />
          </section>

          <section aria-labelledby="airing-h">
            <SectionHeader title={<span id="airing-h">Airing This Week</span>} />
            <AiringCalendar />
          </section>

          <div className="grid gap-7 xl:grid-cols-2">
            <section aria-labelledby="added-h">
              <SectionHeader title={<span id="added-h">Recently Added</span>} />
              <Shelf query={{ ...added, data: recentAdded }} empty="No titles yet." size="sm" />
            </section>
            <section aria-labelledby="completed-h">
              <SectionHeader title={<span id="completed-h">Recently Completed</span>} />
              <Shelf query={{ ...completed, data: recentDone }} empty="Nothing completed yet." size="sm" />
            </section>
          </div>

          <div>
            <section aria-labelledby="activity-h">
              <SectionHeader title={<span id="activity-h">Your Activity</span>} action={<Link to="/stats" className="flex items-center text-xs text-accent hover:text-accent-hover">Statistics <ChevronRight className="size-3.5" /></Link>} />
              {activity.isError ? <ErrorState error={activity.error} onRetry={() => void activity.refetch()} /> : activity.isLoading ? (
                <div className="flex flex-col gap-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
              ) : !acts?.length ? (
                <EmptyState icon={<History />} title="No activity yet" description="Ratings, progress and status changes will appear here." className="py-8" />
              ) : (
                <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
                  {acts.map((a) => {
                    const cfg = a.category ? CATEGORY_CONFIG[a.category] : null
                    const Icon = cfg?.icon ?? FileUp
                    const rating = a.action === 'rating_changed' ? (a.details.to as number | null) : null
                    return (
                      <li key={a.id} className="flex items-center gap-3 px-3 py-2">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-accent-hover"><Icon className="size-3.5" /></span>
                        <div className="min-w-0 flex-1 text-[13px]">
                          <span className="text-fg-2">{activityText(a)}</span>{' '}
                          {a.media && a.media_id && <Link to={`/media/${a.media_id}`} className="font-semibold hover:text-accent-hover">{a.media.title}</Link>}
                        </div>
                        {rating != null && <StarRating value={rating} size="xs" />}
                        <time className="shrink-0 text-[11px] text-fg-3" dateTime={a.created_at}>{timeAgo(a.created_at)}</time>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </PageContainer>
  )
}

/** Horizontal shelf; card width follows the "per row" setting (half shelves show about half as many). */
function Shelf({ query, empty, size }: { query: { data?: LibraryItem[]; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown }; empty: string; size: 'lg' | 'sm' }) {
  const perRow = usePerRow()
  const { ref, cols, variant } = usePosterColumns(size === 'lg' ? perRow : Math.max(3, Math.round(perRow / 2)))
  const width = { width: `calc((100% - ${(cols - 1) * 12}px) / ${cols})` }
  // Scroll affordance: arrows + edge fades appear only when there is more to see.
  const scroller = useRef<HTMLDivElement | null>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const updateEdges = useCallback(() => {
    const el = scroller.current
    if (!el) return
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 })
  }, [])
  const setRefs = useCallback((el: HTMLDivElement | null) => {
    scroller.current = el
    ref(el)
    if (el) requestAnimationFrame(updateEdges)
  }, [ref, updateEdges])
  useEffect(() => { requestAnimationFrame(updateEdges) }, [query.data, cols, updateEdges])
  const page = (dir: 1 | -1) => scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.85, behavior: 'smooth' })

  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  if (!query.isLoading && !query.data?.length) return <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-fg-3">{empty} <Link to="/import" className="text-accent hover:underline"><Plus className="inline size-3" /> Import</Link></p>
  const arrow = 'absolute top-[calc(50%-1.5rem)] z-10 flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-line-strong bg-surface/95 text-fg shadow-card backdrop-blur transition hover:bg-accent hover:text-white'
  return (
    <div className="relative">
      <div ref={setRefs} onScroll={updateEdges} className="flex snap-x gap-3 overflow-x-auto scroll-smooth pb-2 scrollbar-none" role="list">
        {query.isLoading
          ? Array.from({ length: cols }, (_, i) => <Skeleton key={i} className="aspect-[2/3] shrink-0 rounded-lg" style={width} />)
          : query.data!.map((it, i) => (
              <div key={it.entry_id} className="shrink-0 snap-start" style={width} role="listitem">
                <PosterCard item={it} variant={variant} showCategory={size === 'lg' && variant === 'grid'} eager={i < 8} />
              </div>
            ))}
      </div>
      {edges.left && <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-bg to-transparent" aria-hidden />}
      {edges.right && <div className="pointer-events-none absolute inset-y-0 right-0 w-14 bg-gradient-to-l from-bg to-transparent" aria-hidden />}
      {edges.left && <button type="button" className={cn(arrow, '-left-3')} onClick={() => page(-1)} aria-label="Scroll left"><ChevronLeft className="size-5" /></button>}
      {edges.right && <button type="button" className={cn(arrow, '-right-3')} onClick={() => page(1)} aria-label="Scroll right"><ChevronRight className="size-5" /></button>}
    </div>
  )
}

/** Big "continue" card for the most recently active in-progress title. */
function ContinueHero({ item }: { item: LibraryItem }) {
  const actions = useEntryActions()
  const cfg = CATEGORY_CONFIG[item.category]
  const progress = primaryProgress(item)
  const src = posterSrc(item)
  return (
    <section aria-label="Continue" className="relative overflow-hidden rounded-xl border border-line bg-surface">
      {src && <img src={src} alt="" aria-hidden referrerPolicy="no-referrer" className="absolute inset-0 size-full scale-125 object-cover opacity-60 blur-2xl" />}
      <div className="absolute inset-0 bg-gradient-to-r from-bg/95 via-bg/70 to-bg/20" />
      <div className="relative flex items-center gap-4 p-4 sm:gap-6 sm:p-5">
        <Link to={`/media/${item.media_id}`} className="w-20 shrink-0 sm:w-28">
          <PosterImage src={src} title={item.title} category={item.category} eager className="rounded-lg shadow-card ring-1 ring-white/10" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent-hover"><cfg.icon className="size-3.5" /> Continue {cfg.activeLabel.toLowerCase()}</div>
          <Link to={`/media/${item.media_id}`} className="mt-1 line-clamp-2 text-lg font-bold leading-tight hover:text-accent-hover sm:text-2xl">{item.title}</Link>
          {progress && progress.unit !== '' && (
            <div className="mt-3 flex max-w-md items-center gap-3">
              <ProgressBar ratio={progress.ratio} className="h-1.5 flex-1" label="Progress" />
              <span className="shrink-0 text-[13px] tabular-nums text-fg-2">{progress.label}</span>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {canIncrement(item) && <Button variant="primary" size="sm" onClick={() => actions.increment(item)}><Plus /> 1 {progress?.unit.replace(/s$/, '') ?? ''}</Button>}
            <StarRating value={item.rating} onChange={(v) => actions.setRating(item, v)} size="md" label={`Rate ${item.title}`} />
          </div>
        </div>
      </div>
    </section>
  )
}
