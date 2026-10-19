/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CircleAlert, LoaderCircle, Play, RotateCcw, Square, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { PosterImage } from '@/components/media/PosterImage'
import { Button } from '@/components/ui/button'
import { Badge, EmptyState, ErrorState, ProgressBar } from '@/components/ui/misc'
import { Select } from '@/components/ui/select'
import { invalidateLibrary } from '@/features/tracking/api'
import { getProxyStatus } from '@/integrations/proxied'
import type { ProviderResult } from '@/integrations/types'
import { CATEGORY_CONFIG, CATEGORY_LIST } from '@/lib/categories'
import { friendlyError, supabase, unwrap } from '@/lib/supabase'
import type { MediaCategory } from '@/types/db'
import { applyCandidate, cancelEnrichment, resetFailedJobs, runEnrichment, useEnrichment } from './runner'

const STATES = ['pending', 'matched', 'unresolved', 'failed', 'skipped'] as const

function useStateCounts() {
  return useQuery({
    queryKey: ['enrichment-counts'],
    queryFn: async () => {
      const out: Record<string, number> = {}
      await Promise.all(STATES.map(async (s) => {
        const { count, error } = await supabase.from('media').select('id', { count: 'exact', head: true }).eq('enrichment_state', s)
        if (error) throw error
        out[s] = count ?? 0
      }))
      const { count: review } = await supabase.from('metadata_enrichment_jobs').select('media_id', { count: 'exact', head: true }).eq('status', 'review')
      out.review = review ?? 0
      return out
    },
    // Poll while the runner is active so the counters move.
    refetchInterval: () => (useEnrichment.getState().running ? 4000 : false),
  })
}

