import "server-only";
import { sql } from "@/lib/db";
import type { EntityItem } from "@/lib/data";

/**
 * Weight a play gives to each artist credited on the track.
 *
 * Spotify publishes no numbers, only that "primary artists receive more weight
 * than secondary or featured artists". Scanning both weights against this
 * archive's real Wrapped results chose these, and the fit was deliberately
 * judged on 2023-2025: Spotify has changed how Wrapped is built over the years,
 * so the recent results describe the current method and the 2018 ones do not.
 *
 * A co-primary — Güneş alongside BEGE on "Mümkünse" — carries the play in full;
 * discounting co-primaries made every recent year worse. A guest named by
 * "(feat. …)" counts half. Those values reproduce 2023 and 2025 exactly
 * (39/45 across the last three years). Tuning on all eight years instead scored
 * two points higher overall but nine points worse on the recent three, and lost
 * 2025 entirely.
 *
 * This also sits well with both public statements: the primary still outweighs
 * a guest, which is what the methodology page claims, while a co-primary is
 * credited fully, which is what Spotify support has told listeners.
 */
export const CO_PRIMARY_WEIGHT = 1;
export const FEATURED_WEIGHT = 0.5;

export type WrappedArtists = {
  artists: EntityItem[];
  distinctArtists: number;
};

export async function getWrappedArtists(start: string, end: string, limit = 20): Promise<WrappedArtists> {
  const [row] = await sql<{ artists: EntityItem[] | null; distinct_artists: number }[]>`
    WITH plays AS MATERIALIZED (
      SELECT spotify_id, artist_name, image_url
      FROM public.scrobbles
      WHERE played_at >= ${start}::date::timestamp AT TIME ZONE 'Europe/Istanbul'
        AND played_at < (${end}::date + 1)::timestamp AT TIME ZONE 'Europe/Istanbul'
    ),
    -- A track with no stored credits still counts once, for its own artist, so
    -- a gap in the credit table can never silently drop a play.
    credited AS (
      SELECT
        COALESCE(credit.artist_name, plays.artist_name) AS name,
        credit.artist_id AS id,
        plays.image_url,
        CASE
          WHEN credit.spotify_id IS NULL THEN 1
          WHEN credit.position = 0 THEN 1
          WHEN credit.is_featured THEN ${FEATURED_WEIGHT}
          ELSE ${CO_PRIMARY_WEIGHT}
        END::numeric AS weight
      FROM plays
      LEFT JOIN public.music_track_artists credit ON credit.spotify_id = plays.spotify_id
    ),
    ranked AS (
      SELECT name,
        round(sum(weight))::int AS plays,
        max(id) FILTER (WHERE id IS NOT NULL) AS id,
        max(image_url) FILTER (WHERE image_url IS NOT NULL) AS "imageUrl"
      FROM credited
      GROUP BY name
      ORDER BY sum(weight) DESC, name
      LIMIT ${limit}
    )
    SELECT
      COALESCE((SELECT json_agg(ranked ORDER BY plays DESC, name) FROM ranked), '[]'::json) AS artists,
      (SELECT count(DISTINCT name)::int FROM credited WHERE weight >= ${CO_PRIMARY_WEIGHT}) AS distinct_artists
  `;

  return { artists: row?.artists ?? [], distinctArtists: row?.distinct_artists ?? 0 };
}
