-- 0002 deliberately preserved the PostgREST read path "until the private Next.js
-- application replaces it". That replacement has shipped: the web tier connects
-- as music_web_app over a direct Postgres connection, reads through the
-- scrobbles_web_read_only policy, and never calls PostgREST. Meanwhile the
-- anon-role path stayed wide open, so a project URL plus the (semi-public) anon
-- key could read all 148k plays out of a site whose entire premise is privacy.
--
-- Scope is limited to this system's own objects. This schema is shared with an
-- unrelated application whose tables and views are left untouched, and no
-- schema-wide grant or default privilege is altered here.

DROP POLICY IF EXISTS scrobbles_public_read_only ON public.scrobbles;

REVOKE ALL ON TABLE public.scrobbles FROM anon, authenticated;
REVOKE ALL ON TABLE public.music_schema_migrations FROM anon, authenticated;

-- Supabase's default privileges on this schema granted the API roles every
-- privilege on each rollup as it was created, which is how the views ended up
-- readable — and refreshable, via MAINTAIN — by anon. GRANT/REVOKE ... ON ALL
-- TABLES IN SCHEMA does not reach materialized views, so enumerate them.
DO $revoke_rollups$
DECLARE
    rollup text;
BEGIN
    FOR rollup IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'm'
          AND c.relname LIKE 'mv_music_%'
        ORDER BY c.relname
    LOOP
        EXECUTE format(
            'REVOKE ALL ON TABLE public.%I FROM anon, authenticated', rollup
        );
    END LOOP;
END
$revoke_rollups$;

-- service_role stays as it is: that is the administrative key, not a public one.
-- music_web_reader also stays, since music_web_app inherits its SELECT through
-- role membership and the application would otherwise lose every page.
--
-- Note for whoever adds the next rollup: the schema's default privileges still
-- grant new tables and materialized views to anon and authenticated, so a new
-- mv_music_* view will arrive readable by the API roles unless its migration
-- revokes them the way this one does.
