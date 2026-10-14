import "server-only";
import { unstable_cache } from "next/cache";
import { createHash } from "node:crypto";
import { sql } from "@/lib/db";
import { chooseRecommendations, songKey, type RecommendationTrack } from "@/lib/recommendation-ranking";

export type RecommendationPeriod = "30d" | "year";
type Seed = { id: string; name: string; plays: number };
type CatalogTrack = { id: string; name: string; is_playable?: boolean; artists: { id: string; name: string }[]; album?: { images?: { url: string }[] } };
let token: { value: string; until: number } | undefined;
let tokenRequest: Promise<string> | undefined;
let rateLimitedUntil = 0;
async function accessToken() {
  if (token && token.until > Date.now()) return token.value;
  if (tokenRequest) return tokenRequest;
  tokenRequest = (async () => {
    const id = process.env.SPOTIPY_CLIENT_ID, secret = process.env.SPOTIPY_CLIENT_SECRET;
    if (!id || !secret) throw new Error("Catalogue connection unavailable");
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials", signal: AbortSignal.timeout(5000), cache: "no-store",
    });
    if (!response.ok) throw new Error(`Catalogue authorization ${response.status}`);
    const data = await response.json();
    token = { value: data.access_token, until: Date.now() + (data.expires_in - 60) * 1000 };
    return token.value;
  })();
  try { return await tokenRequest; } finally { tokenRequest = undefined; }
}
async function catalog(path: string) {
  if (Date.now() < rateLimitedUntil) throw new Error("Catalogue rate limited");
  const response = await fetch(`https://api.spotify.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(5000), cache: "no-store",
  });
  if (response.status === 429) rateLimitedUntil = Date.now() + Math.max(60, Number(response.headers.get("retry-after")) || 60) * 1000;
  if (!response.ok) throw new Error(`Catalogue request ${response.status}`);
  return response.json();
}
const artistTracks = unstable_cache(async (id: string, name: string): Promise<CatalogTrack[]> => {
  // This app can access top tracks; search also supports apps without that endpoint.
  const results = await Promise.allSettled([
    catalog(`artists/${encodeURIComponent(id)}/top-tracks?market=TR`),
    catalog(`search?${new URLSearchParams({ q: `artist:"${name}"`, type: "track", market: "TR", limit: "10", offset: "0" })}`),
    catalog(`search?${new URLSearchParams({ q: `artist:"${name}"`, type: "track", market: "TR", limit: "10", offset: "30" })}`),
    catalog(`search?${new URLSearchParams({ q: `artist:"${name}"`, type: "track", market: "TR", limit: "10", offset: "60" })}`),
  ]);
  const tracks: CatalogTrack[] = [];
  for (const result of results) if (result.status === "fulfilled") {
    tracks.push(...(Array.isArray(result.value.tracks) ? result.value.tracks : result.value.tracks?.items ?? []));
  }
  if (!results.some(x => x.status === "fulfilled")) throw new Error("Catalogue temporarily unavailable");
  return tracks.filter(t => t?.id && t.name && t.artists?.some(a => a.id === id) && t.is_playable !== false);
}, ["discovery-catalogue-v3"], { revalidate: 21600 });

export async function getRecommendations(period: RecommendationPeriod, requestedRefresh = "0") {
  const refresh = Math.min(50, Math.max(0, Number.parseInt(requestedRefresh, 10) || 0));
  const [profile] = await sql<{ seeds: Seed[]; familiar: RecommendationTrack[]; today: string }[]>`
    WITH bounds AS (SELECT (now() AT TIME ZONE 'Europe/Istanbul')::date AS today),
    seeds AS (
      SELECT artist_id AS id, artist_name AS name, sum(play_weight)::double precision AS plays
      FROM music_read.artist_plays, bounds WHERE artist_id IS NOT NULL
        AND played_at >= (CASE WHEN ${period}='year' THEN date_trunc('year',bounds.today)::date ELSE bounds.today-29 END)::timestamp AT TIME ZONE 'Europe/Istanbul'
        AND played_at <= now()
      GROUP BY artist_id,artist_name ORDER BY plays DESC,name LIMIT 10
    ), familiar AS (
      SELECT s.spotify_id AS id, max(s.track_name) AS name, max(s.artist_name) AS artist,
        max(s.artist_id) AS "artistId", max(s.image_url) AS "imageUrl",max(s.artist_name) AS seed,
        true AS familiar, 0.1::double precision AS score
      FROM music_read.scrobbles s JOIN seeds ON seeds.id=s.artist_id
      WHERE s.spotify_id IS NOT NULL GROUP BY s.spotify_id
      HAVING count(*) BETWEEN 1 AND 3 AND max(s.played_at) < now()-interval '30 days'
      ORDER BY max(s.played_at) DESC LIMIT 50
    )
    SELECT today::text, coalesce((SELECT json_agg(seeds) FROM seeds),'[]') AS seeds,
      coalesce((SELECT json_agg(f) FROM familiar f),'[]') AS familiar FROM bounds
  `;
  const seeds = profile.seeds ?? [];
  // Read only IDs/identity for novelty, including short/private records. These
  // rows are not analytics plays, but hearing a song makes it familiar.
  const known = await sql<{ id: string | null; name: string; artist: string }[]>`
    SELECT DISTINCT spotify_id AS id,track_name AS name,artist_name AS artist FROM public.scrobbles`;
  const knownIds = new Set(known.map(t => t.id));
  const knownSongs = new Set(known.map(t => songKey(t.name, t.artist)));
  const candidates: RecommendationTrack[] = [...(profile.familiar ?? [])];
  let successful = 0;
  // Limit in-flight Spotify traffic and keep rate-limit failures bounded.
  for (let i = 0; i < seeds.length; i += 3) {
    const results = await Promise.allSettled(seeds.slice(i, i + 3).map(async (seed, offset) => ({ seed, rank: i + offset, tracks: await artistTracks(seed.id, seed.name) })));
    for (const result of results) if (result.status === "fulfilled") {
      successful++;
      const { seed, rank, tracks } = result.value;
      for (const track of tracks) {
        const artist = track.artists[0];
        if (!artist || knownIds.has(track.id) || knownSongs.has(songKey(track.name, artist.name))) continue;
        const jitter = createHash("sha256").update(`${profile.today}|${refresh}|${track.id}`).digest().readUInt32BE(0) / 0xffffffff;
        candidates.push({ id: track.id, name: track.name, artist: track.artists.map(a => a.name).join(", "), artistId: artist.id, identityArtist: artist.name,
          imageUrl: track.album?.images?.[0]?.url ?? null, seed: seed.name, familiar: false, score: 1 + (10 - rank) * .04 + jitter });
      }
    }
  }
  const picks = chooseRecommendations(candidates);
  return { picks, seeds, refresh, unavailable: seeds.length > 0 && successful === 0 };
}
