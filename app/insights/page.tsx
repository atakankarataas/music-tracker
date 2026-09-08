import Link from "next/link";
import { Award, Check, Headphones, LockKeyhole } from "lucide-react";
import type { Metadata } from "next";

import { ActivityHeatmap, BarChart, HourChart, LineChart } from "@/components/charts";
import { PageHeader, SectionHeader, StatTile, Surface } from "@/components/ui";
import { getInsightsData } from "@/lib/data";
import { getListeningPatterns } from "@/lib/listening-patterns";
import { calendarRange } from "@/lib/periods";
import { formatDate, formatNumber } from "@/lib/format";
import { getLegacyInsightsFeatures } from "@/lib/legacy-features";

import styles from "./insights.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Insights" };

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const requested = (await searchParams).period;
  const period = requested === "90d" || requested === "365d" ? requested : "30d";
  const range = calendarRange(period);
  const [data, legacy, patterns] = await Promise.all([getInsightsData(), getLegacyInsightsFeatures(), getListeningPatterns(range.start, range.end)]);
  const percentage = (value: number) => patterns.total ? Math.round(value / patterns.total * 100) : 0;
  const dominant = patterns.dayparts.reduce((a,b) => b.value > a.value ? b : a);
  const repeatShare = percentage(patterns.total - patterns.tracks);
  const peakHour = data.hourly.reduce((best, point) => point.value > best.value ? point : best, data.hourly[0]);
  const peakDay = data.weekdays.reduce((best, point) => point.value > best.value ? point : best, data.weekdays[0]);
  const recentTotal = data.heatmap.reduce((sum, day) => sum + day.value, 0);
  const activeRecentDays = data.heatmap.filter((day) => day.value > 0).length;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Patterns"
        title="There’s a rhythm to you."
        description="Go beyond your favourites. Find the little habits that make this archive yours."
        action={<span className={styles.lifetimeBadge}><Headphones size={15} /> {formatNumber(legacy.totalPlays)} lifetime plays</span>}
      />

      <section className={styles.periodSection} aria-label="Selected period insights">
        <div className={styles.periodHeader}><div><span className={styles.kicker}>A CLOSER LISTEN</span><p>{formatDate(range.start!)} — {formatDate(range.end)}</p></div><nav aria-label="Insights period" className={styles.periods}>{(["30d", "90d", "365d"] as const).map(value => <Link key={value} href={`/insights?period=${value}`} aria-current={period === value ? "page" : undefined}>{value === "365d" ? "1 year" : `${value.slice(0,-1)} days`}</Link>)}</nav></div>
        <div className={styles.patternHero}><div><span className={styles.kicker}>YOUR LISTENING SIGNATURE</span><h2>{patterns.total ? `${dominant.label}. Your kind of quiet.` : "Every habit starts with a song."}</h2><p>{patterns.total ? `${percentage(dominant.value)}% of your plays land in this six-hour window. You spent ${patterns.active_days} days with music in this period.` : "No recorded plays in this period yet. Try a longer window to find your patterns."}</p><Link href="/discover">Find your next old favourite ↗</Link></div><div className={styles.streak}><strong>{patterns.longest_streak}</strong><span>DAYS IN A ROW</span><p>Your longest listening streak<br />inside this period</p></div></div>
        <div className={styles.factGrid}>
          <article><span>THE SOUNDTRACK</span><strong>{formatNumber(patterns.total)}</strong><h3>Recorded plays</h3><p>{formatNumber(patterns.tracks)} different tracks from {formatNumber(patterns.artists)} artists.</p></article>
          <article><span>FRESH NAMES</span><strong>{formatNumber(patterns.new_artists)}</strong><h3>Artists new to your archive</h3><p>First recorded here in this period. Your earlier untracked listening is unknown.</p></article>
          <article><span>FAMILIAR GROUND</span><strong>{repeatShare}%</strong><h3>Repeat plays</h3><p>Plays beyond each track’s first appearance within this period.</p></article>
          <article><span>YOUR INNER CIRCLE</span><strong>{percentage(patterns.top_five)}%</strong><h3>From just five artists</h3><p>The share of plays belonging to your five most played artists.</p></article>
        </div>
        <div className="split-grid"><Surface><SectionHeader title="When music finds you" detail="Four chapters of your day · Istanbul time" /><div className={styles.dayparts}>{patterns.dayparts.map((part,i) => <div key={part.label}><div><span>{part.label} <small>{["00–06", "06–12", "12–18", "18–24"][i]}</small></span><strong>{percentage(part.value)}%</strong></div><div className={styles.meter}><i style={{width:`${percentage(part.value)}%`}} /></div></div>)}</div></Surface>
        <Surface><SectionHeader title="Little things, worth remembering" detail="Highlights from your selected period" /><div className={styles.highlights}><article><span>YOUR BIGGEST DAY</span><strong>{patterns.peak_day ? formatDate(patterns.peak_day) : "Still to come"}</strong><p>{formatNumber(patterns.peak_plays)} recorded plays in one day.</p></article><article><span>TIME WE CAN MEASURE</span><strong>{formatNumber(patterns.known_minutes)} min</strong><p>Actual export listening time, available for {patterns.timed_plays} of {formatNumber(patterns.total)} plays ({percentage(patterns.timed_plays)}%). API-only plays do not include measured listening time.</p></article></div></Surface></div>
      </section>

      <div className={styles.archiveHeading}><span className={styles.kicker}>THE BIGGER PICTURE</span><h2>Across your archive.</h2><p>The charts below keep their own lifetime or labelled calendar ranges.</p></div>
      <section className="stats-grid">
        <StatTile label="Peak hour" value={`${peakHour?.label ?? "—"}:00`} detail={peakHour ? `${formatNumber(peakHour.value)} lifetime plays` : undefined} />
        <StatTile label="Most active day" value={peakDay?.label ?? "—"} />
        <StatTile label={`Last ${formatNumber(data.heatmap.length)} days`} value={formatNumber(recentTotal)} />
        <StatTile label="Active days" value={`${formatNumber(activeRecentDays)} / ${formatNumber(data.heatmap.length)}`} />
      </section>

      <Surface>
        <SectionHeader title="Listening clock" detail="Lifetime plays by local hour" />
        <HourChart data={data.hourly} />
      </Surface>

      <div className="split-grid split-grid-weighted">
        <Surface>
          <SectionHeader title="Last twelve months" detail="Monthly listening volume" />
          <LineChart data={data.monthly} />
        </Surface>
        <Surface>
          <SectionHeader title="Week shape" detail="Lifetime plays by weekday" />
          <BarChart data={data.weekdays} />
        </Surface>
      </div>

      <Surface>
        <SectionHeader title="Recent activity" detail="Twelve months, shown from oldest to newest" />
        <ActivityHeatmap data={data.heatmap} />
      </Surface>

      <Surface>
        <SectionHeader title="Milestones collection" detail="Moments earned through the life of your archive" />
        <div className={styles.milestones}>
          {legacy.milestones.map((milestone) => (
            <article data-unlocked={milestone.unlocked || undefined} key={milestone.name}>
              <span className={styles.milestoneIcon}>
                {milestone.unlocked ? <Award size={24} /> : <LockKeyhole size={22} />}
              </span>
              <div className={styles.milestoneCopy}>
                <div><h3>{milestone.name}</h3>{milestone.unlocked ? <span><Check size={13} /> Unlocked</span> : <span>Locked</span>}</div>
                <p>{milestone.description}</p>
                <div className={styles.progress}><i style={{ width: `${milestone.progress}%` }} /></div>
                <small>{milestone.unlocked ? `${formatNumber(milestone.current)} plays recorded` : `${formatNumber(milestone.remaining)} plays remaining`}</small>
              </div>
            </article>
          ))}
        </div>
      </Surface>
    </div>
  );
}
