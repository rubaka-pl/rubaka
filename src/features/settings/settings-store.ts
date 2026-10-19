/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { z } from 'zod'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '@/lib/supabase'
import type { MediaCategory } from '@/types/db'

const browserTz = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
})()

export const SORT_OPTIONS = [
  { value: 'added_desc', label: 'Date added (newest)' },
  { value: 'added_asc', label: 'Date added (oldest)' },
  { value: 'title_asc', label: 'Title A–Z' },
  { value: 'title_desc', label: 'Title Z–A' },
  { value: 'release_desc', label: 'Release date (newest)' },
  { value: 'release_asc', label: 'Release date (oldest)' },
  { value: 'rating_desc', label: 'Rating (highest)' },
  { value: 'rating_asc', label: 'Rating (lowest)' },
  { value: 'started_desc', label: 'Date started' },
  { value: 'completed_desc', label: 'Date completed' },
  { value: 'activity_desc', label: 'Last activity' },
  { value: 'progress_desc', label: 'Progress' },
  { value: 'repeats_desc', label: 'Repeat count' },
  { value: 'random', label: 'Random' },
] as const
export type SortValue = (typeof SORT_OPTIONS)[number]['value'] | 'relevance' | 'priority_desc'

/** Settings synced to Supabase (user_settings.settings). */
export const settingsSchema = z.object({
  timezone: z.string().catch(browserTz).default(browserTz),
  dateFormat: z.enum(['medium', 'long', 'numeric', 'iso']).catch('medium').default('medium'),
  theme: z.enum(['dark', 'light']).catch('dark').default('dark'),
  defaultSort: z.string().catch('added_desc').default('added_desc'),
  defaultView: z.enum(['grid', 'compact', 'list']).catch('grid').default('grid'),
  /** What to do with the wishlist flag when tracking starts. */
  wishlistOnStart: z.enum(['ask', 'keep', 'remove']).catch('ask').default('ask'),
  /** Fill progress to the known total when marking completed. */
  fillProgressOnComplete: z.boolean().catch(true).default(true),
  /** Show the NSFW-flagged covers blurred (provider-reported adult content). */
  blurAdult: z.boolean().catch(true).default(true),
})
export type Settings = z.infer<typeof settingsSchema>
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({})

export type ViewMode = 'grid' | 'compact' | 'list'

interface SettingsState {
  settings: Settings
  /** Per-category view mode (local interface preference). */
  viewModes: Partial<Record<MediaCategory, ViewMode>>
  sidebarCollapsed: boolean
  setLocal: (patch: Partial<Settings>) => void
  setViewMode: (c: MediaCategory, v: ViewMode) => void
  setSidebarCollapsed: (v: boolean) => void
}

// localStorage is only a cache for interface preferences; the source of truth
// for settings is the user_settings table (see loadRemoteSettings/saveSettings).
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      viewModes: {},
      sidebarCollapsed: false,
      setLocal: (patch) => set((s) => ({ settings: settingsSchema.parse({ ...s.settings, ...patch }) })),
      setViewMode: (c, v) => set((s) => ({ viewModes: { ...s.viewModes, [c]: v } })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
    }),
    {
      name: 'rubaka.prefs',
      version: 1,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>
        return { ...current, ...p, settings: settingsSchema.parse({ ...current.settings, ...(p.settings ?? {}) }) }
      },
    },
  ),
)

export function getSettingsSnapshot(): Settings {
  return useSettingsStore.getState().settings
}

export function useSettings(): Settings {
  return useSettingsStore((s) => s.settings)
}

export function applyTheme(theme: Settings['theme']) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem('rubaka.theme', theme)
  } catch {
    /* storage unavailable: theme still applies for this session */
  }
}

export async function loadRemoteSettings(): Promise<void> {
  const { data, error } = await supabase.from('user_settings').select('settings').maybeSingle()
  if (error) {
    console.error('[rubaka] load settings', error)
    return
  }
  if (data?.settings) {
    const merged = settingsSchema.parse({ ...getSettingsSnapshot(), ...data.settings })
    useSettingsStore.setState({ settings: merged })
    applyTheme(merged.theme)
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const prev = getSettingsSnapshot()
  const next = settingsSchema.parse({ ...prev, ...patch })
  useSettingsStore.setState({ settings: next })
  if (patch.theme) applyTheme(next.theme)
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return
  const { error } = await supabase.from('user_settings').upsert({ user_id: auth.user.id, settings: next })
  if (error) {
    useSettingsStore.setState({ settings: prev })
    if (patch.theme) applyTheme(prev.theme)
    throw error
  }
}
