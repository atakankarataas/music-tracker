CREATE INDEX IF NOT EXISTS idx_scrobbles_artist_name_played_at
ON public.scrobbles (artist_name, played_at DESC);

CREATE INDEX IF NOT EXISTS idx_scrobbles_album_name_played_at
ON public.scrobbles (album_name, played_at DESC)
WHERE album_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scrobbles_track_name_played_at
ON public.scrobbles (track_name, played_at DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_music_totals AS
SELECT
    true AS singleton,
    count(*)::bigint AS total_plays,
    count(DISTINCT artist_name)::bigint AS artists,
    count(DISTINCT spotify_id)::bigint AS tracks,
    count(DISTINCT album_name)::bigint AS albums,
    count(DISTINCT (played_at AT TIME ZONE 'Europe/Istanbul')::date)::bigint AS days_listened,
    min(played_at) AS first_play,
    max(played_at) AS last_play
FROM public.scrobbles;

CREATE UNIQUE INDEX IF NOT EXISTS mv_music_totals_singleton_idx
ON public.mv_music_totals (singleton);

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_music_artist_totals AS
SELECT
    artist_name,
    count(*)::bigint AS plays,
    max(image_url) FILTER (WHERE image_url IS NOT NULL) AS image_url,
    max(artist_id) FILTER (WHERE artist_id IS NOT NULL) AS artist_id,
    min(played_at) AS first_play,
    max(played_at) AS last_play
FROM public.scrobbles
GROUP BY artist_name;

CREATE UNIQUE INDEX IF NOT EXISTS mv_music_artist_totals_name_idx
ON public.mv_music_artist_totals (artist_name);

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_music_track_totals AS
SELECT
    md5(coalesce(spotify_id, '') || E'\x1f' || track_name || E'\x1f' || artist_name) AS entity_key,
    spotify_id,
    track_name,
    artist_name,
    count(*)::bigint AS plays,
    max(image_url) FILTER (WHERE image_url IS NOT NULL) AS image_url,
    max(album_id) FILTER (WHERE album_id IS NOT NULL) AS album_id,
    min(played_at) AS first_play,
    max(played_at) AS last_play
FROM public.scrobbles
GROUP BY spotify_id, track_name, artist_name;

CREATE UNIQUE INDEX IF NOT EXISTS mv_music_track_totals_key_idx
ON public.mv_music_track_totals (entity_key);

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_music_album_totals AS
SELECT
    md5(coalesce(album_id, '') || E'\x1f' || album_name || E'\x1f' || artist_name) AS entity_key,
    album_id,
    album_name,
    artist_name,
    count(*)::bigint AS plays,
    max(image_url) FILTER (WHERE image_url IS NOT NULL) AS image_url,
    min(played_at) AS first_play,
    max(played_at) AS last_play
FROM public.scrobbles
WHERE album_name IS NOT NULL
GROUP BY album_id, album_name, artist_name;

CREATE UNIQUE INDEX IF NOT EXISTS mv_music_album_totals_key_idx
ON public.mv_music_album_totals (entity_key);

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_music_daily_counts AS
SELECT
    (played_at AT TIME ZONE 'Europe/Istanbul')::date AS day,
    count(*)::bigint AS plays
FROM public.scrobbles
GROUP BY 1;

CREATE UNIQUE INDEX IF NOT EXISTS mv_music_daily_counts_day_idx
ON public.mv_music_daily_counts (day);

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_music_hour_counts AS
SELECT
    extract(hour FROM played_at AT TIME ZONE 'Europe/Istanbul')::smallint AS hour,
    count(*)::bigint AS plays
FROM public.scrobbles
GROUP BY 1;

CREATE UNIQUE INDEX IF NOT EXISTS mv_music_hour_counts_hour_idx
ON public.mv_music_hour_counts (hour);

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_music_weekday_counts AS
SELECT
    extract(isodow FROM played_at AT TIME ZONE 'Europe/Istanbul')::smallint AS day_number,
    count(*)::bigint AS plays
FROM public.scrobbles
GROUP BY 1;

CREATE UNIQUE INDEX IF NOT EXISTS mv_music_weekday_counts_day_idx
ON public.mv_music_weekday_counts (day_number);

GRANT SELECT ON TABLE
    public.mv_music_totals,
    public.mv_music_artist_totals,
    public.mv_music_track_totals,
    public.mv_music_album_totals,
    public.mv_music_daily_counts,
    public.mv_music_hour_counts,
    public.mv_music_weekday_counts
TO music_web_reader;

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'refresh-music-rollups';

SELECT cron.schedule(
    'refresh-music-rollups',
    '*/15 * * * *',
    $job$
      REFRESH MATERIALIZED VIEW public.mv_music_totals;
      REFRESH MATERIALIZED VIEW public.mv_music_artist_totals;
      REFRESH MATERIALIZED VIEW public.mv_music_track_totals;
      REFRESH MATERIALIZED VIEW public.mv_music_album_totals;
      REFRESH MATERIALIZED VIEW public.mv_music_daily_counts;
      REFRESH MATERIALIZED VIEW public.mv_music_hour_counts;
      REFRESH MATERIALIZED VIEW public.mv_music_weekday_counts;
    $job$
);
