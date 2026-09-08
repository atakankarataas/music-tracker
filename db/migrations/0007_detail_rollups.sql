CREATE INDEX IF NOT EXISTS mv_music_track_totals_artist_plays_idx
ON public.mv_music_track_totals (artist_name, plays DESC);

CREATE INDEX IF NOT EXISTS mv_music_track_totals_spotify_idx
ON public.mv_music_track_totals (spotify_id);

CREATE INDEX IF NOT EXISTS mv_music_album_totals_album_id_idx
ON public.mv_music_album_totals (album_id);

CREATE INDEX IF NOT EXISTS mv_music_album_totals_album_name_idx
ON public.mv_music_album_totals (album_name);

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_music_artist_daily AS
SELECT
    (played_at AT TIME ZONE 'Europe/Istanbul')::date AS day,
    artist_name,
    count(*)::bigint AS plays
FROM public.scrobbles
GROUP BY 1, 2;

CREATE UNIQUE INDEX IF NOT EXISTS mv_music_artist_daily_key_idx
ON public.mv_music_artist_daily (day, artist_name);

CREATE INDEX IF NOT EXISTS mv_music_artist_daily_artist_day_idx
ON public.mv_music_artist_daily (artist_name, day DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_music_album_daily AS
SELECT
    (played_at AT TIME ZONE 'Europe/Istanbul')::date AS day,
    md5(coalesce(album_id, '') || E'\x1f' || album_name || E'\x1f' || artist_name) AS entity_key,
    album_id,
    album_name,
    artist_name,
    count(*)::bigint AS plays
FROM public.scrobbles
WHERE album_name IS NOT NULL
GROUP BY 1, album_id, album_name, artist_name;

CREATE UNIQUE INDEX IF NOT EXISTS mv_music_album_daily_key_idx
ON public.mv_music_album_daily (day, entity_key);

CREATE INDEX IF NOT EXISTS mv_music_album_daily_id_day_idx
ON public.mv_music_album_daily (album_id, day DESC);

CREATE INDEX IF NOT EXISTS mv_music_album_daily_name_day_idx
ON public.mv_music_album_daily (album_name, day DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_music_track_daily AS
SELECT
    (played_at AT TIME ZONE 'Europe/Istanbul')::date AS day,
    md5(coalesce(spotify_id, '') || E'\x1f' || track_name || E'\x1f' || artist_name) AS entity_key,
    spotify_id,
    track_name,
    artist_name,
    count(*)::bigint AS plays
FROM public.scrobbles
GROUP BY 1, spotify_id, track_name, artist_name;

CREATE UNIQUE INDEX IF NOT EXISTS mv_music_track_daily_key_idx
ON public.mv_music_track_daily (day, entity_key);

CREATE INDEX IF NOT EXISTS mv_music_track_daily_id_day_idx
ON public.mv_music_track_daily (spotify_id, day DESC);

CREATE INDEX IF NOT EXISTS mv_music_track_daily_name_day_idx
ON public.mv_music_track_daily (track_name, day DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_music_album_track_totals AS
SELECT
    md5(
        coalesce(album_id, '') || E'\x1f' || album_name || E'\x1f' || artist_name ||
        E'\x1f' || coalesce(spotify_id, '') || E'\x1f' || track_name
    ) AS entity_key,
    album_id,
    album_name,
    artist_name,
    spotify_id,
    track_name,
    count(*)::bigint AS plays,
    max(image_url) FILTER (WHERE image_url IS NOT NULL) AS image_url
FROM public.scrobbles
WHERE album_name IS NOT NULL
GROUP BY album_id, album_name, artist_name, spotify_id, track_name;

CREATE UNIQUE INDEX IF NOT EXISTS mv_music_album_track_totals_key_idx
ON public.mv_music_album_track_totals (entity_key);

CREATE INDEX IF NOT EXISTS mv_music_album_track_totals_id_plays_idx
ON public.mv_music_album_track_totals (album_id, plays DESC);

CREATE INDEX IF NOT EXISTS mv_music_album_track_totals_name_plays_idx
ON public.mv_music_album_track_totals (album_name, plays DESC);

GRANT SELECT ON TABLE
    public.mv_music_artist_daily,
    public.mv_music_album_daily,
    public.mv_music_track_daily,
    public.mv_music_album_track_totals
TO music_web_reader;

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
      REFRESH MATERIALIZED VIEW public.mv_music_artist_daily;
      REFRESH MATERIALIZED VIEW public.mv_music_album_daily;
      REFRESH MATERIALIZED VIEW public.mv_music_track_daily;
      REFRESH MATERIALIZED VIEW public.mv_music_album_track_totals;
    $job$
);
