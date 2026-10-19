import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input, Switch } from '@/components/ui/form-controls'
import { Dialog, DialogContent } from '@/components/ui/overlays'
import { StarRating } from '@/components/ratings/StarRating'
import { buildStatusPatch, useUpdateEntry } from '@/features/tracking/api'
import type { EntryPatch, LibraryItem, LibraryStatus } from '@/types/db'
import { ProgressFields, StatusSelect, type ProgressValues } from './EntryFields'

/** Compact editor for status, rating, progress and dates (used from cards/lists). */
export function QuickEditDialog({ item, open, onOpenChange }: { item: LibraryItem; open: boolean; onOpenChange: (o: boolean) => void }) {
  const update = useUpdateEntry()
  const [status, setStatus] = useState<LibraryStatus>(item.status)
  const [rating, setRating] = useState<number | null>(item.rating)
  const [progress, setProgress] = useState<ProgressValues>({
    episodes_watched: item.episodes_watched, chapters_read: item.chapters_read, volumes_read: item.volumes_read,
    routes_completed: item.routes_completed, endings_completed: item.endings_completed,
    current_season: item.current_season, current_episode: item.current_episode,
  })
  const [start, setStart] = useState(item.start_date ?? '')
  const [done, setDone] = useState(item.completion_date ?? '')
  const [wish, setWish] = useState(!!item.wishlisted_at)
  const [fav, setFav] = useState(item.is_favorite)
  const dateError = start && done && done < start ? 'Completion date is before the start date' : undefined

  const onStatus = (s: LibraryStatus) => {
    setStatus(s)
    // Pre-fill the same defaults as a quick status change, without overwriting user input.
    const p = buildStatusPatch({ ...item, ...progress, start_date: start || null, completion_date: done || null }, s)
    if (p.start_date && !start) setStart(p.start_date)
    if (p.completion_date && !done) setDone(p.completion_date)
    const { episodes_watched, chapters_read, volumes_read, routes_completed } = p
    setProgress((cur) => ({
      ...cur,
      ...(episodes_watched != null && { episodes_watched }),
      ...(chapters_read != null && { chapters_read }),
      ...(volumes_read != null && { volumes_read }),
      ...(routes_completed != null && { routes_completed }),
    }))
  }

  const save = () => {
    const patch: EntryPatch = {}
    if (status !== item.status) patch.status = status
    if (rating !== item.rating) patch.rating = rating
    for (const k of Object.keys(progress) as (keyof ProgressValues)[]) {
      if (progress[k] !== item[k]) (patch as Record<string, unknown>)[k] = progress[k]
    }
    if ((start || null) !== item.start_date) patch.start_date = start || null
    if ((done || null) !== item.completion_date) patch.completion_date = done || null
    if (wish !== !!item.wishlisted_at) patch.wishlisted_at = wish ? new Date().toISOString() : null
    if (fav !== item.is_favorite) patch.is_favorite = fav
    if (Object.keys(patch).length === 0) return onOpenChange(false)
    update.mutate({ entryId: item.entry_id, mediaId: item.media_id, patch }, { onSuccess: () => onOpenChange(false) })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={item.title} description="Edit tracking">
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Status" htmlFor="qe-status">
              <StatusSelect id="qe-status" category={item.category} value={status} onChange={onStatus} />
            </Field>
            <Field label="Rating">
              <StarRating value={rating} onChange={setRating} size="md" showControls showValue />
            </Field>
          </div>
          <ProgressFields category={item.category} values={progress} totals={item} onChange={(p) => setProgress((c) => ({ ...c, ...p }))} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date" htmlFor="qe-start">
              <Input id="qe-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Completion date" htmlFor="qe-done" error={dateError}>
              <Input id="qe-done" type="date" value={done} onChange={(e) => setDone(e.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-5">
            <label className="flex items-center gap-2 text-[13px]"><Switch checked={wish} onCheckedChange={setWish} /> Wishlist</label>
            <label className="flex items-center gap-2 text-[13px]"><Switch checked={fav} onCheckedChange={setFav} /> Favorite</label>
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" onClick={save} loading={update.isPending} disabled={!!dateError}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
