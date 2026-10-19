/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { supabase } from '@/lib/supabase'
import { sleep } from '@/lib/utils'
import { ProviderError } from './types'

/**
 * Per-provider request spacing. Values sit below each provider's documented
 * limit: AniList 30 req/min (degraded mode), VNDB 200 req/5 min, TVMaze 20
 * req/10 s, Open Library ~1 req/s, TMDB/IGDB go through our Edge Function.
 */
const MIN_INTERVAL: Record<string, number> = {
  anilist: 2100, vndb: 400, tvmaze: 600, openlibrary: 1100, tmdb: 260, igdb: 300,
}
const nextSlot: Record<string, number> = {}

async function waitTurn(provider: string) {
  const now = Date.now()
  const slot = Math.max(now, nextSlot[provider] ?? 0)
  nextSlot[provider] = slot + (MIN_INTERVAL[provider] ?? 500)
  if (slot > now) await sleep(slot - now)
}

/**
 * fetch with rate limiting, retries and exponential backoff.
 * Retries on network errors, 429 (honouring Retry-After) and 5xx.
 */
export async function providerFetch(provider: string, url: string, init?: RequestInit, attempts = 4): Promise<Response> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    await waitTurn(provider)
    try {
      const res = await fetch(url, init)
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after'))
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** i
        nextSlot[provider] = Date.now() + wait
        lastErr = new ProviderError('Rate limited', provider, 429, true)
        continue
      }
      if (res.status >= 500) {
        lastErr = new ProviderError(`Server error ${res.status}`, provider, res.status, true)
        await sleep(800 * 2 ** i)
        continue
      }
      return res
    } catch (err) {
      lastErr = new ProviderError(`Network error: ${(err as Error).message}`, provider, undefined, true)
      await sleep(800 * 2 ** i)
    }
  }
  throw lastErr instanceof ProviderError ? lastErr : new ProviderError(String(lastErr), provider)
}

export async function providerJson<T>(provider: string, url: string, init?: RequestInit): Promise<T> {
  const res = await providerFetch(provider, url, init)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ProviderError(`${provider} responded ${res.status}${text ? `: ${text.slice(0, 160)}` : ''}`, provider, res.status)
  }
  return res.json() as Promise<T>
}

const CACHE_TTL_MS = 30 * 24 * 3600 * 1000

/**
 * Response cache in the metadata_cache table, so repeated enrichment/search
 * runs do not spend provider quota again. Cache failures never break a lookup.
 */
export async function cached<T>(provider: string, key: string, fetcher: () => Promise<T>): Promise<T> {
  try {
    const { data } = await supabase.from('metadata_cache').select('payload, fetched_at').eq('provider', provider).eq('cache_key', key).maybeSingle()
    if (data && Date.now() - new Date(data.fetched_at).getTime() < CACHE_TTL_MS) return data.payload as T
  } catch { /* cache miss */ }
  const value = await fetcher()
  void supabase.from('metadata_cache').upsert({ provider, cache_key: key, payload: value as object, fetched_at: new Date().toISOString() })
    .then(({ error }) => { if (error) console.warn('[rubaka] cache write', error.message) })
  return value
}

/** Strip HTML from provider descriptions (AniList/TVMaze) into plain text. */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text || null
}

export function isoDate(y?: number | null, m?: number | null, d?: number | null): string | null {
  if (!y || !m || !d) return null
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
