import { Repeat } from 'lucide-react'
import { useState } from 'react'
import { ProgressFields, StatusSelect, type ProgressValues } from '@/components/media/EntryFields'
import { StarRating } from '@/components/ratings/StarRating'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form-controls'
import { ProgressBar } from '@/components/ui/misc'
import { useUpdateEntry, type MediaDetail } from '@/features/tracking/api'
import { useEntryActions, type TrackedItem } from '@/features/tracking/hooks'
import { CATEGORY_CONFIG, primaryProgress } from '@/lib/categories'
import { formatDate, formatTimestamp } from '@/lib/dates'
import type { EntryPatch } from '@/types/db'

export function toTracked(d: MediaDetail): TrackedItem {
  const e = d.entry!
  return {
    entry_id: e.id, media_id: d.media.id, category: d.media.category, title: d.media.title, status: e.status,
    start_date: e.start_date, completion_date: e.completion_date, episodes_watched: e.episodes_watched,
    chapters_read: e.chapters_read, volumes_read: e.volumes_read, routes_completed: e.routes_completed,
    wishlisted_at: e.wishlisted_at, is_favorite: e.is_favorite, total_episodes: d.media.total_episodes,
    total_chapters: d.media.total_chapters, total_volumes: d.media.total_volumes, total_routes: d.media.total_routes,
  }
}

/** Personal tracking controls: rating, status, progress, dates, repeats. Saves immediately (optimistic). */
export function TrackingPanel({ d }: { d: MediaDetail }) {
  const e = d.entry!
  const m = d.media
  const cfg = CATEGORY_CONFIG[m.category]
  const actions = useEntryActions()
  const update = useUpdateEntry()
  const tracked = toTracked(d)
  const progress = primaryProgress({ ...e, ...m, category: m.category })
  const save = (patch: EntryPatch) => update.mutate({ entryId: e.id, mediaId: m.id, patch })
  const activeSession = d.sessions.find((s) => s.status === 'active')
  const [editingProgress, setEditingProgress] = useState(false)

  return (
    <section aria-label="Your tracking" className="mt-6 flex flex-wrap items-start gap-x-8 gap-y-5 rounded-lg border border-line bg-surface/80 p-4 backdrop-blur">
      <Field label="Your rating" className="shrink-0">
        <StarRating value={e.rating} onChange={(v) => actions.setRating(tracked, v)} size="lg" showValue showControls />
      </Field>
      <Field label="Status" htmlFor="tp-status" className="shrink-0">
        <StatusSelect id="tp-status" category={m.category} value={e.status} onChange={(s) => actions.setStatus(tracked, s)} className="w-44" />
        {activeSession && <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-accent-hover"><Repeat className="size-3" /> {cfg.repeatLabel} in progress</span>}
      </Field>
      <div className="flex min-w-[220px] flex-1 basis-[240px] flex-col gap-1.5">
        <span className="text-xs font-medium text-fg-2">Progress</span>
        {progress && progress.unit !== '' ? (
          <>
            <div className="flex items-center gap-3">
              <ProgressBar ratio={progress.ratio} className="h-1.5 flex-1" label="Progress" />
              <span className="shrink-0 text-[13px] tabular-nums">{progress.value} / {progress.total ?? '?'}</span>
            </div>
            {cfg.volumes && <span className="text-[11px] text-fg-3 tabular-nums">Volumes {e.volumes_read} / {m.total_volumes ?? '?'}</span>}
            <div className="flex gap-1.5">
              {!(cfg.seasons && d.seasonProgress.length) && (progress.total == null || progress.value < progress.total) && <Button size="sm" variant="outline" onClick={() => actions.increment(tracked)}>+1 {progress.unit.replace(/s$/, '')}</Button>}
              <Button size="sm" variant="ghost" onClick={() => setEditingProgress(!editingProgress)}>{editingProgress ? 'Done' : 'Edit'}</Button>
            </div>
          </>
        ) : cfg.progress === 'single' ? (
          <span className="text-[13px] text-fg-2">{e.status === 'completed' ? `Watched${e.completion_date ? ` on ${formatDate(e.completion_date)}` : ''}` : 'Not watched yet'}</span>
        ) : (
          <span className="text-[13px] text-fg-3">No progress counter for {cfg.label.toLowerCase()}</span>
        )}
      </div>
      <Field label="Start date" htmlFor="tp-start" className="shrink-0">
        <Input id="tp-start" type="date" value={e.start_date ?? ''} max={e.completion_date ?? undefined} className="w-36"
          onChange={(ev) => save({ start_date: ev.target.value || null })} />
      </Field>
      <Field label="Completion date" htmlFor="tp-done" className="shrink-0">
        <Input id="tp-done" type="date" value={e.completion_date ?? ''} min={e.start_date ?? undefined} className="w-36"
          onChange={(ev) => save({ completion_date: ev.target.value || null })} />
      </Field>
      <div className="flex shrink-0 flex-col gap-1.5 text-[13px]">
        <span className="text-xs font-medium text-fg-2">{cfg.repeatLabel === 'Rewatch' ? 'Rewatches' : `${cfg.repeatLabel}s`}</span>
        <span className="tabular-nums">{e.repeat_count}{e.imported_repeat_count > 0 && <span className="text-[11px] text-fg-3"> ({e.imported_repeat_count} undated)</span>}</span>
        <span className="text-[11px] text-fg-3">Last activity {formatTimestamp(e.last_activity_at)}</span>
      </div>
      {editingProgress && (
        <div className="basis-full">
          <ProgressFields
            category={m.category}
            values={e as ProgressValues}
            totals={m}
            hasSeasonRows={d.seasonProgress.length > 0}
            onChange={(p) => save(p)}
          />
        </div>
      )}
    </section>
  )
}
