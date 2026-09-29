import "server-only";
import { unstable_cache } from "next/cache";
import { sql } from "@/lib/db";
import type { EntityItem, ChartPoint } from "@/lib/data";

export type WrappedData = {
  archiveFirstPlay: string | null;
  totalPlays: number;
  artists: number;
  tracks: number;
  topArtists: EntityItem[];
  topAlbums: EntityItem[];
  topTracks: EntityItem[];
  activity: ChartPoint[];
  activeDays: number;
  longestStreak: number;
  dayparts: ChartPoint[];
};

/** Scan the eligible window once and aggregate tracks before expanding credits.
 * Each listed artist receives a full play; archive totals count the event once. */
export async function loadWrappedData(start: string, end: string): Promise<WrappedData> {
  const [row] = await sql<WrappedData[]>`
    WITH plays AS MATERIALIZED (
      SELECT spotify_id, artist_name, track_name, album_name, album_id, image_url,
        played_at AT TIME ZONE 'Europe/Istanbul' AS local_time
      FROM public.scrobbles
      WHERE played_at >= ${start}::date::timestamp AT TIME ZONE 'Europe/Istanbul'
        AND played_at < (${end}::date + 1)::timestamp AT TIME ZONE 'Europe/Istanbul'
        AND (ms_played IS NULL OR ms_played > 30000) AND incognito_mode IS NOT TRUE
    ), track_plays AS MATERIALIZED (
      SELECT spotify_id, artist_name, track_name, count(*)::int AS n, max(image_url) AS image_url
      FROM plays GROUP BY spotify_id, artist_name, track_name
    ), credits AS (
      SELECT c.spotify_id, c.artist_id, max(c.artist_name) AS artist_name
      FROM public.music_track_artists c
      WHERE c.spotify_id IN (SELECT spotify_id FROM track_plays)
      GROUP BY c.spotify_id, c.artist_id
    ), artists AS MATERIALIZED (
      SELECT coalesce(c.artist_name,p.artist_name) AS name, sum(p.n)::int AS plays,
        max(c.artist_id) AS id, max(p.image_url) AS "imageUrl"
      FROM track_plays p LEFT JOIN credits c ON c.spotify_id = p.spotify_id
      GROUP BY coalesce(c.artist_name,p.artist_name)
    ), artist_rank AS (
      SELECT * FROM artists ORDER BY plays DESC, name LIMIT 50
    ), track_rank AS (
      SELECT track_name AS name, artist_name AS secondary, n AS plays,
        image_url AS "imageUrl", spotify_id AS id
      FROM track_plays ORDER BY n DESC, track_name, artist_name, spotify_id LIMIT 20
    ), album_rank AS (
      SELECT album_name AS name, artist_name AS secondary, count(*)::int AS plays,
        max(image_url) AS "imageUrl", album_id AS id
      FROM plays WHERE album_name IS NOT NULL GROUP BY album_id, album_name, artist_name
      ORDER BY count(*) DESC, album_name, artist_name, album_id LIMIT 20
    ), days AS MATERIALIZED (
      SELECT local_time::date AS day, count(*)::int AS n FROM plays GROUP BY 1
    ), streaks AS (
      SELECT count(*)::int AS length FROM (
        SELECT day - row_number() OVER (ORDER BY day)::int AS island FROM days
      ) numbered GROUP BY island
    ), months AS (
      SELECT date_trunc('month', day) AS month, sum(n)::int AS value FROM days GROUP BY 1
    ), activity AS (
      SELECT bucket, to_char(bucket, 'Mon YY') AS label, coalesce(m.value,0) AS value
      FROM generate_series(date_trunc('month', ${start}::date::timestamp),
        date_trunc('month', ${end}::date::timestamp), interval '1 month') AS series(bucket)
      LEFT JOIN months m ON m.month = bucket
    ), daypart_counts AS (
      SELECT floor(extract(hour FROM local_time)/6)::int AS part, count(*)::int AS value
      FROM plays GROUP BY 1
    ), dayparts AS (
      SELECT part, (ARRAY['Night','Morning','Afternoon','Evening'])[part+1] AS label,
        coalesce(c.value,0) AS value FROM generate_series(0,3) AS series(part)
      LEFT JOIN daypart_counts c USING (part)
    )
    SELECT (SELECT first_play::text FROM public.mv_music_totals LIMIT 1) AS "archiveFirstPlay",
      (SELECT count(*)::int FROM plays) AS "totalPlays",
      (SELECT count(*)::int FROM artists) AS artists,
      (SELECT count(DISTINCT coalesce(spotify_id, track_name || chr(31) || artist_name))::int FROM track_plays) AS tracks,
      coalesce((SELECT json_agg(artist_rank ORDER BY plays DESC,name) FROM artist_rank),'[]'::json) AS "topArtists",
      coalesce((SELECT json_agg(album_rank ORDER BY plays DESC,name,secondary,id) FROM album_rank),'[]'::json) AS "topAlbums",
      coalesce((SELECT json_agg(track_rank ORDER BY plays DESC,name,secondary,id) FROM track_rank),'[]'::json) AS "topTracks",
      (SELECT json_agg(json_build_object('label',label,'value',value) ORDER BY bucket) FROM activity) AS activity,
      (SELECT count(*)::int FROM days) AS "activeDays",
      coalesce((SELECT max(length) FROM streaks),0) AS "longestStreak",
      (SELECT json_agg(json_build_object('label',label,'value',value) ORDER BY part) FROM dayparts) AS dayparts
  `;
  if (!row) throw new Error("The Wrapped period could not be loaded");
  return row;
}

// Exact dates are part of Next's cache key, so day/year changes get fresh data.
// Authentication remains enforced by the page middleware; this single archive
// can share aggregate results across authenticated visits for at most a minute.
export const getWrappedData = unstable_cache(loadWrappedData, ["wrapped-plays-v2"], { revalidate: 60 });
