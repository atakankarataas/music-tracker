-- A play credits every artist on the track, not just the first one.
--
-- `scrobbles.artist_name` holds one name, taken from the API's first artist or
-- the export's album artist. On "Mümkünse" that is BEGE, so Güneş received no
-- credit for 33 plays. Across 2026, a quarter of played tracks carry more than
-- one artist and those tracks account for 23.9% of plays, which was enough to
-- put the wrong artist at number one.
--
-- Calibrating against eight years of real Wrapped screenshots showed Spotify
-- credits a co-primary artist in full and a featured artist only marginally, so
-- the credit has to be stored per artist rather than derived from one column.
-- `is_featured` records whether the track title marks that artist with
-- "(feat. …)", which is the only signal Spotify's catalogue exposes: the track
-- object lists every artist in order but never says which are guests.

CREATE TABLE public.music_track_artists (
  spotify_id  text     NOT NULL,
  position    smallint NOT NULL CHECK (position >= 0),
  artist_id   text     NOT NULL,
  artist_name text     NOT NULL,
  is_featured boolean  NOT NULL DEFAULT false,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (spotify_id, position)
);

CREATE INDEX idx_music_track_artists_artist ON public.music_track_artists (artist_id);
CREATE INDEX idx_music_track_artists_name   ON public.music_track_artists (artist_name);

ALTER TABLE public.music_track_artists ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.music_track_artists FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.music_track_artists TO music_web_reader;
CREATE POLICY music_track_artists_read ON public.music_track_artists
  FOR SELECT TO music_web_reader USING (true);
