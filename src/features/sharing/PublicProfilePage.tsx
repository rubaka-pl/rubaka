/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { ChevronLeft, ChevronRight, Eye, Heart, Search } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router'
import { Logo } from '@/components/layout/Logo'
import { PosterGrid, StatusDot } from '@/components/media/PosterCard'
import { PosterImage } from '@/components/media/PosterImage'
import { StarRating } from '@/components/ratings/StarRating'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/form-controls'
import { EmptyState, PillTabs, ProgressBar, Skeleton } from '@/components/ui/misc'
import { Select } from '@/components/ui/select'
import { usePerRow } from '@/features/settings/settings-store'
import { useDebounced } from '@/features/tracking/hooks'
import { CATEGORY_CONFIG, primaryProgress, statusLabel } from '@/lib/categories'
import { posterSrc } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { LibraryStatus, MediaCategory } from '@/types/db'
import { usePublicLibrary, usePublicProfile, type PublicItem } from './api'

const STATUSES: LibraryStatus[] = ['in_progress', 'completed', 'planning', 'on_hold', 'dropped']

/** Read-only view of the library for anyone with the link. No sign-in, no editing. */
export function PublicProfilePage() {
  const { token = '' } = useParams()
  const q = usePublicProfile(token)
  const [tab, setTab] = useState<'overview' | MediaCategory>('overview')
  const perRow = usePerRow()

  if (q.isLoading) return <Shell><Skeleton className="h-28" /><Skeleton className="mt-6 h-72" /></Shell>
  if (q.isError || !q.data) {
    return <Shell><EmptyState className="mt-16" title="This link doesn't work" description="It may have been turned off or replaced by the owner." /></Shell>
  }
  const p = q.data
  const cats = p.categories.filter((c) => c.total > 0)

  return (
    <Shell>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8">
        {cats.map((c) => {
          const cfg = CATEGORY_CONFIG[c.category]
          return (
            <button key={c.category} onClick={() => setTab(c.category)}
              className={cn('flex flex-col gap-1 rounded-xl border bg-surface p-3 text-left transition-colors hover:border-accent/60',
                tab === c.category ? 'border-accent/70 ring-1 ring-accent/40' : 'border-line')}>
              <span className="flex items-center gap-1.5 text-[12px] text-fg-2"><cfg.icon className="size-3.5 text-accent-hover" />{cfg.label}</span>
              <span className="text-2xl font-bold tabular-nums">{c.total}</span>
              <span className="text-[11px] text-fg-3 tabular-nums">{c.completed} {statusLabel('completed', c.category).toLowerCase()}{c.avg_rating != null ? ` · ★ ${c.avg_rating}` : ''}</span>
              <ProgressBar ratio={c.total ? c.completed / c.total : 0} label={`${cfg.label} completed`} />
            </button>
          )
        })}
      </div>

      <PillTabs className="mt-6" value={tab} onChange={setTab}
        items={[{ value: 'overview' as const, label: 'Overview' }, ...cats.map((c) => ({ value: c.category, label: CATEGORY_CONFIG[c.category].label, count: c.total }))]} />

      {tab === 'overview' ? (
        <div className="mt-5 flex flex-col gap-8">
          {p.favorites.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold"><Heart className="size-4 fill-danger text-danger" /> Favorites</h2>
              <PosterGrid perRow={perRow}>{(v) => p.favorites.map((it) => <PublicCard key={it.entry_id} item={it} variant={v} showCategory showRating={p.show_ratings} />)}</PosterGrid>
            </section>
          )}
          {p.recent.length > 0 && (
            <section>
              <h2 className="mb-3 text-[15px] font-semibold">Recently completed</h2>
              <PosterGrid perRow={perRow}>{(v) => p.recent.map((it) => <PublicCard key={it.entry_id} item={it} variant={v} showCategory showRating={p.show_ratings} />)}</PosterGrid>
            </section>
          )}
          {!p.favorites.length && !p.recent.length && <EmptyState title="Pick a category above" />}
        </div>
      ) : (
        <CategoryList key={tab} token={token} category={tab} counts={cats.find((c) => c.category === tab)!} showRatings={p.show_ratings} perRow={perRow} />
      )}
    </Shell>
  )
}

