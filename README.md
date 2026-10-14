# Listening

A private, server-rendered view of a Spotify listening archive. A Supabase Edge Function collects new plays; Python reconciles historical exports and enriches metadata. The web application is Next.js and reads from Supabase Postgres through a dedicated read-only role.

## Architecture

- The production tracker runs as `supabase/functions/spotify-sync` every two minutes through Supabase Cron, with a daily recovery scan. Scheduled calls were verified on 14 October 2026 before removing the GitHub tracker schedule. At the owner's request, GitHub Actions was then disabled for this repository, including CI, manual tracker runs and metadata enrichment. Workflow files remain for reference; re-enable repository Actions before using them. The same track/time matching is used by both providers and the export importer.
- `ingest/import_history.py` backfills a Spotify "Extended Streaming History" export.
- `db/migrations/` owns the database schema, permissions, indexes and analytics rollups.
- `ingest/migrate.py` applies forward-only, checksummed migrations.
- `app/`, `components/` and `lib/` contain the Next.js web tier.

### Two sources, one timeline

The export timestamps a stream to the second; the API includes milliseconds.
Both ingestion paths use `ingest/storage.py`, matching the same track within
three seconds under one advisory transaction lock. The second source enriches
the existing row with metadata and actual export listening duration.

Migration `0013` replaces timestamp-only uniqueness with `(played_at, spotify_id)`.
Different tracks in an offline batch can share a timestamp and must survive.

`python3 ingest/audit.py` reconciles a local export and currently available API
history, writing a gitignored `TRACKER_AUDIT.json`. Any unmatched eligible entry is reported
as missing; sharing another track's timestamp is diagnostic, not an excuse to
ignore a missing play. Multiple export entries inside the same three-second
identity window can match one database row, so this is not a one-to-one count.

The web process uses `WEB_DB_URI`; it never needs the writer connection. Historical aggregates are refreshed by seven staggered, non-blocking Supabase Cron jobs. Realtime-facing totals refresh every five minutes; larger entity and detail summaries refresh every 15–60 minutes. Recent plays continue to come directly from the indexed base table.

## Local development

```bash
npm install
npm run dev
```

`npm run dev` is for active development. For normal daily use, run the stable production server without HMR:

```bash
npm run preview
```

Then open `http://127.0.0.1:3000`.

Required environment values are documented in `.env.example`. Access is a sign-in
form at `/login` that sets an HMAC-signed, `httpOnly` cookie; `middleware.ts`
verifies the signature, the username and the token age on every request, so a
stored token stops working after 30 days even if the cookie survives. Failed
sign-ins are rate limited to 10 attempts per 15 minutes per address. A Vercel
deployment fails closed when `SITE_PASSWORD` is missing.

Apply database migrations with:

```bash
python3 ingest/migrate.py
```

Provision or rotate the local read-only web login with:

```bash
python3 ingest/provision_web_reader.py
```

The generated URI is written only to the gitignored `.env` file.

Backfill a Spotify export — the JSON archive is roughly 180 MB and is deliberately
kept out of the repository, so pass its location:

```bash
python3 ingest/import_history.py ~/Downloads/my_spotify_data
```

## Deployment

Vercel functions are pinned to Tokyo (`hnd1`) in `vercel.json` to match the
Supabase region; from another region the pooler round trip dominates every page.

Set these environment variables on Vercel. `WEB_DB_URI` is the read-only role, and
the writer URI is deliberately absent — the web tier never needs it.

| Variable | Purpose |
| --- | --- |
| `WEB_DB_URI` | Read-only Supabase connection for the web tier |
| `SITE_PASSWORD` | Sign-in password and cookie signing key. **Missing means every route answers 503** |
| `SITE_USERNAME` | Sign-in user (defaults to `listener`) |
| `SPOTIFY_WEB_REDIRECT_URI` | Optional. Enables the in-app private playlist export |
| `SPOTIFY_REFRESH_TOKEN` | Now Playing. `.cache` is gitignored, so this is the only source on Vercel |
| `SPOTIPY_CLIENT_ID` | Exchanging the refresh token |
| `SPOTIPY_CLIENT_SECRET` | Exchanging the refresh token |

Artwork is served straight from Spotify's CDN (`images.unoptimized` in
`next.config.ts`). The covers already arrive at a suitable display resolution;
routing a large archive through Vercel's optimizer can exhaust its source-image
allowance without a meaningful saving.

If GitHub Actions is re-enabled, the manual fallback workflow needs `DB_URI`, `SPOTIPY_CLIENT_ID`, `SPOTIPY_CLIENT_SECRET`
and `SPOTIPY_CACHE` as GitHub Actions secrets. Normal runs scan until two pages
overlap the newest Supabase record. Supabase Cron runs a daily recovery scan at
03:15 UTC (06:15 Istanbul), attempting up to 20 pages across a seven-day lookback
window. A manual workflow run can enable the same recovery mode with its
`recovery` input. GitHub CI and scheduled metadata enrichment are currently disabled.
Run checks locally and use `metadata_backfill.py` / `ingest/track_artists.py` manually
when historical metadata needs reconciliation. The Edge Function already saves
album artwork, track duration, catalogue IDs and every credited artist returned
with each new play; it does not fetch artist genres for the historical archive.

