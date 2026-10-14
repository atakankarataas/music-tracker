import "server-only";
import { sql } from "@/lib/db";

export async function getSyncStatus() {
  const [row] = await sql`
    SELECT (SELECT row_to_json(r) FROM (SELECT started_at,finished_at,status,pages,fetched,inserted,
      newest_play,stop_reason,error_code,github_run_id,source FROM public.music_sync_runs ORDER BY started_at DESC LIMIT 1) r) AS latest,
      (SELECT max(finished_at) FROM public.music_sync_runs WHERE status IN ('success','warning')) AS last_success,
      (SELECT max(finished_at) > now() - CASE WHEN (SELECT source FROM public.music_sync_runs ORDER BY started_at DESC LIMIT 1)='supabase_edge' THEN interval '10 minutes' ELSE interval '90 minutes' END FROM public.music_sync_runs
        WHERE status IN ('success','warning')) AS sync_recent,
      (SELECT max(played_at) FROM music_read.scrobbles) AS last_play,
      (SELECT count(*) FROM music_read.scrobbles) AS total,
      (SELECT total_plays FROM music_read.mv_music_totals LIMIT 1) AS rollup_total
  `;
  return row;
}
