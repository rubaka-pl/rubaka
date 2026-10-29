/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 *
 * Adds a doujinshi from an comic link (or bare gallery id) to the library.
 * Needs a saved session: `npm run rubaka -- login` once.
 *
 * Usage: npm run gal -- <url|id> [more urls...] [--status planning|in_progress|completed|on_hold|dropped]
 *   Default status: planning.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

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
const readSession = (): Record<string, string> => {
  try { return JSON.parse(readFileSync(SESSION_FILE, 'utf8')) } catch { return {} }
}
;(globalThis as Record<string, unknown>).__RUBAKA_AUTH_STORAGE__ = {
  getItem: (k: string) => readSession()[k] ?? null,
  setItem: (k: string, v: string) => writeFileSync(SESSION_FILE, JSON.stringify({ ...readSession(), [k]: v })),
  removeItem: (k: string) => { const s = readSession(); delete s[k]; writeFileSync(SESSION_FILE, JSON.stringify(s)) },
}

const { supabase } = await import('../src/lib/supabase')
const { parseGallery } = await import('../src/features/imports/adapters/gallery')

const STATUSES = ['planning', 'in_progress', 'completed', 'on_hold', 'dropped']
const APP = process.env.RUBAKA_APP_URL ?? 'http://localhost:5173'

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

const args = process.argv.slice(2)
let status = 'planning'
const refs: string[] = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--status') status = args[++i] ?? ''
  else if (args[i].startsWith('--status=')) status = args[i].slice(9)
  else refs.push(args[i])
}
if (!STATUSES.includes(status)) fail(`--status must be one of ${STATUSES.join(', ')}`)
if (!refs.length) fail('Usage: npm run gal -- <gallery url|id> [...] [--status completed]')

const { data: session } = await supabase.auth.getSession()
if (!session.session) fail('Not signed in. Run: npm run rubaka -- login')

let failed = 0
for (const ref of refs) {
  const id = ref.match(/(?:nhentai\.net\/g\/)?(\d+)/)?.[1]
  if (!id) { console.error(`✗ ${ref}: no gallery id found`); failed++; continue }
  const res = await fetch(`https://nhentai.net/api/v2/galleries/${id}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) { console.error(`✗ ${id}: source answered ${res.status}`); failed++; continue }
  const g = await res.json()
  g.thumb = g.cover?.path ? `https://t.nhentai.net/${String(g.cover.path).replace(/\.webp\.webp$/, '.webp')}` : null

  const parsed = parseGallery(JSON.stringify([g]))
  const r = parsed.records[0]
  if (!r) { console.error(`✗ ${id}: ${parsed.invalid[0]?.reason ?? 'could not parse'}`); failed++; continue }

  const { data, error } = await supabase.rpc('create_media_entry', {
    p_media: r.media, p_entry: { status },
    p_titles: r.titles, p_genres: r.genres, p_external_ids: r.external_ids,
    p_seasons: [], p_relations: [], p_is_custom: false, p_enriched: true,
  })
  if (error) { console.error(`✗ ${id}: ${error.message}`); failed++; continue }
  const out = data as { media_id: string; existing: boolean }
  console.log(`${out.existing ? '= Already in library' : '✓ Added'}: ${r.media.title}\n  ${APP}/media/${out.media_id}`)
}
process.exit(failed ? 1 : 0)
