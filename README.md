# RUBAKA — Personal Media Backlog

A private, single-user media library for anime, manga, novels, visual novels, movies, TV series, animated series and games — inspired by Backloggd.

**Author:** RUBAKA · © 2026 RUBAKA

React + TypeScript + Vite + Tailwind on the frontend (static, GitHub Pages), Supabase (Postgres, Auth, RLS, Storage, one Edge Function) on the backend. No always-running server.

---

## 1. Supabase setup (once)

1. Create a free project at [supabase.com](https://supabase.com) (pick a region near you).
2. **Database:** Dashboard → *SQL Editor* → *New query* → paste the whole of [`supabase/setup.sql`](supabase/setup.sql) → *Run*.
   (Alternatively with the CLI: `npx supabase link --project-ref <ref>` then `npx supabase db push`.)
3. **Your account:** *Authentication → Users → Add user → Create new user* — your email + a strong password, tick *Auto Confirm User*.
4. **Disable sign-ups:** *Authentication → Sign In / Providers* → turn off *Allow new users to sign up*.
   (Even if someone signs up, RLS gives them nothing: only the owner below can read or write.)
5. **Make yourself the owner:** copy your user id from *Authentication → Users*, then in the SQL Editor:
   ```sql
   insert into app_private.owner (user_id) values ('YOUR-USER-ID');
   ```
   (If you skip this, the app shows this exact SQL with your id after you sign in.)
6. **Keys for the app:** *Project Settings → API* (Data API / API Keys): copy the **Project URL** and the **anon / publishable** key.
   Never use the `service_role` / secret key in the app.

## 2. Run locally

```bash
npm install
# put the two values from step 6 into .env.local:
#   VITE_SUPABASE_URL=https://xxxx.supabase.co
#   VITE_SUPABASE_ANON_KEY=...
npm run dev        # http://localhost:5173
```

Sign in, then open **Import** to load your MyAnimeList (`.xml.gz` as downloaded), IMDb (`.csv`) and Backloggd (Toolkittd `.json`) exports. After importing, open **Import → Metadata → Start** to fetch posters, synopses, genres and totals.

## 3. Metadata providers

| Provider | Used for | Key |
|---|---|---|
| AniList | anime, manga, light novels (incl. lookup by MAL id) | none |
| VNDB | visual novels | none |
| TVMaze | TV & animated series (incl. lookup by IMDb id) | none |
| Open Library | novels | none |
| TMDB | **movies** (posters, synopses), TV fallback | `TMDB_READ_TOKEN` (free) |
| IGDB | games | `TWITCH_CLIENT_ID` + `TWITCH_CLIENT_SECRET` (free) |
| MyAnimeList API v2 | fallback for anime/manga AniList does not know | `MAL_CLIENT_ID` (free, optional) |

TMDB and IGDB secrets live **only** in Supabase, behind the `metadata-proxy` Edge Function (it checks that the caller is the owner and forwards only whitelisted read-only requests):

1. TMDB: [themoviedb.org](https://www.themoviedb.org) → *Settings → API* → copy the **API Read Access Token**.
2. IGDB: [dev.twitch.tv/console](https://dev.twitch.tv/console) → *Register Your Application* (OAuth redirect `http://localhost`, category *Application Integration*) → copy **Client ID**, create a **Client Secret**.
3. MAL (optional): [myanimelist.net/apiconfig](https://myanimelist.net/apiconfig) → *Create ID* (App Type *web*, any redirect URL) → copy the **Client ID**.
4. Deploy the function and set secrets — either in the Dashboard (*Edge Functions → Deploy a new function → Via editor*, name `metadata-proxy`, paste [`supabase/functions/metadata-proxy/index.ts`](supabase/functions/metadata-proxy/index.ts); then *Edge Functions → Secrets*), or with the CLI:
   ```bash
   npx supabase functions deploy metadata-proxy --project-ref <ref>
   npx supabase secrets set TMDB_READ_TOKEN=... TWITCH_CLIENT_ID=... TWITCH_CLIENT_SECRET=... MAL_CLIENT_ID=... --project-ref <ref>
   ```
Settings → *Metadata providers* shows whether each one is ready.

## 4. Deploy to GitHub Pages

1. Push this folder to a GitHub repository.
2. *Settings → Secrets and variables → Actions*: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (public values).
3. *Settings → Pages → Source: GitHub Actions*.
4. Push to `main` — [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) type-checks, lints, tests, builds and deploys. Deep links work through a `404.html` SPA fallback.
5. In Supabase *Authentication → URL Configuration*, set *Site URL* to `https://<user>.github.io/<repo>/`.

## 5. Development

```bash
npm run typecheck   # TypeScript
npm run lint        # ESLint
npm test            # unit tests + database tests (real migrations in PGlite, incl. RLS)
npm run build       # production build in dist/
node scripts/build-setup-sql.mjs   # regenerate supabase/setup.sql after changing migrations
```

Optional: `RUBAKA_REAL_EXPORTS=C:/path/to/exports npm test` also parses your real export files (read-only).

## Design notes

- **Metadata vs personal data:** `media*` tables hold metadata; `library_entries` and friends hold your status, rating, progress, notes.
- **Ratings** are integer half-stars 0–10; NULL = unrated, 0 = an explicit 0★.
- **Unknown totals** are NULL, never 0; progress may not exceed a *known* total.
- **Repeats** (rewatch/reread/replay) never change the Completed status; only completed sessions count. Imported counts without dates are kept as an "undated" number.
- **Wishlist** is a flag per entry, independent of status, so each category has its own wishlist.
- **Imports** are idempotent (matched by external ids), resumable, and every source row is kept in `import_records`. See [docs/IMPORT_MAPPING.md](docs/IMPORT_MAPPING.md).
- **Enrichment** fills empty fields only and never touches fields you edited or custom covers.
- **Backups:** Settings → Export (JSON / CSV) and Restore (preview, merge or replace).

Created by RUBAKA © 2026
