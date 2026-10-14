export type RecommendationTrack = {
  id: string; name: string; artist: string; artistId: string; imageUrl: string | null;
  identityArtist?: string; seed: string; familiar: boolean; score: number;
};

// Editions with another Spotify ID must not masquerade as an unheard song.
export function songKey(name: string, artist: string) {
  return `${artist.toLocaleLowerCase("en").trim()}|${name.toLocaleLowerCase("en")
    .replace(/\s*[-–(]\s*(?:\d{4}\s*)?(?:remaster(?:ed)?|deluxe|bonus|anniversary|explicit|clean).*$/i, "")
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
  const positions = new Map<RecommendationTrack, number>();
  let fresh = 0, familiar = 0;
  for (const track of selected) positions.set(track, track.familiar ? 3.5 + familiar++ * 5 : fresh++);
  return selected.sort((a, b) => positions.get(a)! - positions.get(b)!);
}
