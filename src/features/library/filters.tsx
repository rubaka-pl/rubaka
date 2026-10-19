/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Label, Switch } from '@/components/ui/form-controls'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays'
import { Select } from '@/components/ui/select'
import { COUNTRY_LABEL, RELEASE_STATUS_LABEL, type CategoryConfig } from '@/lib/categories'
import { cn } from '@/lib/utils'
import type { LibraryStatus } from '@/types/db'
import type { Facets, LibraryParams } from '@/features/tracking/api'

/**
 * Library filter state <-> URL search params. Keeping filters in the URL
 * means they survive navigating into a title and back, reloads and sharing.
 */
export type Tab = 'all' | LibraryStatus | 'wishlist'

export interface FilterState {
  tab: Tab
  q: string
  sort: string
  genres: string[]
  formats: string[]
  countries: string[]
  releaseStatuses: string[]
  decade: string | null
  yearMin: number | null
  yearMax: number | null
  ratingMin: number | null
  rated: 'any' | 'rated' | 'unrated'
  favorite: boolean
  minRepeats: number | null
  progressMin: number | null
  activeRepeat: boolean
}

const list = (v: string | null) => (v ? v.split(',').map(decodeURIComponent).filter(Boolean) : [])
const num = (v: string | null) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

export function readFilters(sp: URLSearchParams, defaultSort: string): FilterState {
  const rated = sp.get('rated')
  return {
    tab: (sp.get('tab') as Tab) || 'all',
    q: sp.get('q') ?? '',
    sort: sp.get('sort') || defaultSort,
    genres: list(sp.get('genres')),
    formats: list(sp.get('formats')),
    countries: list(sp.get('countries')),
    releaseStatuses: list(sp.get('release')),
    decade: sp.get('decade'),
    yearMin: num(sp.get('ymin')),
    yearMax: num(sp.get('ymax')),
    ratingMin: num(sp.get('rmin')),
    rated: rated === 'rated' || rated === 'unrated' ? rated : 'any',
    favorite: sp.get('fav') === '1',
    minRepeats: num(sp.get('repeats')),
    progressMin: num(sp.get('pmin')),
    activeRepeat: sp.get('repeating') === '1',
  }
}

export function writeFilters(f: FilterState, defaultSort: string): URLSearchParams {
  const sp = new URLSearchParams()
  const set = (k: string, v: string | number | null | undefined | boolean) => {
    if (v === null || v === undefined || v === '' || v === false) return
    sp.set(k, v === true ? '1' : String(v))
  }
  if (f.tab !== 'all') set('tab', f.tab)
  set('q', f.q.trim())
  if (f.sort !== defaultSort) set('sort', f.sort)
  if (f.genres.length) sp.set('genres', f.genres.map(encodeURIComponent).join(','))
  if (f.formats.length) sp.set('formats', f.formats.join(','))
  if (f.countries.length) sp.set('countries', f.countries.join(','))
  if (f.releaseStatuses.length) sp.set('release', f.releaseStatuses.join(','))
  set('decade', f.decade)
  set('ymin', f.yearMin)
  set('ymax', f.yearMax)
  set('rmin', f.ratingMin)
  if (f.rated !== 'any') set('rated', f.rated)
  set('fav', f.favorite)
  set('repeats', f.minRepeats)
  set('pmin', f.progressMin)
  set('repeating', f.activeRepeat)
  return sp
}

export function toLibraryParams(f: FilterState, category: CategoryConfig['id'], search: string): LibraryParams {
  const decadeStart = f.decade ? Number(f.decade) : null
  return {
    category,
    statuses: f.tab !== 'all' && f.tab !== 'wishlist' ? [f.tab] : undefined,
    wishlist: f.tab === 'wishlist' ? true : undefined,
    search: search || undefined,
    // A search defaults to relevance order unless the user picked a sort.
    sort: f.sort,
    genres: f.genres,
    formats: f.formats,
    countries: f.countries,
    releaseStatuses: f.releaseStatuses,
    yearMin: f.yearMin ?? decadeStart ?? undefined,
    yearMax: f.yearMax ?? (decadeStart != null ? decadeStart + 9 : undefined),
    ratingMin: f.ratingMin ?? undefined,
    rated: f.rated === 'any' ? undefined : f.rated === 'rated',
    favorite: f.favorite || undefined,
    minRepeats: f.minRepeats ?? undefined,
    progressMin: f.progressMin ?? undefined,
    activeRepeat: f.activeRepeat || undefined,
  }
}

export function activeFilterCount(f: FilterState): number {
  return [
    f.genres.length > 0, f.formats.length > 0, f.countries.length > 0, f.releaseStatuses.length > 0,
    f.decade != null || f.yearMin != null || f.yearMax != null, f.ratingMin != null, f.rated !== 'any',
    f.favorite, f.minRepeats != null, f.progressMin != null, f.activeRepeat,
  ].filter(Boolean).length
}

