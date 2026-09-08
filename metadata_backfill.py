"""Bounded metadata enrichment, independent of listening ingestion."""
import os
import time
import psycopg2
import spotipy
from psycopg2.extras import execute_batch
from spotipy.oauth2 import SpotifyOAuth
from ingest.migrate import load_local_env
from ingest.spotify_auth import SPOTIFY_SCOPES
from tracker import infer_mood


def copy_known_metadata(cur):
    cur.execute("""WITH known AS (
      SELECT spotify_id, max(image_url) AS image_url, max(album_id) AS album_id,
        max(artist_id) AS artist_id, max(duration_ms) AS duration_ms
      FROM public.scrobbles WHERE spotify_id IS NOT NULL GROUP BY spotify_id
    ) UPDATE public.scrobbles s SET image_url=coalesce(s.image_url,k.image_url),
      album_id=coalesce(s.album_id,k.album_id), artist_id=coalesce(s.artist_id,k.artist_id),
      duration_ms=coalesce(s.duration_ms,k.duration_ms)
      FROM known k WHERE s.spotify_id=k.spotify_id AND (
        (s.image_url IS NULL AND k.image_url IS NOT NULL) OR
        (s.album_id IS NULL AND k.album_id IS NOT NULL) OR
        (s.artist_id IS NULL AND k.artist_id IS NOT NULL) OR
        (s.duration_ms IS NULL AND k.duration_ms IS NOT NULL))""")
    return cur.rowcount


class CatalogReader:
    """Use supported batch reads; automatically fall back for Development Mode."""
    def __init__(self, spotify):
        self.spotify = spotify
        self.batch = {'tracks': True, 'artists': True}

    def get(self, kind, ids):
        if self.batch[kind]:
            try:
                return getattr(self.spotify, kind)(ids).get(kind) or []
            except spotipy.SpotifyException as exc:
                if exc.http_status not in (400,403,404):
                    raise
                self.batch[kind] = False
        single = 'track' if kind == 'tracks' else 'artist'
        return [getattr(self.spotify, single)(item) for item in ids]


def main():
    load_local_env()
    conn = psycopg2.connect(os.environ['DB_URI'], connect_timeout=15)
    with conn.cursor() as cur:
        copied = copy_known_metadata(cur)
    conn.commit()
    print(f'Reused known metadata for {copied} plays.')
    if os.environ.get('METADATA_LOCAL_ONLY') == '1':
        conn.close()
        return
    token_info = os.environ.get('SPOTIPY_CACHE')
    cache_path = os.environ.get('SPOTIPY_CACHE_PATH', '.cache')
    if token_info:
        with open(cache_path, 'w', encoding='utf-8') as file:
            file.write(token_info)
    sp = spotipy.Spotify(auth_manager=SpotifyOAuth(
        client_id=os.environ['SPOTIPY_CLIENT_ID'], client_secret=os.environ['SPOTIPY_CLIENT_SECRET'],
        redirect_uri=os.environ.get('SPOTIPY_REDIRECT_URI', 'http://127.0.0.1:8888/callback'),
        scope=SPOTIFY_SCOPES, cache_path=cache_path, open_browser=False),
        requests_timeout=10, retries=0, status_retries=0)
    with conn.cursor() as cur:
        cur.execute("""SELECT spotify_id FROM public.scrobbles WHERE spotify_id IS NOT NULL
          AND (image_url IS NULL OR artist_genres IS NULL OR album_id IS NULL)
          GROUP BY spotify_id ORDER BY count(*) FILTER (WHERE image_url IS NULL) DESC, max(played_at) DESC
          LIMIT %s""", (int(os.environ.get('METADATA_BACKFILL_LIMIT', '200')),))
        ids = [r[0] for r in cur.fetchall()]
    artists = {}
    deadline = time.monotonic() + int(os.environ.get('METADATA_TIME_BUDGET_SECONDS','240'))
    completed = 0
    errors = 0
    catalog = CatalogReader(sp)
    for offset in range(0, len(ids), 50):
        if time.monotonic() >= deadline:
            break
        batch_ids = ids[offset:offset+50]
        try:
            tracks = catalog.get('tracks', batch_ids)
            artist_ids = list(dict.fromkeys(
                artist['id'] for track in tracks if track
                for artist in (track.get('artists') or [])[:1]
                if artist.get('id') and artist['id'] not in artists))
            for artist in catalog.get('artists', artist_ids) if artist_ids else []:
                if artist:
                    artists[artist['id']] = artist.get('genres') or []
            updates = []
            for track_id, track in zip(batch_ids, tracks):
                if not track:
                    continue
                album = track.get('album') or {}
                artist = (track.get('artists') or [{}])[0]
                artist_id = artist.get('id')
                genres = artists.get(artist_id, [])
                images = album.get('images') or []
                image = images[min(1,len(images)-1)]['url'] if images else None
                updates.append((image,album.get('id'),artist_id,genres,
                    infer_mood(track.get('name'),genres),track.get('duration_ms'),track_id))
            with conn.cursor() as cur:
                execute_batch(cur, """UPDATE public.scrobbles SET
                  image_url=coalesce(image_url,%s),album_id=coalesce(album_id,%s),
                  artist_id=coalesce(artist_id,%s),artist_genres=coalesce(artist_genres,%s),
                  mood_label=coalesce(mood_label,%s),duration_ms=coalesce(duration_ms,%s)
                  WHERE spotify_id=%s""", updates, page_size=50)
            conn.commit()
            completed += len(updates)
            print(f'Metadata progress: {completed}/{len(ids)} tracks.', flush=True)
        except Exception as exc:
            conn.rollback()
            errors += 1
            print(f'Metadata request failed ({type(exc).__name__})',flush=True)
            if getattr(exc,'http_status',None) in (401,403,429) or errors >= 5:
                break
    conn.close()
    print(f'Metadata complete: {completed} tracks, {errors} errors. Listening history is independent.')
    if errors:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
