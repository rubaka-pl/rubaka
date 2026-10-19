/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import {
  BookOpen, BookOpenText, Clapperboard, Film, Gamepad2, MonitorPlay, Sparkles, Tv,
  type LucideIcon,
} from 'lucide-react'
import type { LibraryItem, LibraryStatus, Media, MediaCategory, SessionType } from '@/types/db'

/** Which progress counters a category uses. */
export type ProgressKind = 'episodes' | 'chapters' | 'routes' | 'single' | 'none'

export interface CategoryConfig {
  id: MediaCategory
  slug: string
  label: string
  singular: string
  icon: LucideIcon
  progress: ProgressKind
  /** Show volume progress in addition to chapters. */
  volumes: boolean
  /** Show season-level progress (TV-like). */
  seasons: boolean
  sessionType: SessionType
  /** In-progress status label: Watching / Reading / Playing. */
  activeLabel: string
  /** Completed label: Completed / Watched / Played. */
  completedLabel: string
  planningLabel: string
  /** Verb for repeats: Rewatch / Reread / Replay. */
  repeatLabel: string
  /** Name of the wishlist in this category (default "Wishlist"). */
  wishlistLabel?: string
  formats: { value: string; label: string }[]
}

const tvFormats = [
  { value: 'series', label: 'Series' },
  { value: 'mini_series', label: 'Mini-series' },
  { value: 'special', label: 'Special' },
  { value: 'other', label: 'Other' },
]

// Format values must match app_private.valid_format() in the core migration.
export const CATEGORY_CONFIG: Record<MediaCategory, CategoryConfig> = {
  anime: {
    id: 'anime', slug: 'anime', label: 'Anime', singular: 'Anime', icon: Sparkles,
    progress: 'episodes', volumes: false, seasons: false, sessionType: 'rewatch',
    activeLabel: 'Watching', completedLabel: 'Completed', planningLabel: 'Plan to Watch', repeatLabel: 'Rewatch',
    formats: [
      { value: 'tv', label: 'TV' }, { value: 'tv_short', label: 'TV Short' }, { value: 'movie', label: 'Movie' },
      { value: 'ova', label: 'OVA' }, { value: 'ona', label: 'ONA' }, { value: 'special', label: 'Special' },
      { value: 'music', label: 'Music' }, { value: 'other', label: 'Other' },
    ],
  },
  manga: {
    id: 'manga', slug: 'manga', label: 'Manga', singular: 'Manga', icon: BookOpen,
    progress: 'chapters', volumes: true, seasons: false, sessionType: 'reread',
    activeLabel: 'Reading', completedLabel: 'Completed', planningLabel: 'Plan to Read', repeatLabel: 'Reread',
    formats: [
      { value: 'manga', label: 'Manga' }, { value: 'manhwa', label: 'Manhwa' }, { value: 'manhua', label: 'Manhua' },
      { value: 'webtoon', label: 'Webtoon' }, { value: 'one_shot', label: 'One-shot' },
      { value: 'doujinshi', label: 'Doujinshi' }, { value: 'other', label: 'Other' },
    ],
  },
  novel: {
    id: 'novel', slug: 'novels', label: 'Novels', singular: 'Novel', icon: BookOpenText,
    progress: 'chapters', volumes: true, seasons: false, sessionType: 'reread',
    activeLabel: 'Reading', completedLabel: 'Completed', planningLabel: 'Plan to Read', repeatLabel: 'Reread',
    formats: [
      { value: 'light_novel', label: 'Light Novel' }, { value: 'web_novel', label: 'Web Novel' },
      { value: 'novel', label: 'Novel' }, { value: 'short_story', label: 'Short Story' }, { value: 'other', label: 'Other' },
    ],
  },
  visual_novel: {
    id: 'visual_novel', slug: 'visual-novels', label: 'Visual Novels', singular: 'Visual Novel', icon: MonitorPlay,
    progress: 'none', volumes: false, seasons: false, sessionType: 'replay',
    activeLabel: 'Playing', completedLabel: 'Completed', planningLabel: 'Plan to Play', repeatLabel: 'Replay',
    formats: [
      { value: 'visual_novel', label: 'Visual Novel' }, { value: 'kinetic_novel', label: 'Kinetic Novel' },
      { value: 'other', label: 'Other' },
    ],
  },
  movie: {
    id: 'movie', slug: 'movies', label: 'Movies', singular: 'Movie', icon: Film,
    progress: 'single', volumes: false, seasons: false, sessionType: 'rewatch',
    activeLabel: 'Watching', completedLabel: 'Watched', planningLabel: 'Plan to Watch', repeatLabel: 'Rewatch',
    formats: [
      { value: 'movie', label: 'Movie' }, { value: 'tv_movie', label: 'TV Movie' }, { value: 'short', label: 'Short' },
      { value: 'video', label: 'Video' }, { value: 'special', label: 'Special' }, { value: 'other', label: 'Other' },
    ],
  },
  tv_series: {
    id: 'tv_series', slug: 'tv-series', label: 'TV Series', singular: 'TV Series', icon: Tv,
    progress: 'episodes', volumes: false, seasons: true, sessionType: 'rewatch',
    activeLabel: 'Watching', completedLabel: 'Completed', planningLabel: 'Plan to Watch', repeatLabel: 'Rewatch',
    formats: tvFormats,
  },
  animated_series: {
    id: 'animated_series', slug: 'animated-series', label: 'Animated Series', singular: 'Animated Series', icon: Clapperboard,
    progress: 'episodes', volumes: false, seasons: true, sessionType: 'rewatch',
    activeLabel: 'Watching', completedLabel: 'Completed', planningLabel: 'Plan to Watch', repeatLabel: 'Rewatch',
    formats: tvFormats,
  },
  game: {
    id: 'game', slug: 'games', label: 'Games', singular: 'Game', icon: Gamepad2,
    progress: 'none', volumes: false, seasons: false, sessionType: 'replay',
    activeLabel: 'Playing', completedLabel: 'Completed', planningLabel: 'Backlog', repeatLabel: 'Replay', wishlistLabel: 'Want to Play',
    formats: [
      { value: 'game', label: 'Game' }, { value: 'dlc', label: 'DLC' }, { value: 'expansion', label: 'Expansion' },
      { value: 'remake', label: 'Remake' }, { value: 'remaster', label: 'Remaster' }, { value: 'other', label: 'Other' },
    ],
  },
}

