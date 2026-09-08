import Link from "next/link";
import { getDiscovery } from "@/lib/discovery";
import { EntityList,PageHeader,Surface,SectionHeader,StatTile } from "@/components/ui";
import { PeriodNote } from "@/components/period-note";
import { PlaylistExport } from "@/components/playlist-export";
import { formatNumber } from "@/lib/format";
export const dynamic="force-dynamic";
export default async function DiscoverPage({searchParams}:{searchParams:Promise<{month?:string;spotify?:string}>}) {
  const {month,spotify}=await searchParams;
  const data=await getDiscovery(month);
  const label=new Date(`${data.month}-01T12:00:00Z`).toLocaleDateString("en",{month:"long",year:"numeric"});
  return <div className="page-stack">
    <PageHeader eyebrow="A life in music" title="Find your next old favourite." description="Rediscover the songs you left behind, and the sounds that made a month yours." action={<Link className="quiet-link" href="/wrapped">Spotify Wrapped ↗</Link>} />
    {spotify && <p role="status">{spotify === "setup" ? "Spotify playlist connection needs to be configured before connecting." : "Spotify connection was not completed. Please try again."}</p>}
    <Surface className="discovery-hero"><SectionHeader title="Forgotten favourites" detail="At least 10 plays. Not heard in the last 180 days." />
      <EntityList items={data.forgotten} kind="track" />
      <PlaylistExport items={data.forgotten} name="atakan.fm · Forgotten favourites" />
    </Surface>
    <div className="month-picker"><div><span className="eyebrow">Time machine</span><h2>{label}</h2></div>
      <form action="/discover"><label htmlFor="discovery-month">Choose a month</label><input id="discovery-month" name="month" type="month" defaultValue={data.month} min={data.first_month} max={data.today.slice(0,7)} required /><button type="submit">Travel back</button></form>
    </div>
    <section className="stats-grid">
      <StatTile label="Plays this month" value={formatNumber(data.plays)} />
      <StatTile label="Previous month, same days" value={formatNumber(data.previous_plays)} />
      <StatTile label="Change in plays" value={`${data.plays-data.previous_plays>=0?"+":""}${formatNumber(data.plays-data.previous_plays)}`} />
      <StatTile label="Verified listening minutes" value={data.timed_plays?formatNumber(Math.round(Number(data.known_ms)/60000)):"Not available"} detail={`${formatNumber(data.timed_plays)} of ${formatNumber(data.plays)} plays have export duration`} />
    </section>
    <div className="split-grid"><Surface><SectionHeader title="New to your world" detail="Artists first heard in this month" /><EntityList items={data.new_artists} kind="artist" /></Surface>
      <Surface><SectionHeader title="On the rise" detail="More plays than the same days of the previous month" /><EntityList items={data.rising.map(item=>({...item,secondary:`${item.previous} → ${item.plays} plays`}))} kind="artist" /></Surface></div>
    <div className="split-grid"><Surface><SectionHeader title="Albums you returned to" detail="A return after at least six months away before this month" /><EntityList items={data.returns} kind="album" /></Surface>
      <Surface><SectionHeader title="The month's soundtrack" /><EntityList items={data.top_tracks} kind="track" /><PlaylistExport items={data.top_tracks} name={`atakan.fm · ${label}`} /></Surface></div>
    <Surface><SectionHeader title="A note to your future self" detail={label} /><PeriodNote key={data.month} month={data.month} initial={data.note??""} /></Surface>
  </div>;
}
