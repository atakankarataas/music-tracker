import Link from "next/link";
import { getSyncStatus } from "@/lib/discovery";
import { sql } from "@/lib/db";
import { PageHeader, Surface, SectionHeader, StatTile } from "@/components/ui";
import { formatNumber,formatRelativeDate } from "@/lib/format";
export const dynamic="force-dynamic";
export default async function SyncPage() {
  const [data,runs] = await Promise.all([getSyncStatus(),sql`SELECT * FROM public.music_sync_runs ORDER BY started_at DESC LIMIT 20`]);
  return <div className="page-stack"><PageHeader eyebrow="Archive health" title="Is everything arriving?" description="Successful sync time and your last listen are separate signals." />
    <section className="stats-grid">
      <StatTile label="Last successful sync" value={data.last_success?formatRelativeDate(data.last_success):"Waiting for first run"} />
      <StatTile label="Last listen" value={data.last_play?formatRelativeDate(data.last_play):"No plays yet"} />
      <StatTile label="Recorded plays" value={formatNumber(data.total)} />
      <StatTile label="Summary refresh" value={Number(data.total)===Number(data.rollup_total)?"Up to date":"Refreshing"} />
    </section>
    <Surface><SectionHeader title="Recent tracker runs" />
      <p>GitHub schedules can arrive late. Spotify may expose only the latest 50 plays; a successful run confirms those records were saved, not that all earlier or offline plays were available. Importing an Extended Streaming History export reconciles older gaps.</p>
      <div className="sync-table"><table><thead><tr><th>Started</th><th>Status</th><th>Fetched</th><th>New</th><th>Details</th></tr></thead><tbody>
        {runs.map(run=><tr key={run.id}><td>{new Date(run.started_at).toLocaleString("en-GB",{timeZone:"Europe/Istanbul"})}</td><td>{run.status}</td><td>{run.fetched}</td><td>{run.inserted}</td><td>{run.github_run_id ? <a href={`https://github.com/atakankarataas/music-tracker/actions/runs/${encodeURIComponent(run.github_run_id)}`} target="_blank" rel="noreferrer">Open run ↗</a> : run.stop_reason || run.error_code || "In progress"}</td></tr>)}
      </tbody></table></div>
      {!runs.length && <p>New runs will appear here after the updated tracker starts.</p>}
    </Surface><Link className="quiet-link" href="/">Back to overview</Link></div>;
}
