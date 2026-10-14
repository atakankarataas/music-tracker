import Link from "next/link";
import { ArrowUpRight, RefreshCw, Sparkles } from "lucide-react";
import { getRecommendations } from "@/lib/recommendations";
import { Artwork, PageHeader, Surface } from "@/components/ui";
import styles from "./discover.module.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "Discover" };
export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ period?: string; refresh?: string }> }) {
  const params = await searchParams;
  const period = params.period === "year" ? "year" : "30d";
  const data = await getRecommendations(period, params.refresh);
  return <div className="page-stack">
    <PageHeader eyebrow="Discover" title="Your next favourite is out there." description="Fresh songs inspired by your listening, with a few familiar sounds worth another spin." />
    <div className={styles.toolbar}>
      <nav className={styles.periods} aria-label="Recommendation listening period">
        <Link href="/discover?period=30d" prefetch={false} aria-current={period === "30d" ? "page" : undefined}>Last 30 days</Link>
        <Link href="/discover?period=year" prefetch={false} aria-current={period === "year" ? "page" : undefined}>This year</Link>
      </nav>
      <Link className={styles.refresh} href={`/discover?period=${period}&refresh=${(data.refresh + 1) % 51}`} prefetch={false}><RefreshCw size={16} /> Refresh picks</Link>
    </div>
    {data.seeds.length > 0 && <Surface className={styles.inspiration}><Sparkles size={20} /><div><span className="eyebrow">Inspired by your {period === "year" ? "year" : "recent listening"}</span><p>{data.seeds.slice(0, 5).map(seed => seed.name).join(" · ")}</p></div></Surface>}
    {data.unavailable && <p role="status">Spotify’s catalogue is temporarily unavailable. Here are a few underplayed songs from your archive. Try refreshing for new discoveries.</p>}
    {!data.picks.length ? <Surface><h2>{data.seeds.length ? "No fresh picks just yet." : "Your next chapter starts with a listen."}</h2><p>{data.seeds.length ? "Try the other period or refresh your picks." : "Once your listening is synced for this period, your recommendations will appear here."}</p></Surface> : <section className={styles.grid} aria-label="Recommended songs">{data.picks.map(track => <article className={styles.card} key={track.id}>
      <a className={styles.cover} href={`https://open.spotify.com/track/${track.id}`} target="_blank" rel="noreferrer" aria-label={`Open ${track.name} in Spotify`}><Artwork src={track.imageUrl} kind="track" size={240} /><span><ArrowUpRight size={24} /></span></a>
      <div className={styles.copy}><span className={styles.badge} data-familiar={track.familiar}>{track.familiar ? "Worth another listen" : "New to your archive"}</span><h2><a href={`https://open.spotify.com/track/${track.id}`} target="_blank" rel="noreferrer">{track.name}</a></h2><p>{track.artist}</p><small>{track.familiar ? "A familiar song you haven’t played much." : `Because you listen to ${track.seed}.`}</small></div>
    </article>)}</section>}
    <p className="feature-footnote">New means absent from your imported listening history. Picks update with your taste; open any song to listen on Spotify.</p>
  </div>;
}
