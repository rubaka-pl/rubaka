/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 *
 * Local command-line client, so the library can be edited from a terminal
 * (e.g. by an assistant acting on "add Mushoku Tensei, I read volume 1").
 *
 * It signs in as YOU (Supabase Auth, RLS applies) — no secret keys. The
 * password is typed once by you (`npm run rubaka -- login`); only the session
 * token is stored, in .rubaka-session.json (git-ignored, refreshed on use).
 *
 * Usage: npm run rubaka -- <command> [args] [--flags]
 *   login [email]                     sign in (asks for the password)
 *   logout | whoami
 *   find <query> [--cat c]            search your library
 *   lookup <cat> <query>              search metadata providers
 *   add <cat> <query|provider:id>     add a title (uses the best unambiguous match,
 *                                     otherwise lists candidates and exits with code 2)
 *   update <query|entry-uuid>         change an entry in your library
 * Flags (add/update): --status planning|in_progress|completed|on_hold|dropped
 *   --episodes N --chapters N --volumes N --routes N --rating 0..5 (step 0.5, "none" clears)
 *   --start YYYY-MM-DD --done YYYY-MM-DD --wishlist --no-wishlist --favorite --no-favorite --notes "text"
 * Categories: anime manga novel visual_novel movie tv_series animated_series game
 * Provider ids: anilist:123  vndb:v97  tvmaze:184  tmdb:550  igdb:1942
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline'

// ---------------------------------------------------------------- environment
const ROOT = new URL('..', import.meta.url)
const SESSION_FILE = new URL('.rubaka-session.json', ROOT)
for (const f of ['.env.local', '.env']) {
  const p = new URL(f, ROOT)
  if (!existsSync(p)) continue
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

// File-backed auth storage (only the session token; never the password).
const readSession = (): Record<string, string> => {
  try { return JSON.parse(readFileSync(SESSION_FILE, 'utf8')) } catch { return {} }
}
;(globalThis as Record<string, unknown>).__RUBAKA_AUTH_STORAGE__ = {
  getItem: (k: string) => readSession()[k] ?? null,
  setItem: (k: string, v: string) => writeFileSync(SESSION_FILE, JSON.stringify({ ...readSession(), [k]: v })),
  removeItem: (k: string) => { const s = readSession(); delete s[k]; writeFileSync(SESSION_FILE, JSON.stringify(s)) },
}

// Imported after the storage hook is installed.
const { supabase, isSupabaseConfigured, usesSecretKey } = await import('../src/lib/supabase')
const { availableProviders, searchProvider, PROVIDER_LABEL } = await import('../src/integrations/index')
const { toEnrichmentPayload } = await import('../src/integrations/types')
const { getAniListById } = await import('../src/integrations/anilist')
const { getVndbById } = await import('../src/integrations/vndb')
const { getTvmazeById } = await import('../src/integrations/tvmaze')
const { getTmdbMovie, getTmdbTv, getIgdbById } = await import('../src/integrations/proxied')
import type { ProviderResult } from '../src/integrations/types'
import type { LibraryItem, LibraryStatus, MediaCategory } from '../src/types/db'

const CATS: MediaCategory[] = ['anime', 'manga', 'novel', 'visual_novel', 'movie', 'tv_series', 'animated_series', 'game']
const STATUSES: LibraryStatus[] = ['planning', 'in_progress', 'completed', 'on_hold', 'dropped']
const FORMATS: Record<MediaCategory, string[]> = {
  anime: ['tv', 'tv_short', 'movie', 'ova', 'ona', 'special', 'music', 'other'],
  manga: ['manga', 'manhwa', 'manhua', 'webtoon', 'one_shot', 'doujinshi', 'other'],
  novel: ['light_novel', 'web_novel', 'novel', 'short_story', 'other'],
  visual_novel: ['visual_novel', 'kinetic_novel', 'other'],
  movie: ['movie', 'tv_movie', 'short', 'video', 'special', 'other'],
  tv_series: ['series', 'mini_series', 'special', 'other'],
  animated_series: ['series', 'mini_series', 'special', 'other'],
  game: ['game', 'dlc', 'expansion', 'remake', 'remaster', 'other'],
}
const APP = process.env.RUBAKA_APP_URL ?? 'http://localhost:5173'

// ---------------------------------------------------------------- helpers
function fail(msg: string, code = 1): never {
  console.error(`✗ ${msg}`)
  process.exit(code)
}

function parseArgs(argv: string[]) {
  const pos: string[] = []
  const flags: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2)
      if (v !== undefined) flags[k] = v
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') && !['wishlist', 'no-wishlist', 'favorite', 'no-favorite'].includes(k)) flags[k] = argv[++i]
      else flags[k] = true
    } else pos.push(a)
  }
  return { pos, flags }
}