export function EnrichmentPanel() {
  const qc = useQueryClient()
  const state = useEnrichment()
  const counts = useStateCounts()
  const proxy = useQuery({ queryKey: ['proxy-status'], queryFn: () => getProxyStatus(true), staleTime: 60_000 })
  const [category, setCategory] = useState<string>('all')

  const start = async () => {
    try {
      await runEnrichment(category === 'all' ? undefined : (category as MediaCategory))
      toast.success('Metadata run finished')
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      invalidateLibrary(qc)
      qc.invalidateQueries({ queryKey: ['enrichment-counts'] })
      qc.invalidateQueries({ queryKey: ['enrichment-review'] })
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="text-[15px] font-semibold">Fill missing metadata</h2>
        <p className="mt-1 max-w-3xl text-[13px] text-fg-3">
          Looks up posters, synopses, genres, totals and alternative titles. Matches by stable ids first (MAL → AniList, IMDb → TVMaze/TMDB), then by
          very close title matches; anything uncertain goes to review. Values you already have, fields you edited by hand and custom covers are never overwritten.
          The queue runs in this tab — you can stop and continue later.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Badge tone="success">AniList · VNDB · TVMaze · Open Library: ready (no key needed)</Badge>
          {proxy.isLoading ? <Badge>Checking server providers…</Badge> : (
            <>
              <Badge tone={proxy.data?.tmdb ? 'success' : 'warning'}>TMDB (movies, TV): {proxy.data?.tmdb ? 'configured' : proxy.data === null ? 'Edge Function not deployed' : 'not configured'}</Badge>
              <Badge tone={proxy.data?.mal ? 'success' : 'default'}>MyAnimeList fallback: {proxy.data?.mal ? 'configured' : 'optional'}</Badge>
              <Badge tone={proxy.data?.igdb ? 'success' : 'warning'}>IGDB (games): {proxy.data?.igdb ? 'configured' : proxy.data === null ? 'Edge Function not deployed' : 'not configured'}</Badge>
            </>
          )}
        </div>
        {counts.isError ? <ErrorState className="mt-3" error={counts.error} /> : (
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {[...STATES, 'review'].map((s) => (
              <div key={s} className="rounded-md border border-line px-3 py-2">
                <div className="text-[11px] capitalize text-fg-3">{s === 'skipped' ? 'custom (skipped)' : s}</div>
                <div className="text-lg font-bold tabular-nums">{counts.data?.[s]?.toLocaleString() ?? '…'}</div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Select aria-label="Category" value={category} onValueChange={setCategory} className="w-44" options={[{ value: 'all', label: 'All categories' }, ...CATEGORY_LIST.map((c) => ({ value: c.id, label: c.label }))]} disabled={state.running} />
          {state.running ? (
            <Button variant="danger" onClick={cancelEnrichment}><Square /> Stop</Button>
          ) : (
            <Button variant="primary" onClick={() => void start()}><Play /> Start</Button>
          )}
          <Button variant="ghost" disabled={state.running} onClick={async () => {
            const n = await resetFailedJobs()
            toast(`${n} failed/unresolved titles queued again`)
            qc.invalidateQueries({ queryKey: ['enrichment-counts'] })
          }}><RotateCcw /> Retry failed & unresolved</Button>
        </div>
        {(state.running || state.processed > 0) && (
          <div className="mt-4 flex flex-col gap-2" aria-live="polite">
            <ProgressBar ratio={state.total ? state.processed / state.total : null} />
            <div className="flex flex-wrap gap-3 text-xs text-fg-2">
              <span>{state.processed.toLocaleString()} / {state.total.toLocaleString()} processed</span>
              <span className="text-success">{state.matched} matched</span>
              <span className="text-warning">{state.review} to review</span>
              <span>{state.unresolved} not found</span>
              <span className="text-danger">{state.failed} errors</span>
              {state.running && state.current && <span className="flex items-center gap-1 text-fg-3"><LoaderCircle className="size-3 animate-spin" /> {state.current}</span>}
            </div>
            {state.log.length > 0 && (
              <ul className="max-h-36 overflow-y-auto rounded border border-line bg-surface-2 p-2 font-mono text-[11px] text-fg-3">
                {state.log.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            )}
          </div>
        )}
      </section>
      <ReviewList />
    </div>
  )
}

interface ReviewJob {
  media_id: string
  provider: string
  last_error: string | null
  result: { candidates?: ProviderResult[]; suggest_category?: MediaCategory; provider_title?: string } | null
  media: { id: string; title: string; category: MediaCategory; release_year: number | null; format: string | null }
}

function ReviewList() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['enrichment-review'],
    queryFn: async () => unwrap(await supabase.from('metadata_enrichment_jobs')
      .select('media_id, provider, last_error, result, media!inner(id, title, category, release_year, format)')
      .eq('status', 'review').order('updated_at', { ascending: false }).limit(200), 'review') as unknown as ReviewJob[],
  })
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['enrichment-review'] })
    qc.invalidateQueries({ queryKey: ['enrichment-counts'] })
    invalidateLibrary(qc)
  }
  const dismiss = async (j: ReviewJob) => {
    await supabase.from('metadata_enrichment_jobs').update({ status: 'done' }).eq('media_id', j.media_id).eq('provider', j.provider)
    refresh()
  }
  const moveCategory = async (j: ReviewJob, to: MediaCategory) => {
    // Clear a format that is not valid in the new category.
    const valid = CATEGORY_CONFIG[to].formats.some((f) => f.value === j.media.format)
    const { error } = await supabase.from('media').update({ category: to, ...(valid ? {} : { format: to === 'novel' ? 'light_novel' : null }) }).eq('id', j.media_id)
    if (error) return toast.error(friendlyError(error))
    await dismiss(j)
    toast.success(`Moved “${j.media.title}” to ${CATEGORY_CONFIG[to].label}`)
  }
  const applyAllSuggestions = async () => {
    const list = (q.data ?? []).filter((j) => j.result?.suggest_category)
    for (const j of list) await moveCategory(j, j.result!.suggest_category!)
  }

  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (q.isLoading) return null
  if (!q.data?.length) return <EmptyState title="Nothing to review" description="Ambiguous matches and category suggestions will appear here." className="py-8" />
  const suggestions = q.data.filter((j) => j.result?.suggest_category)

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Needs review ({q.data.length})</h2>
        {suggestions.length > 1 && <Button size="sm" onClick={() => void applyAllSuggestions()}>Apply all {suggestions.length} category suggestions</Button>}
      </div>
      <ul className="flex flex-col gap-2">
        {q.data.map((j) => (
          <li key={j.media_id} className="rounded-lg border border-line bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/media/${j.media_id}`} className="font-semibold hover:text-accent-hover">{j.media.title}</Link>
              <Badge>{CATEGORY_CONFIG[j.media.category].singular}</Badge>
              {j.media.release_year && <span className="text-xs text-fg-3">{j.media.release_year}</span>}
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void dismiss(j)}><X /> Dismiss</Button>
            </div>
            {j.result?.suggest_category && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
                <CircleAlert className="size-4 text-warning" />
                The metadata source lists this as <b>{CATEGORY_CONFIG[j.result.suggest_category].singular}</b>{j.result.provider_title ? ` (“${j.result.provider_title}”)` : ''}.
                <Button size="sm" variant="primary" onClick={() => void moveCategory(j, j.result!.suggest_category!)}><Check /> Move to {CATEGORY_CONFIG[j.result.suggest_category].label}</Button>
              </div>
            )}
            {j.result?.candidates?.length ? (
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {j.result.candidates.map((c) => (
                  <button key={`${c.provider}:${c.externalId}`} className="flex w-28 shrink-0 flex-col gap-1 rounded-md border border-line p-1.5 text-left hover:border-accent"
                    onClick={async () => {
                      try {
                        await applyCandidate(j.media_id, j.media.category, j.provider, c)
                        toast.success(`Applied ${c.title}`)
                        refresh()
                      } catch (e) { toast.error(friendlyError(e)) }
                    }}>
                    <PosterImage src={c.posterUrl} title={c.title} category={j.media.category} className="rounded" />
                    <span className="line-clamp-2 text-[11px] font-medium">{c.title}</span>
                    <span className="text-[10px] text-fg-3">{c.year ?? '—'} · {Math.round((c.confidence ?? 0) * 100)}%</span>
                  </button>
                ))}
              </div>
            ) : !j.result?.suggest_category && <p className="mt-1 text-xs text-fg-3">{j.last_error}</p>}
          </li>
        ))}
      </ul>
    </section>
  )
}
