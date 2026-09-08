import "server-only";

import { unstable_cache } from "next/cache";

import { sql } from "@/lib/db";

export type EntityItem = {
  name: string;
  secondary?: string | null;
  plays: number;
  imageUrl?: string | null;
  id?: string | null;
};

export type RecentPlay = {
  trackName: string;
  artistName: string;
  playedAt: string;
  imageUrl?: string | null;
  spotifyId?: string | null;
};

export type ChartPoint = { label: string; value: number };

type InsightRow = {
  hourly: Array<{ label: string; value: number }>;
  weekdays: Array<{ label: string; value: number }>;
  monthly: Array<{ label: string; value: number }>;
  heatmap: Array<{ date: string; value: number }>;
};

async function loadInsightsData() {
    const [row] = await sql<InsightRow[]>`
      WITH hours AS (SELECT generate_series(0, 23) AS hour),
      weekdays(day_number, label) AS (
        VALUES (1, 'Mon'), (2, 'Tue'), (3, 'Wed'), (4, 'Thu'),
               (5, 'Fri'), (6, 'Sat'), (7, 'Sun')
      ),
      months AS (
        SELECT generate_series(
          date_trunc('month', (now() AT TIME ZONE 'Europe/Istanbul')) - interval '11 months',
          date_trunc('month', (now() AT TIME ZONE 'Europe/Istanbul')),
          interval '1 month'
        ) AS month
      ),
      days AS (
        SELECT generate_series(
          (now() AT TIME ZONE 'Europe/Istanbul')::date - 363,
          (now() AT TIME ZONE 'Europe/Istanbul')::date,
          interval '1 day'
        )::date AS day
      )
      SELECT
        (SELECT json_agg(json_build_object(
          'label', lpad(hours.hour::text, 2, '0'),
          'value', COALESCE(counts.plays, 0)
        ) ORDER BY hours.hour)
        FROM hours
        LEFT JOIN (
          SELECT hour::int AS hour, plays::int AS plays
          FROM public.mv_music_hour_counts
        ) counts USING (hour)) AS hourly,
        (SELECT json_agg(json_build_object(
          'label', weekdays.label,
          'value', COALESCE(counts.plays, 0)
        ) ORDER BY weekdays.day_number)
        FROM weekdays
        LEFT JOIN (
          SELECT day_number::int AS day_number, plays::int AS plays
          FROM public.mv_music_weekday_counts
        ) counts USING (day_number)) AS weekdays,
        (SELECT json_agg(json_build_object(
          'label', to_char(months.month, 'Mon'),
          'value', COALESCE(counts.plays, 0)
        ) ORDER BY months.month)
        FROM months
        LEFT JOIN (
          SELECT date_trunc('month', day::timestamp) AS month, sum(plays)::int AS plays
          FROM public.mv_music_daily_counts
          WHERE day >= date_trunc('month', (now() AT TIME ZONE 'Europe/Istanbul'))::date - interval '11 months'
          GROUP BY 1
        ) counts USING (month)) AS monthly,
        (SELECT json_agg(json_build_object(
          'date', days.day::text,
          'value', COALESCE(counts.plays, 0)
        ) ORDER BY days.day)
        FROM days
        LEFT JOIN (
          SELECT day, plays::int AS plays
          FROM public.mv_music_daily_counts
          WHERE day >= (now() AT TIME ZONE 'Europe/Istanbul')::date - 363
        ) counts USING (day)) AS heatmap
    `;

    if (!row) {
      throw new Error("The listening insights snapshot is unavailable");
    }

    return {
      hourly: row.hourly ?? [],
      weekdays: row.weekdays ?? [],
      monthly: row.monthly ?? [],
      heatmap: row.heatmap ?? [],
    };
}

// Key bumped because the heatmap window changed from 84 to 364 days.
const getCachedInsightsData = unstable_cache(loadInsightsData, ["insights-v5"], {
  revalidate: 300,
  tags: ["listening-history"],
});

export async function getInsightsData() {
  return process.env.NODE_ENV === "development"
    ? loadInsightsData()
    : getCachedInsightsData();
}

export type DetailData = {
  kind: "artist" | "album" | "track";
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  totalPlays: number;
  firstPlay: string;
  lastPlay: string;
  activeDays: number;
  topItems: EntityItem[];
  recent: RecentPlay[];
  daily: ChartPoint[];
};

