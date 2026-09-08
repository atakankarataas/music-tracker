import "server-only";

import { getEntityLegacyFeatures, type EntityLegacyFeatures, type LegacyEntityKind } from "@/lib/legacy-features";
import { sql } from "@/lib/db";
import type { ChartPoint } from "@/lib/data";

import { DISPLAY_TIME_ZONE } from "@/lib/periods";

export const DETAIL_PERIODS = ["7d", "30d", "90d", "180d", "365d", "all"] as const;
export type DetailPeriod = (typeof DETAIL_PERIODS)[number];

const PERIOD_DAYS: Record<Exclude<DetailPeriod, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "180d": 180,
  "365d": 365,
};

export type DetailRankedItem = {
  name: string;
  secondary: string | null;
  plays: number;
  lifetimePlays: number;
  imageUrl: string | null;
  id: string | null;
  albumId: string | null;
};

export type DetailRecentPlay = {
  trackName: string;
  artistName: string;
  albumName: string | null;
  playedAt: string;
  imageUrl: string | null;
  spotifyId: string | null;
};

export type DetailContext = {
  artistName: string;
  artistId: string | null;
  albumName: string | null;
  albumId: string | null;
};

export type DetailTrend = {
  direction: "up" | "down" | "steady" | "new";
  current: number;
  previous: number;
  percentageChange: number | null;
  comparisonDays: number;
};

export type DetailPeriodFeatures = {
  period: DetailPeriod;
  periodLabel: string;
  periodPlays: number;
  activeDays: number;
  distinctTracks: number;
  distinctAlbums: number;
  averagePerTrack: number | null;
  averagePerActiveDay: number | null;
  topItem: DetailRankedItem | null;
  topItemShare: number | null;
  peak: { label: string; plays: number } | null;
  chart: ChartPoint[];
  chartMode: "day" | "month";
  trend: DetailTrend;
  topTracks: DetailRankedItem[];
  topAlbums: DetailRankedItem[];
  albumTracks: DetailRankedItem[];
  recent: DetailRecentPlay[];
  context: DetailContext;
};

export type DetailPageFeatures = DetailPeriodFeatures & {
  lifetimePlays: number;
  legacy: EntityLegacyFeatures;
};

type RawRankedItem = {
  name: string;
  secondary: string | null;
  plays: number;
  lifetimePlays: number;
  imageUrl: string | null;
  id: string | null;
  albumId: string | null;
};

type RawDetailRow = {
  lifetime_plays: string;
  period_plays: string;
  active_days: number;
  distinct_tracks: number;
  distinct_albums: number;
  current_comparison: number;
  previous_comparison: number;
  period_start: string;
  period_end: string;
  first_local_day: string;
  chart: Array<{ bucket: string; value: number }>;
  peak: { bucket: string; plays: number } | null;
  top_tracks: RawRankedItem[];
  top_albums: RawRankedItem[];
  album_tracks: RawRankedItem[];
  recent: DetailRecentPlay[];
  context: DetailContext | null;
};

export function parseDetailPeriod(value: string | string[] | null | undefined): DetailPeriod {
  const candidate = Array.isArray(value) ? value[0] : value;
  return DETAIL_PERIODS.some((period) => period === candidate) ? candidate as DetailPeriod : "all";
}

export function decodeDetailParam(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function detailPeriodLabel(period: DetailPeriod) {
  if (period === "all") return "All time";
  return `${PERIOD_DAYS[period]} days`;
}

function roundAverage(total: number, divisor: number) {
  if (!divisor) return null;
  return Math.round((total / divisor) * 10) / 10;
}

function mapRankedItems(items: RawRankedItem[] | null | undefined): DetailRankedItem[] {
  return (items ?? []).map((item) => ({
    ...item,
    plays: Number(item.plays),
    lifetimePlays: Number(item.lifetimePlays),
  }));
}

function plainDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addUtcDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addUtcMonths(value: Date, months: number) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1));
}

function dateKey(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const dayLabelFormatter = new Intl.DateTimeFormat("en", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

const monthLabelFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
});