const int = (v: string | true | undefined, name: string) => {
  if (v === undefined) return undefined
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0) fail(`--${name} must be a whole number ≥ 0`)
  return n
}
const date = (v: string | true | undefined, name: string) => {
  if (v === undefined) return undefined
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(`--${name} must be YYYY-MM-DD`)
  return v
}
const today = () => new Date().toISOString().slice(0, 10)

/** Turn flags into an entry patch (validated). */
function patchFromFlags(flags: Record<string, string | true>) {
  const p: Record<string, unknown> = {}
  if (flags.status !== undefined) {
    if (!STATUSES.includes(flags.status as LibraryStatus)) fail(`--status must be one of ${STATUSES.join(', ')}`)
    p.status = flags.status
  }
  const map: [string, string][] = [['episodes', 'episodes_watched'], ['chapters', 'chapters_read'], ['volumes', 'volumes_read'], ['routes', 'routes_completed']]
  for (const [flag, col] of map) { const n = int(flags[flag], flag); if (n !== undefined) p[col] = n }
  if (flags.rating !== undefined) {
    if (flags.rating === 'none') p.rating = null
    else {
      const stars = Number(flags.rating)
      if (!Number.isFinite(stars) || stars < 0 || stars > 5 || Math.round(stars * 2) !== stars * 2) fail('--rating must be 0..5 in steps of 0.5 (or "none")')
      p.rating = Math.round(stars * 2)
    }
  }
  const s = date(flags.start, 'start'); if (s) p.start_date = s
  const d = date(flags.done, 'done'); if (d) p.completion_date = d
  if (flags.wishlist) p.wishlisted_at = new Date().toISOString()
  if (flags['no-wishlist']) p.wishlisted_at = null
  if (flags.favorite) p.is_favorite = true
  if (flags['no-favorite']) p.is_favorite = false
  if (typeof flags.notes === 'string') p.notes = flags.notes
  return p
}

async function requireSession() {
  if (usesSecretKey) fail('VITE_SUPABASE_ANON_KEY is a secret key. Use the publishable key.')
  if (!isSupabaseConfigured) fail('Supabase is not configured (.env.local).')
  const { data } = await supabase.auth.getSession()
  if (!data.session) fail('Not signed in. Run: npm run rubaka -- login')
  const { data: owner, error } = await supabase.rpc('am_i_owner')
  if (error) fail(`Cannot reach the database: ${error.message}`)
  if (!owner) fail('This account is not the RUBAKA owner.')
  return data.session
}

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true })
    if (hidden) {
      // Mask typed characters.
      ;(rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
        stdout.write(s.includes(question) ? s : s.replace(/[^\r\n]/g, '*'))
      }
    }
    rl.question(question, (answer) => { rl.close(); if (hidden) stdout.write('\n'); resolve(answer.trim()) })
  })
}

function describe(i: LibraryItem) {
  const prog = i.category === 'manga' || i.category === 'novel' ? `ch ${i.chapters_read}/${i.total_chapters ?? '?'} vol ${i.volumes_read}/${i.total_volumes ?? '?'}`
    : i.category === 'visual_novel' ? `routes ${i.routes_completed}/${i.total_routes ?? '?'}`
    : ['anime', 'tv_series', 'animated_series'].includes(i.category) ? `ep ${i.episodes_watched}/${i.total_episodes ?? '?'}` : ''
  return `${i.entry_id}  [${i.category}] ${i.title}${i.release_year ? ` (${i.release_year})` : ''} — ${i.status}${prog ? `, ${prog}` : ''}${i.rating != null ? `, ${i.rating / 2}★` : ''}${i.wishlisted_at ? ', wishlist' : ''}`
}

