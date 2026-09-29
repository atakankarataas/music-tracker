import "server-only";
import { sql } from "@/lib/db";
import type { EntityItem } from "@/lib/data";

// An archive-calibrated approximation, NOT Spotify's undisclosed formula.
// Catalogue order is only a proxy for billing; it does not prove artist roles.
export const SECONDARY_WEIGHT = 0.35;
export type ArtistRankingMode = "all" | "primary" | "weighted";
export const ARTIST_MODES: ArtistRankingMode[] = ["all", "primary", "weighted"];
export function parseArtistMode(value?: string): ArtistRankingMode {
  return ARTIST_MODES.includes(value as ArtistRankingMode) ? value as ArtistRankingMode : "weighted";
}
export type CreditedArtist = EntityItem & { score: number };
export type WrappedArtists = {
  artists: CreditedArtist[];
  distinctArtists: number;
  totalPlays: number;
  creditedPlays: number;
  unknownDurationPlays: number;
  unknownPrivacyPlays: number;
};

export async function getWrappedArtists(start: string, end: string, limit = 20,
  mode: ArtistRankingMode = "weighted", wrapped = true): Promise<WrappedArtists> {
  const [row] = await sql<{
    artists: CreditedArtist[]; distinct_artists: number; total_plays: number;
    credited_plays: number; unknown_duration: number; unknown_privacy: number;
  }[]>`
    WITH plays AS MATERIALIZED (
      SELECT spotify_id, artist_name, image_url, ms_played, incognito_mode
      FROM public.scrobbles
      WHERE played_at >= ${start}::date::timestamp AT TIME ZONE 'Europe/Istanbul'
        AND played_at < (${end}::date + 1)::timestamp AT TIME ZONE 'Europe/Istanbul'
        AND (${!wrapped} OR ((ms_played IS NULL OR ms_played > 30000) AND incognito_mode IS NOT TRUE))
    ), track_plays AS (
      SELECT spotify_id, artist_name, count(*)::int AS n, max(image_url) AS image_url
      FROM plays GROUP BY spotify_id, artist_name
    ), credits AS (
      -- Guard against a duplicate artist in a malformed catalogue response.
      SELECT spotify_id, artist_id, max(artist_name) AS artist_name, min(position) AS position
      FROM public.music_track_artists GROUP BY spotify_id, artist_id
    ), credited AS (
      SELECT CASE WHEN ${mode} = 'primary' THEN p.artist_name ELSE coalesce(c.artist_name,p.artist_name) END AS name,
        CASE WHEN ${mode} = 'primary' THEN NULL ELSE c.artist_id END AS id,
        p.image_url, p.n,
        CASE WHEN ${mode} != 'weighted' OR c.position = 0 OR c.spotify_id IS NULL
          THEN 1.0 ELSE ${SECONDARY_WEIGHT}::numeric END AS weight
      FROM track_plays p
      LEFT JOIN credits c ON c.spotify_id = p.spotify_id AND ${mode} != 'primary'
    ), grouped AS (
      SELECT name, sum(n)::int AS plays, sum(n * weight)::float AS score,
        max(id) AS id, max(image_url) AS "imageUrl"
      FROM credited GROUP BY name
    ), ranked AS (
      SELECT * FROM grouped ORDER BY score DESC, name LIMIT ${limit}
    )
    SELECT coalesce((SELECT json_agg(ranked ORDER BY score DESC,name) FROM ranked),'[]'::json) AS artists,
      (SELECT count(*)::int FROM grouped) AS distinct_artists,
      count(*)::int AS total_plays,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM credits c WHERE c.spotify_id=plays.spotify_id))::int AS credited_plays,
      count(*) FILTER (WHERE ms_played IS NULL)::int AS unknown_duration,
      count(*) FILTER (WHERE incognito_mode IS NULL)::int AS unknown_privacy
    FROM plays
  `;
  return { artists: row?.artists ?? [], distinctArtists: row?.distinct_artists ?? 0,
    totalPlays: row?.total_plays ?? 0, creditedPlays: row?.credited_plays ?? 0,
    unknownDurationPlays: row?.unknown_duration ?? 0, unknownPrivacyPlays: row?.unknown_privacy ?? 0 };
}