const peakDayFormatter = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const peakMonthFormatter = new Intl.DateTimeFormat("en", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function fillChart(
  raw: Array<{ bucket: string; value: number }>,
  mode: "day" | "month",
  start: string,
  end: string,
) {
  const values = new Map(raw.map((point) => [point.bucket.slice(0, 10), Number(point.value)]));
  const points: ChartPoint[] = [];
  let cursor = plainDate(start);
  const last = plainDate(end);
  if (mode === "month") cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));

  while (cursor <= last && points.length < 600) {
    const key = dateKey(cursor);
    points.push({
      label: mode === "day" ? dayLabelFormatter.format(cursor) : monthLabelFormatter.format(cursor),
      value: values.get(key) ?? 0,
    });
    cursor = mode === "day" ? addUtcDays(cursor, 1) : addUtcMonths(cursor, 1);
  }

  return points;
}

function peakLabel(bucket: string, mode: "day" | "month") {
  const date = plainDate(bucket);
  return mode === "day" ? peakDayFormatter.format(date) : peakMonthFormatter.format(date);
}

function mapTrend(current: number, previous: number, comparisonDays: number): DetailTrend {
  const direction = previous === 0
    ? current > 0 ? "new" : "steady"
    : current > previous ? "up" : current < previous ? "down" : "steady";

  return {
    direction,
    current,
    previous,
    percentageChange: previous === 0 ? null : Math.round(((current - previous) / previous) * 1_000) / 10,
    comparisonDays,
  };
}