export const CLEARED: Omit<FilterState, 'tab' | 'sort' | 'q'> = {
  genres: [], formats: [], countries: [], releaseStatuses: [], decade: null, yearMin: null, yearMax: null,
  ratingMin: null, rated: 'any', favorite: false, minRepeats: null, progressMin: null, activeRepeat: false,
}

// ---------------------------------------------------------------- Controls
function MultiSelect({ label, options, value, onChange, searchable }: {
  label: string; options: { value: string; label: string; count?: number }[]; value: string[]
  onChange: (v: string[]) => void; searchable?: boolean
}) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())), [options, q])
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 text-[13px] hover:border-line-strong',
          value.length ? 'text-fg' : 'text-fg-2',
        )}>
          <span className="text-fg-3">{label}</span>
          <span className="max-w-28 truncate">{value.length === 0 ? 'All' : value.length === 1 ? options.find((o) => o.value === value[0])?.label ?? value[0] : `${value.length} selected`}</span>
          <ChevronDown className="size-3.5 text-fg-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-2">
        {searchable && (
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2 top-2 size-4 text-fg-3" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase()}…`} className="pl-7" aria-label={`Search ${label}`} />
          </div>
        )}
        <div className="max-h-64 overflow-y-auto">
          {shown.length === 0 && <p className="px-2 py-3 text-xs text-fg-3">Nothing to choose from yet.</p>}
          {shown.map((o) => (
            <label key={o.value} className="flex h-8 cursor-pointer items-center gap-2 rounded px-2 text-[13px] hover:bg-surface-hover">
              <Checkbox checked={value.includes(o.value)} onCheckedChange={() => toggle(o.value)} />
              <span className="flex-1 truncate">{o.label}</span>
              {o.count != null && <span className="text-[11px] tabular-nums text-fg-3">{o.count}</span>}
            </label>
          ))}
        </div>
        {value.length > 0 && <Button size="sm" variant="ghost" className="mt-1 w-full" onClick={() => onChange([])}>Clear</Button>}
      </PopoverContent>
    </Popover>
  )
}

