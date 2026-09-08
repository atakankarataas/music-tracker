import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, Disc3 } from "lucide-react";
import { getHomePeriodData } from "@/lib/home-features";
import { getListeningPatterns } from "@/lib/listening-patterns";
import { wrappedRange } from "@/lib/periods";
import { EntityList, Surface, SectionHeader, StatTile } from "@/components/ui";
import { YearStories, type YearStory } from "@/components/year-stories";
import { LineChart } from "@/components/charts";
import { PlaylistExport } from "@/components/playlist-export";
import { formatDate, formatNumber, entityHref } from "@/lib/format";
import styles from "./wrapped.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Wrapped" };
export default async function WrappedPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { year: requested } = await searchParams;
  const { year, start, end, currentYear } = wrappedRange(requested);
  const [data, patterns] = await Promise.all([
    getHomePeriodData("custom", start, end), getListeningPatterns(start, end),
  ]);
  const firstYear = data.archiveFirstPlay ? Number(data.archiveFirstPlay.slice(0, 4)) : currentYear;
  const years = Array.from({ length: Math.max(1, currentYear - firstYear + 1) }, (_, i) => currentYear - i);
  const href = (mode: string) => `/library?${new URLSearchParams({ mode, period: "custom", start, end })}`;
  const artist = data.topArtists[0], track = data.topTracks[0];
  const dominant = patterns.dayparts.reduce((a, b) => b.value > a.value ? b : a);
  const stories: YearStory[] = [
    { label: "The soundtrack", headline: `${formatNumber(data.totalPlays)} plays. Entirely you.`, detail: `${formatNumber(data.artists)} artists and ${formatNumber(data.tracks)} tracks found a place in your ${year}.`, color: "#d7ed9b" },
    { label: "Your headliner", headline: artist?.name ?? "Your next favourite awaits.", detail: artist ? `${formatNumber(artist.plays)} plays. The artist you kept coming back to.` : "Start listening and your year will take shape here.", color: "#c6b8ee" },
    { label: "On repeat", headline: track?.name ?? "A blank canvas.", detail: track ? `${track.secondary ?? ""} · ${formatNumber(track.plays)} plays. Some songs just stay with you.` : "Every great year starts with one song.", color: "#f1b38d" },
    { label: "In the rhythm", headline: `${patterns.longest_streak} days in a row.`, detail: `Your longest recorded listening streak in this period. ${formatNumber(patterns.active_days)} active days altogether.`, color: "#a9d9de" },
    { label: "Your listening hours", headline: patterns.total ? `${dominant.label} is your time.` : "Find your rhythm.", detail: patterns.total ? `${Math.round(dominant.value / patterns.total * 100)}% of your recorded plays happened in this six-hour window, in Istanbul time.` : "Your listening habits will appear as your archive grows.", color: "#edcddd" },
  ];
  return <div className="page-stack">
    <div className={styles.topline}><span><Disc3 size={16} /> THE ANNUAL MIXTAPE</span><form className={styles.yearPicker}><label htmlFor="wrapped-year">Your year</label><select id="wrapped-year" name="year" defaultValue={year}>{!years.includes(year) && <option value={year}>{year}</option>}{years.map(y => <option key={y} value={y}>{y}{y === currentYear ? " · so far" : ""}</option>)}</select><button>Open</button></form></div>
    <header className={styles.hero}>
      <div className={styles.heroCopy}><p>EVERY PLAY LEFT A LITTLE TRACE.</p><h1>Your {year}.<br /><em>On repeat.</em></h1><div>{formatDate(start)} — {formatDate(end)}</div><a href="#year-stories" className={styles.heroButton}>Play back your year <ArrowUpRight size={18} /></a></div>
      <div className={styles.mosaic} aria-label="Albums that shaped your year">{data.topAlbums.slice(0, 9).map((album, i) => <div key={`${album.id}-${i}`}>{album.imageUrl ? <Image src={album.imageUrl} alt={`${album.name} — ${album.secondary}`} width={220} height={220} priority={i < 3} /> : <Disc3 size={60} />}</div>)}{!data.topAlbums.length && <div className={styles.emptyCover}><Disc3 size={72} /><span>Your soundtrack starts here</span></div>}</div>
      <span className={styles.heroStamp}>VOL. {String(year).slice(-2)} / ATAKAN.FM</span>
    </header>
    <section className="stats-grid"><StatTile label="Plays in your archive" value={formatNumber(data.totalPlays)} /><StatTile label="Different artists" value={formatNumber(data.artists)} /><StatTile label="Tracks in rotation" value={formatNumber(data.tracks)} /><StatTile label="Days with music" value={formatNumber(patterns.active_days)} /></section>
    <div id="year-stories" className={styles.anchor}><YearStories key={year} stories={stories} year={year} range={`${start} — ${end}`} /></div>
    {!!data.topArtists.length && <section><div className={styles.sectionTitle}><span>THE ONES YOU CAME BACK TO</span><h2>Your main characters.</h2></div><div className={styles.podium}>{data.topArtists.slice(0, 3).map((item, i) => <Link href={entityHref("artist", item.name, item.id)} className={styles.artist} key={item.name}><span className={styles.rank}>0{i + 1}</span><div><span>{i === 0 ? "YOUR HEADLINER" : "ON HEAVY ROTATION"}</span><h3>{item.name}</h3><p>{formatNumber(item.plays)} plays · {Math.round(item.plays / data.totalPlays * 100)}% of your year</p></div><ArrowUpRight size={22} /></Link>)}</div></section>}
    <Surface><SectionHeader title="The shape of your year" detail="Every rise, every quiet month. Ranked by recorded plays." /><LineChart data={data.activity} /></Surface>
    <div className="split-grid"><Surface><SectionHeader title="Your top artists" href={href("artists")} /><EntityList items={data.topArtists} kind="artist" /></Surface><Surface><SectionHeader title="Your top albums" href={href("albums")} /><EntityList items={data.topAlbums} kind="album" /></Surface></div>
    <Surface><SectionHeader title="The tracks that stayed" href={href("tracks")} /><EntityList items={data.topTracks} kind="track" /><PlaylistExport items={data.topTracks} name={`atakan.fm · Wrapped ${year}${year === currentYear ? " so far" : ""}`} /></Surface>
    <p className="feature-footnote">January 1 through {year === currentYear ? "today" : "December 31"}, in Europe/Istanbul. This is your recorded archive, not Spotify&rsquo;s official Wrapped; missing history and Spotify&rsquo;s eligibility rules can change the result. Downloaded cards are saved only to your device. <a href="https://newsroom.spotify.com/2025-12-05/wrapped-methodology-explained/" target="_blank" rel="noreferrer">Spotify methodology ↗</a></p>
  </div>;
}