async function libraryFind(query: string, category?: string) {
  const { data, error } = await supabase.rpc('library_query', { p_search: query, p_category: category ?? null, p_sort: 'relevance', p_limit: 10 })
  if (error) fail(error.message)
  return data as LibraryItem[]
}

async function byProviderId(cat: MediaCategory, ref: string): Promise<ProviderResult | null> {
  const [prov, id] = ref.split(':', 2)
  switch (prov) {
    case 'anilist': return getAniListById(Number(id))
    case 'vndb': return getVndbById(id)
    case 'tvmaze': return getTvmazeById(Number(id))
    case 'tmdb': return cat === 'movie' ? getTmdbMovie(Number(id)) : getTmdbTv(Number(id), cat)
    case 'igdb': return getIgdbById(Number(id))
    default: return fail(`Unknown provider "${prov}". Use anilist:, vndb:, tvmaze:, tmdb:, igdb:`)
  }
}

async function lookup(cat: MediaCategory, query: string) {
  const provs = (await availableProviders(cat)).filter((p) => p.available).map((p) => p.provider)
  if (!provs.length) fail(`No metadata provider is configured for ${cat}.`)
  const all: ProviderResult[] = []
  for (const p of provs) {
    try { all.push(...(await searchProvider(p, cat, query))) } catch (e) { console.error(`  (${PROVIDER_LABEL[p]} failed: ${(e as Error).message})`) }
  }
  return all.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
}

const printCandidates = (rs: ProviderResult[]) => rs.slice(0, 10).forEach((r) =>
  console.log(`  ${r.provider}:${r.externalId}  ${r.title}${r.originalTitle ? ` / ${r.originalTitle}` : ''}${r.year ? ` (${r.year})` : ''}  ${r.format ?? ''}  [${r.category}]  match ${Math.round((r.confidence ?? 0) * 100)}%`))

// ---------------------------------------------------------------- commands
const { pos, flags } = parseArgs(process.argv.slice(2))
const cmd = pos.shift()