### Production polling contract

- Poll every two minutes with `limit=50`. This is a page limit, not 50 new database
  rows per run. Existing plays are reconciled instead of counted twice.
- Start from the latest available page without an `after` filter. Comparing only
  against the latest recorded timestamp can miss offline plays uploaded later
  with older playback timestamps.
- Follow Spotify's `before` cursor. Normal runs stop after two pages overlap the
  database watermark; all runs stop at the lookback boundary, an empty or stalled
  page, or 20 pages. The page cap limits requests, not guaranteed recoverable history.
- Keep a daily recovery scan at 06:15 Istanbul, ignoring the watermark shortcut.
  It uses the same bounded lookback and cannot restore history Spotify withholds.
- Use Extended Streaming History imports for older gaps and measured listening
  duration. The Web API supplies track length, not actual time listened or complete
  skip/privacy flags.

Spotify's response includes a `before` cursor and `next` URL, but live validation
for this account currently returns an empty second page after the newest 50
plays. The tracker follows the cursor and will use additional pages whenever
Spotify exposes them, but it cannot recover history the Web API withholds. The
Extended Streaming History export remains the authoritative fallback for those
older offline plays.

The sync bounds are configurable without code changes:

| Variable | Default | Purpose |
| --- | ---: | --- |
| `SPOTIFY_SYNC_LOOKBACK_DAYS` | `7` | Rolling window searched for late offline plays |
| `SPOTIFY_SYNC_MAX_PAGES` | `20` | Hard request cap; 20 pages cover up to 1,000 plays |
| `SPOTIFY_SYNC_OVERLAP_PAGES` | `2` | Pages scanned past the current database watermark during normal runs |
| `SPOTIFY_SYNC_FORCE_RECOVERY` | `false` | Ignore the watermark shortcut and scan the full rolling window |

## Verification

```bash
npm run lint
npm run typecheck
npm run build
python3 -m py_compile tracker.py metadata_backfill.py token_al.py ingest/*.py
```

`.env.example` documents every required value. `SITE_PASSWORD` gates the local
site too, so leaving it empty is the only way to browse without signing in
during development.

The web tests cover token expiry, tampering, username mismatch, future-dated
tokens and the shared calendar-range helper:

```bash
npm test
python3 -m unittest discover -s tests
```

Both suites, plus lint, types and a production build, run in GitHub Actions on
every push and pull request (`.github/workflows/ci.yml`).

`GET /api/health` reports the Vercel function region, a measured database
round-trip and tracker status. Signed-in requests also receive the last
successful tracker run, last recorded play and archive total. A reachable database is not evidence that ingestion still works,
so `tracker` is reported separately and the response drops to `207` when the
last successful run is over 90 minutes old. The last play is deliberately not
used as a health signal: a quiet listening day is not a broken tracker.
Server functions are pinned to Tokyo (`hnd1`) in `vercel.json`, matching the
current Supabase project.

The same signals are shown to a person at `/sync`, together with the last 20
tracker runs, so a silent GitHub Actions outage becomes visible in the UI rather
than only in the workflow log.

## Backup and restore

The pre-migration custom-format dump is kept in the gitignored `backups/` directory. Inspect it with `pg_restore --list` before relying on it. Restore into a fresh database first; do not test a restore over production.

## Archive features

- **Wrapped** (`/wrapped`): an estimated yearly recap, opening on the current year, separate from
  free calendar ranges. See the artist-credit and Wrapped methodology below.
- **Discover** (`/discover`): forgotten favorites, monthly highlights, rising/new
  artists, returning albums and a month picker for the musical time machine.
- Monthly notes are stored in Postgres. Existing library saved filters remain
  available; `/` or Cmd/Ctrl+K opens search outside text inputs.
- Playlist export previews the selection before creating a private Spotify playlist.
  To enable it, register `https://YOUR_HOST/api/spotify/callback` in the Spotify
  app dashboard and set exactly the same `SPOTIFY_WEB_REDIRECT_URI` on the web
  deployment. Then use Connect Spotify once to grant playlist permission.
  Tracker credentials alone do not grant playlist-write permission.
- Actual listening minutes use export `ms_played`; track duration is stored
  separately and is never presented as measured listening time.

Metadata enrichment runs separately every night. It first copies known metadata
between plays of the same track, then fetches up to 2,000 missing track records
within a time budget. Batch APIs are used when supported; Development Mode
restrictions trigger single-item fallback. API failures do not stop ingestion.
Genre and mood labels are approximate metadata, not audio analysis.

