/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, CheckSquare, Dices, LayoutGrid, List, Plus, Search, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { PageContainer } from '@/components/layout/AppShell'
import { MediaListRow } from '@/components/media/MediaListRow'
import { PosterCard, PosterGrid } from '@/components/media/PosterCard'
import { PerRowControl } from '@/components/media/PosterSizeControl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/form-controls'
import { EmptyState, ErrorState, PillTabs, Skeleton } from '@/components/ui/misc'
import { ConfirmDialog, Dialog, DialogContent, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tooltip } from '@/components/ui/overlays'
import { Select } from '@/components/ui/select'
import { AddMediaDialog } from '@/features/discovery/AddMediaDialog'
import { MetadataBanner } from '@/features/enrichment/MetadataBanner'
import { SORT_OPTIONS, usePerRow, useSettings, useSettingsStore, type ViewMode } from '@/features/settings/settings-store'
import { fetchLibrary, keys, useBulkUpdate, useDeleteMedia, useFacets } from '@/features/tracking/api'
import { useDebounced } from '@/features/tracking/hooks'
import { categoryBySlug, statusLabel, wishlistLabel, type CategoryConfig } from '@/lib/categories'
import { friendlyError } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { STATUSES, type LibraryStatus } from '@/types/db'
import { ActiveFilterChips, activeFilterCount, FilterBar, readFilters, toLibraryParams, writeFilters, type FilterState, type Tab } from './filters'

const PAGE_SIZE = 60

export function LibraryRoute() {
  const { slug } = useParams()
  const cfg = categoryBySlug(slug)
  if (!cfg) return <Navigate to="/" replace />
  return <LibraryPage key={cfg.id} cfg={cfg} />
}

