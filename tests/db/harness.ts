/**
 * Runs the real SQL migrations inside PGlite (Postgres compiled to WASM) with a
 * minimal stand-in for Supabase's `auth` schema and roles, so schema
 * constraints, triggers, RPCs and RLS can be tested without Docker.
 */
import { PGlite, type Transaction } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { unaccent } from '@electric-sql/pglite/contrib/unaccent'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations')

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`

export const OWNER = '11111111-1111-4111-8111-111111111111'
export const STRANGER = '22222222-2222-4222-8222-222222222222'

export async function createTestDb(opts: { owner?: boolean } = {}) {
  const db = await PGlite.create({ extensions: { pg_trgm, unaccent } })
  await db.exec(SUPABASE_STUB)
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'))
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err })
    }
  }
  await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@test'), ('${STRANGER}', 'x@test')`)
  if (opts.owner !== false) await db.exec(`insert into app_private.owner (user_id) values ('${OWNER}')`)
  return db
}

/** Run `fn` as the Supabase `authenticated` role with the given user id (or as `anon`). */
export async function as<T>(db: PGlite, user: string | 'anon', fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    if (user === 'anon') {
      await tx.exec(`set local role anon`)
    } else {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user])
      await tx.exec(`set local role authenticated`)
    }
    return fn(tx)
  })
}

/** Convenience: insert a media row + library entry as the owner, return ids. */
export async function addTitle(
  db: PGlite,
  media: Record<string, unknown>,
  entry: Record<string, unknown> = {},
): Promise<{ mediaId: string; entryId: string }> {
  return as(db, OWNER, async (tx) => {
    const mcols = Object.keys(media)
    const m = await tx.query<{ id: string }>(
      `insert into media (${mcols.join(',')}) values (${mcols.map((_, i) => `$${i + 1}`).join(',')}) returning id`,
      Object.values(media),
    )
    const mediaId = m.rows[0].id
    const ecols = ['media_id', ...Object.keys(entry)]
    const e = await tx.query<{ id: string }>(
      `insert into library_entries (${ecols.join(',')}) values (${ecols.map((_, i) => `$${i + 1}`).join(',')}) returning id`,
      [mediaId, ...Object.values(entry)],
    )
    return { mediaId, entryId: e.rows[0].id }
  })
}
