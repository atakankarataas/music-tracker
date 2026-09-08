-- Existing PostgREST traffic reads this table through the anon role. Preserve
-- that read path until the private Next.js application replaces it, but remove
-- every capability that could mutate or destroy listening history.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.scrobbles
FROM anon, authenticated;

GRANT SELECT
ON TABLE public.scrobbles
TO anon, authenticated;

ALTER TABLE public.scrobbles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scrobbles_public_read_only ON public.scrobbles;
CREATE POLICY scrobbles_public_read_only
ON public.scrobbles
FOR SELECT
TO anon, authenticated
USING (true);
