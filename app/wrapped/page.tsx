import Link from "next/link";
import Image from "next/image";
import Form from "next/form";
import { ArrowUpRight, Disc3 } from "lucide-react";
import { getWrappedData } from "@/lib/wrapped";
import { wrappedRange } from "@/lib/periods";
import { EntityList, Surface, SectionHeader, StatTile } from "@/components/ui";
import { YearStories, type YearStory } from "@/components/year-stories";
import { LineChart } from "@/components/charts";
import { PlaylistExport } from "@/components/playlist-export";
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
  const href = (mode: string) => `/library?${new URLSearchParams({ mode, period: "custom", start, end })}`;
  const artistHref = (name: string) => `/library?${new URLSearchParams({ mode: "tracks", period: "custom", start, end, filter_type: "artist", filter_value: name })}`;
  const artist = topArtists[0], track = data.topTracks[0];
  const dominant = data.dayparts.reduce((a, b) => b.value > a.value ? b : a);
  const stories: YearStory[] = [
    { label: "The soundtrack", headline: `${formatNumber(data.totalPlays)} plays. Entirely you.`, detail: `${formatNumber(artistCount)} artists and ${formatNumber(data.tracks)} tracks found a place in your ${year}.`, color: "#d7ed9b" },
    { label: "Your headliner", headline: artist?.name ?? "Your next favourite awaits.", detail: artist ? `${formatNumber(artist.plays)} plays. The artist you kept coming back to.` : "Start listening and your year will take shape here.", color: "#c6b8ee" },
    { label: "On repeat", headline: track?.name ?? "A blank canvas.", detail: track ? `${track.secondary ?? ""} · ${formatNumber(track.plays)} plays. Some songs just stay with you.` : "Every great year starts with one song.", color: "#f1b38d" },
    { label: "In the rhythm", headline: `${data.longestStreak} days in a row.`, detail: `Your longest recorded listening streak in this period. ${formatNumber(data.activeDays)} active days altogether.`, color: "#a9d9de" },
    { label: "Your listening hours", headline: data.totalPlays ? `${dominant.label} is your time.` : "Find your rhythm.", detail: data.totalPlays ? `${Math.round(dominant.value / data.totalPlays * 100)}% of your recorded plays happened in this six-hour window, in Istanbul time.` : "Your listening habits will appear as your archive grows.", color: "#edcddd" },
  ];
  return <div className="page-stack">
    <div className={styles.topline}><span><Disc3 size={16} /> WRAPPED RECONSTRUCTION</span><Form action="/wrapped" className={styles.yearPicker}><label htmlFor="wrapped-year">Your year</label><select key={year} id="wrapped-year" name="year" defaultValue={year}>{!years.includes(year) && <option value={year}>{year}</option>}{years.map(y => <option key={y} value={y}>{y}</option>)}</select><button>Open</button></Form></div>
    <header className={styles.hero}>
      <div className={styles.heroCopy}><p>EVERY PLAY LEFT A LITTLE TRACE.</p><h1>Your {year}.<br /><em>{end < cutoff ? "So far." : "On repeat."}</em></h1><div>{formatDate(start)} — {formatDate(end)}</div><a href="#year-stories" className={styles.heroButton}>Play back your year <ArrowUpRight size={18} /></a></div>
      <div className={styles.mosaic} aria-label="Albums that shaped your year">{data.topAlbums.slice(0, 9).map((album, i) => <div key={`${album.id}-${i}`}>{album.imageUrl ? <Image src={album.imageUrl} alt={`${album.name} — ${album.secondary}`} width={220} height={220} priority={i < 3} /> : <Disc3 size={60} />}</div>)}{!data.topAlbums.length && <div className={styles.emptyCover}><Disc3 size={72} /><span>Your soundtrack starts here</span></div>}</div>
      <span className={styles.heroStamp}>VOL. {String(year).slice(-2)} / ATAKAN.FM</span>
    </header>
    <section className="stats-grid"><StatTile label="Plays in your archive" value={formatNumber(data.totalPlays)} /><StatTile label="Different artists" value={formatNumber(artistCount)} /><StatTile label="Tracks in rotation" value={formatNumber(data.tracks)} /><StatTile label="Days with music" value={formatNumber(data.activeDays)} /></section>
    <div id="year-stories" className={styles.anchor}><YearStories key={year} stories={stories} year={year} range={`${start} — ${end}`} /></div>
    {!!topArtists.length && <section><div className={styles.sectionTitle}><span>THE ONES YOU CAME BACK TO</span><h2>Your main characters.</h2></div><div className={styles.podium}>{topArtists.slice(0, 3).map((item, i) => <Link href={artistHref(item.name)} className={styles.artist} key={item.name}><span className={styles.rank}>0{i + 1}</span><div><span>{i === 0 ? "YOUR HEADLINER" : "ON HEAVY ROTATION"}</span><h3>{item.name}</h3><p>{formatNumber(item.plays)} plays</p></div><ArrowUpRight size={22} /></Link>)}</div></section>}
    <Surface><SectionHeader title="The shape of your year" detail="Every rise, every quiet month. Ranked by recorded plays." /><LineChart data={data.activity} /></Surface>
    <div className="split-grid"><Surface><SectionHeader title="Your top artists" detail="Ranked by plays · collaborations count for every credited artist" /><EntityList items={topArtists} kind="artist" itemHref={item => artistHref(item.name)} /></Surface><Surface><SectionHeader title="Albums by recorded plays" href={href("albums")} /><EntityList items={data.topAlbums} kind="album" /></Surface></div>
    <Surface><SectionHeader title="The tracks that stayed" href={href("tracks")} /><EntityList items={data.topTracks} kind="track" /><PlaylistExport items={data.topTracks} name={`atakan.fm · Wrapped ${year}`} /></Surface>
    <p className="feature-footnote">An archive recap, not official Spotify Wrapped. Each credited artist receives one play; total plays count each listen once. Missing credits use the recorded artist. Known Private Sessions and plays of 30 seconds or less are excluded; unknown duration or privacy status is included provisionally. The 12 November cutoff is an estimate, and the current year runs up to today or that cutoff. Spotify’s own ranking and filtering can differ. <Link href={`/?period=custom&start=${start}&end=${year}-12-31`}>Browse any date range ↗</Link></p>
  </div>;
}
