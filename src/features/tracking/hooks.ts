import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getSettingsSnapshot } from '@/features/settings/settings-store'
import { CATEGORY_CONFIG } from '@/lib/categories'
import type { EntryPatch, LibraryItem, LibraryStatus } from '@/types/db'
import { buildStatusPatch, useUpdateEntry } from './api'

/** Fields the status/progress helpers need. Works for list rows and detail entries. */
export type TrackedItem = Pick<LibraryItem,
  'entry_id' | 'media_id' | 'category' | 'status' | 'start_date' | 'completion_date' | 'episodes_watched'
  | 'chapters_read' | 'volumes_read' | 'routes_completed' | 'wishlisted_at' | 'is_favorite' | 'title'> &
  Partial<Pick<LibraryItem, 'total_episodes' | 'total_chapters' | 'total_volumes' | 'total_routes'>>

/**
 * Entry actions shared by cards, list rows and the detail page.
 * Starting tracking on a wishlisted title follows the "wishlistOnStart"
 * setting: remove automatically, keep, or ask (a toast with an action — the
 * flag is never removed silently).
 */
export function useEntryActions() {
  const update = useUpdateEntry()

  const patch = (item: TrackedItem, p: EntryPatch) => update.mutate({ entryId: item.entry_id, mediaId: item.media_id, patch: p })

  const setStatus = (item: TrackedItem, status: LibraryStatus) => {
    if (status === item.status) return
    const p = buildStatusPatch(item, status)
    const startsTracking = (status === 'in_progress' || status === 'completed') && item.wishlisted_at
    const mode = getSettingsSnapshot().wishlistOnStart
    if (startsTracking && mode === 'remove') p.wishlisted_at = null
    update.mutate({ entryId: item.entry_id, mediaId: item.media_id, patch: p }, {
      onSuccess: () => {
        if (startsTracking && mode === 'ask') {
          toast(`“${item.title}” is still in your wishlist`, {
            action: { label: 'Remove', onClick: () => patch(item, { wishlisted_at: null }) },
            duration: 8000,
          })
        }
      },
    })
  }

  /**
   * +1 to the primary progress counter (episodes / chapters, or volumes for a
   * title tracked by volume). Reaching a known total completes the title, with
   * an Undo in the toast.
   */
  const increment = (item: TrackedItem) => {
    const step = nextStep(item)
    if (!step) return
    const next: EntryPatch = { [step.field]: step.value }
    let completes = false
    if (step.total != null && step.value >= step.total && item.status !== 'completed') {
      Object.assign(next, buildStatusPatch(item, 'completed'))
      completes = true
    } else if (item.status === 'planning' || item.status === 'on_hold') {
      Object.assign(next, buildStatusPatch(item, 'in_progress'))
    }
    update.mutate({ entryId: item.entry_id, mediaId: item.media_id, patch: next }, {
      onSuccess: () => {
        if (!completes) return
        toast.success(`“${item.title}” completed`, {
          action: {
            label: 'Undo',
            onClick: () => patch(item, {
              status: item.status, completion_date: item.completion_date, episodes_watched: item.episodes_watched,
              chapters_read: item.chapters_read, volumes_read: item.volumes_read,
            }),
          },
          duration: 8000,
        })
      },
    })
  }

  const toggleWishlist = (item: TrackedItem) => patch(item, { wishlisted_at: item.wishlisted_at ? null : new Date().toISOString() })
  const toggleFavorite = (item: TrackedItem) => patch(item, { is_favorite: !item.is_favorite })
  const setRating = (item: TrackedItem, rating: number | null) => patch(item, { rating })

  return { patch, setStatus, increment, toggleWishlist, toggleFavorite, setRating, pending: update.isPending }
}

type StepField = 'episodes_watched' | 'chapters_read' | 'volumes_read' | 'routes_completed'

/** The counter +1 would change, its new value and its known total (null = unknown). */
export function nextStep(item: TrackedItem): { field: StepField; value: number; total: number | null; unit: string } | null {
  const cfg = CATEGORY_CONFIG[item.category]
  const mk = (field: StepField, cur: number, total: number | null | undefined, unit: string) =>
    total != null && cur >= total ? null : { field, value: cur + 1, total: total ?? null, unit }
  if (cfg.progress === 'episodes') return mk('episodes_watched', item.episodes_watched, item.total_episodes, 'ep')
  if (cfg.progress === 'chapters') {
    // Light novels are usually tracked by volume: keep counting what is being counted.
    if (cfg.volumes && item.chapters_read === 0 && item.volumes_read > 0) return mk('volumes_read', item.volumes_read, item.total_volumes, 'vol')
    return mk('chapters_read', item.chapters_read, item.total_chapters, 'ch')
  }
  if (cfg.progress === 'routes') return mk('routes_completed', item.routes_completed, item.total_routes, 'route')
  return null
}

export function canIncrement(item: TrackedItem): boolean {
  return nextStep(item) != null
}

/** True on devices without hover (touch); quick actions are then always visible. */
export function useCanHover(): boolean {
  const query = '(hover: hover) and (pointer: fine)'
  const [can, setCan] = useState(() => typeof window === 'undefined' || !window.matchMedia || window.matchMedia(query).matches)
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia(query)
    const on = () => setCan(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return can
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