const RATING_OPTIONS = [
  { value: 'any', label: 'Any' },
  ...[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((v) => ({ value: String(v), label: `≥ ${v / 2} ★` })),
  { value: 'rated', label: 'Rated only' },
  { value: 'unrated', label: 'Unrated only' },
]

export function FilterBar({ cfg, f, facets, onChange }: {
  cfg: CategoryConfig; f: FilterState; facets: Facets | undefined; onChange: (patch: Partial<FilterState>) => void
}) {
  const decades = useMemo(() => {
    const min = facets?.year_min, max = facets?.year_max
    if (!min || !max) return []
    const out: string[] = []
    for (let d = Math.floor(max / 10) * 10; d >= Math.floor(min / 10) * 10; d -= 10) out.push(String(d))
    return out
  }, [facets])

  // Movies and games have no "ongoing" state.
  const hasReleaseStatus = cfg.id !== 'movie' && cfg.id !== 'game'
  const ratingValue = f.rated !== 'any' ? f.rated : f.ratingMin != null ? String(f.ratingMin) : 'any'
  const progressUnit = cfg.progress === 'episodes' ? 'Episodes' : cfg.progress === 'chapters' ? 'Chapters' : cfg.progress === 'routes' ? 'Routes' : null

  return (
    <>
      <MultiSelect label="Genres" searchable value={f.genres} onChange={(genres) => onChange({ genres })}
        options={(facets?.genres ?? []).map((g) => ({ value: g.name, label: g.name, count: g.count }))} />
      <MultiSelect label="Format" value={f.formats} onChange={(formats) => onChange({ formats })}
        options={cfg.formats.filter((o) => facets?.formats.includes(o.value) || f.formats.includes(o.value))} />
      {(cfg.id === 'manga' || cfg.id === 'novel' || cfg.id === 'anime') && (facets?.countries.length ?? 0) > 0 && (
        <MultiSelect label="Country" value={f.countries} onChange={(countries) => onChange({ countries })}
          options={(facets?.countries ?? []).map((c) => ({ value: c, label: COUNTRY_LABEL[c] ?? c }))} />
      )}
      <div className="flex items-center gap-1.5">
        <Label className="text-fg-3" htmlFor="flt-decade">Year</Label>
        <Select id="flt-decade" aria-label="Release decade" value={f.decade ?? 'all'} className="w-24"
          onValueChange={(v) => onChange({ decade: v === 'all' ? null : v, yearMin: null, yearMax: null })}
          options={[{ value: 'all', label: 'All' }, ...decades.map((d) => ({ value: d, label: `${d}s` }))]} />
      </div>
      <div className="flex items-center gap-1.5">
        <Label className="text-fg-3" htmlFor="flt-rating">Rating</Label>
        <Select id="flt-rating" aria-label="Rating filter" value={ratingValue} className="w-32" options={RATING_OPTIONS}
          onValueChange={(v) => onChange(v === 'any' ? { ratingMin: null, rated: 'any' }
            : v === 'rated' || v === 'unrated' ? { rated: v, ratingMin: null } : { ratingMin: Number(v), rated: 'any' })} />
      </div>
      {hasReleaseStatus && (
        <div className="flex items-center gap-1.5">
          <Label className="text-fg-3" htmlFor="flt-release">{cfg.id === 'manga' || cfg.id === 'novel' ? 'Publishing' : 'Airing'}</Label>
          <Select id="flt-release" aria-label="Release status" className="w-32"
            value={f.releaseStatuses.length === 1 ? f.releaseStatuses[0] : 'all'}
            onValueChange={(v) => onChange({ releaseStatuses: v === 'all' ? [] : [v] })}
            options={[{ value: 'all', label: 'All' }, ...Object.entries(RELEASE_STATUS_LABEL).map(([value, label]) => ({ value, label }))]} />
        </div>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="secondary"><SlidersHorizontal /> More</Button>
        </PopoverTrigger>
        <PopoverContent className="flex w-72 flex-col gap-3" align="end">
          <label className="flex items-center justify-between gap-2 text-[13px]">Favorites only <Switch checked={f.favorite} onCheckedChange={(favorite) => onChange({ favorite })} /></label>
          <label className="flex items-center justify-between gap-2 text-[13px]">{cfg.repeatLabel} in progress <Switch checked={f.activeRepeat} onCheckedChange={(activeRepeat) => onChange({ activeRepeat })} /></label>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="flt-rep">Min. {cfg.repeatLabel.toLowerCase()}s</Label>
            <Input id="flt-rep" type="number" min={0} className="w-20" value={f.minRepeats ?? ''} onChange={(e) => onChange({ minRepeats: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })} />
          </div>
          {progressUnit && (
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="flt-prog">{progressUnit} ≥</Label>
              <Input id="flt-prog" type="number" min={0} className="w-20" value={f.progressMin ?? ''} onChange={(e) => onChange({ progressMin: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })} />
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <Label>Release year</Label>
            <div className="flex items-center gap-1">
              <Input aria-label="From year" type="number" className="w-[4.5rem]" placeholder="from" value={f.yearMin ?? ''} onChange={(e) => onChange({ yearMin: e.target.value === '' ? null : Number(e.target.value), decade: null })} />
              <Input aria-label="To year" type="number" className="w-[4.5rem]" placeholder="to" value={f.yearMax ?? ''} onChange={(e) => onChange({ yearMax: e.target.value === '' ? null : Number(e.target.value), decade: null })} />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}

/** Removable chips for every active filter, plus "Clear all". */
export function ActiveFilterChips({ cfg, f, onChange }: { cfg: CategoryConfig; f: FilterState; onChange: (p: Partial<FilterState>) => void }) {
  const chips: { label: string; clear: Partial<FilterState> }[] = []
  f.genres.forEach((g) => chips.push({ label: g, clear: { genres: f.genres.filter((x) => x !== g) } }))
  f.formats.forEach((v) => chips.push({ label: cfg.formats.find((o) => o.value === v)?.label ?? v, clear: { formats: f.formats.filter((x) => x !== v) } }))
  f.countries.forEach((v) => chips.push({ label: COUNTRY_LABEL[v] ?? v, clear: { countries: f.countries.filter((x) => x !== v) } }))
  f.releaseStatuses.forEach((v) => chips.push({ label: RELEASE_STATUS_LABEL[v] ?? v, clear: { releaseStatuses: f.releaseStatuses.filter((x) => x !== v) } }))
  if (f.decade) chips.push({ label: `${f.decade}s`, clear: { decade: null } })
  if (f.yearMin != null || f.yearMax != null) chips.push({ label: `${f.yearMin ?? '…'}–${f.yearMax ?? '…'}`, clear: { yearMin: null, yearMax: null } })
  if (f.ratingMin != null) chips.push({ label: `≥ ${f.ratingMin / 2} ★`, clear: { ratingMin: null } })
  if (f.rated !== 'any') chips.push({ label: f.rated === 'rated' ? 'Rated' : 'Unrated', clear: { rated: 'any' } })
  if (f.favorite) chips.push({ label: 'Favorites', clear: { favorite: false } })
  if (f.activeRepeat) chips.push({ label: `${cfg.repeatLabel} in progress`, clear: { activeRepeat: false } })
  if (f.minRepeats != null) chips.push({ label: `${cfg.repeatLabel}s ≥ ${f.minRepeats}`, clear: { minRepeats: null } })
  if (f.progressMin != null) chips.push({ label: `Progress ≥ ${f.progressMin}`, clear: { progressMin: null } })
  if (!chips.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c, i) => (
        <button key={i} onClick={() => onChange(c.clear)} className="inline-flex h-6 items-center gap-1 rounded-full bg-accent-soft px-2.5 text-[11px] font-medium text-fg ring-1 ring-accent/40 hover:bg-accent/30" aria-label={`Remove filter ${c.label}`}>
          {c.label} <X className="size-3" />
        </button>
      ))}
      <Button size="sm" variant="link" onClick={() => onChange(CLEARED)}>Clear all</Button>
    </div>
  )
}
