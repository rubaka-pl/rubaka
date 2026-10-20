/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, Check, ExternalLink, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { PosterImage } from '@/components/media/PosterImage'
import { StatusSelect } from '@/components/media/EntryFields'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form-controls'
import { Badge, EmptyState, ErrorState, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { Dialog, DialogContent } from '@/components/ui/overlays'
import { Select } from '@/components/ui/select'
import { invalidateLibrary } from '@/features/tracking/api'
import { useSettings } from '@/features/settings/settings-store'
import { useDebounced } from '@/features/tracking/hooks'
import { availableProviders, PROVIDER_LABEL, searchProvider, type SearchProvider } from '@/integrations'
import { toEnrichmentPayload, type ProviderResult } from '@/integrations/types'
import { withTimeToBeat } from '@/integrations/proxied'
import { CATEGORY_CONFIG, CATEGORY_LIST, formatLabel } from '@/lib/categories'
import { buildStatusPatch } from '@/features/tracking/api'
import { friendlyError, supabase, unwrap } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { LibraryStatus, MediaCategory } from '@/types/db'
import { getNhentaiGallery, nhentaiIdFromInput } from '@/integrations/nhentai'
import type { NormalizedRecord } from '@/features/imports/types'
import { CustomMediaForm } from './CustomMediaForm'

export function AddMediaDialog({ open, onOpenChange, defaultCategory }: { open: boolean; onOpenChange: (o: boolean) => void; defaultCategory?: MediaCategory }) {
  const [category, setCategory] = useState<MediaCategory>(defaultCategory ?? 'anime')
  const [tab, setTab] = useState('search')
  // Reset to the page's category each time the dialog opens (state adjusted during render, no effect).
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open && defaultCategory) setCategory(defaultCategory)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add media" description="Search online databases or create a custom entry." wide>
        <div className="flex flex-col gap-3">
          <Field label="Category" htmlFor="add-cat">
            <Select id="add-cat" value={category} onValueChange={(v) => setCategory(v as MediaCategory)} options={CATEGORY_LIST.map((c) => ({ value: c.id, label: c.label }))} className="w-full sm:w-60" />
          </Field>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="search">{category === 'doujinshi' ? 'nhentai link' : 'Search online'}</TabsTrigger>
              <TabsTrigger value="custom">Custom entry</TabsTrigger>
            </TabsList>
            <TabsContent value="search" className="pt-3">
              {category === 'doujinshi'
                ? <NhentaiLink onAdded={() => onOpenChange(false)} />
                : <ExternalSearch key={category} category={category} onAdded={() => onOpenChange(false)} onCustom={() => setTab('custom')} />}
            </TabsContent>
            <TabsContent value="custom" className="pt-3">
              <CustomMediaForm key={category} category={category} onCreated={() => onOpenChange(false)} />
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ExternalSearch({ category, onAdded, onCustom }: { category: MediaCategory; onAdded: () => void; onCustom: () => void }) {
  const providers = useQuery({ queryKey: ['providers', category], queryFn: () => availableProviders(category), staleTime: 300_000 })
  const firstAvailable = providers.data?.find((p) => p.available)?.provider
  const [provider, setProvider] = useState<SearchProvider | undefined>()
  const active = provider ?? firstAvailable
  const [q, setQ] = useState('')
  const term = useDebounced(q.trim(), 450)

  const results = useQuery({
    queryKey: ['provider-search', active, category, term],
    queryFn: () => searchProvider(active!, category, term),
    enabled: !!active && term.length >= 2,
    staleTime: 300_000,
    retry: false,
  })

  // Which results are already in the library (by any external id).
  const ids = results.data?.flatMap((r) => r.externalIds.map((x) => `${x.provider}:${x.external_id}`)) ?? []
  const owned = useQuery({
    queryKey: ['owned-ids', ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const providersList = Array.from(new Set(results.data!.flatMap((r) => r.externalIds.map((x) => x.provider))))
      const extIds = Array.from(new Set(results.data!.flatMap((r) => r.externalIds.map((x) => x.external_id))))
      const rows = unwrap(await supabase.from('media_external_ids').select('provider, external_id, media_id').in('provider', providersList).in('external_id', extIds), 'owned') as { provider: string; external_id: string; media_id: string }[]
      return new Map(rows.map((r) => [`${r.provider}:${r.external_id}`, r.media_id]))
    },
  })

  if (providers.data && !firstAvailable) {
    const need = CATEGORY_CONFIG[category].id === 'game' ? 'IGDB (Twitch credentials)' : 'TMDB'
    return (
      <EmptyState title={`${need} is not configured`} className="py-8"
        description={`Online search for ${CATEGORY_CONFIG[category].label} needs ${need} credentials in the metadata-proxy Edge Function (see README → Metadata providers). You can still add a custom entry.`}
        action={<Button onClick={onCustom}><Plus /> Custom entry</Button>} />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-fg-3" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${CATEGORY_CONFIG[category].label.toLowerCase()} by title…`} className="pl-8" aria-label="Search online" />
        </div>
        {providers.data && providers.data.length > 1 && (
          <Select aria-label="Source" value={active} onValueChange={(v) => setProvider(v as SearchProvider)} className="w-36"
            options={providers.data.filter((p) => p.available).map((p) => ({ value: p.provider, label: PROVIDER_LABEL[p.provider] }))} />
        )}
      </div>
      <div className="min-h-40">
        {term.length < 2 ? (
          <p className="py-8 text-center text-[13px] text-fg-3">Type at least two characters. Results come from {active ? PROVIDER_LABEL[active] : '…'}; nothing is added until you confirm.</p>
        ) : results.isLoading ? (
          <div className="flex flex-col gap-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>
        ) : results.isError ? (
          <ErrorState error={results.error} onRetry={() => void results.refetch()} />
        ) : !results.data?.length ? (
          <EmptyState title="No results" description="Try another spelling or the original title, or create a custom entry." action={<Button onClick={onCustom}>Custom entry</Button>} className="py-8" />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {[...results.data].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)).map((r) => {
              const ownedId = r.externalIds.map((x) => owned.data?.get(`${x.provider}:${x.external_id}`)).find(Boolean)
              return <ResultRow key={`${r.provider}:${r.externalId}`} r={r} category={category} ownedMediaId={ownedId} onAdded={onAdded} />
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function ResultRow({ r, category, ownedMediaId, onAdded }: { r: ProviderResult; category: MediaCategory; ownedMediaId?: string; onAdded: () => void }) {
  const blurAdult = useSettings().blurAdult
  const [confirming, setConfirming] = useState(false)
  const [status, setStatus] = useState<LibraryStatus>('planning')
  // Wishlist is a short "want first" list: never set implicitly, only by the toggle.
  const [wish, setWish] = useState(false)
  const changeStatus = (s: LibraryStatus) => setStatus(s)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const categoryMismatch = r.category !== category

  const add = async () => {
    setBusy(true)
    try {
      const payload = toEnrichmentPayload(await withTimeToBeat(r))
      const entry = {
        ...buildStatusPatch({ category, status: 'planning', start_date: null, completion_date: null, episodes_watched: 0, chapters_read: 0, volumes_read: 0, routes_completed: 0, total_episodes: r.totals?.episodes, total_chapters: r.totals?.chapters, total_volumes: r.totals?.volumes, total_routes: r.totals?.routes }, status),
        status,
        wishlisted_at: wish ? new Date().toISOString() : null,
      }
      const res = unwrap(await supabase.rpc('create_media_entry', {
        p_media: { ...payload.media, category, title: r.title },
        p_entry: entry, p_titles: payload.titles, p_genres: payload.genres, p_external_ids: payload.external_ids,
        p_seasons: payload.seasons, p_relations: payload.relations, p_is_custom: false, p_enriched: true,
      }), 'create media') as { media_id: string; existing: boolean }
      invalidateLibrary(qc)
      toast.success(res.existing ? `“${r.title}” was already in your library` : `Added “${r.title}”`, {
        action: { label: 'Open', onClick: () => navigate(`/media/${res.media_id}`) },
      })
      onAdded()
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={cn('rounded-lg border border-line bg-surface-2/50 p-2', confirming && 'border-accent/50')}>
      <div className="flex gap-3">
        <div className={cn('w-12 shrink-0', r.isAdult && blurAdult && 'blur-sm')}><PosterImage src={r.posterUrl} title={r.title} category={category} className="rounded" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold">{r.title}</span>
            {r.year && <span className="text-xs text-fg-3">{r.year}</span>}
            {r.format && <Badge>{formatLabel(r.category, r.format)}</Badge>}
            {r.isAdult && <Badge tone="danger">18+</Badge>}
          </div>
          {(r.originalTitle || r.titles?.length) && <div className="truncate text-xs text-fg-3">{r.originalTitle ?? r.titles?.[0]?.title}</div>}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-3">
            <span>Source: {PROVIDER_LABEL[r.provider]}</span>
            {r.confidence != null && <Badge tone={r.confidence >= 0.85 ? 'success' : r.confidence >= 0.6 ? 'warning' : 'default'}>Match {Math.round(r.confidence * 100)}%</Badge>}
            {categoryMismatch && <Badge tone="warning">Source says {CATEGORY_CONFIG[r.category].singular}</Badge>}
            {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-fg"><ExternalLink className="size-3" /> View</a>}
          </div>
        </div>
        <div className="flex shrink-0 items-start">
          {ownedMediaId ? (
            <Button size="sm" variant="ghost" onClick={() => { navigate(`/media/${ownedMediaId}`); onAdded() }}><Check /> In library</Button>
          ) : !confirming ? (
            <Button size="sm" variant="primary" onClick={() => setConfirming(true)}><Plus /> Add</Button>
          ) : null}
        </div>
      </div>
      {confirming && !ownedMediaId && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
          <StatusSelect category={category} value={status} onChange={changeStatus} className="w-40" />
          <Button size="sm" variant={wish ? 'primary' : 'outline'} onClick={() => setWish(!wish)} aria-pressed={wish}><Bookmark /> Wishlist</Button>
          <div className="ml-auto flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button size="sm" variant="primary" loading={busy} onClick={add}>Confirm add</Button>
          </div>
        </div>
      )}
    </li>
  )
}

/** Paste an nhentai link (or id) → preview → add. The metadata comes from the same adapter as the favourites import. */
function NhentaiLink({ onAdded }: { onAdded: () => void }) {
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<LibraryStatus>('planning')
  const [record, setRecord] = useState<NormalizedRecord | null>(null)
  const [busy, setBusy] = useState<'load' | 'add' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const blurAdult = useSettings().blurAdult
  const navigate = useNavigate()
  const qc = useQueryClient()

  const load = async (value: string) => {
    setRecord(null)
    const id = nhentaiIdFromInput(value)
    if (!id) { setError(value.trim() ? 'That does not look like an nhentai link (https://nhentai.net/g/123456/).' : null); return }
    setError(null)
    setBusy('load')
    try {
      setRecord(await getNhentaiGallery(id))
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(null)
    }
  }

  const add = async () => {
    if (!record) return
    setBusy('add')
    try {
      const res = unwrap(await supabase.rpc('create_media_entry', {
        p_media: record.media, p_entry: { status },
        p_titles: record.titles, p_genres: record.genres, p_external_ids: record.external_ids,
        p_seasons: [], p_relations: [], p_is_custom: false, p_enriched: true,
      }), 'create media') as { media_id: string; existing: boolean }
      invalidateLibrary(qc)
      toast.success(res.existing ? `“${record.media.title}” was already in your library` : `Added “${record.media.title}”`, {
        action: { label: 'Open', onClick: () => navigate(`/media/${res.media_id}`) },
      })
      onAdded()
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(null)
    }
  }

  const details = record?.media.details as { pages?: number; artists?: string[]; groups?: string[] } | undefined
  return (
    <div className="flex flex-col gap-3">
      <Input autoFocus value={input} aria-label="nhentai link" placeholder="https://nhentai.net/g/123456/"
        onChange={(e) => { setInput(e.target.value); void load(e.target.value) }} />
      {error && <p className="text-[13px] text-danger">{error}</p>}
      {busy === 'load' && <Skeleton className="h-20" />}
      {record && (
        <div className="rounded-lg border border-accent/50 bg-surface-2/50 p-2">
          <div className="flex gap-3">
            <div className={cn('w-12 shrink-0', blurAdult && 'blur-sm')}><PosterImage src={record.media.poster_url} title={record.media.title} category="doujinshi" className="rounded" /></div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{record.media.title}</div>
              {record.media.original_title && <div className="truncate text-xs text-fg-3">{record.media.original_title}</div>}
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-3">
                <Badge tone="danger">18+</Badge>
                {details?.pages && <span>{details.pages} pages</span>}
                {details?.artists?.length ? <span>{details.artists.join(', ')}</span> : null}
                {details?.groups?.length ? <span>[{details.groups.join(', ')}]</span> : null}
              </div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
            <StatusSelect category="doujinshi" value={status} onChange={setStatus} className="w-40" />
            <Button size="sm" variant="primary" className="ml-auto" loading={busy === 'add'} onClick={add}><Plus /> Add</Button>
          </div>
        </div>
      )}
      {!record && !error && busy !== 'load' && <p className="py-6 text-center text-[13px] text-fg-3">Paste an nhentai link or gallery number; nothing is added until you confirm.</p>}
    </div>
  )
}
