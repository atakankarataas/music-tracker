import "server-only";
import { sql } from "@/lib/db";
import { localToday } from "@/lib/periods";
import type { EntityItem } from "@/lib/data";

export async function getDiscovery(requestedMonth?: string) {
  const today = localToday();
  const month = requestedMonth && /^\d{4}-(0[1-9]|1[012])$/.test(requestedMonth) && requestedMonth <= today.slice(0, 7)
    ? requestedMonth : today.slice(0, 7);
  const start = `${month}-01`;
  const [row] = await sql<{
    forgotten: EntityItem[]; new_artists: EntityItem[]; rising: (EntityItem & { previous: number })[];
    returns: EntityItem[]; top_tracks: EntityItem[]; plays: number; previous_plays: number;
    known_ms: string; timed_plays: number; note: string | null; first_month: string;
  }[]>`
    WITH bounds AS (
      SELECT ${start}::date AS first_day,
        LEAST((${start}::date + interval '1 month')::date - 1, ${today}::date) AS last_day,
        (${start}::date - interval '1 month')::date AS previous_start
    ), range_plays AS MATERIALIZED (
      SELECT s.* FROM public.scrobbles s, bounds b
      WHERE s.played_at >= b.first_day::timestamp AT TIME ZONE 'Europe/Istanbul'
        AND s.played_at < (b.last_day+1)::timestamp AT TIME ZONE 'Europe/Istanbul'
    ), artists AS (
      SELECT artist_name AS name, max(image_url) AS "imageUrl", min(played_at) AS first_play,
        count(*) FILTER (WHERE played_at >= b.first_day::timestamp AT TIME ZONE 'Europe/Istanbul'
          AND played_at < (b.last_day+1)::timestamp AT TIME ZONE 'Europe/Istanbul')::int AS plays,
        count(*) FILTER (WHERE played_at >= b.previous_start::timestamp AT TIME ZONE 'Europe/Istanbul'
          AND played_at < LEAST(b.first_day, b.previous_start + (b.last_day-b.first_day+1))::timestamp AT TIME ZONE 'Europe/Istanbul')::int AS previous
      FROM public.scrobbles CROSS JOIN bounds b GROUP BY artist_name
    ), forgotten AS (
      SELECT track_name AS name,artist_name AS secondary,spotify_id AS id,max(image_url) AS "imageUrl",count(*)::int AS plays
      FROM public.scrobbles WHERE spotify_id IS NOT NULL GROUP BY spotify_id,track_name,artist_name
      HAVING count(*) >= 10 AND max(played_at) < now()-interval '180 days'
      ORDER BY count(*) DESC, max(played_at) DESC, spotify_id LIMIT 20
    ), returning_albums AS (
      SELECT s.album_name AS name,s.artist_name AS secondary,s.album_id AS id,max(s.image_url) AS "imageUrl",
        count(*) FILTER (WHERE s.played_at >= b.first_day::timestamp AT TIME ZONE 'Europe/Istanbul'
          AND s.played_at < (b.last_day+1)::timestamp AT TIME ZONE 'Europe/Istanbul')::int AS plays
      FROM public.scrobbles s CROSS JOIN bounds b WHERE s.album_name IS NOT NULL
      GROUP BY s.album_id,s.album_name,s.artist_name,b.first_day,b.last_day
      HAVING max(s.played_at) FILTER (WHERE s.played_at < b.first_day::timestamp AT TIME ZONE 'Europe/Istanbul')
        < (b.first_day-180)::timestamp AT TIME ZONE 'Europe/Istanbul'
      ORDER BY plays DESC,s.album_name LIMIT 10
    ), tracks AS (
      SELECT track_name AS name,artist_name AS secondary,spotify_id AS id,max(image_url) AS "imageUrl",count(*)::int AS plays
      FROM range_plays GROUP BY spotify_id,track_name,artist_name ORDER BY count(*) DESC,track_name LIMIT 20
    )
    SELECT (SELECT count(*)::int FROM range_plays) AS plays,
      (SELECT coalesce(sum(previous),0)::int FROM artists) AS previous_plays,
      (SELECT coalesce(sum(ms_played),0)::text FROM range_plays) AS known_ms,
      (SELECT count(ms_played)::int FROM range_plays) AS timed_plays,
      coalesce((SELECT json_agg(forgotten) FROM forgotten),'[]') AS forgotten,
      coalesce((SELECT json_agg(t) FROM (SELECT name,"imageUrl",plays FROM artists,bounds
        WHERE first_play >= first_day::timestamp AT TIME ZONE 'Europe/Istanbul' AND plays>0 ORDER BY plays DESC,name LIMIT 10) t),'[]') AS new_artists,
      coalesce((SELECT json_agg(t) FROM (SELECT name,"imageUrl",plays,previous FROM artists
        WHERE plays>previous AND previous>0 ORDER BY plays-previous DESC,name LIMIT 10) t),'[]') AS rising,
      coalesce((SELECT json_agg(t) FROM (SELECT * FROM returning_albums WHERE plays>0) t),'[]') AS returns,
      coalesce((SELECT json_agg(tracks) FROM tracks),'[]') AS top_tracks,
      (SELECT body FROM public.music_notes WHERE period_key=${month}) AS note,
      (SELECT to_char(min(played_at) AT TIME ZONE 'Europe/Istanbul','YYYY-MM') FROM public.scrobbles) AS first_month
    FROM bounds
  `;
  return { ...row, month, today };
}

export async function getSyncStatus() {
  const [row] = await sql`
    SELECT (SELECT row_to_json(r) FROM (SELECT started_at,finished_at,status,pages,fetched,inserted,
      newest_play,stop_reason,error_code,github_run_id FROM public.music_sync_runs ORDER BY started_at DESC LIMIT 1) r) AS latest,
      (SELECT max(finished_at) FROM public.music_sync_runs WHERE status IN ('success','warning')) AS last_success,
      (SELECT max(finished_at) > now() - interval '90 minutes' FROM public.music_sync_runs
        WHERE status IN ('success','warning')) AS sync_recent,
      (SELECT max(played_at) FROM public.scrobbles) AS last_play,
      (SELECT count(*) FROM public.scrobbles) AS total,
      (SELECT total_plays FROM public.mv_music_totals LIMIT 1) AS rollup_total
  `;
  return row;
}
