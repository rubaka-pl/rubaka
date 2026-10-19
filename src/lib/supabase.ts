/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/** Accept a pasted dashboard link (supabase.com/dashboard/project/<ref>) and turn it into the API URL. */
function normalizeUrl(raw: string | undefined): string | undefined {
  const v = raw?.trim().replace(/\/+$/, '')
  const ref = v?.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i)?.[1]
  return ref ? `https://${ref}.supabase.co` : v
}

/**
 * True for keys that bypass Row Level Security (new "sb_secret_..." keys or a
 * legacy JWT with role "service_role"). Such a key must never ship to a browser.
 */
export function isSecretKey(key: string | undefined): boolean {
  if (!key) return false
  if (key.startsWith('sb_secret_')) return true
  const payload = key.split('.')[1]
  if (!payload) return false
  try {
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role'
  } catch {
    return false
  }
}

// In the app these come from Vite; the local CLI (scripts/rubaka.ts) runs the
// same modules in Node, where they come from process.env instead.
const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
const viteEnv = (import.meta as { env?: Record<string, string | undefined> }).env
const env = (key: string) => viteEnv?.[key] ?? nodeEnv?.[key]
const url = normalizeUrl(env('VITE_SUPABASE_URL'))
const rawKey = env('VITE_SUPABASE_ANON_KEY')?.trim()

/** The CLI injects a file-backed session store; the browser uses localStorage (default). */
const authStorage = (globalThis as { __RUBAKA_AUTH_STORAGE__?: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } }).__RUBAKA_AUTH_STORAGE__

/** Set when the configured key is a secret key: the app refuses to use it. */
export const usesSecretKey = isSecretKey(rawKey)
const anonKey = usesSecretKey ? undefined : rawKey

/** False when the build has no usable Supabase configuration (a setup screen is shown). */
export const isSupabaseConfigured = Boolean(
  url && anonKey && !url.includes('YOUR-PROJECT') && !anonKey.startsWith('PASTE-'),
)

// Only the public anon/publishable key is used in the browser. All data is
// protected by RLS; the service-role key must never appear in this bundle.
export const supabase: SupabaseClient = createClient(
  url ?? 'http://localhost:54321',
  anonKey ?? 'public-anon-key-missing',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: !authStorage, ...(authStorage ? { storage: authStorage } : {}) } },
)

export const ASSET_BUCKET = 'media-assets'

/** Public URL for a custom image stored in Supabase Storage. */
export function assetUrl(path: string | null | undefined): string | null {
  if (!path) return null
  return supabase.storage.from(ASSET_BUCKET).getPublicUrl(path).data.publicUrl
}

/** Custom uploads always take precedence over provider images. */
export function posterSrc(m: { custom_poster_path?: string | null; poster_url?: string | null }): string | null {
  return assetUrl(m.custom_poster_path) ?? m.poster_url ?? null
}

export function backdropSrc(m: { custom_backdrop_path?: string | null; backdrop_url?: string | null }): string | null {
  return assetUrl(m.custom_backdrop_path) ?? m.backdrop_url ?? null
}

/** Turn a PostgREST/Postgres error into a message that is safe to show. */
export function friendlyError(err: unknown): string {
  if (!err) return 'Something went wrong.'
  const e = err as { message?: string; code?: string }
  const msg = e.message ?? String(err)
  if (/Failed to fetch|NetworkError|fetch failed|Load failed/i.test(msg)) {
    return 'Cannot reach the server. Check your connection and try again.'
  }
  if (e.code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return 'Access denied. Make sure you are signed in as the configured owner.'
  }
  if (e.code === '23505') return 'This item already exists.'
  if (/JWT|refresh token/i.test(msg)) return 'Your session expired. Please sign in again.'
  return msg.length > 220 ? `${msg.slice(0, 220)}…` : msg
}

/** Throw on a Supabase error, logging technical details for debugging. */
export function unwrap<T>(res: { data: T; error: unknown }, context: string): T {
  if (res.error) {
    console.error(`[rubaka] ${context}`, res.error)
    throw res.error
  }
  return res.data
}
