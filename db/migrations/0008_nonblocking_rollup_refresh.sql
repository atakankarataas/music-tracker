-- A plain materialized-view refresh takes an ACCESS EXCLUSIVE lock. The old
-- cron job therefore froze every page reading a rollup for the full refresh
-- (96 seconds in the slowest observed run). Every view below has the unique
-- index PostgreSQL requires for a concurrent refresh, so readers can continue
-- using the previous snapshot while the next one is built.

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'refresh-music-rollups';

SELECT cron.schedule(
    'refresh-music-rollups',
    '*/15 * * * *',
    $job$
      REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_music_totals;
      REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_music_artist_totals;
      REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_music_track_totals;
      REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_music_album_totals;
      REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_music_daily_counts;
      REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_music_hour_counts;
      REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_music_weekday_counts;
      REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_music_artist_daily;
      REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_music_album_daily;
      REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_music_track_daily;
      REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_music_album_track_totals;
    $job$
);
