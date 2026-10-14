-- Spotify may rename a track/album without changing its ID. Group by that ID
-- so a list row and the detail page it opens always represent the same entity.
CREATE OR REPLACE VIEW music_read.mv_music_track_totals WITH (security_invoker=true) AS
SELECT coalesce(spotify_id,md5(track_name||chr(31)||artist_name)) AS entity_key,
 max(spotify_id) AS spotify_id,max(track_name) AS track_name,max(artist_name) AS artist_name,
 count(*)::bigint AS plays,max(image_url) AS image_url,max(album_id) AS album_id,
 min(played_at) AS first_play,max(played_at) AS last_play
FROM music_read.scrobbles GROUP BY coalesce(spotify_id,md5(track_name||chr(31)||artist_name));
CREATE OR REPLACE VIEW music_read.mv_music_album_totals WITH (security_invoker=true) AS
SELECT coalesce(album_id,md5(album_name||chr(31)||artist_name)) AS entity_key,
 max(album_id) AS album_id,max(album_name) AS album_name,max(artist_name) AS artist_name,
 count(*)::bigint AS plays,max(image_url) AS image_url,min(played_at) AS first_play,max(played_at) AS last_play
FROM music_read.scrobbles WHERE album_name IS NOT NULL
GROUP BY coalesce(album_id,md5(album_name||chr(31)||artist_name));
CREATE OR REPLACE VIEW music_read.mv_music_track_daily WITH (security_invoker=true) AS
SELECT (played_at AT TIME ZONE 'Europe/Istanbul')::date AS day,
 coalesce(spotify_id,md5(track_name||chr(31)||artist_name)) AS entity_key,
 max(spotify_id) AS spotify_id,max(track_name) AS track_name,max(artist_name) AS artist_name,count(*)::bigint AS plays
FROM music_read.scrobbles GROUP BY 1,2;
CREATE OR REPLACE VIEW music_read.mv_music_album_daily WITH (security_invoker=true) AS
SELECT (played_at AT TIME ZONE 'Europe/Istanbul')::date AS day,
 coalesce(album_id,md5(album_name||chr(31)||artist_name)) AS entity_key,
 max(album_id) AS album_id,max(album_name) AS album_name,max(artist_name) AS artist_name,count(*)::bigint AS plays
FROM music_read.scrobbles WHERE album_name IS NOT NULL GROUP BY 1,2;
CREATE OR REPLACE VIEW music_read.mv_music_album_track_totals WITH (security_invoker=true) AS
SELECT coalesce(album_id,md5(album_name||chr(31)||artist_name))||chr(31)||coalesce(spotify_id,md5(track_name||chr(31)||artist_name)) AS entity_key,
 max(album_id) AS album_id,max(album_name) AS album_name,max(artist_name) AS artist_name,
 max(spotify_id) AS spotify_id,max(track_name) AS track_name,count(*)::bigint AS plays,max(image_url) AS image_url
FROM music_read.scrobbles WHERE album_name IS NOT NULL
GROUP BY coalesce(album_id,md5(album_name||chr(31)||artist_name)),coalesce(spotify_id,md5(track_name||chr(31)||artist_name));
