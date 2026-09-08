import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TokenCache = { value: string; expiresAt: number };
type SnapshotCache = { value: unknown; expiresAt: number };

declare global {
  var __spotifyAccessToken: TokenCache | undefined;
  var __spotifyNowPlaying: SnapshotCache | undefined;
}

type SpotipyCache = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
};

async function readSpotipyCache(): Promise<SpotipyCache | null> {
  try {
    const configured = process.env.SPOTIPY_CACHE_PATH ?? ".cache";
    const cachePath = path.isAbsolute(configured)
      ? configured
      : path.join(/* turbopackIgnore: true */ process.cwd(), configured);
    return JSON.parse(await readFile(cachePath, "utf8")) as SpotipyCache;
  } catch {
    return null;
  }
}

async function getAccessToken() {
  if (globalThis.__spotifyAccessToken && globalThis.__spotifyAccessToken.expiresAt > Date.now()) {
    return globalThis.__spotifyAccessToken.value;
  }

  const cache = await readSpotipyCache();
  if (cache?.access_token && (cache.expires_at ?? 0) * 1000 > Date.now() + 30_000) {
    globalThis.__spotifyAccessToken = {
      value: cache.access_token,
      expiresAt: (cache.expires_at ?? 0) * 1000,
    };
    return cache.access_token;
  }

  const clientId = process.env.SPOTIPY_CLIENT_ID;
  const clientSecret = process.env.SPOTIPY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN ?? cache?.refresh_token;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) return null;
  const token = await response.json() as { access_token: string; expires_in: number };
  globalThis.__spotifyAccessToken = {
    value: token.access_token,
    expiresAt: Date.now() + Math.max(30, token.expires_in - 60) * 1000,
  };
  return token.access_token;
}

async function loadNowPlayingResponse() {
  if (globalThis.__spotifyNowPlaying && globalThis.__spotifyNowPlaying.expiresAt > Date.now()) {
    return Response.json(globalThis.__spotifyNowPlaying.value, { headers: { "Cache-Control": "private, no-store" } });
  }

  const accessToken = await getAccessToken();
  if (!accessToken) return new Response(null, { status: 204 });

  const response = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });

  if (response.status === 204 || !response.ok) return new Response(null, { status: 204 });

  const payload = await response.json() as {
    is_playing: boolean;
    progress_ms: number;
    item?: {
      name: string;
      duration_ms: number;
      artists: Array<{ name: string }>;
      album: { images: Array<{ url: string }> };
    };
  };

  if (!payload.item || !payload.is_playing) return new Response(null, { status: 204 });
  const snapshot = {
    isPlaying: payload.is_playing,
    is_playing: payload.is_playing,
    track: payload.item.name,
    name: payload.item.name,
    artist: payload.item.artists.map((artist) => artist.name).join(", "),
    imageUrl: payload.item.album.images[0]?.url ?? null,
    image: payload.item.album.images[0]?.url ?? null,
    progressMs: payload.progress_ms,
    progress_ms: payload.progress_ms,
    durationMs: payload.item.duration_ms,
    duration_ms: payload.item.duration_ms,
  };
  globalThis.__spotifyNowPlaying = { value: snapshot, expiresAt: Date.now() + 10_000 };
  return Response.json(snapshot, { headers: { "Cache-Control": "private, no-store" } });
}

export async function GET() {
  try {
    return await loadNowPlayingResponse();
  } catch {
    // Now Playing is ambient UI; a Spotify timeout must never hold or fail the
    // listening archive itself.
    return new Response(null, { status: 204 });
  }
}
