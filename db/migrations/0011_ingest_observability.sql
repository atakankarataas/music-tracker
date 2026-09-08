ALTER TABLE public.scrobbles
  ADD COLUMN IF NOT EXISTS ingest_sources text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ms_played integer CHECK (ms_played >= 0),
  ADD COLUMN IF NOT EXISTS duration_ms integer CHECK (duration_ms >= 0),
  ADD COLUMN IF NOT EXISTS skipped boolean,
  ADD COLUMN IF NOT EXISTS offline boolean;

CREATE TABLE public.music_sync_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running','success','warning','failed')),
  mode text NOT NULL,
  pages integer NOT NULL DEFAULT 0,
  fetched integer NOT NULL DEFAULT 0,
  inserted integer NOT NULL DEFAULT 0,
  newest_play timestamptz,
  stop_reason text,
  error_code text,
  github_run_id text
);
CREATE INDEX ON public.music_sync_runs (started_at DESC);
ALTER TABLE public.music_sync_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.music_sync_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.music_sync_runs TO music_web_reader;
CREATE POLICY music_sync_read ON public.music_sync_runs FOR SELECT TO music_web_reader USING (true);

CREATE TABLE public.music_notes (
  period_key text PRIMARY KEY CHECK (period_key ~ '^[0-9]{4}-[0-9]{2}$'),
  body text NOT NULL CHECK (length(body) <= 4000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.music_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.music_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.music_notes TO music_web_reader;
CREATE POLICY music_notes_private ON public.music_notes TO music_web_reader USING (true) WITH CHECK (true);

CREATE TABLE public.music_login_attempts (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL
);
ALTER TABLE public.music_login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.music_login_attempts FROM PUBLIC, anon, authenticated, music_web_reader;
CREATE FUNCTION public.music_login_allowed(attempt_key text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE current_attempts integer;
BEGIN
  IF length(attempt_key) <> 64 THEN RETURN false; END IF;
  DELETE FROM public.music_login_attempts WHERE window_start < now() - interval '1 day';
  INSERT INTO public.music_login_attempts AS a VALUES (attempt_key, now(), 1)
  ON CONFLICT (key) DO UPDATE SET
    attempts = CASE WHEN a.window_start < now() - interval '15 minutes' THEN 1 ELSE a.attempts + 1 END,
    window_start = CASE WHEN a.window_start < now() - interval '15 minutes' THEN now() ELSE a.window_start END
  RETURNING attempts INTO current_attempts;
  RETURN current_attempts <= 10;
END $$;
REVOKE ALL ON FUNCTION public.music_login_allowed(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_login_allowed(text) TO music_web_reader;
