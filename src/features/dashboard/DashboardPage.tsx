/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, FileUp, History, Plus } from 'lucide-react'
import { Link } from 'react-router'
import { PageContainer } from '@/components/layout/AppShell'
import { PosterCard } from '@/components/media/PosterCard'
import { PosterImage } from '@/components/media/PosterImage'
import { StarRating } from '@/components/ratings/StarRating'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState, SectionHeader, Skeleton } from '@/components/ui/misc'
import { fetchLibrary, useActivity, useDashboardSummary, type LibraryParams } from '@/features/tracking/api'
import { CATEGORY_CONFIG } from '@/lib/categories'
import { timeAgo } from '@/lib/dates'
import { posterSrc } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { LibraryItem } from '@/types/db'
import { activityText } from './activity-text'

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
  const wishlist = useItems('wishlist', { wishlist: true, sort: 'priority_desc', limit: 8 })
  const activity = useActivity(8)
  const isEmpty = summary.data?.every((c) => c.total === 0)

  return (
    <PageContainer className="flex flex-col gap-7">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-[13px] text-fg-3">Your personal media library</p>
      </header>

      {/* Category summary */}
      <section aria-label="Library summary">
        {summary.isError ? <ErrorState error={summary.error} onRetry={() => void summary.refetch()} /> : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-8">
            {(summary.data ?? Array.from({ length: 8 }, () => null)).map((c, i) => {
              if (!c) return <Skeleton key={i} className="h-[92px]" />
              const cfg = CATEGORY_CONFIG[c.category]
              return (
                <Link key={c.category} to={`/${cfg.slug}`} className="group rounded-lg border border-line bg-surface p-3 transition-colors hover:border-line-strong hover:bg-surface-hover">
                  <cfg.icon className={cn('size-5', ACCENTS[i])} aria-hidden />
                  <div className="mt-2 text-xs text-fg-2">{cfg.label}</div>
                  <div className="text-xl font-bold tabular-nums leading-tight">{c.total.toLocaleString()}</div>
                  <div className="text-[11px] text-fg-3">{cfg.activeLabel} {c.active}</div>
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
          <section aria-labelledby="current-h">
            <SectionHeader title={<span id="current-h">Currently Watching / Reading / Playing</span>} />
            <Shelf query={current} empty="Nothing in progress. Start something from your wishlist!" size="lg" />
          </section>

          <div className="grid gap-7 xl:grid-cols-2">
            <section aria-labelledby="added-h">
              <SectionHeader title={<span id="added-h">Recently Added</span>} />
              <Shelf query={{ ...added, data: added.data?.items }} empty="No titles yet." size="sm" />
            </section>
            <section aria-labelledby="completed-h">
              <SectionHeader title={<span id="completed-h">Recently Completed</span>} />
              <Shelf query={{ ...completed, data: completed.data?.items }} empty="Nothing completed yet." size="sm" />
            </section>
          </div>

          <div className="grid gap-7 xl:grid-cols-[1fr_1.15fr]">
            <section aria-labelledby="activity-h">
              <SectionHeader title={<span id="activity-h">Your Activity</span>} action={<Link to="/stats" className="flex items-center text-xs text-accent hover:text-accent-hover">Statistics <ChevronRight className="size-3.5" /></Link>} />
              {activity.isError ? <ErrorState error={activity.error} onRetry={() => void activity.refetch()} /> : activity.isLoading ? (
                <div className="flex flex-col gap-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
              ) : !activity.data?.length ? (
                <EmptyState icon={<History />} title="No activity yet" description="Ratings, progress and status changes will appear here." className="py-8" />
              ) : (
                <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
                  {activity.data.map((a) => {
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
            <section aria-labelledby="wish-h">
              <SectionHeader title={<span id="wish-h">Wishlist Highlights</span>} />
              {wishlist.isError ? <ErrorState error={wishlist.error} onRetry={() => void wishlist.refetch()} /> : !wishlist.isLoading && !wishlist.data?.items.length ? (
                <EmptyState title="Wishlist is empty" description="Bookmark titles you want to get to next." className="py-8" />
              ) : (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                  {(wishlist.data?.items ?? Array.from({ length: 4 }, () => null)).slice(0, 8).map((it, i) => it ? (
                    <WishCard key={it.entry_id} item={it} />
                  ) : <Skeleton key={i} className="aspect-[2/3]" />)}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </PageContainer>
  )
}

function WishCard({ item }: { item: LibraryItem }) {
  const cfg = CATEGORY_CONFIG[item.category]
  return (
    <Link to={`/media/${item.media_id}`} className="group flex min-w-0 flex-col gap-1.5">
      <div className="relative">
        <PosterImage src={posterSrc(item)} title={item.title} category={item.category} className="transition-transform group-hover:-translate-y-0.5" />
        <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white">
          <cfg.icon className="size-3" /> {cfg.singular}
        </span>
      </div>
      <span className="line-clamp-2 text-[12px] font-semibold leading-tight group-hover:text-accent-hover">{item.title}</span>
    </Link>
  )
}

function Shelf({ query, empty, size }: { query: { data?: LibraryItem[]; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown }; empty: string; size: 'lg' | 'sm' }) {
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  const w = size === 'lg' ? 'w-[132px] sm:w-[150px]' : 'w-[96px] sm:w-[104px]'
  if (query.isLoading) {
    return <div className="flex gap-3 overflow-hidden">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className={cn('aspect-[2/3] shrink-0', w)} />)}</div>
  }
  if (!query.data?.length) return <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-fg-3">{empty} <Link to="/import" className="text-accent hover:underline"><Plus className="inline size-3" /> Import</Link></p>
  return (
    <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 scrollbar-none" role="list">
      {query.data.map((it, i) => (
        <div key={it.entry_id} className={cn('shrink-0', w)} role="listitem">
          <PosterCard item={it} variant={size === 'lg' ? 'grid' : 'compact'} showCategory={size === 'lg'} eager={i < 8} />
        </div>
      ))}
    </div>
  )
}
