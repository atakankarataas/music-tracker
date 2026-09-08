"""Shared, serialized import/tracker writes; preserves export listening duration."""
from datetime import datetime, timezone
from psycopg2.extras import execute_values

COLUMNS = ('track_name', 'artist_name', 'album_name', 'played_at', 'spotify_id',
           'image_url', 'album_id', 'artist_id', 'duration_ms', 'ms_played', 'skipped', 'offline', 'source')

def parse_time(value):
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)

def deduplicate_batch(plays):
    """Only collapse close entries of the same track, never two different tracks."""
    seen = {}
    result = []
    for play in sorted(plays, key=lambda p: parse_time(p['played_at'])):
        key = play.get('spotify_id') or (play['track_name'], play['artist_name'])
        at = parse_time(play['played_at'])
        if key in seen and (at - seen[key]).total_seconds() <= 3:
            continue
        seen[key] = at
        result.append(play)
    return result

def store_plays(cur, plays):
    plays = deduplicate_batch(plays)
    if not plays:
        return 0
    # Import and tracker take the same transaction lock before matching/inserting.
    cur.execute("SELECT pg_advisory_xact_lock(734201911)")
    cur.execute("""CREATE TEMP TABLE IF NOT EXISTS music_candidates (
      track_name text, artist_name text, album_name text, played_at timestamptz,
      spotify_id text, image_url text, album_id text, artist_id text,
      duration_ms integer, ms_played integer, skipped boolean, offline boolean, source text
    ) ON COMMIT DROP""")
    cur.execute("TRUNCATE pg_temp.music_candidates")
    execute_values(cur, 'INSERT INTO pg_temp.music_candidates VALUES %s',
                   [tuple(p.get(k) for k in COLUMNS) for p in plays], page_size=1000)
    match = """s.played_at BETWEEN c.played_at - interval '3 seconds' AND c.played_at + interval '3 seconds'
      AND (s.spotify_id = c.spotify_id OR ((s.spotify_id IS NULL OR c.spotify_id IS NULL)
        AND s.track_name = c.track_name AND s.artist_name = c.artist_name))"""
    cur.execute(f"""UPDATE public.scrobbles s SET
      image_url = COALESCE(s.image_url,c.image_url), album_id = COALESCE(s.album_id,c.album_id),
      artist_id = COALESCE(s.artist_id,c.artist_id), spotify_id = COALESCE(s.spotify_id,c.spotify_id),
      duration_ms = COALESCE(s.duration_ms,c.duration_ms), ms_played = COALESCE(c.ms_played,s.ms_played),
      skipped = COALESCE(c.skipped,s.skipped), offline = COALESCE(c.offline,s.offline),
      ingest_sources = ARRAY(SELECT DISTINCT unnest(s.ingest_sources || ARRAY[c.source]))
      FROM pg_temp.music_candidates c WHERE {match}""")
    cur.execute(f"""INSERT INTO public.scrobbles (
      track_name,artist_name,album_name,played_at,spotify_id,image_url,album_id,artist_id,
      duration_ms,ms_played,skipped,offline,ingest_sources)
      SELECT c.track_name,c.artist_name,c.album_name,c.played_at,c.spotify_id,c.image_url,c.album_id,c.artist_id,
        c.duration_ms,c.ms_played,c.skipped,c.offline,ARRAY[c.source]
      FROM pg_temp.music_candidates c WHERE NOT EXISTS (SELECT 1 FROM public.scrobbles s WHERE {match})
      ON CONFLICT (played_at, spotify_id) DO NOTHING""")
    return cur.rowcount
