# Import mappings

Mappings were written after inspecting the owner's real exports (October 2026). Every source row is stored in `import_records.raw`, so nothing is lost even when a field is not mapped.

## MyAnimeList — XML export (`animelist_*.xml.gz`, `mangalist_*.xml.gz`, format 1.1.0)

The export is XML (gzip), not JSON. `.gz` files are unpacked in the browser.

| MAL field | RUBAKA | Notes |
|---|---|---|
| `series_animedb_id` / `manga_mangadb_id` | external id `mal_anime` / `mal_manga` | duplicate-prevention key |
| `series_title` / `manga_title` | `media.title` | English/Japanese titles come from AniList enrichment |
| `series_type` | `media.format` | TV→tv, OVA, ONA, Movie, Special/TV Special→special, Music; CM/PV/Unknown→other. Manga exports have no type: filled by AniList (manhwa/manhua from country, light novels suggested for the Novels category) |
| `series_episodes`, `manga_chapters`, `manga_volumes` | totals | `0` = unknown → NULL. If your progress exceeds the MAL total, progress is kept and the total is left unknown (warning in the report) |
| `my_status` | `status` | Watching/Reading→in_progress, Completed, On-Hold, Dropped, Plan to Watch/Read→planning. Numeric codes 1/2/3/4/6 are also accepted |
| `my_score` | `rating` | 1–10 = half-stars (MAL 7 = 3.5★). `0` = not scored → NULL (never 0★) |
| `my_watched_episodes`, `my_read_chapters`, `my_read_volumes` | progress | |
| `my_start_date`, `my_finish_date` | `start_date`, `completion_date` | `0000-00-00` → NULL; partial dates (`2019-05-00`) are not imported (warning). Finish before start → finish dropped |
| `my_times_watched` / `my_times_read` | `imported_repeat_count` | undated repeats; no sessions are invented |
| `my_rewatching`=1 / `my_rereading`=YES | an active rewatch/reread session | |
| `my_comments` | `notes` | |
| `my_tags` | appended to notes | empty in the real export |
| `my_priority`, `my_storage`, `my_discuss`, `my_sns`, `update_on_import` | not mapped | priority is always LOW in the export |

Option: *Plan to Watch → Planning only* (default) or *Planning + Wishlist*.

Observed in the real files: anime 3,605 rows (header 3,605), manga 721 rows (header claims 723 — the preview shows the difference), 3 manga with progress above MAL totals, almost no dates.

## IMDb — list / watchlist / ratings CSV

Columns: `Position, Const, Created, Modified, Description, Title, Original Title, URL, Title Type, IMDb Rating, Runtime (mins), Year, Genres, Num Votes, Release Date, Directors, Your Rating, Date Rated`.

| IMDb field | RUBAKA | Notes |
|---|---|---|
| `Const` (tt…) | external id `imdb` | key; rows without it are invalid |
| `Title`, `Original Title` | title / original title | |
| `Title Type` | category + format | Movie, TV Movie, Video, Short, TV Short, TV Special → Movies. TV Series / Mini Series → TV Series, or (with the Animation genre) Animated Series — flagged for review, option to send them to Anime instead. TV Episode → skipped by default (can be included) |
| `Year`, `Release Date` | `release_year`, `release_date` | partial dates (`1998-11`) keep only the year |
| `Genres` | genres | |
| `Runtime (mins)` | `runtime` (movies) / `episode_duration` (series) | informational only |
| `Directors` | `details.directors` | |
| `IMDb Rating` | `details.imdb_rating` | |
| `Your Rating` | `rating` | 1–10 = half-stars (8 → 4★) |
| `Created` | `added_at` | date the title was added to the list |
| `Date Rated` | not mapped | it is the rating date, not a watch date |
| `Position`, `Modified`, `Description`, `Num Votes` | not mapped | |

IMDb has **no watch status and no watch dates**. Options: rated titles → Completed (default) or Planning; unrated → Planning (default), Planning + Wishlist, or Completed.

Real file: 1,960 rows, 861 rated; 1,811 movie-type, 85 TV series, 64 animated series, 3 episodes.

## Backloggd — Toolkittd JSON

Format from the Toolkittd source (`entrypoints/backloggd.content/shared/types/api.ts`): array of `{ id, name, most_recent_playthrough_id, playthroughs: {id: Playthrough}, game_log? }`. To be re-verified against the owner's real file.

| Field | RUBAKA | Notes |
|---|---|---|
| `id` | external id `backloggd` | |
| `name` | title | metadata from IGDB enrichment |
| `game_log.is_playing` / `is_play` / `is_backlog` | status | playing → in_progress, played → Completed (option: On Hold / Dropped — the played sub-status is not in the export), backlog → planning |
| `game_log.is_wishlist` | wishlist | independent of status |
| `game_log.game_liked` | favorite | |
| `game_log.rating` | rating | scale auto-detected (1–10 or 0.5–5), can be overridden |
| first non-replay playthrough | start/completion dates, review | |
| `is_replay` playthroughs | replay sessions | finished → completed (counted); unfinished → active if currently playing, otherwise kept as *abandoned* (not counted) |
| hours/minutes, `play_dates`, platform ids | not mapped | RUBAKA does not track play time |
| no `game_log` | invalid ("not logged") | recorded in the report |

## Conflicts with existing titles

Matching is by external id only. Same-title records without a shared id are shown as *possible duplicates* and imported as new unless you choose “Merge into …”.

Policies for existing titles: **Merge** (default — fill empty fields only), **Keep existing**, **Use imported** (overwrite conflicting fields), **Skip**; each conflicting field can also be toggled per entry.
