export type RecommendationTrack = {
  id: string; name: string; artist: string; artistId: string; imageUrl: string | null;
  identityArtist?: string; seed: string; familiar: boolean; score: number;
};

// Editions with another Spotify ID must not masquerade as an unheard song.
export function songKey(name: string, artist: string) {
  return `${artist.toLocaleLowerCase("en").trim()}|${name.toLocaleLowerCase("en")
    .replace(/\s*[-–(]\s*(?:\d{4}\s*)?(?:remaster(?:ed)?|deluxe|bonus|anniversary|explicit|clean|sped[ -]*up|slowed(?:[ -]*down)?|nightcore).*$/i, "")
    .replace(/\s+/g, " ").trim()}`;
}

export function chooseRecommendations(candidates: RecommendationTrack[], limit = 20) {
  const unique = new Map<string, RecommendationTrack>();
  for (const track of candidates.filter(t => t.id && t.name && t.artistId).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))) {
    const key = songKey(track.name, track.identityArtist ?? track.artist);
    if (!unique.has(key)) unique.set(key, track);
  }
  const pool = [...unique.values()];
  const selected: RecommendationTrack[] = [];
  const artistCounts = new Map<string, number>();
  const add = (familiar: boolean, maximum: number) => {
    for (const track of pool) {
      if (selected.length >= limit || maximum <= 0) break;
      if (track.familiar !== familiar || selected.includes(track) || (artistCounts.get(track.artistId) ?? 0) >= 3) continue;
      selected.push(track); artistCounts.set(track.artistId, (artistCounts.get(track.artistId) ?? 0) + 1); maximum--;
    }
  };
  add(false, Math.ceil(limit * .8));
  add(true, selected.length ? Math.min(Math.floor(limit * .2), Math.floor(selected.length / 4)) : Math.floor(limit * .2));
  add(false, limit - selected.length);
  // Spread artists and tuck familiar tracks between discoveries.
  const buckets = new Map<string, RecommendationTrack[]>();
  for (const track of selected.filter(t => !t.familiar)) {
    const bucket = buckets.get(track.seed) ?? [];
    bucket.push(track); buckets.set(track.seed, bucket);
  }
  const discoveries: RecommendationTrack[] = [];
  while ([...buckets.values()].some(b => b.length)) {
    for (const bucket of buckets.values()) if (bucket.length) discoveries.push(bucket.shift()!);
  }
  const positions = new Map<RecommendationTrack, number>();
  discoveries.forEach((track, i) => positions.set(track, i));
  selected.filter(t => t.familiar).forEach((track, i) => positions.set(track, 3.5 + i * 5));
  return selected.sort((a, b) => positions.get(a)! - positions.get(b)!);
}