function LibraryPage({ cfg }: { cfg: CategoryConfig }) {
  const settings = useSettings()
  const [sp, setSp] = useSearchParams()
  const wishlistHidden = settings.hiddenWishlistTabs.includes(cfg.id)
  const planningHidden = settings.hiddenPlanningTabs.includes(cfg.id)
  const f = useMemo(() => {
    const r = readFilters(sp, settings.defaultSort)
    // A hidden Wishlist tab cannot be the active one (e.g. from an old link).
    if ((wishlistHidden && r.tab === 'wishlist') || (planningHidden && r.tab === 'planning')) return { ...r, tab: 'all' as Tab }
    return r
  }, [sp, settings.defaultSort, wishlistHidden, planningHidden])
  const update = useCallback((patch: Partial<FilterState>) => {
    setSp(writeFilters({ ...f, ...patch }, settings.defaultSort), { replace: true })
  }, [f, setSp, settings.defaultSort])

  // 'compact' is a legacy view: it is now just a higher per-row count.
  const storedView = useSettingsStore((s) => s.viewModes[cfg.id] ?? s.settings.defaultView)
  const view: ViewMode = storedView === 'compact' ? 'grid' : storedView
  const perRow = usePerRow()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const setView = useSettingsStore((s) => s.setViewMode)
  const [searchText, setSearchText] = useState(f.q)
  const debouncedSearch = useDebounced(searchText, 300)
  useEffect(() => {
    if (debouncedSearch !== f.q) update({ q: debouncedSearch })
  }, [debouncedSearch]) // eslint-disable-line react-hooks/exhaustive-deps

  const facets = useFacets(cfg.id)
  // While searching, results are ordered by relevance unless a sort was chosen explicitly.
  const explicitSort = sp.has('sort')
  const params = useMemo(() => {
    const p = toLibraryParams(f, cfg.id, f.q)
    return f.q && !explicitSort ? { ...p, sort: 'relevance' } : p
  }, [f, cfg.id, explicitSort])
  // Stable shuffle seed for this visit so paging a random order never repeats titles.
  const [shuffleSeed] = useState(() => String(Math.random()).slice(2, 10))
  const seed = f.sort === 'random' ? shuffleSeed : ''

  const query = useInfiniteQuery({
    queryKey: ['library', 'infinite', params, seed],
    queryFn: ({ pageParam }) => fetchLibrary({ ...params, seed, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
  })
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data])
  const total = query.data?.pages[0]?.total ?? 0

  // ---- selection / bulk actions
  const [selecting, setSelecting] = useState(false)
  // entry_id -> media_id, so bulk actions also cover titles not loaded on screen.
  const [selected, setSelected] = useState<Map<string, string>>(new Map())
  const mediaOf = useMemo(() => new Map(items.map((i) => [i.entry_id, i.media_id])), [items])
  const onSelectChange = useCallback((id: string, v: boolean) => {
    setSelected((s) => {
      const n = new Map(s)
      if (v) n.set(id, mediaOf.get(id) ?? ''); else n.delete(id)
      return n
    })
  }, [mediaOf])
  const stopSelecting = () => { setSelecting(false); setSelected(new Map()) }
  const selectAllMatching = async () => {
    const all = new Map<string, string>()
    try {
      for (let offset = 0; ; offset += 500) {
        const page = await fetchLibrary({ ...params, limit: 500, offset })
        page.items.forEach((i) => all.set(i.entry_id, i.media_id))
        if (page.items.length < 500) break
      }
      setSelected(all)
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }

  // ---- infinite scroll + scroll restoration
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((e) => {
      if (e[0].isIntersecting && query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage()
    }, { rootMargin: '800px' })
    io.observe(el)
    return () => io.disconnect()
  }, [query])
  useScrollRestoration(`lib:${cfg.id}:${sp.toString()}`, !query.isLoading)

  const [addOpen, setAddOpen] = useState(false)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const pickRandom = async () => {
    try {
      const res = await qc.fetchQuery({
        queryKey: keys.library({ ...params, sort: 'random', seed: String(Math.random()), limit: 1 }),
        queryFn: () => fetchLibrary({ ...params, sort: 'random', seed: String(Math.random()), limit: 1 }),
      })
      const pick = res.items[0]
      if (!pick) return toast('Nothing to pick from with the current filters')
      toast.success(`Random pick: ${pick.title}`)
      navigate(`/media/${pick.media_id}`)
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }

  const counts = facets.data?.status_counts ?? {}
  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: 'all', label: 'All', count: facets.data?.total },
    ...(['in_progress', 'completed', 'on_hold', 'dropped', 'planning'] as LibraryStatus[])
      .filter((s) => !(s === 'planning' && planningHidden))
      .map((s) => ({ value: s as Tab, label: statusLabel(s, cfg.id), count: counts[s] ?? 0 })),
    ...(wishlistHidden ? [] : [{ value: 'wishlist' as Tab, label: wishlistLabel(cfg.id), count: facets.data?.wishlist_count }]),
  ]
  const nFilters = activeFilterCount(f)
  const sortOptions = f.q ? [{ value: 'relevance', label: 'Relevance' }, ...SORT_OPTIONS] : f.tab === 'wishlist' ? [{ value: 'priority_desc', label: 'Wishlist priority' }, ...SORT_OPTIONS] : SORT_OPTIONS

  return (
    <PageContainer>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><cfg.icon className="size-5 text-accent" /> {cfg.label}</h1>
          <p className="mt-0.5 text-[13px] text-fg-3" aria-live="polite">
            {query.isLoading ? 'Loading…' : `${total.toLocaleString()} ${total === 1 ? 'entry' : 'entries'}${nFilters || f.q || f.tab !== 'all' ? ' match' : ''}`}
          </p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative flex-1 sm:w-64 sm:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-fg-3" />
            <Input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder={`Search ${cfg.label.toLowerCase()}…`} className="pl-8" aria-label={`Search ${cfg.label}`} />
            {searchText && (
              <button onClick={() => setSearchText('')} className="absolute right-2 top-2 text-fg-3 hover:text-fg" aria-label="Clear search"><X className="size-4" /></button>
            )}
          </div>
          <Button variant="primary" onClick={() => setAddOpen(true)}><Plus /> Add</Button>
        </div>
      </div>

      <MetadataBanner category={cfg.id} />

      <PillTabs className="mt-4" value={f.tab} onChange={(tab) => update({ tab })} items={tabs} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="hidden text-xs text-fg-3 sm:inline">Sort</span>
          <Select aria-label="Sort by" value={params.sort} onValueChange={(sort) => update({ sort })} options={sortOptions} className="w-44 sm:w-48" />
        </div>
        {/* Desktop/tablet: filters inline. Phone: in a sheet behind one button. */}
        <div className="hidden flex-wrap items-center gap-2 md:contents">
          <FilterBar cfg={cfg} f={f} facets={facets.data} onChange={update} />
        </div>
        <Button variant="secondary" className="md:hidden" onClick={() => setFiltersOpen(true)}>
          <SlidersHorizontal /> Filters{nFilters ? <span className="rounded bg-accent px-1 text-[11px] text-white">{nFilters}</span> : null}
        </Button>
        <div className="ml-auto flex items-center gap-1">
          {view !== 'list' && <PerRowControl className="mr-1 hidden sm:flex" />}
          {f.tab === 'wishlist' && (
            <Tooltip content="Pick a random title from this list"><Button variant="ghost" size="icon" onClick={pickRandom} aria-label="Random pick"><Dices /></Button></Tooltip>
          )}
          <Tooltip content="Select multiple">
            <Button variant={selecting ? 'primary' : 'ghost'} size="icon" onClick={() => (selecting ? stopSelecting() : setSelecting(true))} aria-pressed={selecting} aria-label="Select multiple"><CheckSquare /></Button>
          </Tooltip>
          <ViewToggle value={view} onChange={(v) => setView(cfg.id, v)} />
        </div>
      </div>
      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent title="Filters" description={`${total.toLocaleString()} matching`}>
          <div className="flex flex-col items-start gap-3 [&>*]:w-full [&_button[role=combobox]]:flex-1">
            <FilterBar cfg={cfg} f={f} facets={facets.data} onChange={update} />
            {view !== 'list' && <div className="flex items-center justify-between"><span className="text-xs text-fg-3">Grid</span><PerRowControl /></div>}
            <div className="flex gap-2 pt-1">
              {nFilters > 0 && <Button variant="ghost" onClick={() => update(CLEARED_ALL)}>Clear all</Button>}
              <Button variant="primary" className="ml-auto" onClick={() => setFiltersOpen(false)}>Show {total.toLocaleString()}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="mt-2.5"><ActiveFilterChips cfg={cfg} f={f} onChange={update} /></div>

      {selecting && (
        <BulkBar
          count={selected.size}
          total={total}
          onSelectAll={selectAllMatching}
          onClear={stopSelecting}
          entryIds={[...selected.keys()]}
          mediaIds={[...selected.values()]}
          cfg={cfg}
          onDone={() => setSelected(new Map())}
        />
      )}

      <section className="mt-4" aria-label={`${cfg.label} results`}>
        {query.isLoading ? (
          <LoadingGrid view={view} perRow={perRow} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : items.length === 0 ? (
          <EmptyLibrary cfg={cfg} filtered={nFilters > 0 || !!f.q || f.tab !== 'all'} tab={f.tab} onClear={() => { setSearchText(''); update({ ...{ q: '', tab: 'all' }, ...CLEARED_ALL }) }} onAdd={() => setAddOpen(true)} />
        ) : view === 'list' ? (
          <div role="table" aria-label={cfg.label} className="rounded-lg border border-line bg-surface/40">
            {items.map((it) => (
              <MediaListRow key={it.entry_id} item={it} selectable={selecting} selected={selected.has(it.entry_id)} onSelectChange={onSelectChange} />
            ))}
          </div>
        ) : (
          <PosterGrid perRow={perRow}>
            {(variant) => items.map((it, i) => (
              <PosterCard key={it.entry_id} item={it} variant={variant} eager={i < 12}
                selectable={selecting} selected={selected.has(it.entry_id)} onSelectChange={onSelectChange} />
            ))}
          </PosterGrid>
        )}
        <div ref={sentinel} className="h-px" />
        {query.isFetchingNextPage && <div className="mt-6"><LoadingGrid view={view} perRow={perRow} rows={1} /></div>}
        {query.hasNextPage && !query.isFetchingNextPage && (
          <div className="mt-6 flex justify-center"><Button onClick={() => void query.fetchNextPage()}>Load more</Button></div>
        )}
      </section>
      <AddMediaDialog open={addOpen} onOpenChange={setAddOpen} defaultCategory={cfg.id} />
    </PageContainer>
  )
}

