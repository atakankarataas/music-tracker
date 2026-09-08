import Link from "next/link";
import { getSyncStatus } from "@/lib/discovery";
import { formatRelativeDate } from "@/lib/format";
export async function SyncStatus() {
  const data = await getSyncStatus();
  // Freshness is decided by the database clock in getSyncStatus. Comparing against
  // Date.now() here would read the render-time clock, which React treats as impure.
  const recent = data.sync_recent === true;
  const failed = data.latest?.status === "failed";
  return <Link href="/sync" className="sync-indicator" data-warning={!recent || failed || undefined}>
    <i />{failed ? "Tracker needs attention" : recent ? `Synced ${formatRelativeDate(data.last_success)}` : data.last_success ? "Sync is delayed" : "Sync monitoring ready"}
  </Link>;
}
