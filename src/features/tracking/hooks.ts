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

  /** +1 to the primary progress counter (episodes/chapters/routes). */
  const increment = (item: TrackedItem) => {
    const cfg = CATEGORY_CONFIG[item.category]
    const next: EntryPatch = {}
    if (cfg.progress === 'episodes') {
      if (item.total_episodes != null && item.episodes_watched >= item.total_episodes) return
      next.episodes_watched = item.episodes_watched + 1
    } else if (cfg.progress === 'chapters') {
      if (item.total_chapters != null && item.chapters_read >= item.total_chapters) return
      next.chapters_read = item.chapters_read + 1
    } else if (cfg.progress === 'routes') {
      if (item.total_routes != null && item.routes_completed >= item.total_routes) return
      next.routes_completed = item.routes_completed + 1
    } else return
    if (item.status === 'planning' || item.status === 'on_hold') {
      Object.assign(next, buildStatusPatch(item, 'in_progress'))
    }
    patch(item, next)
  }

  const toggleWishlist = (item: TrackedItem) => patch(item, { wishlisted_at: item.wishlisted_at ? null : new Date().toISOString() })
  const toggleFavorite = (item: TrackedItem) => patch(item, { is_favorite: !item.is_favorite })
  const setRating = (item: TrackedItem, rating: number | null) => patch(item, { rating })

  return { patch, setStatus, increment, toggleWishlist, toggleFavorite, setRating, pending: update.isPending }
}

export function canIncrement(item: TrackedItem): boolean {
  const cfg = CATEGORY_CONFIG[item.category]
  if (cfg.progress === 'episodes') return item.total_episodes == null || item.episodes_watched < item.total_episodes
  if (cfg.progress === 'chapters') return item.total_chapters == null || item.chapters_read < item.total_chapters
  if (cfg.progress === 'routes') return item.total_routes == null || item.routes_completed < item.total_routes
  return false
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