### Wrapped stories and deeper insights

Wrapped now includes an album-cover collage, archive-year picker, artist podium,
five keyboard-accessible story cards and a local PNG download. Recaps use the
explicitly estimated Wrapped window; free date selection remains in the archive. Downloads do not
upload or automatically share listening data.

Insights adds 30/90/365-day windows for streaks, artists first seen in the archive,
repeat-play share, top-five artist concentration, six-hour listening windows,
busiest day and measured export minutes. These metrics use the same Istanbul
calendar boundaries. The existing charts below retain their explicitly labelled
lifetime/calendar ranges. A streak is consecutive recorded days inside the
selected window; discovery means first seen in this archive, not necessarily
first ever heard by the listener.

### Artist credits and Wrapped estimates

Normal home/library rankings credit each catalogue artist in full; total plays
still count each listening event once. Artist filters and detail pages include
collaborations. Missing catalogue credits fall back to the recorded artist.

Wrapped opens on the current year (2026 today) and ranks artists by plays only.
Each credited artist receives one full play; overall totals count each listen
once. It uses one query for rankings and monthly activity and reads live data on every
server render. Its counts include the same recorded plays as Library’s View all
links, including private listening. The year picker navigates immediately, and
Refresh fetches the latest database values without changing the year.
Overview opens with the last 30 days selected.

Wrapped's 1 January–12 November window is an estimate: Spotify publishes
mid-November, not a specific cutoff day. The current year ends at today until
that cutoff. Older years remain selectable. This recap does not claim to
reproduce Spotify's proprietary artist or album rankings; free date selection
remains available in Overview and Library.

Apply migration 0015 before deploying this version, then restore privacy flags:

```sh
python3 ingest/migrate.py
python3 ingest/backfill_privacy.py
```

Wrapped and normal archive browsing include the same private and short API
records. Wrapped is a yearly archive recap, not a reproduction of Spotify’s
privacy/content filters. Export import still admits music records >=30s; known
short API records remain in the archive with their measured duration. The archive stores eligible
music plays, so its duration subtotal cannot reproduce official total minutes
(which also include short plays and other content). Taste Profile exclusions
and Spotify's content filters cannot be reconstructed from this archive.

Regression and read-only integration checks:

```sh
MUSIC_TEST_DATABASE=1 node --env-file=.env scripts/test-analytics.cjs
node --env-file=.env scripts/verify-analytics.cjs
```

The SQL regression test only writes temporary tables. For local screenshot
comparison use `python3 scripts/audit-wrapped.py --help`; keep personal reference
files and reports inside the gitignored `reports/` directory.

## Supabase tracker deployment

The Edge Function uses the existing project's included function quota: 21,600
normal invocations per 30 days plus 30 daily recovery calls. No new project or
paid service is created. The tracker uses TypeScript and a single short-lived
Postgres connection. Spotify credentials and the 384-bit trigger credential
are stored in Supabase Vault; the function has no anonymous write path.

Setup order:

```sh
python3 ingest/migrate.py
python3 ingest/supabase_tracker.py --configure
# Deploy spotify-sync from supabase/functions/spotify-sync with Supabase CLI
# or use scripts/bundle-edge.py to prepare one Dashboard editor file.
python3 scripts/bundle-edge.py
python3 ingest/supabase_tracker.py --activate
```

Activation checks absent/invalid auth, a read-only dry run and two live calls
before creating cron schedules. Observe at least two scheduled successful runs
before removing the schedule block in .github/workflows/main.yml. The repository's
Actions are now disabled; its manual workflow and metadata/CI definitions are
retained only for a future opt-in fallback.

The handler uses a 150-second expiring lease and the Python writer's advisory
transaction lock. Duplicate/rounded timestamps of the same track are reconciled;
different offline tracks at the same timestamp survive. API writes preserve
export listening duration, privacy and skip flags. All catalogue artists in the
track response are saved immediately. Rotated refresh tokens are persisted in
Vault. Failures carry sanitized diagnostics into music_sync_runs; a missing
Supabase heartbeat for ten minutes makes the web status show a delay.

Only new Supabase run/cron diagnostics are retained for 14 days to keep the free
project's storage bounded. Listening history is never deleted by that job.

Checks:

```sh
deno check --config supabase/functions/spotify-sync/deno.json supabase/functions/spotify-sync/index.ts
deno test --config supabase/functions/spotify-sync/deno.json --allow-env supabase/functions/spotify-sync/core_test.ts
MUSIC_TEST_DATABASE=1 deno test --config supabase/functions/spotify-sync/deno.json --env-file=.env --allow-env --allow-net supabase/functions/spotify-sync/storage_test.ts
```

The SQL test writes only temporary tables. Its fixtures never enter the archive.
