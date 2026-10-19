# RUBAKA — Implementation status

_Last updated: 2026-10-20_

## Live and verified with the owner's real data (Supabase project in use)

- Supabase schema: migrations 1–8 applied (core, queries, imports/enrichment/backup, storage, create entry,
  bulk updates, VNDB source, "completed = all episodes"). RLS: anonymous access refused (checked from outside).
- Auth: email/password login, owner check; secret keys are refused by the app.
- Imports done: MAL anime (3,605) and manga (721), IMDb (1,957 + 3 skipped episodes), VNDB API (99 + 92 skipped),
  0 failed records. IMDb entries were then bulk-marked Completed in "historical" mode (no date, no activity).
- Metadata: AniList (manga covers confirmed in the UI), MAL fallback, TVMaze, TMDB (after token fix) and IGDB
  secrets configured; `metadata-proxy` Edge Function deployed (status endpoint reports all providers ready).
- Local CLI (`npm run rubaka -- …`) signed in as the owner; used to add titles (Mushoku Tensei, Re:Zero LNs).

## Implemented, verified by automated tests and build only

- Library UI: dashboard, category pages (tabs incl. Planning/Wishlist, 14 sorts, filters incl. airing/publishing
  status, URL state, 3 views, infinite list, scroll restore, bulk actions with "Completed — earlier, date unknown",
  select all matching), poster cards, quick actions, star rating, detail page (tracking, seasons, VN routes,
  history/sessions, relations, notes with autosave), metadata editor with locked fields, quick cover drop/paste,
  Add Media (online + custom), import wizard + history, enrichment queue + review, statistics, settings,
  export JSON/CSV, restore (merge/replace), delete library.
- Franchises (migration 12): groups across every category — auto-detect from AniList/VNDB relations
  (incl. via external ids), TMDB movie collections, IGDB game franchises/collections; manual create/rename/
  add/remove (hand removals are locked); Franchises page, franchise page, chip on every title page.
- Public read-only share link (Settings → Share): `/u/<token>`, per-category visibility, optional ratings;
  definer RPCs expose no notes/reviews/history/wishlist; regenerate or turn off at any time.
- Visible "+1" next to the progress bar on cards of titles being followed; reaching a known total completes
  the title (toast with Undo); light novels tracked by volume step volumes.
- Image uploads are shrunk to WebP in the browser before upload (not yet exercised live).
- Tests: 68 passing (database tests on the real migrations in PGlite incl. RLS, unit tests); 5 opt-in live tests.

## TODO

- Telegram bot: send a Shikimori / MAL / VNDB link → the title is added to the library (Edge Function
  webhook, owner's chat id whitelisted, bot token in Supabase secrets).

## Known issues / remaining

- 2 anime from the MAL import were deleted afterwards (MAL 59012, 51685) — owner to confirm intent.
- 1,096 IMDb entries are Completed but still flagged Wishlist (owner chose "Planning + Wishlist" on import) —
  awaiting owner decision; nothing removed automatically.
- Light novels inside the MAL manga list: category suggestions waiting in Import → Metadata → Needs review.
- Backloggd (Toolkittd JSON) adapter not yet run on the owner's real file.
- Russian localization not started (labels centralized in `src/lib/categories.ts`).
- Lint: 1 warning (React Compiler skips `CustomMediaForm` because of react-hook-form `watch()`).

## Required configuration

| What | Where | Status |
|---|---|---|
| Supabase URL + publishable key | `.env.local`, GitHub Actions secrets | set |
| Owner user id | `app_private.owner` | set |
| TMDB / Twitch / MAL secrets | Supabase Edge Function secrets | set |

## Deployment

GitHub Pages via `.github/workflows/deploy.yml` — see README §4.
