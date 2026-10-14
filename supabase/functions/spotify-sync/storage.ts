import type { Sql } from "npm:postgres@3.4.9";
import type { Credit, Play } from "./core.ts";

/** Use the Python importer/tracker's lock, track identity and +/-3 second match.
 * API writes fill metadata but never overwrite measured export duration/flags. */
export async function storeBatch(
  sql: Sql,
  plays: Play[],
  credits: Credit[],
): Promise<number> {
  return await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(734201911)`;
    let inserted = 0;
    if (plays.length) {
      const candidates = tx`SELECT * FROM jsonb_to_recordset(${
        tx.json(plays)
      }) AS c(
        track_name text,artist_name text,album_name text,played_at timestamptz,spotify_id text,
        image_url text,album_id text,artist_id text,duration_ms integer,source text)`;
      const match =
        tx`s.played_at BETWEEN c.played_at - interval '3 seconds' AND c.played_at + interval '3 seconds'
        AND (s.spotify_id=c.spotify_id OR ((s.spotify_id IS NULL OR c.spotify_id IS NULL)
          AND s.track_name=c.track_name AND s.artist_name=c.artist_name))`;
      await tx`WITH c AS (${candidates}) UPDATE public.scrobbles s SET
        image_url=coalesce(s.image_url,c.image_url),album_id=coalesce(s.album_id,c.album_id),
        artist_id=coalesce(s.artist_id,c.artist_id),spotify_id=coalesce(s.spotify_id,c.spotify_id),
        duration_ms=coalesce(s.duration_ms,c.duration_ms),
        ingest_sources=ARRAY(SELECT DISTINCT unnest(s.ingest_sources || ARRAY[c.source]))
        FROM c WHERE ${match}`;
      const result =
        await tx`WITH c AS (${candidates}) INSERT INTO public.scrobbles(
        track_name,artist_name,album_name,played_at,spotify_id,image_url,album_id,artist_id,duration_ms,ingest_sources)
        SELECT c.track_name,c.artist_name,c.album_name,c.played_at,c.spotify_id,c.image_url,c.album_id,c.artist_id,
          c.duration_ms,ARRAY[c.source] FROM c
        WHERE NOT EXISTS(SELECT 1 FROM public.scrobbles s WHERE ${match})
        ON CONFLICT(played_at,spotify_id) DO NOTHING RETURNING id`;
      inserted = result.length;
    }
    if (credits.length) {
      const catalogue = tx`SELECT * FROM jsonb_to_recordset(${
        tx.json(credits)
      }) AS a(
        spotify_id text,position integer,artist_id text,artist_name text,is_featured boolean)`;
      await tx`WITH a AS (${catalogue}) DELETE FROM public.music_track_artists
        WHERE spotify_id IN (SELECT spotify_id FROM a)`;
      await tx`WITH a AS (${catalogue}) INSERT INTO public.music_track_artists(
        spotify_id,position,artist_id,artist_name,is_featured)
        SELECT spotify_id,position,artist_id,artist_name,is_featured FROM a`;
    }
    return inserted;
  });
}
