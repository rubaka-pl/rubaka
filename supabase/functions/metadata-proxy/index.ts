/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 *
 * metadata-proxy — server-side access to metadata providers that need secret
 * credentials (TMDB, IGDB). Secrets live in Supabase function secrets and are
 * never sent to the browser. Only the configured owner may call it, and only
 * whitelisted, read-only provider endpoints are forwarded.
 *
 * Secrets (supabase secrets set ...):
 *   TMDB_READ_TOKEN        TMDB "API Read Access Token" (v4 bearer)  — or —
 *   TMDB_API_KEY           TMDB v3 API key
 *   TWITCH_CLIENT_ID       IGDB via Twitch developer application
 *   TWITCH_CLIENT_SECRET
 *   MAL_CLIENT_ID          MyAnimeList API v2 client id (fallback for anime/manga AniList lacks)
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const TMDB_PATH = /^\/(search\/(movie|tv|multi)|movie\/\d+|tv\/\d+|tv\/\d+\/season\/\d+|find\/tt\d+)$/
const TMDB_PARAMS = new Set(['query', 'year', 'first_air_date_year', 'page', 'language', 'include_adult', 'append_to_response', 'external_source'])
const IGDB_ENDPOINTS = new Set(['games', 'search'])
const MAL_PATH = /^\/(anime|manga)\/\d+$/
const MAL_FIELDS = /^[a-z_,{}]+$/

let igdbToken: { value: string; expires: number } | null = null

async function getIgdbToken(): Promise<string> {
  if (igdbToken && igdbToken.expires > Date.now() + 60_000) return igdbToken.value
  const id = Deno.env.get('TWITCH_CLIENT_ID')
  const secret = Deno.env.get('TWITCH_CLIENT_SECRET')
  const res = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${id}&client_secret=${secret}&grant_type=client_credentials`, { method: 'POST' })
  if (!res.ok) throw new Error(`Twitch token request failed (${res.status})`)
  const data = await res.json() as { access_token: string; expires_in: number }
  igdbToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 }
  return igdbToken.value
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // Only the configured owner may use the proxy (checked with the caller's JWT, so RLS rules apply).
  const authHeader = req.headers.get('Authorization') ?? ''
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: isOwner, error: ownerErr } = await sb.rpc('am_i_owner')
  if (ownerErr || !isOwner) return json({ error: 'Forbidden' }, 403)

  let body: { provider?: string; path?: string; params?: Record<string, string>; endpoint?: string; query?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  // Accept either TMDB credential in either secret: the v4 "API Read Access
  // Token" (a long JWT, sent as Bearer) or the v3 "API Key" (32 hex chars,
  // sent as ?api_key=). Pasted whitespace or a "Bearer " prefix is ignored.
  const tmdbCreds = [Deno.env.get('TMDB_READ_TOKEN'), Deno.env.get('TMDB_API_KEY')]
    .map((v) => v?.trim().replace(/^Bearer\s+/i, ''))
    .filter((v): v is string => !!v)
  const tmdbToken = tmdbCreds.find((v) => v.startsWith('eyJ'))
  const tmdbKey = tmdbCreds.find((v) => /^[0-9a-f]{32}$/i.test(v))
  const igdbConfigured = Boolean(Deno.env.get('TWITCH_CLIENT_ID') && Deno.env.get('TWITCH_CLIENT_SECRET'))
  const malClientId = Deno.env.get('MAL_CLIENT_ID')

  try {
    if (body.provider === 'status') {
      return json({ tmdb: Boolean(tmdbToken || tmdbKey), igdb: igdbConfigured, mal: Boolean(malClientId) })
    }

    if (body.provider === 'tmdb') {
      if (!tmdbToken && !tmdbKey) return json({ error: 'TMDB is not configured' }, 501)
      if (!body.path || !TMDB_PATH.test(body.path)) return json({ error: 'Path not allowed' }, 400)
      const url = new URL(`https://api.themoviedb.org/3${body.path}`)
      for (const [k, v] of Object.entries(body.params ?? {})) if (TMDB_PARAMS.has(k)) url.searchParams.set(k, String(v))
      if (!tmdbToken && tmdbKey) url.searchParams.set('api_key', tmdbKey)
      const res = await fetch(url, { headers: tmdbToken ? { Authorization: `Bearer ${tmdbToken}`, Accept: 'application/json' } : { Accept: 'application/json' } })
      const text = await res.text()
      return new Response(text, { status: res.status, headers: { ...CORS, 'Content-Type': 'application/json', ...(res.headers.get('retry-after') ? { 'Retry-After': res.headers.get('retry-after')! } : {}) } })
    }

    if (body.provider === 'igdb') {
      if (!igdbConfigured) return json({ error: 'IGDB is not configured' }, 501)
      if (!body.endpoint || !IGDB_ENDPOINTS.has(body.endpoint) || typeof body.query !== 'string' || body.query.length > 2000) {
        return json({ error: 'Request not allowed' }, 400)
      }
      const token = await getIgdbToken()
      const res = await fetch(`https://api.igdb.com/v4/${body.endpoint}`, {
        method: 'POST',
        headers: { 'Client-ID': Deno.env.get('TWITCH_CLIENT_ID')!, Authorization: `Bearer ${token}`, Accept: 'application/json' },
        body: body.query,
      })
      return new Response(await res.text(), { status: res.status, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    if (body.provider === 'mal') {
      if (!malClientId) return json({ error: 'MyAnimeList is not configured' }, 501)
      const fields = body.params?.fields ?? ''
      if (!body.path || !MAL_PATH.test(body.path) || !MAL_FIELDS.test(fields)) return json({ error: 'Request not allowed' }, 400)
      const res = await fetch(`https://api.myanimelist.net/v2${body.path}?fields=${fields}`, { headers: { 'X-MAL-CLIENT-ID': malClientId } })
      return new Response(await res.text(), { status: res.status, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    return json({ error: 'Unknown provider' }, 400)
  } catch (err) {
    console.error('metadata-proxy error', err)
    return json({ error: 'Upstream request failed' }, 502)
  }
})