async function loadDetailPeriodFeatures(
  kind: LegacyEntityKind,
  value: string,
  byId: boolean,
  period: DetailPeriod,
): Promise<(DetailPeriodFeatures & { lifetimePlays: number }) | null> {
  const cleanValue = value.trim();
  if (!cleanValue) return null;

  const entityPredicate = kind === "artist"
    ? byId ? sql`artist_id = ${cleanValue}` : sql`artist_name = ${cleanValue}`
    : kind === "album"
      ? byId ? sql`album_id = ${cleanValue}` : sql`album_name = ${cleanValue}`
      : byId ? sql`spotify_id = ${cleanValue}` : sql`track_name = ${cleanValue}`;
  const periodDays = period === "all" ? 0 : PERIOD_DAYS[period];
  const comparisonDays = period === "all" ? 90 : periodDays;
  const chartMode: "day" | "month" = period === "all" || periodDays > 90 ? "month" : "day";
  const periodPredicate = period === "all"
    ? sql``
    : sql`
        WHERE played_at >= (
          (((now() AT TIME ZONE ${DISPLAY_TIME_ZONE})::date - (${periodDays} - 1))::timestamp)
          AT TIME ZONE ${DISPLAY_TIME_ZONE}
        )
      `;
  const bucketExpression = chartMode === "day"
    ? sql`date_trunc('day', local_at)::date`
    : sql`date_trunc('month', local_at)::date`;

  const [row] = await sql<RawDetailRow[]>`
    WITH bounds AS (
      SELECT
        (now() AT TIME ZONE ${DISPLAY_TIME_ZONE})::date AS today,
        (
          (((now() AT TIME ZONE ${DISPLAY_TIME_ZONE})::date - (${comparisonDays} - 1))::timestamp)
          AT TIME ZONE ${DISPLAY_TIME_ZONE}
        ) AS current_start,
        (
          (((now() AT TIME ZONE ${DISPLAY_TIME_ZONE})::date - ((${comparisonDays} * 2) - 1))::timestamp)
          AT TIME ZONE ${DISPLAY_TIME_ZONE}
        ) AS previous_start
    ),
    entity AS MATERIALIZED (
      SELECT
        track_name,
        artist_name,
        album_name,
        image_url,
        spotify_id,
        album_id,
        artist_id,
        played_at,
        played_at AT TIME ZONE ${DISPLAY_TIME_ZONE} AS local_at,
        (played_at AT TIME ZONE ${DISPLAY_TIME_ZONE})::date AS local_day,
        COALESCE(spotify_id, md5(track_name || E'\\x1f' || artist_name)) AS track_key,
        CASE WHEN album_name IS NULL THEN NULL
          ELSE COALESCE(album_id, md5(album_name || E'\\x1f' || artist_name))
        END AS album_key
      FROM public.scrobbles
      WHERE ${entityPredicate}
    ),
    period_rows AS MATERIALIZED (
      SELECT * FROM entity ${periodPredicate}
    ),
    lifetime_track_groups AS (
      SELECT
        track_key,
        track_name,
        artist_name,
        count(*)::int AS lifetime_plays,
        max(image_url) FILTER (WHERE image_url IS NOT NULL) AS image_url,
        max(spotify_id) FILTER (WHERE spotify_id IS NOT NULL) AS spotify_id,
        max(album_id) FILTER (WHERE album_id IS NOT NULL) AS album_id
      FROM entity
      GROUP BY track_key, track_name, artist_name
    ),
    period_track_groups AS (
      SELECT track_key, count(*)::int AS period_plays
      FROM period_rows
      GROUP BY track_key
    ),
    ranked_tracks AS (
      SELECT
        lifetime.track_name,
        lifetime.artist_name,
        COALESCE(period.period_plays, 0)::int AS period_plays,
        lifetime.lifetime_plays,
        lifetime.image_url,
        lifetime.spotify_id,
        lifetime.album_id
      FROM lifetime_track_groups lifetime
      LEFT JOIN period_track_groups period USING (track_key)
    ),
    period_album_groups AS (
      SELECT
        album_key,
        album_name,
        artist_name,
        count(*)::int AS period_plays,
        max(image_url) FILTER (WHERE image_url IS NOT NULL) AS image_url,
        max(album_id) FILTER (WHERE album_id IS NOT NULL) AS album_id
      FROM period_rows
      WHERE album_name IS NOT NULL
      GROUP BY album_key, album_name, artist_name
    ),
    lifetime_album_groups AS (
      SELECT album_key, count(*)::int AS lifetime_plays
      FROM entity
      WHERE album_key IS NOT NULL
      GROUP BY album_key
    ),
    period_buckets AS (
      SELECT ${bucketExpression} AS bucket, count(*)::int AS value
      FROM period_rows
      GROUP BY 1
      ORDER BY 1
      LIMIT 600
    ),
    context AS (
      SELECT
        artist_name,
        max(artist_id) FILTER (WHERE artist_id IS NOT NULL) AS artist_id,
        album_name,
        max(album_id) FILTER (WHERE album_id IS NOT NULL) AS album_id,
        count(*) AS plays
      FROM entity
      GROUP BY artist_name, album_name
      ORDER BY plays DESC, artist_name, album_name NULLS LAST
      LIMIT 1
    ),
    totals AS (
      SELECT
        count(*)::text AS lifetime_plays,
        min(local_day)::text AS first_local_day
      FROM entity
    ),
    period_stats AS (
      SELECT
        count(*)::text AS period_plays,
        count(DISTINCT local_day)::int AS active_days,
        count(DISTINCT track_key)::int AS distinct_tracks,
        count(DISTINCT album_key) FILTER (WHERE album_key IS NOT NULL)::int AS distinct_albums
      FROM period_rows
    ),
    comparison AS (
      SELECT
        count(*) FILTER (WHERE entity.played_at >= bounds.current_start)::int AS current_count,
        count(*) FILTER (
          WHERE entity.played_at >= bounds.previous_start
            AND entity.played_at < bounds.current_start
        )::int AS previous_count
      FROM entity
      CROSS JOIN bounds
    )
    SELECT
      totals.lifetime_plays,
      period_stats.period_plays,
      period_stats.active_days,
      period_stats.distinct_tracks,
      period_stats.distinct_albums,
      comparison.current_count AS current_comparison,
      comparison.previous_count AS previous_comparison,
      CASE
        WHEN ${period} = 'all' THEN totals.first_local_day
        ELSE (bounds.today - (${periodDays} - 1))::text
      END AS period_start,
      bounds.today::text AS period_end,
      totals.first_local_day,
      COALESCE((
        SELECT json_agg(json_build_object(
          'bucket', bucket::text,
          'value', value
        ) ORDER BY bucket)
        FROM period_buckets
      ), '[]'::json) AS chart,
      (
        SELECT json_build_object('bucket', bucket::text, 'plays', value)
        FROM period_buckets
        ORDER BY value DESC, bucket DESC
        LIMIT 1
      ) AS peak,
      COALESCE((
        SELECT json_agg(json_build_object(
          'name', track_name,
          'secondary', artist_name,
          'plays', period_plays,
          'lifetimePlays', lifetime_plays,
          'imageUrl', image_url,
          'id', spotify_id,
          'albumId', album_id
        ) ORDER BY period_plays DESC, lifetime_plays DESC, track_name)
        FROM (SELECT * FROM ranked_tracks WHERE period_plays > 0 ORDER BY period_plays DESC, lifetime_plays DESC, track_name LIMIT 12) top
      ), '[]'::json) AS top_tracks,
      CASE WHEN ${kind} = 'artist' THEN COALESCE((
        SELECT json_agg(json_build_object(
          'name', albums.album_name,
          'secondary', albums.artist_name,
          'plays', albums.period_plays,
          'lifetimePlays', COALESCE(lifetime.lifetime_plays, albums.period_plays),
          'imageUrl', albums.image_url,
          'id', albums.album_id,
          'albumId', albums.album_id
        ) ORDER BY albums.period_plays DESC, albums.album_name)
        FROM (
          SELECT * FROM period_album_groups
          ORDER BY period_plays DESC, album_name
          LIMIT 8
        ) albums
        LEFT JOIN lifetime_album_groups lifetime USING (album_key)
      ), '[]'::json) ELSE '[]'::json END AS top_albums,
      CASE WHEN ${kind} = 'album' THEN COALESCE((
        SELECT json_agg(json_build_object(
          'name', track_name,
          'secondary', artist_name,
          'plays', period_plays,
          'lifetimePlays', lifetime_plays,
          'imageUrl', image_url,
          'id', spotify_id,
          'albumId', album_id
        ) ORDER BY period_plays DESC, lifetime_plays DESC, track_name)
        FROM ranked_tracks
      ), '[]'::json) ELSE '[]'::json END AS album_tracks,
      COALESCE((
        SELECT json_agg(json_build_object(
          'trackName', track_name,
          'artistName', artist_name,
          'albumName', album_name,
          'playedAt', played_at::text,
          'imageUrl', image_url,
          'spotifyId', spotify_id
        ) ORDER BY played_at DESC)
        FROM (SELECT * FROM entity ORDER BY played_at DESC LIMIT 12) latest
      ), '[]'::json) AS recent,
      (
        SELECT json_build_object(
          'artistName', artist_name,
          'artistId', artist_id,
          'albumName', album_name,
          'albumId', album_id
        )
        FROM context
      ) AS context
    FROM totals
    CROSS JOIN period_stats
    CROSS JOIN comparison
    CROSS JOIN bounds
  `;

  const lifetimePlays = Number(row?.lifetime_plays ?? 0);
  if (!row || lifetimePlays === 0 || !row.first_local_day || !row.context) return null;

  const periodPlays = Number(row.period_plays);
  const topTracks = mapRankedItems(row.top_tracks);
  const topItem = kind === "track" ? null : topTracks[0] ?? null;
  const peak = row.peak
    ? { label: peakLabel(row.peak.bucket, chartMode), plays: Number(row.peak.plays) }
    : null;

  return {
    lifetimePlays,
    period,
    periodLabel: detailPeriodLabel(period),
    periodPlays,
    activeDays: Number(row.active_days),
    distinctTracks: Number(row.distinct_tracks),
    distinctAlbums: Number(row.distinct_albums),
    averagePerTrack: roundAverage(periodPlays, Number(row.distinct_tracks)),
    averagePerActiveDay: roundAverage(periodPlays, Number(row.active_days)),
    topItem,
    topItemShare: topItem && periodPlays ? Math.round((topItem.plays / periodPlays) * 1_000) / 10 : null,
    peak,
    chart: fillChart(row.chart ?? [], chartMode, row.period_start, row.period_end),
    chartMode,
    trend: mapTrend(Number(row.current_comparison), Number(row.previous_comparison), comparisonDays),
    topTracks,
    topAlbums: mapRankedItems(row.top_albums),
    albumTracks: mapRankedItems(row.album_tracks),
    recent: row.recent ?? [],
    context: row.context,
  };
}

export async function getDetailPageFeatures(
  kind: LegacyEntityKind,
  value: string,
  byId: boolean,
  period: DetailPeriod,
): Promise<DetailPageFeatures | null> {
  const [periodFeatures, legacy] = await Promise.all([
    loadDetailPeriodFeatures(kind, value, byId, period),
    getEntityLegacyFeatures(kind, value, byId),
  ]);

  if (!periodFeatures || !legacy) return null;
  return { ...periodFeatures, legacy };
}