const CLEARED_ALL: Partial<FilterState> = {
  genres: [], formats: [], countries: [], releaseStatuses: [], decade: null, yearMin: null, yearMax: null,
  ratingMin: null, rated: 'any', favorite: false, minRepeats: null, progressMin: null, activeRepeat: false,
}

// Poster size is a slider now; the old "compact" view is a small poster size.
function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const opts: { v: ViewMode; icon: typeof LayoutGrid; label: string }[] = [
    { v: 'grid', icon: LayoutGrid, label: 'Posters' },
    { v: 'list', icon: List, label: 'List' },
  ]
  return (
    <div className="flex rounded-md border border-line bg-surface-2 p-0.5" role="radiogroup" aria-label="View mode">
      {opts.map((o) => (
        <Tooltip key={o.v} content={o.label}>
          <button role="radio" aria-checked={value === o.v} aria-label={o.label} onClick={() => onChange(o.v)}
            className={cn('flex size-7 items-center justify-center rounded text-fg-3 transition-colors', value === o.v ? 'bg-accent-soft text-fg' : 'hover:text-fg')}>
            <o.icon className="size-4" />
          </button>
        </Tooltip>
      ))}
    </div>
  )
}

function LoadingGrid({ view, perRow, rows = 2 }: { view: ViewMode; perRow: number; rows?: number }) {
  if (view === 'list') return <div className="flex flex-col gap-2">{Array.from({ length: 6 * rows }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
  return (
    <PosterGrid perRow={perRow}>
      {() => Array.from({ length: perRow * rows }, (_, i) => (
        <div key={i} className="flex flex-col gap-2"><Skeleton className="aspect-[2/3] rounded-lg" /><Skeleton className="h-3 w-3/4" /><Skeleton className="h-2.5 w-1/2" /></div>
      ))}
    </PosterGrid>
  )
}

function EmptyLibrary({ cfg, filtered, tab, onClear, onAdd }: { cfg: CategoryConfig; filtered: boolean; tab: Tab; onClear: () => void; onAdd: () => void }) {
  if (filtered) {
    return (
      <EmptyState icon={<Search />} title="No matches" description={tab === 'wishlist' ? `Your ${cfg.label} wishlist is empty or nothing matches the filters.` : 'Nothing in this view matches the current search and filters.'}
        action={<Button onClick={onClear}>Clear search and filters</Button>} />
    )
  }
  return (
    <EmptyState icon={<cfg.icon />} title={`No ${cfg.label.toLowerCase()} yet`} description="Add a title from an online database, create a custom entry, or import your existing lists."
      action={<div className="flex gap-2"><Button variant="primary" onClick={onAdd}><Plus /> Add {cfg.singular.toLowerCase()}</Button><Button asChild><a href={`${import.meta.env.BASE_URL}import`}>Import</a></Button></div>} />
  )
}

function BulkBar({ count, total, onSelectAll, onClear, entryIds, mediaIds, cfg, onDone }: {
  count: number; total: number; onSelectAll: () => Promise<void>; onClear: () => void; entryIds: string[]; mediaIds: string[]; cfg: CategoryConfig; onDone: () => void
}) {
  const bulk = useBulkUpdate()
  const del = useDeleteMedia()
  const settings = useSettings()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [selectingAll, setSelectingAll] = useState(false)
  const run = (patch: Parameters<typeof bulk.mutate>[0]['patch'], opts: { fillProgress?: boolean; historical?: boolean } = {}) =>
    bulk.mutate({ entryIds, patch, ...opts }, { onSuccess: onDone })
  const disabled = count === 0 || bulk.isPending
  const fill = settings.fillProgressOnComplete
  return (
    <div className="sticky top-0 z-20 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-surface/95 px-3 py-2 shadow-card backdrop-blur">
      <span className="text-[13px] font-medium">{count.toLocaleString()} selected</span>
      <Button size="sm" variant="ghost" loading={selectingAll} disabled={count === total}
        onClick={async () => { setSelectingAll(true); try { await onSelectAll() } finally { setSelectingAll(false) } }}>
        Select all {total.toLocaleString()} matching
      </Button>
      <div className="mx-1 h-5 w-px bg-line" />
      <Menu>
        <MenuTrigger asChild><Button size="sm" disabled={disabled} loading={bulk.isPending}>Set status</Button></MenuTrigger>
        <MenuContent align="start">
          {STATUSES.filter((s) => s !== 'completed').map((s) => <MenuItem key={s} onSelect={() => run({ status: s })}>{statusLabel(s, cfg.id)}</MenuItem>)}
          <MenuSeparator />
          <MenuItem onSelect={() => run({ status: 'completed' }, { fillProgress: fill })}>
            {statusLabel('completed', cfg.id)} — finished now
          </MenuItem>
          {/* Past completions: date stays unknown, statistics and the activity feed are not touched. */}
          <MenuItem onSelect={() => run({ status: 'completed' }, { fillProgress: fill, historical: true })}>
            {statusLabel('completed', cfg.id)} — earlier, date unknown
          </MenuItem>
        </MenuContent>
      </Menu>
      <Button size="sm" disabled={disabled} onClick={() => run({ wishlisted_at: new Date().toISOString() })}><Bookmark /> Wishlist</Button>
      <Button size="sm" disabled={disabled} onClick={() => run({ wishlisted_at: null })}>Remove from Wishlist</Button>
      <Button size="sm" disabled={disabled} onClick={() => run({ is_favorite: true })}>Favorite</Button>
      <Button size="sm" disabled={disabled} onClick={() => run({ is_favorite: false })}>Unfavorite</Button>
      <Button size="sm" variant="danger" disabled={count === 0} onClick={() => setConfirmDelete(true)}><Trash2 /> Delete</Button>
      <Button size="icon-sm" variant="ghost" className="ml-auto" onClick={onClear} aria-label="Exit selection"><X /></Button>
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} destructive title={`Delete ${count} ${count === 1 ? 'entry' : 'entries'}?`}
        description="Their ratings, progress, history and notes will be removed permanently (unless you restore a backup)."
        confirmLabel={`Delete ${count}`} onConfirm={async () => { await del.mutateAsync(mediaIds); onDone() }} />
    </div>
  )
}

/** Saves the main scroll container position per view and restores it when data is ready. */
function useScrollRestoration(key: string, ready: boolean) {
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('[data-scroll-container]')
    if (!el) return
    const save = () => {
      try { sessionStorage.setItem(`scroll:${key}`, String(el.scrollTop)) } catch { /* ignore */ }
    }
    el.addEventListener('scroll', save, { passive: true })
    return () => el.removeEventListener('scroll', save)
  }, [key])
  useEffect(() => {
    if (!ready) return
    const el = document.querySelector<HTMLElement>('[data-scroll-container]')
    let y = 0
    try { y = Number(sessionStorage.getItem(`scroll:${key}`) ?? 0) } catch { /* ignore */ }
    if (el && y > 0) requestAnimationFrame(() => { el.scrollTop = y })
  }, [key, ready])
}