function CategoryList({ token, category, counts, showRatings, perRow }: {
  token: string; category: MediaCategory; counts: Record<string, number | string | null>; showRatings: boolean; perRow: number
}) {
  const [status, setStatus] = useState<LibraryStatus | 'all'>('all')
  const [sort, setSort] = useState(showRatings ? 'rating_desc' : 'title_asc')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const term = useDebounced(search, 300)
  const q = usePublicLibrary(token, category, status === 'all' ? null : status, sort, term, page)
  const total = q.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / 60))
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(0) }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <PillTabs value={status} onChange={reset(setStatus)}
          items={[{ value: 'all' as const, label: 'All', count: Number(counts.total) },
            ...STATUSES.filter((s) => Number(counts[s]) > 0).map((s) => ({ value: s, label: statusLabel(s, category), count: Number(counts[s]) }))]} />
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
            <Input value={search} onChange={(e) => reset(setSearch)(e.target.value)} placeholder="Search" className="w-44 pl-8" aria-label="Search" />
          </div>
          <Select value={sort} onValueChange={reset(setSort)} aria-label="Sort" className="w-40" options={[
            ...(showRatings ? [{ value: 'rating_desc', label: 'Highest rated' }] : []),
            { value: 'title_asc', label: 'Title A–Z' }, { value: 'completed_desc', label: 'Recently completed' },
            { value: 'release_desc', label: 'Newest release' }, { value: 'release_asc', label: 'Oldest release' }, { value: 'added_desc', label: 'Recently added' },
          ]} />
        </div>
      </div>
      {q.isLoading ? <Skeleton className="h-72" /> : !q.data?.items.length ? <EmptyState title="Nothing here" /> : (
        <div className={cn('transition-opacity', q.isFetching && 'opacity-60')}>
          <PosterGrid perRow={perRow}>{(v) => q.data!.items.map((it) => <PublicCard key={it.entry_id} item={it} variant={v} showRating={showRatings} />)}</PosterGrid>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-[13px] text-fg-2">
          <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((x) => x - 1)}><ChevronLeft /> Previous</Button>
          <span className="tabular-nums">{page + 1} / {pages}</span>
          <Button variant="secondary" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((x) => x + 1)}>Next <ChevronRight /></Button>
        </div>
      )}
    </div>
  )
}

function PublicCard({ item, variant, showCategory, showRating }: { item: PublicItem; variant: 'grid' | 'compact'; showCategory?: boolean; showRating: boolean }) {
  const compact = variant === 'compact'
  const progress = primaryProgress(item as Parameters<typeof primaryProgress>[0])
  const following = item.status === 'in_progress' || item.status === 'on_hold'
  const sub = [showCategory && CATEGORY_CONFIG[item.category].singular, following && progress?.unit ? progress.label : item.release_year].filter(Boolean).join(' · ')
  return (
    <article className="flex min-w-0 flex-col" aria-label={item.title}>
      <div className="relative">
        <PosterImage src={posterSrc(item)} title={item.title} category={item.category} className="rounded-lg shadow-[0_4px_14px_-6px_rgb(0_0_0/0.6)] ring-1 ring-white/[0.06]" />
        <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-sm">
          <StatusDot status={item.status} />{!compact && statusLabel(item.status, item.category)}
        </span>
        {item.is_favorite && <span className="absolute right-1.5 top-1.5 rounded bg-black/65 p-1"><Heart className="size-3 fill-danger text-danger" aria-label="Favorite" /></span>}
      </div>
      <div className="mt-1.5 flex min-w-0 flex-col gap-0.5">
        <div className={cn('line-clamp-1 font-semibold leading-tight', compact ? 'text-[11px]' : 'text-[12.5px]')} title={item.title}>{item.title}</div>
        {!compact && sub && <div className="truncate text-[11px] text-fg-3 tabular-nums">{sub}</div>}
        {following && progress?.unit && <ProgressBar ratio={progress.ratio} label={`Progress ${progress.label}`} />}
        {showRating && item.rating != null && <StarRating value={item.rating} size={compact ? 'xs' : 'sm'} label={`Rated ${item.rating / 2}`} />}
      </div>
    </article>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1500px] items-center justify-between px-4 sm:px-6">
          <Logo />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11px] text-fg-3"><Eye className="size-3.5" /> Read-only shared library</span>
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6">{children}</main>
    </div>
  )
}