export const CATEGORY_LIST = Object.values(CATEGORY_CONFIG)

export function categoryBySlug(slug: string | undefined): CategoryConfig | undefined {
  return CATEGORY_LIST.find((c) => c.slug === slug)
}

export function statusLabel(status: LibraryStatus, category?: MediaCategory): string {
  const c = category ? CATEGORY_CONFIG[category] : undefined
  switch (status) {
    case 'planning': return c?.planningLabel ?? 'Planning'
    case 'in_progress': return c?.activeLabel ?? 'In Progress'
    case 'completed': return c?.completedLabel ?? 'Completed'
    case 'on_hold': return 'On Hold'
    case 'dropped': return 'Dropped'
  }
}

export function wishlistLabel(category: MediaCategory): string {
  return CATEGORY_CONFIG[category].wishlistLabel ?? 'Wishlist'
}

export function formatLabel(category: MediaCategory, format: string | null | undefined): string | null {
  if (!format) return null
  return CATEGORY_CONFIG[category].formats.find((f) => f.value === format)?.label ?? format
}

type ProgressSource = Pick<LibraryItem,
  'category' | 'episodes_watched' | 'chapters_read' | 'volumes_read' | 'routes_completed' | 'status'
  | 'current_season' | 'current_episode'> &
  Partial<Pick<Media, 'total_episodes' | 'total_chapters' | 'total_volumes' | 'total_routes'>>

export interface ProgressInfo {
  value: number
  /** null when the total is unknown. */
  total: number | null
  /** 0..1, or null when the total is unknown. */
  ratio: number | null
  label: string
  unit: string
}

/** Primary progress for cards: episodes / chapters / routes / watched. */
export function primaryProgress(item: ProgressSource): ProgressInfo | null {
  const cfg = CATEGORY_CONFIG[item.category]
  const mk = (value: number, total: number | null | undefined, prefix: string, unit: string): ProgressInfo => {
    const t = total ?? null
    return {
      value, total: t, unit,
      ratio: t ? Math.min(1, value / t) : null,
      label: `${prefix} ${value} / ${t ?? '?'}`,
    }
  }
  switch (cfg.progress) {
    case 'episodes':
      if (cfg.seasons && item.current_season != null && item.current_episode != null) {
        const p = mk(item.episodes_watched, item.total_episodes, 'Ep', 'episodes')
        return { ...p, label: `S${item.current_season}E${item.current_episode} / ${item.total_episodes ?? '?'}` }
      }
      return mk(item.episodes_watched, item.total_episodes, 'Ep', 'episodes')
    case 'chapters':
      return mk(item.chapters_read, item.total_chapters, 'Ch', 'chapters')
    case 'routes':
      return mk(item.routes_completed, item.total_routes, 'Route', 'routes')
    case 'single': {
      const done = item.status === 'completed'
      return { value: done ? 1 : 0, total: 1, ratio: done ? 1 : 0, label: done ? 'Watched' : 'Not watched', unit: '' }
    }
    case 'none':
      return null
  }
}

export const RELEASE_STATUS_LABEL: Record<string, string> = {
  upcoming: 'Not yet released',
  releasing: 'Ongoing',
  finished: 'Finished',
  cancelled: 'Cancelled',
  hiatus: 'On hiatus',
}

export const COUNTRY_LABEL: Record<string, string> = {
  JP: 'Japan', KR: 'South Korea', CN: 'China', TW: 'Taiwan', US: 'United States', GB: 'United Kingdom',
  FR: 'France', RU: 'Russia', CA: 'Canada', DE: 'Germany',
}
