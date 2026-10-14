-- One read model for every page. Raw import/API records remain untouched.
CREATE SCHEMA music_read;
REVOKE ALL ON SCHEMA music_read FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA music_read TO music_web_reader;

-- Numerical coefficients are an estimate, calibrated against supplied Wrapped
-- rankings. Spotify publishes primary > secondary, not the coefficients/roles.
CREATE FUNCTION music_read.artist_credit_weight(credit_position smallint)
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT CASE WHEN credit_position > 0 THEN 0.35 ELSE 1.0 END $$;
REVOKE ALL ON FUNCTION music_read.artist_credit_weight(smallint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION music_read.artist_credit_weight(smallint) TO music_web_reader;

CREATE VIEW music_read.scrobbles WITH (security_invoker=true) AS
SELECT s.*,1.0::numeric AS play_weight FROM public.scrobbles s
WHERE (ms_played IS NULL OR ms_played > 30000) AND incognito_mode IS NOT TRUE;

DO $artist_view$
DECLARE columns text;
BEGIN
  SELECT string_agg(CASE column_name
    WHEN 'artist_name' THEN 'coalesce(c.artist_name,s.artist_name) AS artist_name'
    WHEN 'artist_id' THEN 'coalesce(c.artist_id,s.artist_id) AS artist_id'
    ELSE format('s.%I',column_name) END,', ' ORDER BY ordinal_position)
  INTO columns FROM information_schema.columns
  WHERE table_schema='public' AND table_name='scrobbles';
  EXECUTE format('CREATE VIEW music_read.artist_plays WITH (security_invoker=true) AS
    SELECT %s, music_read.artist_credit_weight(c.position::smallint) AS play_weight
    FROM music_read.scrobbles s LEFT JOIN (
      SELECT spotify_id,artist_id,max(artist_name) AS artist_name,min(position) AS position
      FROM public.music_track_artists GROUP BY spotify_id,artist_id
    ) c ON c.spotify_id=s.spotify_id',columns);
END $artist_view$;

-- Lightweight live summary views avoid duplicating the existing 140 MB of
-- materialized archive snapshots, and keep cross-page totals equally fresh.
DO $summaries$
DECLARE relation record; definition text; source text;
BEGIN
  FOR relation IN SELECT relname FROM pg_class
    WHERE relnamespace='public'::regnamespace AND relkind='m' AND relname LIKE 'mv_music_%'
  LOOP
    source := CASE WHEN relation.relname IN ('mv_music_artist_totals','mv_music_artist_daily')
      THEN 'music_read.artist_plays' ELSE 'music_read.scrobbles' END;
    definition := pg_get_viewdef(format('public.%I',relation.relname)::regclass,false);
    definition := regexp_replace(definition,'\m(public\.)?scrobbles\M',source,'g');
    IF source='music_read.artist_plays' THEN
      definition := replace(definition,'count(*)','sum(play_weight)::double precision');
    END IF;
    IF relation.relname='mv_music_totals' THEN
      definition := regexp_replace(definition,'count\(DISTINCT (music_read\.scrobbles\.)?artist_name\)',
        '(SELECT count(DISTINCT artist_name) FROM music_read.artist_plays)','g');
    END IF;
    EXECUTE format('CREATE VIEW music_read.%I WITH (security_invoker=true) AS %s',relation.relname,definition);
  END LOOP;
END $summaries$;
REVOKE ALL ON ALL TABLES IN SCHEMA music_read FROM PUBLIC,anon,authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA music_read TO music_web_reader;
