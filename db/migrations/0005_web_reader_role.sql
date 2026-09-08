DO $role$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'music_web_reader') THEN
        CREATE ROLE music_web_reader NOLOGIN;
    END IF;
END
$role$;

GRANT USAGE ON SCHEMA public TO music_web_reader;
GRANT SELECT ON TABLE public.scrobbles TO music_web_reader;

DROP POLICY IF EXISTS scrobbles_web_read_only ON public.scrobbles;
CREATE POLICY scrobbles_web_read_only
ON public.scrobbles
FOR SELECT
TO music_web_reader
USING (true);
