import { cookies } from "next/headers";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A reachable database was never enough to prove the archive is still growing.
// The tracker can fail for hours while `SELECT 1` keeps answering, so the probe
// also reports when the last run finished and when the last play landed. Those
// are deliberately separate: a quiet listening day is not a broken tracker.
export async function GET() {
  const startedAt = performance.now();

  try {
    const [row] = await sql<{
      last_success: string | null;
      last_run_status: string | null;
      last_play: string | null;
      sync_recent: boolean | null;
      total_plays: string;
    }[]>`
      SELECT
        (SELECT max(finished_at) FROM public.music_sync_runs WHERE status IN ('success','warning')) AS last_success,
        (SELECT status FROM public.music_sync_runs ORDER BY started_at DESC LIMIT 1) AS last_run_status,
        (SELECT max(finished_at) > now() - interval '90 minutes' FROM public.music_sync_runs
          WHERE status IN ('success','warning')) AS sync_recent,
        (SELECT max(played_at) FROM public.scrobbles) AS last_play,
        (SELECT count(*)::text FROM public.scrobbles) AS total_plays
    `;

    const token = (await cookies()).get(COOKIE_NAME)?.value;
    const authorized = !!(token && process.env.SITE_PASSWORD &&
      await verifyToken(token, process.env.SITE_PASSWORD));
    const trackerHealthy = row.sync_recent === true && row.last_run_status !== "failed";

    return Response.json(
      {
        ok: true,
        database: "reachable",
        tracker: row.last_success === null ? "unreported" : trackerHealthy ? "current" : "stale",
        ...(authorized ? {
          lastSyncAt: row.last_success,
          lastRunStatus: row.last_run_status,
          lastPlayAt: row.last_play,
          totalPlays: Number(row.total_plays),
        } : {}),
        region: process.env.VERCEL_REGION ?? "local",
        databaseRttMs: Number((performance.now() - startedAt).toFixed(1)),
        timestamp: new Date().toISOString(),
      },
      { status: trackerHealthy ? 200 : 207, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        ok: false,
        database: "unreachable",
        region: process.env.VERCEL_REGION ?? "local",
        timestamp: new Date().toISOString(),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