type DetailRow = {
  title: string;
  subtitle: string | null;
  image_url: string | null;
  total_plays: string;
  first_play: string;
  last_play: string;
  active_days: string;
  top_items: EntityItem[];
  recent: RecentPlay[];
  daily: ChartPoint[];
};

function mapDetail(kind: DetailData["kind"], row: DetailRow): DetailData {
  return {
    kind,
    title: row.title,
    subtitle: row.subtitle,
    imageUrl: row.image_url,
    totalPlays: Number(row.total_plays),
    firstPlay: row.first_play,
    lastPlay: row.last_play,
    activeDays: Number(row.active_days),
    topItems: row.top_items ?? [],
    recent: row.recent ?? [],
    daily: row.daily ?? [],
  };
}

export async function getArtistDetail(name: string): Promise<DetailData | null> {
  const [row] = await sql<DetailRow[]>`
    WITH entity AS (
      SELECT * FROM public.mv_music_artist_totals WHERE artist_name = ${name}
    )
    SELECT
      entity.artist_name AS title,
      NULL::text AS subtitle,
      entity.image_url,
      entity.plays::text AS total_plays,
      entity.first_play::text,
      entity.last_play::text,
      (SELECT count(*)::text FROM public.mv_music_artist_daily d
       WHERE d.artist_name = entity.artist_name) AS active_days,
      COALESCE((SELECT json_agg(item ORDER BY item.plays DESC) FROM (
        SELECT track_name AS name, NULL::text AS secondary, plays::int AS plays,
          image_url AS "imageUrl", spotify_id AS id
        FROM public.mv_music_track_totals
        WHERE artist_name = entity.artist_name
        ORDER BY plays DESC LIMIT 10
      ) item), '[]'::json) AS top_items,
      COALESCE((SELECT json_agg(item ORDER BY item."playedAt" DESC) FROM (
        SELECT track_name AS "trackName", artist_name AS "artistName",
          played_at::text AS "playedAt", image_url AS "imageUrl", spotify_id AS "spotifyId"
        FROM public.scrobbles
        WHERE artist_name = entity.artist_name
        ORDER BY played_at DESC LIMIT 8
      ) item), '[]'::json) AS recent,
      COALESCE((SELECT json_agg(json_build_object('label', to_char(day, 'DD Mon'), 'value', plays) ORDER BY day) FROM (
        SELECT day, plays::int AS plays FROM public.mv_music_artist_daily
        WHERE artist_name = entity.artist_name
          AND day >= (now() AT TIME ZONE 'Europe/Istanbul')::date - 29
      ) chart), '[]'::json) AS daily
    FROM entity
  `;
  return row?.title ? mapDetail("artist", row) : null;
}

export async function getAlbumDetail(
  value: string,
  byId = false,
): Promise<DetailData | null> {
  const [row] = await sql<DetailRow[]>`
    WITH candidates AS (
      SELECT * FROM public.mv_music_album_totals
      WHERE ${byId ? sql`album_id = ${value}` : sql`album_name = ${value}`}
    ),
    entity AS (
      SELECT max(album_name) AS album_name, max(artist_name) AS artist_name,
        max(image_url) AS image_url, sum(plays) AS plays,
        min(first_play) AS first_play, max(last_play) AS last_play
      FROM candidates
    )
    SELECT
      entity.album_name AS title,
      entity.artist_name AS subtitle,
      entity.image_url,
      entity.plays::text AS total_plays,
      entity.first_play::text,
      entity.last_play::text,
      (SELECT count(DISTINCT day)::text FROM public.mv_music_album_daily
       WHERE ${byId ? sql`album_id = ${value}` : sql`album_name = ${value}`}) AS active_days,
      COALESCE((SELECT json_agg(item ORDER BY item.plays DESC) FROM (
        SELECT track_name AS name, artist_name AS secondary, plays::int AS plays,
          image_url AS "imageUrl", spotify_id AS id
        FROM public.mv_music_album_track_totals
        WHERE ${byId ? sql`album_id = ${value}` : sql`album_name = ${value}`}
        ORDER BY plays DESC LIMIT 20
      ) item), '[]'::json) AS top_items,
      COALESCE((SELECT json_agg(item ORDER BY item."playedAt" DESC) FROM (
        SELECT track_name AS "trackName", artist_name AS "artistName",
          played_at::text AS "playedAt", image_url AS "imageUrl", spotify_id AS "spotifyId"
        FROM public.scrobbles
        WHERE ${byId ? sql`album_id = ${value}` : sql`album_name = ${value}`}
        ORDER BY played_at DESC LIMIT 8
      ) item), '[]'::json) AS recent,
      COALESCE((SELECT json_agg(json_build_object('label', to_char(day, 'DD Mon'), 'value', plays) ORDER BY day) FROM (
        SELECT day, sum(plays)::int AS plays FROM public.mv_music_album_daily
        WHERE ${byId ? sql`album_id = ${value}` : sql`album_name = ${value}`}
          AND day >= (now() AT TIME ZONE 'Europe/Istanbul')::date - 29
        GROUP BY day
      ) chart), '[]'::json) AS daily
    FROM entity
  `;
  return row?.title ? mapDetail("album", row) : null;
}

