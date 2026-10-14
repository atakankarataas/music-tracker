export type Artist = { id?: string; name?: string };
export type SpotifyTrack = {
  id?: string;
  name?: string;
  duration_ms?: number;
  artists?: Artist[];
  album?: { id?: string; name?: string; images?: { url: string }[] };
};
export type HistoryItem = { played_at: string; track: SpotifyTrack };
export type HistoryPage = {
  items?: HistoryItem[];
  cursors?: { before?: string | null };
};
export type Play = {
  track_name: string;
  artist_name: string;
  album_name: string;
  played_at: string;
  spotify_id: string | null;
  image_url: string | null;
  album_id: string | null;
  artist_id: string | null;
  duration_ms: number | null;
  source: "api";
};
export type Credit = {
  spotify_id: string;
  position: number;
  artist_id: string;
  artist_name: string;
  is_featured: boolean;
};
export type HistoryResult = {
  items: HistoryItem[];
  pages: number;
  stopReason: string;
};

export function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

export async function fetchHistory(
  fetchPage: (before?: number) => Promise<HistoryPage>,
  options: {
    cutoff: number;
    watermark: number | null;
    recovery: boolean;
    maxPages?: number;
  },
): Promise<HistoryResult> {
  const found = new Map<string, HistoryItem>();
  const cursors = new Set<number>();
  let before: number | undefined,
    pages = 0,
    overlaps = 0,
    stopReason = "page limit";
  for (let page = 0; page < (options.maxPages ?? 20); page++) {
    const response = await fetchPage(before);
    pages++;
    const items = response.items ?? [];
    if (!items.length) {
      stopReason = "no more Spotify history";
      break;
    }
    const dates: number[] = [];
    for (const item of items) {
      const at = time(item.played_at);
      if (at === null) continue;
      dates.push(at);
      if (at >= options.cutoff) {
        const key = item.track?.id ??
          JSON.stringify([
            item.track?.name,
            item.track?.artists?.map((a) => a.name),
          ]);
        found.set(JSON.stringify([at, key]), item);
      }
    }
    if (!dates.length) {
      stopReason = "page contained no valid timestamps";
      break;
    }
    const oldest = Math.min(...dates);
    if (oldest <= options.cutoff) {
      stopReason = "lookback boundary reached";
      break;
    }
    if (
      !options.recovery && options.watermark !== null &&
      oldest <= options.watermark
    ) {
      if (++overlaps >= 2) {
        stopReason = "database overlap reached";
        break;
      }
    }
    const raw = response.cursors?.before;
    const candidate = raw && /^\d+$/.test(raw) ? Number(raw) : oldest;
    if (!Number.isSafeInteger(candidate) || cursors.has(candidate)) {
      stopReason = "cursor stopped advancing";
      break;
    }
    cursors.add(candidate);
    before = candidate;
  }
  return {
    items: [...found.values()].sort((a, b) =>
      time(a.played_at)! - time(b.played_at)!
    ),
    pages,
    stopReason,
  };
}

export function deduplicate(plays: Play[]): Play[] {
  const last = new Map<string, number>();
  return [...plays].sort((a, b) => time(a.played_at)! - time(b.played_at)!)
    .filter((play) => {
      const key = play.spotify_id ??
        JSON.stringify([play.track_name, play.artist_name]);
      const at = time(play.played_at)!;
      const previous = last.get(key);
      if (previous !== undefined && at - previous <= 3_000) return false;
      last.set(key, at);
      return true;
    });
}

function normalise(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replaceAll("$", "s").replaceAll("&", " ").replace(/[^a-z0-9 ]/g, " ");
}

export function prepare(
  items: HistoryItem[],
): { plays: Play[]; credits: Credit[] } {
  const plays: Play[] = [], tracks = new Map<string, SpotifyTrack>();
  for (
    const item of [...items].sort((a, b) =>
      (time(a.played_at) ?? 0) - (time(b.played_at) ?? 0)
    )
  ) {
    const track = item.track,
      artist = track?.artists?.[0],
      album = track?.album;
    if (
      !track?.name || !artist?.name || !album?.name ||
      time(item.played_at) === null
    ) continue;
    const images = album.images ?? [];
    plays.push({
      track_name: track.name,
      artist_name: artist.name,
      album_name: album.name,
      played_at: item.played_at,
      spotify_id: track.id ?? null,
      image_url: images[Math.min(1, images.length - 1)]?.url ?? null,
      album_id: album.id ?? null,
      artist_id: artist.id ?? null,
      duration_ms:
        Number.isInteger(track.duration_ms) && track.duration_ms! >= 0
          ? track.duration_ms!
          : null,
      source: "api",
    });
    if (track.id) tracks.set(track.id, track);
  }
  const credits: Credit[] = [];
  for (const [id, track] of tracks) {
    const seen = new Set<string>();
    const guests = normalise(
      track.name?.match(/[\(\[]\s*(?:feat|ft|with)[\.\s]([^\)\]]*)[\)\]]/i)
        ?.[1] ?? "",
    );
    for (const [position, artist] of (track.artists ?? []).entries()) {
      if (!artist.id || !artist.name || seen.has(artist.id)) continue;
      seen.add(artist.id);
      const name = normalise(artist.name),
        words = name.split(" ").filter((w) => w.length > 2);
      const featured = position > 0 && !!guests &&
        (guests.includes(name) ||
          !!words.length && words.every((w) => guests.includes(w)));
      credits.push({
        spotify_id: id,
        position,
        artist_id: artist.id,
        artist_name: artist.name,
        is_featured: featured,
      });
    }
  }
  return { plays: deduplicate(plays), credits };
}

export async function authorized(
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!header?.startsWith("Bearer ") || secret.length < 32) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all(
    [header.slice(7), secret].map((v) =>
      crypto.subtle.digest("SHA-256", encoder.encode(v))
    ),
  );
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}

export function incomplete(
  result: HistoryResult,
  watermark: number | null,
): boolean {
  const oldest = Math.min(
    ...result.items.map((i) => time(i.played_at)!).filter((v) => v !== null),
  );
  return result.stopReason === "page limit" || result.items.length >= 50 &&
      (watermark === null || oldest > watermark) &&
      result.stopReason === "no more Spotify history";
}
