// Time spent: client-side mirror of app_private.estimated_minutes (migration 9)
// plus display helpers. Estimates follow MyAnimeList / Shikimori:
// (episodes watched + repeats × total episodes) × episode length.
import type { LibraryEntry, Media } from '@/types/db'

type M = Pick<Media, 'category' | 'episode_duration' | 'runtime' | 'total_episodes' | 'details'> & Partial<Pick<Media, 'total_chapters' | 'total_volumes'>>
type E = Pick<LibraryEntry, 'status' | 'episodes_watched' | 'chapters_read' | 'volumes_read' | 'repeat_count' | 'time_spent_minutes'>

export function estimatedMinutes(m: M, e: E): number | null {
  const done = e.status === 'completed' ? 1 : 0
  switch (m.category) {
    case 'anime':
    case 'tv_series':
    case 'animated_series':
      return m.episode_duration ? (e.episodes_watched + e.repeat_count * (m.total_episodes ?? e.episodes_watched)) * m.episode_duration : null
    case 'movie':
      return m.runtime ? (done + e.repeat_count) * m.runtime : null
    case 'game': {
      const ttb = Number(m.details?.time_to_beat_minutes)
      return ttb > 0 ? (done + e.repeat_count) * ttb : null
    }
    case 'visual_novel': {
      const len = Number(m.details?.length_minutes)
      return len > 0 ? (done + e.repeat_count) * len : null
    }
    // Doujinshi: ~0.5 min per page (see migration 16).
    case 'doujinshi': {
      const pages = Number(m.details?.pages)
      return pages > 0 ? Math.round((done + e.repeat_count) * pages * 0.5) || null : null
    }
    // Reading estimates (see migration 10): manga chapter ≈ 9.23 min (matches MAL "Days"),
    // novel volume ≈ 210 min, novel chapter ≈ 15 min when no volumes are tracked.
    case 'manga':
      return Math.round((e.chapters_read + e.repeat_count * (m.total_chapters ?? e.chapters_read)) * 9.23) || null
    case 'novel':
      return e.volumes_read > 0
        ? (e.volumes_read + e.repeat_count * (m.total_volumes ?? e.volumes_read)) * 210
        : (e.chapters_read + e.repeat_count * (m.total_chapters ?? e.chapters_read)) * 15 || null
    default:
      return null
  }
}

export function timeSpentMinutes(m: M, e: E): { minutes: number | null; manual: boolean } {
  if (e.time_spent_minutes != null) return { minutes: e.time_spent_minutes, manual: true }
  return { minutes: estimatedMinutes(m, e), manual: false }
}

/** "45 min", "12 h 30 min", "3 d 4 h". */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null) return '—'
  const m = Math.round(minutes)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (h < 48) return rest ? `${h} h ${rest} min` : `${h} h`
  const d = Math.floor(h / 24)
  const hh = h % 24
  return hh ? `${d} d ${hh} h` : `${d} d`
}

/** MAL-style "Days: 87.3". */
export const toDays = (minutes: number) => Math.round((minutes / 1440) * 10) / 10
