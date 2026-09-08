-- Keep realtime-facing summaries fresh without rebuilding all eleven views in
-- the same storage/CPU burst. Every refresh remains concurrent, and the jobs
-- are deliberately staggered so only one begins in a given minute.

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname IN (
  'refresh-music-rollups',
  'refresh-music-totals',
  'refresh-music-daily',
  'refresh-music-artists',
  'refresh-music-tracks',
  'refresh-music-albums',
  'refresh-music-patterns',
  'refresh-music-details'
);

SELECT cron.schedule(
  'refresh-music-totals',
  '1,6,11,16,21,26,31,36,41,46,51,56 * * * *',
  'REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_music_totals'
);

SELECT cron.schedule(
  'refresh-music-daily',
  '2,7,12,17,22,27,32,37,42,47,52,57 * * * *',
  'REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_music_daily_counts'
);

SELECT cron.schedule(
  'refresh-music-artists',
  '3,18,33,48 * * * *',
  'REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_music_artist_totals'
);

SELECT cron.schedule(
  'refresh-music-tracks',
  '4,19,34,49 * * * *',
  'REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_music_track_totals'
);

SELECT cron.schedule(
  'refresh-music-albums',
  '5,20,35,50 * * * *',
  'REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_music_album_totals'
);

SELECT cron.schedule(
  'refresh-music-patterns',
  '8 * * * *',
  $job$
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_music_hour_counts;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_music_weekday_counts;
  $job$
);

SELECT cron.schedule(
  'refresh-music-details',
  '13 * * * *',
  $job$
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_music_artist_daily;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_music_album_daily;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_music_track_daily;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_music_album_track_totals;
  $job$
);
