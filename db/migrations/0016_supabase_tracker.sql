-- Move scheduling to the existing Supabase project. Activation is a separate
-- deployment step, after authenticated/dry-run/duplicate-write checks pass.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

ALTER TABLE public.music_sync_runs
  ADD COLUMN source text NOT NULL DEFAULT 'github_actions'
  CHECK (source IN ('github_actions','supabase_edge','manual'));

CREATE TABLE public.music_sync_lease (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  owner text NOT NULL,
  expires_at timestamptz NOT NULL
);
ALTER TABLE public.music_sync_lease ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.music_sync_lease FROM PUBLIC,anon,authenticated,music_web_reader;

CREATE FUNCTION public.music_trigger_spotify_sync(recovery boolean DEFAULT false)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE endpoint text; bearer text;
BEGIN
  SELECT decrypted_secret INTO endpoint FROM vault.decrypted_secrets
    WHERE name='music_tracker_endpoint';
  SELECT decrypted_secret INTO bearer FROM vault.decrypted_secrets
    WHERE name='music_tracker_trigger_secret';
  IF endpoint IS NULL OR bearer IS NULL THEN
    RAISE EXCEPTION 'Spotify tracker deployment is not configured';
  END IF;
  RETURN net.http_post(
    url := endpoint,
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer ' || bearer,'x-region','ap-northeast-1'),
    body := jsonb_build_object('recovery',recovery),
    timeout_milliseconds := 120000
  );
END $$;
REVOKE ALL ON FUNCTION public.music_trigger_spotify_sync(boolean) FROM PUBLIC,anon,authenticated,music_web_reader;

-- Bound only the new provider's operational logs; listening records and the
-- existing GitHub audit history are not affected.
CREATE FUNCTION public.music_cleanup_edge_logs() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  DELETE FROM public.music_sync_runs
    WHERE source='supabase_edge' AND finished_at < now()-interval '14 days';
  DELETE FROM cron.job_run_details WHERE end_time < now()-interval '14 days'
    AND jobid IN (SELECT jobid FROM cron.job WHERE jobname IN (
      'spotify-sync','spotify-sync-recovery','spotify-sync-log-retention'));
END $$;
REVOKE ALL ON FUNCTION public.music_cleanup_edge_logs() FROM PUBLIC,anon,authenticated,music_web_reader;
