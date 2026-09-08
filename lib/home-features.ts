import "server-only";

import type { ChartPoint, EntityItem, RecentPlay } from "@/lib/data";
import { sql } from "@/lib/db";
import { calendarRange, PERIOD_DAYS } from "@/lib/periods";

export const HOME_PERIODS = ["7d", "30d", "90d", "180d", "365d", "all", "custom", "wrapped"] as const;
export type HomePeriod = (typeof HOME_PERIODS)[number];

export type HomePeriodData = {
  period: HomePeriod;
  start: string;
  end: string;
  archiveTotalPlays: number;
  archiveFirstPlay: string | null;
  totalPlays: number;
  artists: number;
  albums: number;
  tracks: number;
  topArtists: EntityItem[];
  topAlbums: EntityItem[];
  topTracks: EntityItem[];
  recent: RecentPlay[];
  activity: ChartPoint[];
  activityUnit: "day" | "month" | "year";
};

type HomePeriodRow = {
  start_day: string;
  end_day: string;
  archive_total_plays: string;
  archive_first_play: string | null;
  total_plays: string;
  artists: string;
  albums: string;
  tracks: string;
  top_artists: EntityItem[];
  top_albums: EntityItem[];
  top_tracks: EntityItem[];
  recent: RecentPlay[];
  activity: ChartPoint[];
};

export function parseHomePeriod(value: string | undefined): HomePeriod {
  return HOME_PERIODS.includes(value as HomePeriod) ? value as HomePeriod : "30d";
}

