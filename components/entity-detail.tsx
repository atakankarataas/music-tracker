import Link from "next/link";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Disc3,
  Headphones,
  Minus,
  Target,
} from "lucide-react";

import { LineChart } from "@/components/charts";
import { Artwork, SectionHeader, Surface } from "@/components/ui";
import type { DetailData } from "@/lib/data";
import {
  DETAIL_PERIODS,
  detailPeriodLabel,
  type DetailPageFeatures,
  type DetailPeriod,
  type DetailRankedItem,
} from "@/lib/detail-features";
import { entityHref, formatDate, formatNumber } from "@/lib/format";

import styles from "./entity-detail.module.css";

const exactDateTime = new Intl.DateTimeFormat("en", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: "Europe/Istanbul",
});

function artistHref(name: string) {
  return `/artist/${encodeURIComponent(name)}`;
}

function albumHref(name: string, id: string | null) {
  return entityHref("album", name, id);
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className={styles.metricCard}>
      <span>{label}</span>
      <strong title={value}>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function EmptySection({ children }: { children: React.ReactNode }) {
  return <p className={styles.emptySection}>{children}</p>;
}

function RankedList({
  items,
  kind,
  period,
  showLifetime = false,
}: {
  items: DetailRankedItem[];
  kind: "album" | "track";
  period: DetailPeriod;
  showLifetime?: boolean;
}) {
  if (!items.length) return <EmptySection>No plays in this period.</EmptySection>;

  const maximum = Math.max(...items.map((item) => item.plays), 1);
  return (
    <ol className={styles.rankedList}>
      {items.map((item, index) => {
        const href = entityHref(kind, item.name, item.id);
        return (
          <li key={`${item.id ?? item.name}-${item.secondary ?? ""}-${index}`}>
            <span className={styles.rank}>{String(index + 1).padStart(2, "0")}</span>
            <Link aria-label={item.name} className={styles.rowArtwork} href={href}>
              <Artwork kind={kind} src={item.imageUrl} />
            </Link>
            <span className={styles.rowCopy}>
              <Link href={href}>{item.name}</Link>
              {item.secondary ? <Link href={artistHref(item.secondary)}>{item.secondary}</Link> : null}
            </span>
            <span className={styles.rowCount}>
              <span>
                <strong>{formatNumber(item.plays)}</strong> {period === "all" ? "plays" : "in period"}
              </span>
              {showLifetime && period !== "all" ? <small>{formatNumber(item.lifetimePlays)} lifetime</small> : null}
              <i aria-hidden="true"><b style={{ width: `${(item.plays / maximum) * 100}%` }} /></i>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function TrendBadge({ features }: { features: DetailPageFeatures }) {
  const { trend } = features;
  const Icon = trend.direction === "up" || trend.direction === "new"
    ? ArrowUpRight
    : trend.direction === "down" ? ArrowDownRight : Minus;
  const text = trend.direction === "new"
    ? "New activity"
    : trend.direction === "steady"
      ? "No change"
      : `${trend.percentageChange !== null && trend.percentageChange > 0 ? "+" : ""}${trend.percentageChange ?? 0}%`;

  return (
    <span className={styles.trendBadge} data-direction={trend.direction}>
      <Icon aria-hidden="true" size={14} />
      <strong>{text}</strong>
      <small>vs previous {trend.comparisonDays} days</small>
    </span>
  );
}

function Milestones({ features }: { features: DetailPageFeatures }) {
  const { achievements, nextMilestone } = features.legacy;
  return (
    <Surface className={styles.milestoneSurface}>
      <SectionHeader title="Milestone ladder" detail="Lifetime listening landmarks" />
      {nextMilestone ? (
        <div className={styles.nextMilestone}>
          <span className={styles.milestoneTarget}><Target aria-hidden="true" size={16} /> Next goal</span>
          <div>
            <strong>{formatNumber(nextMilestone.count)} plays</strong>
            <small>{formatNumber(nextMilestone.remaining)} remaining</small>
          </div>
          <i aria-label={`${nextMilestone.progress}% complete`}>
            <b style={{ width: `${Math.min(100, nextMilestone.progress)}%` }} />
          </i>
          <span className={styles.progressLabel}>{nextMilestone.progress}%</span>
        </div>
      ) : (
        <div className={styles.completedMilestones}><Check aria-hidden="true" size={16} /> Every milestone reached</div>
      )}

      {achievements.length ? (
        <ol className={styles.milestoneList}>
          {[...achievements].reverse().map((achievement) => (
            <li key={achievement.count}>
              <span><Check aria-hidden="true" size={13} /></span>
              <div>
                <strong>{formatNumber(achievement.count)} plays</strong>
                <small>{achievement.date} · {achievement.time}</small>
              </div>
            </li>
          ))}
        </ol>
      ) : <EmptySection>The first milestone is still ahead.</EmptySection>}
    </Surface>
  );
}

function RecentExact({ features }: { features: DetailPageFeatures }) {
  return (
    <Surface>
      <SectionHeader title="Recent listens" detail="Exact local timestamps · Europe/Istanbul" />
      {features.recent.length ? (
        <div className={styles.recentList}>
          {features.recent.map((play, index) => (
            <div className={styles.recentRow} key={`${play.playedAt}-${index}`}>
              <Artwork src={play.imageUrl} />
              <span className={styles.recentCopy}>
                <Link href={entityHref("track", play.trackName, play.spotifyId)}>{play.trackName}</Link>
                <Link href={artistHref(play.artistName)}>{play.artistName}</Link>
              </span>
              <time dateTime={play.playedAt}>{exactDateTime.format(new Date(play.playedAt))}</time>
            </div>
          ))}
        </div>
      ) : <EmptySection>No recorded listens.</EmptySection>}
    </Surface>
  );
}

function Breadcrumbs({ data, features }: { data: DetailData; features: DetailPageFeatures }) {
  const context = features.context;
  return (
    <nav aria-label="Breadcrumb" className={styles.breadcrumbs}>
      <Link href="/library">Library</Link>
      <ChevronRight aria-hidden="true" size={13} />
      {data.kind !== "artist" ? (
        <>
          <Link href={artistHref(context.artistName)}>{context.artistName}</Link>
          <ChevronRight aria-hidden="true" size={13} />
        </>
      ) : null}
      {data.kind === "track" && context.albumName ? (
        <>
          <Link href={albumHref(context.albumName, context.albumId)}>{context.albumName}</Link>
          <ChevronRight aria-hidden="true" size={13} />
        </>
      ) : null}
      <span aria-current="page">{data.title}</span>
    </nav>
  );
}

export function EntityDetail({
  data,
  features,
  basePath,
}: {
  data: DetailData;
  features: DetailPageFeatures;
  basePath: string;
}) {
  const context = features.context;
  const topItemLabel = data.kind === "artist" ? "Top track" : data.kind === "album" ? "Top track" : "Average pace";
  const topItemValue = data.kind === "track"
    ? features.averagePerActiveDay === null ? "—" : `${formatNumber(features.averagePerActiveDay)} / day`
    : features.topItem?.name ?? "No plays";
  const topItemDetail = data.kind === "track"
    ? features.activeDays
      ? `Across ${formatNumber(features.activeDays)} active day${features.activeDays === 1 ? "" : "s"}`
      : "No activity in this period"
    : features.topItemShare === null ? "No share for this period" : `${features.topItemShare}% of period plays`;
  const catalogValue = data.kind === "artist"
    ? `${formatNumber(features.distinctTracks)} track${features.distinctTracks === 1 ? "" : "s"}`
    : data.kind === "album"
      ? `${formatNumber(features.distinctTracks)} track${features.distinctTracks === 1 ? "" : "s"}`
      : `${formatNumber(features.activeDays)} day${features.activeDays === 1 ? "" : "s"}`;
  const catalogDetail = data.kind === "artist"
    ? `${formatNumber(features.distinctAlbums)} album${features.distinctAlbums === 1 ? "" : "s"} in period`
    : data.kind === "album"
      ? features.averagePerTrack === null ? "No period average" : `${formatNumber(features.averagePerTrack)} average plays per track`
      : `${formatNumber(features.periodPlays)} plays in selected period`;

  return (
    <div className={`page-stack ${styles.detailPage}`}>
      <Breadcrumbs data={data} features={features} />

      <section className={styles.hero}>
        {/* The 196px hero image is the LCP element on every detail page. */}
        <div className={styles.heroArtwork}><Artwork kind={data.kind} priority size={196} src={data.imageUrl} /></div>
        <div className={styles.heroCopy}>
          <span className="eyebrow">{data.kind} analysis</span>
          <h1>{data.title}</h1>
          {data.kind !== "artist" ? (
            <p className={styles.heroLinks}>
              <Link href={artistHref(context.artistName)}>{context.artistName}</Link>
              {data.kind === "track" && context.albumName ? (
                <><span>·</span><Link href={albumHref(context.albumName, context.albumId)}>{context.albumName}</Link></>
              ) : null}
            </p>
          ) : null}
          <div className={styles.heroMeta}>
            <span><Headphones aria-hidden="true" size={15} /> {formatNumber(features.lifetimePlays)} lifetime plays</span>
            <span><CalendarDays aria-hidden="true" size={15} /> Since {formatDate(data.firstPlay)}</span>
            <span><Clock3 aria-hidden="true" size={15} /> Last heard {exactDateTime.format(new Date(data.lastPlay))}</span>
          </div>
        </div>
      </section>

      <nav aria-label="Listening period" className={styles.periods}>
        {DETAIL_PERIODS.map((period) => (
          <Link
            aria-current={features.period === period ? "page" : undefined}
            data-active={features.period === period || undefined}
            href={`${basePath}?period=${period}`}
            key={period}
            scroll={false}
          >
            {period === "all" ? "All" : period.toUpperCase()}
          </Link>
        ))}
      </nav>

      <section className={styles.metrics}>
        <MetricCard
          detail={features.period === "all" ? "Complete listening history" : `Across the last ${detailPeriodLabel(features.period)}`}
          label={`${features.periodLabel} plays`}
          value={formatNumber(features.periodPlays)}
        />
        <MetricCard detail={topItemDetail} label={topItemLabel} value={topItemValue} />
        <MetricCard
          detail={features.peak ? `${formatNumber(features.peak.plays)} plays` : "No activity in this period"}
          label="Peak period"
          value={features.peak?.label ?? "—"}
        />
        <MetricCard detail={catalogDetail} label={data.kind === "track" ? "Active days" : "Catalog reach"} value={catalogValue} />
      </section>

      <Surface className={styles.chartSurface}>
        <div className={styles.chartHeading}>
          <SectionHeader
            detail={features.period === "all" ? "Lifetime listening volume by month" : `${features.periodLabel} listening volume by ${features.chartMode}`}
            title="Listening history"
          />
          <TrendBadge features={features} />
        </div>
        <LineChart data={features.chart} />
      </Surface>

      <section className={styles.insights} aria-label="Lifetime insights">
        {features.legacy.insights.map((insight) => (
          <div className={styles.insightCard} key={insight.label}>
            <span>{insight.label}</span>
            <strong>{insight.value}</strong>
            <small>{insight.sub}</small>
          </div>
        ))}
      </section>

      {data.kind === "artist" ? (
        <div className={styles.twoColumn}>
          <Surface>
            <SectionHeader title="Top tracks" detail={`${features.periodLabel} ranking`} />
            <RankedList items={features.topTracks} kind="track" period={features.period} />
          </Surface>
          <Surface>
            <SectionHeader title="Top albums" detail={`${features.periodLabel} ranking`} />
            <RankedList items={features.topAlbums} kind="album" period={features.period} />
          </Surface>
        </div>
      ) : null}

      {data.kind === "album" ? (
        <Surface>
          <SectionHeader
            title="Complete track list"
            detail={`${formatNumber(features.albumTracks.length)} tracks · period and lifetime totals`}
          />
          <RankedList items={features.albumTracks} kind="track" period={features.period} showLifetime />
        </Surface>
      ) : null}

      {data.kind === "track" && context.albumName ? (
        <Surface className={styles.contextSurface}>
          <Disc3 aria-hidden="true" size={21} />
          <div>
            <span>Album context</span>
            <Link href={albumHref(context.albumName, context.albumId)}>{context.albumName}</Link>
            <small>by <Link href={artistHref(context.artistName)}>{context.artistName}</Link></small>
          </div>
          <ChevronRight aria-hidden="true" size={17} />
        </Surface>
      ) : null}

      <div className={styles.lowerGrid}>
        <RecentExact features={features} />
        <Milestones features={features} />
      </div>
    </div>
  );
}
