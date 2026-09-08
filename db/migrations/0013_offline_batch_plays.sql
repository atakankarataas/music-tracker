-- Spotify stamps a whole batch of offline plays with a single second when the
-- device reconnects and flushes them. UNIQUE (played_at) could therefore store
-- only the first play of each batch, dropping valid listening history.
--
-- Identity moves to (played_at, spotify_id). NULLS NOT DISTINCT matters because
-- a local file carries no Spotify id: without it, Postgres would treat every
-- NULL as unique and let the same untitled play accumulate on re-import.
--
-- Cross-source deduplication does not depend on this index any more. Since
-- ingest/storage.py both the tracker and the importer match candidates within
-- three seconds under one advisory lock before inserting, which is what
-- actually prevents the millisecond-precision API and the second-precision
-- export from double-counting the same play.
--
-- idx_played_at already covers played_at DESC, so dropping the unique index
-- does not slow the recency queries the UI depends on.

ALTER TABLE public.scrobbles DROP CONSTRAINT scrobbles_played_at_key;

ALTER TABLE public.scrobbles ADD CONSTRAINT scrobbles_play_identity_key
  UNIQUE NULLS NOT DISTINCT (played_at, spotify_id);