switch (cmd) {
  case 'login': {
    if (!isSupabaseConfigured) fail('Supabase is not configured (.env.local).')
    const email = pos[0] ?? await ask('Email: ')
    const password = await ask('Password: ', true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) fail(`Sign-in failed: ${error.message}`)
    await requireSession()
    console.log(`✓ Signed in as ${email}. Session saved to .rubaka-session.json (no password stored).`)
    break
  }
  case 'logout': {
    await supabase.auth.signOut()
    if (existsSync(SESSION_FILE)) unlinkSync(SESSION_FILE)
    console.log('✓ Signed out')
    break
  }
  case 'whoami': {
    const s = await requireSession()
    console.log(`✓ ${s.user.email} (owner)`)
    break
  }
  case 'find': {
    await requireSession()
    const q = pos.join(' ')
    if (!q) fail('Usage: find <query> [--cat c]')
    const rows = await libraryFind(q, typeof flags.cat === 'string' ? flags.cat : undefined)
    if (!rows.length) console.log('No matches in your library.')
    rows.forEach((r) => console.log(describe(r)))
    break
  }
  case 'lookup': {
    await requireSession()
    const cat = pos.shift() as MediaCategory
    if (!CATS.includes(cat)) fail(`Category must be one of ${CATS.join(', ')}`)
    printCandidates(await lookup(cat, pos.join(' ')))
    break
  }
  case 'add': {
    await requireSession()
    const cat = pos.shift() as MediaCategory
    if (!CATS.includes(cat)) fail(`Category must be one of ${CATS.join(', ')}`)
    const query = pos.join(' ')
    if (!query) fail('Usage: add <cat> <query|provider:id> [flags]')
    let r: ProviderResult | null
    if (/^(anilist|vndb|tvmaze|tmdb|igdb):\S+$/.test(query)) {
      r = await byProviderId(cat, query)
      if (!r) fail(`${query} was not found.`)
    } else {
      const rs = await lookup(cat, query)
      const [top, second] = rs
      // Only take an unambiguous, near-exact match automatically.
      if (!top || (top.confidence ?? 0) < 0.85 || (second && (second.confidence ?? 0) > (top.confidence ?? 0) - 0.05)) {
        console.log('Ambiguous — pick one and re-run with its id (e.g. add novel anilist:12345 ...):')
        printCandidates(rs)
        process.exit(2)
      }
      r = top
    }
    if (r.category !== cat) console.log(`! Note: the source lists this as ${r.category}; adding it to ${cat} as requested.`)
    const payload = toEnrichmentPayload({ ...r, format: r.format && FORMATS[cat].includes(r.format) ? r.format : null })
    const patch = patchFromFlags(flags)
    const progressGiven = ['episodes_watched', 'chapters_read', 'volumes_read', 'routes_completed'].some((k) => Number(patch[k] ?? 0) > 0)
    const status = (patch.status as LibraryStatus | undefined) ?? (progressGiven ? 'in_progress' : 'planning')
    // Dates are only set when given: an assistant adding past reads must not invent them.
    const entry = { ...patch, status }
    const { data, error } = await supabase.rpc('create_media_entry', {
      p_media: { ...payload.media, category: cat, title: r.title }, p_entry: entry,
      p_titles: payload.titles, p_genres: payload.genres, p_external_ids: payload.external_ids,
      p_seasons: payload.seasons, p_relations: payload.relations, p_is_custom: false, p_enriched: true,
    })
    if (error) fail(error.message)
    const res = data as { media_id: string; entry_id: string; existing: boolean }
    if (res.existing && Object.keys(patch).length) {
      // Already in the library: apply the requested changes to the existing entry.
      const { error: upErr } = await supabase.from('library_entries').update(patch).eq('id', res.entry_id)
      if (upErr) fail(upErr.message)
    }
    const [item] = (await supabase.rpc('library_query', { p_entry_ids: [res.entry_id], p_limit: 1 })).data as LibraryItem[]
    console.log(`${res.existing ? '✓ Already in library — updated' : '✓ Added'}: ${describe(item)}`)
    console.log(`  ${APP}/media/${res.media_id}`)
    break
  }
  case 'update': {
    await requireSession()
    const ref = pos.join(' ')
    if (!ref) fail('Usage: update <query|entry-uuid> [flags]')
    let item: LibraryItem | undefined
    if (/^[0-9a-f-]{36}$/i.test(ref)) {
      item = ((await supabase.rpc('library_query', { p_entry_ids: [ref], p_limit: 1 })).data as LibraryItem[])[0]
    } else {
      const rows = await libraryFind(ref, typeof flags.cat === 'string' ? flags.cat : undefined)
      if (rows.length > 1 && rows[0].relevance === rows[1].relevance) {
        console.log('Several titles match — re-run with the entry id:')
        rows.forEach((r) => console.log(`  ${describe(r)}`))
        process.exit(2)
      }
      item = rows[0]
    }
    if (!item) fail(`“${ref}” is not in your library.`)
    const patch = patchFromFlags(flags)
    if (!Object.keys(patch).length) fail('Nothing to change: pass --status, --chapters, --rating, ...')
    // Same defaults as the app (without overwriting existing dates).
    if (patch.status === 'completed' && !item.completion_date && !patch.completion_date) patch.completion_date = today()
    if (patch.status === 'in_progress' && !item.start_date && !patch.start_date) patch.start_date = today()
    const { error } = await supabase.from('library_entries').update(patch).eq('id', item.entry_id)
    if (error) fail(error.message)
    const [after] = (await supabase.rpc('library_query', { p_entry_ids: [item.entry_id], p_limit: 1 })).data as LibraryItem[]
    console.log(`✓ Updated: ${describe(after)}`)
    console.log(`  ${APP}/media/${after.media_id}`)
    break
  }
  default:
    console.log(readFileSync(new URL(import.meta.url), 'utf8').match(/\* Usage:[\s\S]*?\*\//)?.[0].replace(/^ ?\* ?/gm, '').replace(/\/\s*$/, '').trim() ?? 'See scripts/rubaka.ts')
}
process.exit(0)
