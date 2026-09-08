import "server-only";
import { sql } from "@/lib/db";

export type ListeningPatterns = {
  total: number; artists: number; tracks: number; active_days: number;
  longest_streak: number; new_artists: number; top_five: number;
  peak_day: string | null; peak_plays: number; timed_plays: number; known_minutes: number;
  dayparts: { label: string; value: number }[];
};

/** All metrics use the same inclusive Istanbul calendar window. */
export async function getListeningPatterns(start: string | null, end: string) {
  const [row] = await sql<ListeningPatterns[]>`
    WITH plays AS MATERIALIZED (
      SELECT *, (played_at AT TIME ZONE 'Europe/Istanbul')::date AS day,
        extract(hour FROM played_at AT TIME ZONE 'Europe/Istanbul')::int AS hour
      FROM public.scrobbles
      WHERE (${start}::date IS NULL OR played_at >= ${start}::date::timestamp AT TIME ZONE 'Europe/Istanbul')
        AND played_at < (${end}::date+1)::timestamp AT TIME ZONE 'Europe/Istanbul'
    ), days AS (
      SELECT day,count(*)::int AS plays FROM plays GROUP BY day
    ), islands AS (
      SELECT day, day - row_number() OVER (ORDER BY day)::int AS island FROM days
    ), first_artists AS (
      SELECT artist_name,min(played_at) AS first_play FROM public.scrobbles GROUP BY artist_name
    ), parts AS (
      SELECT CASE WHEN hour<6 THEN 0 WHEN hour<12 THEN 1 WHEN hour<18 THEN 2 ELSE 3 END AS part,
        count(*)::int AS value FROM plays GROUP BY 1
    )
    SELECT count(*)::int AS total, count(DISTINCT artist_name)::int AS artists,
      count(DISTINCT coalesce(spotify_id,track_name||' / '||artist_name))::int AS tracks,
      (SELECT count(*)::int FROM days) AS active_days,
      coalesce((SELECT max(length)::int FROM (SELECT count(*) AS length FROM islands GROUP BY island) streaks),0) AS longest_streak,
      (SELECT count(*)::int FROM first_artists WHERE (${start}::date IS NULL OR first_play >= ${start}::date::timestamp AT TIME ZONE 'Europe/Istanbul')
        AND first_play < (${end}::date+1)::timestamp AT TIME ZONE 'Europe/Istanbul') AS new_artists,
      coalesce((SELECT sum(n)::int FROM (SELECT count(*) AS n FROM plays GROUP BY artist_name ORDER BY n DESC LIMIT 5) leaders),0) AS top_five,
      (SELECT day::text FROM days ORDER BY plays DESC,day DESC LIMIT 1) AS peak_day,
      coalesce((SELECT max(plays) FROM days),0) AS peak_plays,
      count(ms_played)::int AS timed_plays, coalesce(round(sum(ms_played)/60000.0),0)::int AS known_minutes,
      (SELECT json_agg(json_build_object('label',label,'value',coalesce(value,0)) ORDER BY ordinal)
        FROM (VALUES (0,'After midnight'),(1,'Morning'),(2,'Afternoon'),(3,'Evening')) labels(ordinal,label)
        LEFT JOIN parts ON part=ordinal) AS dayparts
    FROM plays
  `;
  return row;
}