export async function getTrackDetail(
  value: string,
  byId = false,
): Promise<DetailData | null> {
  const [row] = await sql<DetailRow[]>`
    WITH candidates AS (
      SELECT * FROM public.mv_music_track_totals
      WHERE ${byId ? sql`spotify_id = ${value}` : sql`track_name = ${value}`}
    ),
    entity AS (
      SELECT max(track_name) AS track_name, max(artist_name) AS artist_name,
        max(image_url) AS image_url, sum(plays) AS plays,
        min(first_play) AS first_play, max(last_play) AS last_play
      FROM candidates
    )
    SELECT
      entity.track_name AS title,
      entity.artist_name AS subtitle,
      entity.image_url,
      entity.plays::text AS total_plays,
      entity.first_play::text,
      entity.last_play::text,
      (SELECT count(DISTINCT day)::text FROM public.mv_music_track_daily
       WHERE ${byId ? sql`spotify_id = ${value}` : sql`track_name = ${value}`}) AS active_days,
      '[]'::json AS top_items,
      COALESCE((SELECT json_agg(item ORDER BY item."playedAt" DESC) FROM (
        SELECT track_name AS "trackName", artist_name AS "artistName",
          played_at::text AS "playedAt", image_url AS "imageUrl", spotify_id AS "spotifyId"
        FROM public.scrobbles
        WHERE ${byId ? sql`spotify_id = ${value}` : sql`track_name = ${value}`}
        ORDER BY played_at DESC LIMIT 12
      ) item), '[]'::json) AS recent,
      COALESCE((SELECT json_agg(json_build_object('label', to_char(day, 'DD Mon'), 'value', plays) ORDER BY day) FROM (
        SELECT day, sum(plays)::int AS plays FROM public.mv_music_track_daily
        WHERE ${byId ? sql`spotify_id = ${value}` : sql`track_name = ${value}`}
          AND day >= (now() AT TIME ZONE 'Europe/Istanbul')::date - 29
        GROUP BY day
      ) chart), '[]'::json) AS daily
    FROM entity
  `;
  return row?.title ? mapDetail("track", row) : null;
}

export async function searchEntities(query: string) {
  const term = `%${query.trim()}%`;
  if (!query.trim()) return { artists: [], tracks: [], albums: [] };

  const [row] = await sql<
    Array<{
      artists: EntityItem[];
      tracks: EntityItem[];
      albums: EntityItem[];
    }>
  >`
    SELECT
      COALESCE((SELECT json_agg(item ORDER BY item.plays DESC) FROM (
        SELECT artist_name AS name, plays::int AS plays,
          image_url AS "imageUrl", artist_id AS id
        FROM public.mv_music_artist_totals WHERE artist_name ILIKE ${term}
        ORDER BY plays DESC LIMIT 10
      ) item), '[]'::json) AS artists,
      COALESCE((SELECT json_agg(item ORDER BY item.plays DESC) FROM (
        SELECT track_name AS name, artist_name AS secondary, plays::int AS plays,
          image_url AS "imageUrl", spotify_id AS id
        FROM public.mv_music_track_totals WHERE track_name ILIKE ${term} OR artist_name ILIKE ${term}
        ORDER BY plays DESC LIMIT 20
      ) item), '[]'::json) AS tracks,
      COALESCE((SELECT json_agg(item ORDER BY item.plays DESC) FROM (
        SELECT album_name AS name, artist_name AS secondary, plays::int AS plays,
          image_url AS "imageUrl", album_id AS id
        FROM public.mv_music_album_totals
        WHERE album_name ILIKE ${term} OR artist_name ILIKE ${term}
        ORDER BY plays DESC LIMIT 10
      ) item), '[]'::json) AS albums
  `;

  return row;
}
