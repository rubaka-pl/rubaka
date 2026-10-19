# RUBAKA — Implementation status

_Last updated: 2026-10-19 (session 1)_

## Completed (implemented, verified by automated tests where noted)

- **Database** — 5 migrations (`supabase/migrations`), one-paste `supabase/setup.sql`.
  Schema, constraints, triggers, RLS (owner-only), RPCs: `library_query`, `library_facets`, `dashboard_summary`,
  `library_stats`, `import_match`, `import_apply`, `import_finish`, `apply_enrichment(_batch)`, `enqueue_enrichment`,
  `create_media_entry`, `wipe_library`, `restore_rows`, `restore_media_genres`, `restore_finish`, `am_i_owner`.
  ✅ 32 database tests in PGlite (real migrations): RLS for anon / non-owner / unconfigured owner, half-star ratings,
  NULL vs 0, unknown totals, progress caps, sessions & repeat counting, activity merging, search (Japanese, Russian,
  romaji with macrons, typos), stable pagination for every sort, idempotent/resumable imports, per-record failure
  isolation, fill-only enrichment, wipe + restore, custom entries with Japanese original titles.
- **Importers** (adapters) for the real files: MAL XML(.gz), IMDb CSV, Backloggd Toolkittd JSON.
  ✅ 21 unit tests + 2 optional tests over the real exports (3,605 anime, 721 manga, 1,960 IMDb rows: 0 invalid).
  Mapping: `docs/IMPORT_MAPPING.md`.
- **Frontend** (typecheck, lint and production build pass):
  auth (login, no sign-up, owner check screens), app shell (collapsible sidebar, mobile drawer, Ctrl+K search, `/`, `n`),
  dashboard, category pages (status tabs incl. Planning & Wishlist, 14 sorts, combinable filters in the URL,
  3 view modes, infinite loading, scroll restoration, bulk actions, random wishlist pick), poster cards with quick
  actions (touch-friendly), SVG star rating (half stars, keyboard, touch, explicit 0, clear), detail page
  (tracking panel, overview, seasons, VN routes, history with rewatch/reread/replay sessions, details, relations,
  markdown notes with autosave), metadata editor (locks edited fields, custom cover/backdrop upload),
  Add Media (online search with confidence + custom entry), import wizard (preview, conflicts, report, history),
  metadata enrichment queue (batching, rate limits, backoff, review list, category suggestions), statistics
  (overview, rating distribution, status, completed/added by year, genres, top rated, most revisited, heatmap,
  year view), settings (theme, defaults, timezone, date format, wishlist behaviour, providers, export JSON/CSV,
  restore with preview, delete library).
- **Edge Function** `metadata-proxy` (TMDB, IGDB) — written, not deployed.
- **Deployment** — GitHub Actions workflow for Pages, SPA 404 fallback.

## Not yet verified against a live Supabase project

Everything that talks to Supabase from the browser (login, CRUD, imports, storage uploads, Edge Function) has
only been verified through types, the PGlite database tests and the build. A live end-to-end pass is pending
until the project credentials exist.

## Remaining / known issues

- Live end-to-end browser testing (login → import real files → enrichment → edit → backup/restore).
- Backloggd mapping must be re-checked against the owner's real Toolkittd JSON (format taken from the extension source).
- Edge Function untested (needs deployment + TMDB/Twitch credentials).
- Russian localization: not started. UI strings are in components; category/status labels are centralized in
  `src/lib/categories.ts`.
- Lint warning (not error): React Compiler skips `CustomMediaForm` because of `react-hook-form`'s `watch()`.
- Main bundle is code-split into vendor chunks (largest: React 97 KB gzip).

## Required credentials / configuration

| What | Where | Status |
|---|---|---|
| Supabase Project URL + anon/publishable key | `.env.local` (local), GitHub Actions secrets (deploy) | **needed** |
| Owner user id | `insert into app_private.owner ...` (SQL Editor) | needed |
| TMDB read token | Supabase function secret `TMDB_READ_TOKEN` | optional (movie posters) |
| Twitch client id/secret | Supabase function secrets | optional (games) |

## Test results (local, 2026-10-19)

- `npm run typecheck` ✅
- `npm run lint` ✅ (0 errors, 1 warning)
- `npm test` ✅ 53 passed (32 database, 21 unit), 2 opt-in real-export tests skipped by default (they pass when enabled)
- `npm run build` ✅

## Deployment status

Not deployed. GitHub repository not created yet.
