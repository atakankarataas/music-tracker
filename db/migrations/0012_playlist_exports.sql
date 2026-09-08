CREATE TABLE public.music_playlist_exports (
  request_id uuid PRIMARY KEY,
  fingerprint text NOT NULL,
  status text NOT NULL CHECK(status IN ('creating','adding','complete','failed')),
  spotify_id text,
  url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.music_playlist_exports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.music_playlist_exports FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.music_playlist_exports TO music_web_reader;
CREATE POLICY music_playlist_exports_private ON public.music_playlist_exports TO music_web_reader USING(true) WITH CHECK(true);