function dayDistance(start: string, end: string) {
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

async function loadHomePeriodData(
  period: HomePeriod,
  requestedStart: string,
  requestedEnd: string,
): Promise<HomePeriodData> {
  const range = calendarRange(period, requestedStart, requestedEnd);
  period = range.period;
  const customStart = range.start ?? range.end;
  const customEnd = range.end;
  const span = (period === "custom" || period === "wrapped")
    ? dayDistance(customStart, customEnd) + 1
    : PERIOD_DAYS[period as keyof typeof PERIOD_DAYS] ?? 3_650;
  const activityUnit: HomePeriodData["activityUnit"] = period === "all" || span > 730
    ? "year"
    : span > 60 ? "month" : "day";
  const bucket = activityUnit === "day"
    ? sql`date_trunc('day', played_at AT TIME ZONE 'Europe/Istanbul')`
    : activityUnit === "month"
      ? sql`date_trunc('month', played_at AT TIME ZONE 'Europe/Istanbul')`
      : sql`date_trunc('year', played_at AT TIME ZONE 'Europe/Istanbul')`;
  const bucketLabel = activityUnit === "day"
    ? sql`to_char(bucket, 'DD Mon')`
    : activityUnit === "month"
      ? sql`to_char(bucket, 'Mon YY')`
      : sql`to_char(bucket, 'YYYY')`;


  const [row] = await sql<HomePeriodRow[]>`
    WITH bounds AS (
      SELECT
        CASE
          WHEN ${period} = 'all' THEN COALESCE(
            (SELECT min((played_at AT TIME ZONE 'Europe/Istanbul')::date) FROM public.scrobbles),
            (now() AT TIME ZONE 'Europe/Istanbul')::date
          )
          ELSE ${customStart}::date
        END AS start_day,
        CASE
          WHEN ${period} = 'custom' THEN ${customEnd}::date
          ELSE (now() AT TIME ZONE 'Europe/Istanbul')::date
        END AS end_day
    ),
    filtered AS MATERIALIZED (
      SELECT s.*
      FROM public.scrobbles s
      CROSS JOIN bounds
      WHERE s.played_at >= bounds.start_day::timestamp AT TIME ZONE 'Europe/Istanbul'
        AND s.played_at < (bounds.end_day + 1)::timestamp AT TIME ZONE 'Europe/Istanbul'
    ),
    totals AS (
      SELECT
        count(*)::bigint AS total_plays,
        count(DISTINCT artist_name)::bigint AS artists,
        count(DISTINCT coalesce(album_id, album_name || E'\x1f' || artist_name))::bigint AS albums,
        count(DISTINCT coalesce(spotify_id, track_name || E'\x1f' || artist_name))::bigint AS tracks
      FROM filtered
    ),
    archive AS (
      -- The archive-wide headline never depends on the selected period, and the
      -- totals rollup already keeps both values a few minutes fresh. Reading
      -- them here avoids a second full pass over 148k rows on every cache miss.
      SELECT total_plays::bigint AS total_plays, first_play
      FROM public.mv_music_totals
    ),
    artist_rank AS (
      SELECT artist_name AS name, count(*)::int AS plays,
        max(image_url) FILTER (WHERE image_url IS NOT NULL) AS "imageUrl",
        max(artist_id) FILTER (WHERE artist_id IS NOT NULL) AS id
      FROM filtered
      GROUP BY artist_name
      ORDER BY count(*) DESC, artist_name
      LIMIT ${period === "wrapped" ? 20 : 5}
    ),
    album_rank AS (
      SELECT album_name AS name, artist_name AS secondary, count(*)::int AS plays,
        max(image_url) FILTER (WHERE image_url IS NOT NULL) AS "imageUrl",
        max(album_id) FILTER (WHERE album_id IS NOT NULL) AS id
      FROM filtered
      WHERE album_name IS NOT NULL
      GROUP BY album_id, album_name, artist_name
      ORDER BY count(*) DESC, album_name
      LIMIT 20
    ),
    track_rank AS (
      SELECT track_name AS name, artist_name AS secondary, count(*)::int AS plays,
        max(image_url) FILTER (WHERE image_url IS NOT NULL) AS "imageUrl",
        max(spotify_id) FILTER (WHERE spotify_id IS NOT NULL) AS id
      FROM filtered
      GROUP BY spotify_id, track_name, artist_name
      ORDER BY count(*) DESC, track_name
      LIMIT 20
    ),
    activity_counts AS (
      SELECT ${bucket} AS bucket, count(*)::int AS value
      FROM filtered
      GROUP BY 1
      ORDER BY 1
    ), activity AS (
      SELECT series.bucket, coalesce(counts.value, 0) AS value FROM bounds,
      LATERAL generate_series(date_trunc(${activityUnit}, bounds.start_day::timestamp),
        date_trunc(${activityUnit}, bounds.end_day::timestamp),
        ('1 ' || ${activityUnit})::interval) AS series(bucket)
      LEFT JOIN activity_counts counts ON counts.bucket = series.bucket
    )
    SELECT
      bounds.start_day::text,
      bounds.end_day::text,
      archive.total_plays::text AS archive_total_plays,
      archive.first_play::text AS archive_first_play,
      totals.total_plays::text,
      totals.artists::text,
      totals.albums::text,
      totals.tracks::text,
      COALESCE((SELECT json_agg(artist_rank ORDER BY plays DESC, name) FROM artist_rank), '[]'::json) AS top_artists,
      COALESCE((SELECT json_agg(album_rank ORDER BY plays DESC, name) FROM album_rank), '[]'::json) AS top_albums,
      COALESCE((SELECT json_agg(track_rank ORDER BY plays DESC, name) FROM track_rank), '[]'::json) AS top_tracks,
      COALESCE((
        SELECT json_agg(item ORDER BY item."playedAt" DESC)
        FROM (
          SELECT track_name AS "trackName", artist_name AS "artistName",
            played_at::text AS "playedAt", image_url AS "imageUrl", spotify_id AS "spotifyId"
          FROM public.scrobbles
          ORDER BY played_at DESC
          LIMIT 10
        ) item
      ), '[]'::json) AS recent,
      COALESCE((SELECT json_agg(json_build_object('label', ${bucketLabel}, 'value', value) ORDER BY bucket) FROM activity), '[]'::json) AS activity
    FROM bounds
    CROSS JOIN totals
    CROSS JOIN archive
  `;

  if (!row) throw new Error("The selected listening period could not be loaded");

  return {
    period,
    start: row.start_day,
    end: row.end_day,
    archiveTotalPlays: Number(row.archive_total_plays),
    archiveFirstPlay: row.archive_first_play,
    totalPlays: Number(row.total_plays),
    artists: Number(row.artists),
    albums: Number(row.albums),
    tracks: Number(row.tracks),
    topArtists: row.top_artists ?? [],
    topAlbums: row.top_albums ?? [],
    topTracks: row.top_tracks ?? [],
    recent: row.recent ?? [],
    activity: row.activity ?? [],
    activityUnit,
  };
}

export function getHomePeriodData(period: HomePeriod, start = "", end = "") {
  // Listening data is append-only and the home route is explicitly dynamic.
  // Keeping this behind unstable_cache made a hard reload and an App Router
  // navigation disagree: the latter could reuse a prefetched, minute-old RSC
  // payload. Always run the query for the request instead.
  return loadHomePeriodData(period, start, end);
}
