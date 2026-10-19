// @vitest-environment node
import { createTestDb } from './harness'

test('migrations apply cleanly', async () => {
  const db = await createTestDb()
  const r = await db.query<{ n: number }>(`select count(*)::int as n from pg_tables where schemaname = 'public'`)
  expect(r.rows[0].n).toBeGreaterThan(10)
})

test('supabase/setup.sql (one-paste setup) applies as a single script', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm')
  const { unaccent } = await import('@electric-sql/pglite/contrib/unaccent')
  const { readFileSync } = await import('node:fs')
  const db = await PGlite.create({ extensions: { pg_trgm, unaccent } })
  await db.exec(`create role anon nologin; create role authenticated nologin; create schema auth;
    create table auth.users (id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;`)
  await db.exec(readFileSync('supabase/setup.sql', 'utf8'))
  const r = await db.query<{ n: number }>(`select count(*)::int as n from pg_proc where proname = 'library_query'`)
  expect(r.rows[0].n).toBe(1)
})
