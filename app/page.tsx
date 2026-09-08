import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Search } from "lucide-react";

import { ActivityHeatmap, LineChart } from "@/components/charts";
import { Artwork, EntityList, PageHeader, RecentList, SectionHeader, SegmentedControl, StatTile, Surface } from "@/components/ui";
import { formatDate, formatNumber, istanbulYear } from "@/lib/format";
import { getHomePeriodData, parseHomePeriod, type HomePeriod } from "@/lib/home-features";
import { getLegacyHomeFeatures } from "@/lib/legacy-features";

import { SyncStatus } from "@/components/sync-status";
import { DateRangeForm } from "@/components/date-range-form";
import { calendarRange } from "@/lib/periods";

import styles from "./home.module.css";

export const dynamic = "force-dynamic";

const periodOptions: Array<{ value: HomePeriod; label: string }> = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "180d", label: "6 months" },
  { value: "365d", label: "1 year" },
  { value: "all", label: "All time" },
];

function periodHref(period: HomePeriod) {
  return period === "30d" ? "/" : `/?period=${period}`;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  let period = parseHomePeriod(typeof params.period === "string" ? params.period : undefined);
  const start = typeof params.start === "string" ? params.start : "";
  const end = typeof params.end === "string" ? params.end : "";
  const validation = calendarRange(period, start, end);
  period = validation.period;
  const [range, legacy] = await Promise.all([
    getHomePeriodData(period, start, end),
    // A full year of columns fills the panel; 84 days left most of it empty.
    getLegacyHomeFeatures({ anniversaryLimit: 8, heatmapDays: 364, tagLimit: 6 }),
  ]);

  const years = range.archiveFirstPlay
    ? Math.max(1, istanbulYear() - istanbulYear(range.archiveFirstPlay) + 1)
    : 0;
  const rangeLabel = period === "wrapped" ? "Wrapped so far" : period === "all"
    ? "All time"
    : period === "custom"
      ? `${formatDate(range.start)} – ${formatDate(range.end)}`
      : periodOptions.find((item) => item.value === period)?.label ?? "Selected range";
  const comparison = legacy.monthComparison;
  const comparisonUp = comparison.delta >= 0;
  const topArtist = range.topArtists[0];
  const topTrack = range.topTracks[0];
  const libraryHref = (mode: "artists" | "albums" | "tracks") => {
    const query = new URLSearchParams({ mode, period: period === "wrapped" ? "custom" : period });
    if (period === "custom" || period === "wrapped") {
      query.set("start", range.start);
      query.set("end", range.end);
    }
    return `/library?${query}`;
  };

  return (
    <div className="page-stack">
      <SyncStatus />
      <PageHeader
        eyebrow="Your listening archive"
        title="Music, over time."
        description={range.archiveFirstPlay ? `A private record of ${formatNumber(range.archiveTotalPlays)} plays across ${years} years, beginning ${formatDate(range.archiveFirstPlay)}.` : "Your listening history."}
        action={(
          <div className={styles.headerActions}>
            <Link className="quiet-link" href="/wrapped">Spotify Wrapped ↗</Link>
            <Link className="quiet-link" href="/discover">Discover ↗</Link>
            <Link className="quiet-link" href="/search"><Search size={15} /> Search archive</Link>
            <Link className="quiet-link" href="/insights">Explore insights <ArrowUpRight size={15} /></Link>
          </div>
        )}
      />

      <section className={styles.rangePanel} aria-label="Listening period">
        <div>
          <span className="eyebrow">Active range</span>
          <strong>{rangeLabel}</strong>
        </div>
        <SegmentedControl
          active={period}
          items={periodOptions.map((item) => ({ ...item, href: periodHref(item.value) }))}
        />
        <DateRangeForm className={styles.customRange} start={period === "custom" ? range.start : ""} end={period === "custom" ? range.end : ""} />
        {validation.error && <p role="alert">{validation.error}</p>}
      </section>

      <section className="stats-grid">
        <StatTile label={`${rangeLabel} plays`} value={formatNumber(range.totalPlays)} detail={`${formatNumber(range.artists)} artists · ${formatNumber(range.tracks)} tracks`} />
        <StatTile label="Top artist" tone="text" value={topArtist?.name ?? "—"} detail={topArtist ? `${formatNumber(topArtist.plays)} plays` : undefined} />
        <StatTile label="Top track" tone="text" value={topTrack?.name ?? "—"} detail={topTrack ? `${topTrack.secondary ?? ""} · ${formatNumber(topTrack.plays)} plays` : undefined} />
        <StatTile
          label={`${comparison.currentLabel}, first ${comparison.daysCompared} days`}
          value={formatNumber(comparison.current)}
          detail={`${comparisonUp ? "+" : ""}${formatNumber(comparison.delta)} vs the same days in ${comparison.previousLabel}`}
        />
      </section>

      <Surface className="trend-surface">
        <SectionHeader title={`${rangeLabel} activity`} detail={`Plays grouped by ${range.activityUnit}`} />
        {range.activity.length ? <LineChart data={range.activity} /> : <p className={styles.muted}>No plays in this range.</p>}
      </Surface>

      <div className={styles.threeColumns}>
        <Surface>
          <SectionHeader title="Top artists" href={libraryHref("artists")} />
          <EntityList items={range.topArtists} kind="artist" />
        </Surface>
        <Surface>
          <SectionHeader title="Top albums" href={libraryHref("albums")} />
          <EntityList items={range.topAlbums.slice(0, 5)} kind="album" />
        </Surface>
        <Surface>
          <SectionHeader title="Top tracks" href={libraryHref("tracks")} />
          <EntityList items={range.topTracks.slice(0, 5)} kind="track" />
        </Surface>
      </div>

      <div className="split-grid split-grid-weighted">
        <Surface>
          <SectionHeader title="Listening activity" detail="The last twelve months" />
          <ActivityHeatmap data={legacy.heatmap.map((day) => ({ date: day.date, value: day.count }))} />
        </Surface>
        <Surface>
          <SectionHeader
            title="Month over month"
            detail={`The first ${comparison.daysCompared} days of ${comparison.currentLabel}, against the same days of ${comparison.previousLabel}`}
          />
          <div className={styles.comparison}>
            <span data-positive={comparisonUp || undefined}>
              {comparisonUp ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
              {comparison.percentageChange === null ? "New activity" : `${Math.abs(comparison.percentageChange)}%`}
            </span>
            <strong>{formatNumber(comparison.current)}</strong>
            <small>{formatNumber(comparison.previous)} in {comparison.previousLabel}</small>
          </div>
        </Surface>
      </div>

      <div className="split-grid">
        <Surface>
          <SectionHeader
            title="Genres"
            detail={`Most present across the ${formatNumber(legacy.genreMood.genrePlays)} plays your tracker has enriched so far`}
          />
          {legacy.genreMood.genres.length ? (
            <div className={styles.tagRanking}>
              {legacy.genreMood.genres.map((genre) => {
                const maximum = legacy.genreMood.genres[0]?.count || 1;
                return <div key={genre.name}><span>{genre.name}</span><i><b style={{ width: `${(genre.count / maximum) * 100}%` }} /></i><strong>{formatNumber(genre.count)}</strong></div>;
              })}
            </div>
          ) : <p className={styles.muted}>Genre metadata will appear as your tracker enriches artists.</p>}
        </Surface>
        <Surface>
          <SectionHeader
            title="Listening moods"
            detail={`Across ${formatNumber(legacy.genreMood.moodPlays)} approximately classified plays; based on track names and genres`}
          />
          {legacy.genreMood.moods.length ? (
            <div className={styles.moodCloud}>{legacy.genreMood.moods.map((mood) => <span key={mood.name}>{mood.name}<small>{formatNumber(mood.count)}</small></span>)}</div>
          ) : <p className={styles.muted}>Mood metadata has not been recorded yet.</p>}
        </Surface>
      </div>

      {legacy.onThisDay.length ? (
        <Surface>
          <SectionHeader title="On this day" detail="Songs you played on this date in earlier years" />
          <div className={styles.memories}>
            {legacy.onThisDay.map((play) => (
              <Link href={play.href} key={play.playedAt}>
                <Artwork src={play.imageUrl} />
                <span><strong>{play.trackName}</strong><small>{play.artistName}</small></span>
                <em>{play.yearsAgo} {play.yearsAgo === 1 ? "year" : "years"} ago</em>
              </Link>
            ))}
          </div>
        </Surface>
      ) : null}

      <Surface>
        <SectionHeader title="Recently played" detail="The latest entries recorded by your tracker" />
        <RecentList items={range.recent} />
      </Surface>
    </div>
  );
}
