import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, Disc3 } from "lucide-react";
import { getWrappedData } from "@/lib/wrapped";
import { wrappedRange } from "@/lib/periods";
import { EntityList, Surface, SectionHeader, StatTile } from "@/components/ui";
import { LineChart } from "@/components/charts";
import { PlaylistExport } from "@/components/playlist-export";
import { WrappedControls } from "@/components/wrapped-controls";
import { formatDate, formatNumber } from "@/lib/format";
import styles from "./wrapped.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Wrapped" };
export default async function WrappedPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { year: requested } = await searchParams;
  const { year, start, end, latestYear, cutoff } = wrappedRange(requested);
  const data = await getWrappedData(start, end);
  const topArtists = data.topArtists;
  const artistCount = data.artists;
  const firstYear = data.archiveFirstPlay ? Number(data.archiveFirstPlay.slice(0, 4)) : latestYear;
  const years = Array.from({ length: Math.max(1, latestYear - Math.max(2018, firstYear) + 1) }, (_, i) => latestYear - i);
  const href = (mode: string) => `/library?${new URLSearchParams({ mode, period: "custom", start, end, ranking: "wrapped" })}`;
  const artistHref = (name: string) => `/library?${new URLSearchParams({ mode: "tracks", period: "custom", start, end, ranking: "wrapped", filter_type: "artist", filter_value: name })}`;
  return <div className="page-stack">
    <div className={styles.topline}><span><Disc3 size={16} /> WRAPPED RECONSTRUCTION</span><WrappedControls key={year} year={year} years={years} className={styles.yearPicker} /></div>
    <header className={styles.hero}>
      <div className={styles.heroCopy}><p>EVERY PLAY LEFT A LITTLE TRACE.</p><h1>Your {year}.<br /><em>{end < cutoff ? "So far." : "On repeat."}</em></h1><div>{formatDate(start)} — {formatDate(end)}</div><a href="#year-rankings" className={styles.heroButton}>Explore your top 10 <ArrowUpRight size={18} /></a></div>
      <div className={styles.mosaic} aria-label="Albums that shaped your year">{data.topAlbums.slice(0, 9).map((album, i) => <div key={`${album.id}-${i}`}>{album.imageUrl ? <Image src={album.imageUrl} alt={`${album.name} — ${album.secondary}`} width={100} height={100} sizes="100px" priority={i < 3} /> : <Disc3 size={60} />}</div>)}{!data.topAlbums.length && <div className={styles.emptyCover}><Disc3 size={72} /><span>Your soundtrack starts here</span></div>}</div>
      <span className={styles.heroStamp}>VOL. {String(year).slice(-2)} / ATAKAN.FM</span>
    </header>
    <section className="stats-grid"><StatTile label="Eligible plays" value={formatNumber(data.totalPlays)} /><StatTile label="Different artists" value={formatNumber(artistCount)} /><StatTile label="Tracks in rotation" value={formatNumber(data.tracks)} /><StatTile label="Days with music" value={formatNumber(data.activeDays)} /></section>
    {!!topArtists.length && <section><div className={styles.sectionTitle}><span>THE ONES YOU CAME BACK TO</span><h2>Your main characters.</h2></div><div className={styles.podium}>{topArtists.slice(0, 3).map((item, i) => <Link href={artistHref(item.name)} className={styles.artist} key={item.name}><span className={styles.rank}>0{i + 1}</span><div><span>{i === 0 ? "YOUR HEADLINER" : "ON HEAVY ROTATION"}</span><h3>{item.name}</h3><p>{formatNumber(item.plays)} weighted plays</p></div><ArrowUpRight size={22} /></Link>)}</div></section>}
    <Surface><SectionHeader title="The shape of your year" detail="Every rise, every quiet month. Ranked by recorded plays." /><LineChart data={data.activity} /></Surface>
    <div id="year-rankings" className={styles.rankings}>
      <Surface>
        <SectionHeader title="Top artists" detail="Estimated Spotify weighted plays" href={href("artists")} />
        <EntityList items={topArtists.slice(0, 10)} kind="artist" valueLabel="weighted plays" itemHref={item => artistHref(item.name)} />
      </Surface>
      <Surface>
        <SectionHeader title="Top songs" href={href("tracks")} />
        <EntityList items={data.topTracks.slice(0, 10)} kind="track" />
        <PlaylistExport items={data.topTracks.slice(0, 10)} name={`atakan.fm · Wrapped ${year} top 10`} />
      </Surface>
      <Surface>
        <SectionHeader title="Top albums" href={href("albums")} />
        <EntityList items={data.topAlbums.slice(0, 10)} kind="album" />
      </Surface>
    </div>
    <p className="feature-footnote">Artist order estimates Spotify’s weighted streams: first catalogue artist 1, other artists 0.35. Spotify does not publish its coefficients or billing roles; this estimate matches the supplied 2023–2025 top-five lists. Artist counts and order use the same estimated weighted plays. Known listens of 30 seconds or less and known private sessions are excluded; API listens have unknown duration. View all uses the same rules. The 12 November cutoff is an estimate. Taste Profile exclusions and Spotify’s album scoring are unavailable; albums here are ranked by plays. <a href="https://newsroom.spotify.com/2025-12-05/wrapped-methodology-explained/" target="_blank" rel="noreferrer">Spotify’s methodology ↗</a> · <Link href={`/?period=custom&start=${start}&end=${year}-12-31`}>Browse any date range ↗</Link></p>
  </div>;
}
