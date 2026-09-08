import "server-only";

import { unstable_cache } from "next/cache";

import { sql } from "@/lib/db";

import { DISPLAY_TIME_ZONE, PERIOD_DAYS } from "@/lib/periods";

export type MonthComparison = {
  current: number;
  previous: number;
  delta: number;
  percentageChange: number | null;
  currentLabel: string;
  previousLabel: string;
  /**
   * How many days of each month the two figures cover. Both sides are measured
   * over this same window, so the comparison stays meaningful on the 1st.
   */
  daysCompared: number;
};

export type OnThisDayPlay = {
  trackName: string;
  artistName: string;
  imageUrl: string | null;
  spotifyId: string | null;
  playedAt: string;
  yearsAgo: number;
  href: string;
};

export type LegacyHeatmapDay = {
  date: string;
  label: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
};

export type RankedTag = {
  name: string;
  count: number;
};

export type GenreMoodData = {
  genres: RankedTag[];
  moods: RankedTag[];
  /** Plays carrying genre metadata; well below the archive total for now. */
  genrePlays: number;
  /** Plays carrying a mood other than the "Mixed" fallthrough. */
  moodPlays: number;
};

export type LegacyHomeFeatures = {
  monthComparison: MonthComparison;
  onThisDay: OnThisDayPlay[];
  heatmap: LegacyHeatmapDay[];
  genreMood: GenreMoodData;
};

type LegacyHomeRow = {
  current_count: number;
  previous_count: number;
  current_label: string;
  previous_label: string;
  days_compared: number;
  genre_plays: number;
  mood_plays: number;
  on_this_day: Array<{
    trackName: string;
    artistName: string;
    imageUrl: string | null;
    spotifyId: string | null;
    playedAt: string;
    yearsAgo: number;
  }>;
  heatmap: Array<{ date: string; label: string; count: number }>;
  genres: RankedTag[];
  moods: RankedTag[];
};

function clampInteger(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function encodePathSegment(value: string) {
  return encodeURIComponent(value);
}

function trackHref(trackName: string, spotifyId: string | null) {
  return spotifyId
    ? `/track/id/${encodePathSegment(spotifyId)}`
    : `/track/${encodePathSegment(trackName)}`;
}

function albumHref(albumName: string, albumId: string | null) {
  return albumId
    ? `/album/id/${encodePathSegment(albumId)}`
    : `/album/${encodePathSegment(albumName)}`;
}

async function loadLegacyHomeFeatures(
  anniversaryLimit: number,
  heatmapDays: number,
  tagLimit: number,
): Promise<LegacyHomeFeatures> {
  const [row] = await sql<LegacyHomeRow[]>`
    WITH local_now AS (
      SELECT now() AT TIME ZONE ${DISPLAY_TIME_ZONE} AS value
    ),
    month_bounds AS (
      SELECT
        date_trunc('month', value)::date AS current_start,
        (date_trunc('month', value) - interval '1 month')::date AS previous_start,
        value::date AS today,
        -- How far into the month we are. The previous month has to be measured
        -- over the same number of days, otherwise the comparison reports a
        -- catastrophic collapse on the 1st of every month and then climbs back
        -- purely as a function of the date.
        (value::date - date_trunc('month', value)::date)::int AS days_elapsed
      FROM local_now
    ),
    month_counts AS (
      SELECT
        COALESCE(sum(plays) FILTER (
          WHERE day >= month_bounds.current_start
            AND day <= month_bounds.today
        ), 0)::int AS current_count,
        COALESCE(sum(plays) FILTER (
          WHERE day >= month_bounds.previous_start
            AND day <= month_bounds.previous_start + month_bounds.days_elapsed
        ), 0)::int AS previous_count
      FROM public.mv_music_daily_counts
      CROSS JOIN month_bounds
      WHERE day >= month_bounds.previous_start
        AND day <= month_bounds.today
    ),
    anniversary_matches AS (
      SELECT
        scrobbles.track_name,
        scrobbles.artist_name,
        scrobbles.image_url,
        scrobbles.spotify_id,
        scrobbles.played_at,
        (
          extract(year FROM local_now.value)::int -
          extract(year FROM scrobbles.played_at AT TIME ZONE ${DISPLAY_TIME_ZONE})::int
        ) AS years_ago
      FROM public.scrobbles
      CROSS JOIN local_now
      WHERE extract(month FROM scrobbles.played_at AT TIME ZONE ${DISPLAY_TIME_ZONE}) =
              extract(month FROM local_now.value)
        AND extract(day FROM scrobbles.played_at AT TIME ZONE ${DISPLAY_TIME_ZONE}) =
            extract(day FROM local_now.value)
        AND extract(year FROM scrobbles.played_at AT TIME ZONE ${DISPLAY_TIME_ZONE}) <
            extract(year FROM local_now.value)
    ),
    anniversary_plays AS (
      -- Take one play from each year before taking a second from any of them.
      -- Ordering by years_ago alone let the most recent year fill the whole
      -- panel, which hid the eight earlier years this archive actually covers —
      -- the deep history is the entire point of the feature.
      SELECT *
      FROM (
        SELECT
          anniversary_matches.*,
          row_number() OVER (
            PARTITION BY years_ago ORDER BY played_at DESC
          ) AS rank_in_year
        FROM anniversary_matches
      ) ranked
      ORDER BY rank_in_year ASC, years_ago ASC
      LIMIT ${anniversaryLimit}
    ),
    heatmap_days AS (
      SELECT generate_series(
        (SELECT value::date FROM local_now) - (${heatmapDays} - 1),
        (SELECT value::date FROM local_now),
        interval '1 day'
      )::date AS day
    ),
    heatmap_counts AS (
      SELECT
        heatmap_days.day,
        COALESCE(daily.plays, 0)::int AS count
      FROM heatmap_days
      LEFT JOIN public.mv_music_daily_counts daily USING (day)
    ),
    top_genres AS (
      SELECT genre AS name, count(*)::int AS count
      FROM public.scrobbles
      CROSS JOIN LATERAL unnest(scrobbles.artist_genres) AS genre
      WHERE scrobbles.artist_genres IS NOT NULL
        AND nullif(btrim(genre), '') IS NOT NULL
      GROUP BY genre
      ORDER BY count DESC, genre ASC
      LIMIT ${tagLimit}
    ),
    top_moods AS (
      SELECT mood_label AS name, count(*)::int AS count
      FROM public.scrobbles
      WHERE nullif(btrim(mood_label), '') IS NOT NULL
        -- "Mixed" is what infer_mood() returns when none of its keywords match,
        -- so it is a fallthrough rather than a mood. It accounted for 76% of
        -- every tagged play and flattened the panel into a single bar.
        AND mood_label <> 'Mixed'
      GROUP BY mood_label
      ORDER BY count DESC, mood_label ASC
      LIMIT ${tagLimit}
    ),
    tag_coverage AS (
      -- Only a fifth of the archive carries enrichment metadata, so the panels
      -- must be able to say what they are actually describing.
      SELECT
        count(*) FILTER (WHERE artist_genres IS NOT NULL)::int AS genre_plays,
        count(*) FILTER (
          WHERE nullif(btrim(mood_label), '') IS NOT NULL AND mood_label <> 'Mixed'
        )::int AS mood_plays
      FROM public.scrobbles
    )
    SELECT
      month_counts.current_count,
      month_counts.previous_count,
      to_char(month_bounds.current_start, 'FMMonth') AS current_label,
      to_char(month_bounds.previous_start, 'FMMonth') AS previous_label,
      (month_bounds.days_elapsed + 1) AS days_compared,
      tag_coverage.genre_plays,
      tag_coverage.mood_plays,
      COALESCE((
        SELECT json_agg(json_build_object(
          'trackName', track_name,
          'artistName', artist_name,
          'imageUrl', image_url,
          'spotifyId', spotify_id,
          'playedAt', played_at::text,
          'yearsAgo', years_ago
        ) ORDER BY years_ago ASC, played_at DESC)
        FROM anniversary_plays
      ), '[]'::json) AS on_this_day,
      COALESCE((
        SELECT json_agg(json_build_object(
          'date', day::text,
          'label', to_char(day, 'DD Mon'),
          'count', count
        ) ORDER BY day)
        FROM heatmap_counts
      ), '[]'::json) AS heatmap,
      COALESCE((SELECT json_agg(top_genres ORDER BY count DESC, name) FROM top_genres), '[]'::json) AS genres,
      COALESCE((SELECT json_agg(top_moods ORDER BY count DESC, name) FROM top_moods), '[]'::json) AS moods
    FROM month_counts
    CROSS JOIN month_bounds
    CROSS JOIN tag_coverage
  `;

  const current = Number(row?.current_count ?? 0);
  const previous = Number(row?.previous_count ?? 0);
  const delta = current - previous;
  const heatmap = row?.heatmap ?? [];
  const maxHeatmapCount = heatmap.reduce((maximum, day) => Math.max(maximum, day.count), 0);

  return {
    monthComparison: {
      current,
      previous,
      delta,
      percentageChange: previous === 0 ? null : Math.round((delta / previous) * 1000) / 10,
      currentLabel: row?.current_label ?? "Current month",
      previousLabel: row?.previous_label ?? "Previous month",
      daysCompared: Number(row?.days_compared ?? 0),
    },
    onThisDay: (row?.on_this_day ?? []).map((play) => ({
      ...play,
      yearsAgo: Number(play.yearsAgo),
      href: trackHref(play.trackName, play.spotifyId),
    })),
    heatmap: heatmap.map((day) => {
      const count = Number(day.count);
      const rawLevel = count === 0 || maxHeatmapCount === 0
        ? 0
        : Math.max(1, Math.min(4, Math.floor((count / maxHeatmapCount) * 4)));
      return { ...day, count, level: rawLevel as LegacyHeatmapDay["level"] };
    }),
    genreMood: {
      genres: row?.genres ?? [],
      moods: row?.moods ?? [],
      genrePlays: Number(row?.genre_plays ?? 0),
      moodPlays: Number(row?.mood_plays ?? 0),
    },
  };
}

export async function getLegacyHomeFeatures(options?: {
  anniversaryLimit?: number;
  heatmapDays?: number;
  tagLimit?: number;
}) {
  const anniversaryLimit = clampInteger(options?.anniversaryLimit ?? 5, 1, 20);
  const heatmapDays = clampInteger(options?.heatmapDays ?? 84, 7, 366);
  const tagLimit = clampInteger(options?.tagLimit ?? 5, 1, 20);
  // This payload shares the live home route with the period query. Caching it
  // separately allowed half of the page to update while heatmap/comparison
  // sections remained stale until a manual reload.
  return loadLegacyHomeFeatures(anniversaryLimit, heatmapDays, tagLimit);
}

export async function getMonthComparison() {
  return (await getLegacyHomeFeatures()).monthComparison;
}

export async function getOnThisDay() {
  return (await getLegacyHomeFeatures()).onThisDay;
}

export async function getListeningHeatmap(days = 84) {
  return (await getLegacyHomeFeatures({ heatmapDays: days })).heatmap;
}

export async function getGenreMood(limit = 5) {
  return (await getLegacyHomeFeatures({ tagLimit: limit })).genreMood;
}

export type ListeningClockHour = {
  hour: number;
  label: string;
  count: number;
  height: number;
};

export type GlobalMilestone = {
  name: string;
  description: string;
  icon: string;
  target: number;
  current: number;
  unlocked: boolean;
  progress: number;
  remaining: number;
};

export type LegacyInsightsFeatures = {
  totalPlays: number;
  clock: ListeningClockHour[];
  milestones: GlobalMilestone[];
};

type LegacyInsightsRow = {
  total_plays: string;
  clock: Array<{ hour: number; count: number }>;
};

async function loadLegacyInsightsFeatures(): Promise<LegacyInsightsFeatures> {
    const [row] = await sql<LegacyInsightsRow[]>`
      WITH hours AS (SELECT generate_series(0, 23)::int AS hour)
      SELECT
        totals.total_plays::text AS total_plays,
        COALESCE((
          SELECT json_agg(json_build_object(
            'hour', hours.hour,
            'count', COALESCE(hour_counts.plays, 0)::int
          ) ORDER BY hours.hour)
          FROM hours
          LEFT JOIN public.mv_music_hour_counts hour_counts USING (hour)
        ), '[]'::json) AS clock
      FROM public.mv_music_totals totals
    `;

    const totalPlays = Number(row?.total_plays ?? 0);
    const rawClock = row?.clock ?? [];
    const maximum = rawClock.reduce((best, hour) => Math.max(best, Number(hour.count)), 0);
    const clock = rawClock.map((hour) => ({
      hour: Number(hour.hour),
      label: String(hour.hour).padStart(2, "0"),
      count: Number(hour.count),
      height: maximum === 0 ? 0 : Math.floor((Number(hour.count) / maximum) * 100),
    }));
    const awakeningTarget = 1_000;

    return {
      totalPlays,
      clock,
      milestones: [{
        name: "The Awakening",
        description: "Listen to your first 1,000 tracks.",
        icon: "*",
        target: awakeningTarget,
        current: totalPlays,
        unlocked: totalPlays >= awakeningTarget,
        progress: Math.min(100, Math.floor((totalPlays / awakeningTarget) * 100)),
        remaining: Math.max(0, awakeningTarget - totalPlays),
      }],
    };
}

const getCachedLegacyInsightsFeatures = unstable_cache(
  loadLegacyInsightsFeatures,
  ["legacy-insights-features-v2"],
  { revalidate: 300, tags: ["listening-history"] },
);

export function getLegacyInsightsFeatures() {
  return process.env.NODE_ENV === "development"
    ? loadLegacyInsightsFeatures()
    : getCachedLegacyInsightsFeatures();
}

export type LegacyEntityKind = "artist" | "album" | "track";

export type AchievedMilestone = {
  count: number;
  achieved: true;
  achievedAt: string;
  date: string;
  time: string;
};

export type NextMilestone = {
  count: number;
  progress: number;
  remaining: number;
};

export type EntityInsightCard = {
  label: "First listen" | "Longest streak" | "Rediscovery";
  value: string;
  sub: string;
};

export type EntityLegacyFeatures = {
  totalPlays: number;
  achievements: AchievedMilestone[];
  nextMilestone: NextMilestone | null;
  insights: EntityInsightCard[];
};

type EntityFeaturesRow = {
  total_plays: string;
  first_play: string | null;
  last_play: string | null;
  first_date: string | null;
  first_time: string | null;
  last_date: string | null;
  longest_streak: number;
  rediscovery_gap_days: number;
  achievements: AchievedMilestone[];
};

const MILESTONE_GOALS: Record<LegacyEntityKind, readonly number[]> = {
  artist: [1, 50, 100, 500, 1_000, 5_000, 10_000],
  album: [10, 50, 100, 500, 1_000],
  track: [1, 10, 25, 50, 100, 500, 1_000],
};

export async function getEntityLegacyFeatures(
  kind: LegacyEntityKind,
  value: string,
  byId = false,
): Promise<EntityLegacyFeatures | null> {
  const cleanValue = value.trim();
  if (!cleanValue) return null;

  const entityPredicate = kind === "artist"
    ? byId ? sql`artist_id = ${cleanValue}` : sql`artist_name = ${cleanValue}`
    : kind === "album"
      ? byId ? sql`album_id = ${cleanValue}` : sql`album_name = ${cleanValue}`
      : byId ? sql`spotify_id = ${cleanValue}` : sql`track_name = ${cleanValue}`;
  const goals = MILESTONE_GOALS[kind];

  const [row] = await sql<EntityFeaturesRow[]>`
    WITH filtered AS (
      SELECT
        played_at,
        played_at AT TIME ZONE ${DISPLAY_TIME_ZONE} AS local_at,
        (played_at AT TIME ZONE ${DISPLAY_TIME_ZONE})::date AS local_day
      FROM public.scrobbles
      WHERE ${entityPredicate}
    ),
    numbered AS (
      SELECT *, row_number() OVER (ORDER BY played_at ASC) AS play_number
      FROM filtered
    ),
    targets AS (
      SELECT unnest(${sql.array([...goals], 23)})::int AS goal
    ),
    stats AS (
      SELECT
        count(*)::bigint AS total_plays,
        min(played_at) AS first_play,
        max(played_at) AS last_play,
        min(local_at) AS first_local,
        max(local_at) AS last_local
      FROM filtered
    ),
    distinct_days AS (
      SELECT DISTINCT local_day FROM filtered
    ),
    streak_islands AS (
      SELECT
        local_day - row_number() OVER (ORDER BY local_day)::int AS island
      FROM distinct_days
    ),
    streaks AS (
      SELECT count(*)::int AS length
      FROM streak_islands
      GROUP BY island
    ),
    gaps AS (
      SELECT extract(epoch FROM local_at - lag(local_at) OVER (ORDER BY local_at)) / 86400 AS days
      FROM filtered
    )
    SELECT
      stats.total_plays::text AS total_plays,
      stats.first_play::text AS first_play,
      stats.last_play::text AS last_play,
      to_char(stats.first_local, 'DD Mon YYYY') AS first_date,
      to_char(stats.first_local, 'HH24:MI') AS first_time,
      to_char(stats.last_local, 'DD Mon YYYY') AS last_date,
      COALESCE((SELECT max(length) FROM streaks), 0)::int AS longest_streak,
      COALESCE((SELECT floor(max(days))::int FROM gaps), 0)::int AS rediscovery_gap_days,
      COALESCE((
        SELECT json_agg(json_build_object(
          'count', targets.goal,
          'achieved', true,
          'achievedAt', numbered.played_at::text,
          'date', to_char(numbered.local_at, 'DD Mon YYYY'),
          'time', to_char(numbered.local_at, 'HH24:MI')
        ) ORDER BY targets.goal)
        FROM targets
        JOIN numbered ON numbered.play_number = targets.goal
      ), '[]'::json) AS achievements
    FROM stats
  `;

  const totalPlays = Number(row?.total_plays ?? 0);
  if (!row || totalPlays === 0 || !row.first_play || !row.last_play) return null;

  const nextGoal = goals.find((goal) => totalPlays < goal);
  const longestStreak = Number(row.longest_streak);
  const rediscoveryGap = Number(row.rediscovery_gap_days);

  return {
    totalPlays,
    achievements: row.achievements ?? [],
    nextMilestone: nextGoal === undefined ? null : {
      count: nextGoal,
      progress: Math.floor((totalPlays / nextGoal) * 100),
      remaining: nextGoal - totalPlays,
    },
    insights: [
      {
        label: "First listen",
        value: row.first_date ?? "—",
        sub: row.first_time ?? "",
      },
      {
        label: "Longest streak",
        value: `${longestStreak} day${longestStreak === 1 ? "" : "s"}`,
        sub: "consecutive listening days",
      },
      {
        label: "Rediscovery",
        value: `${rediscoveryGap} day${rediscoveryGap === 1 ? "" : "s"}`,
        sub: `biggest gap before returning, last on ${row.last_date ?? "—"}`,
      },
    ],
  };
}

export function getArtistLegacyFeatures(value: string, byId = false) {
  return getEntityLegacyFeatures("artist", value, byId);
}

export function getAlbumLegacyFeatures(value: string, byId = false) {
  return getEntityLegacyFeatures("album", value, byId);
}

export function getTrackLegacyFeatures(value: string, byId = false) {
  return getEntityLegacyFeatures("track", value, byId);
}

export const LEGACY_LIBRARY_MODES = ["scrobbles", "artists", "albums", "tracks"] as const;
export const LEGACY_LIBRARY_PERIODS = ["7d", "30d", "90d", "180d", "365d", "all", "custom"] as const;
export const LEGACY_LIBRARY_SORTS = ["plays_desc", "plays_asc", "name_asc", "recent_desc"] as const;
export const LEGACY_LIBRARY_FILTERS = ["artist", "album", "track"] as const;

export type LegacyLibraryMode = (typeof LEGACY_LIBRARY_MODES)[number];
export type LegacyLibraryPeriod = (typeof LEGACY_LIBRARY_PERIODS)[number];
export type LegacyLibrarySort = (typeof LEGACY_LIBRARY_SORTS)[number];
export type LegacyLibraryFilterType = (typeof LEGACY_LIBRARY_FILTERS)[number];
export type LegacyLibraryChartMode = "day" | "month" | "year";

export type LegacyLibraryFilter = {
  type: LegacyLibraryFilterType;
  value: string;
};

export type LegacyLibraryOptions = {
  mode?: LegacyLibraryMode;
  period?: LegacyLibraryPeriod;
  start?: string;
  end?: string;
  filter?: LegacyLibraryFilter | null;
  search?: string;
  sort?: LegacyLibrarySort;
  page?: number;
  pageSize?: number;
};

export type LegacyLibraryChartPoint = {
  label: string;
  value: number;
};

export type LegacyLibraryItem = {
  kind: LegacyLibraryMode;
  rank: number;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  count: number | null;
  percent: number | null;
  id: string | null;
  albumId: string | null;
  playedAt: string | null;
  href: string;
};

export type LegacyLibraryHeader = {
  type: LegacyLibraryFilterType;
  title: string;
  subtitle: string;
  imageUrl: string | null;
  count: number;
  trackCount: number | null;
};

export type LegacyLibraryRelatedItem = {
  rank: number;
  title: string;
  count: number;
  imageUrl: string | null;
  id: string | null;
  href: string;
  percent: number;
};

export type LegacyLibraryResult = {
  mode: LegacyLibraryMode;
  period: LegacyLibraryPeriod;
  sort: LegacyLibrarySort;
  search: string;
  filter: LegacyLibraryFilter | null;
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  currentStart: string;
  currentEnd: string;
  chartMode: LegacyLibraryChartMode;
  chart: LegacyLibraryChartPoint[];
  items: LegacyLibraryItem[];
  header: LegacyLibraryHeader | null;
  relatedAlbums: LegacyLibraryRelatedItem[];
  relatedTracks: LegacyLibraryRelatedItem[];
};

type RawLibraryItem = {
  rank: number;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  count: number | null;
  id: string | null;
  albumId: string | null;
  playedAt: string | null;
  maxCount: number | null;
};

type LibraryPageRow = {
  total_count: string;
  items: RawLibraryItem[];
};

type LibraryChartRow = {
  start_date: string;
  end_date: string;
  points: LegacyLibraryChartPoint[];
};

type RelatedRow = {
  count: string;
  image_url: string | null;
  artist_name: string | null;
  track_count: string;
  albums: Array<{
    title: string;
    count: number;
    imageUrl: string | null;
    id: string | null;
  }>;
  tracks: Array<{
    title: string;
    count: number;
    imageUrl: string | null;
    id: string | null;
  }>;
};

// The home page and the library must agree on what "30 days" means, so the
// day counts come from the shared calendar helper rather than a second copy.
// A drift here showed up as the same ranking reporting two different totals.
const LIBRARY_PERIOD_DAYS: Partial<Record<LegacyLibraryPeriod, number>> = PERIOD_DAYS;

function isChoice<T extends string>(choices: readonly T[], value: string): value is T {
  return choices.some((choice) => choice === value);
}

export function parseLegacyLibraryMode(value: string | null | undefined): LegacyLibraryMode {
  return value && isChoice(LEGACY_LIBRARY_MODES, value) ? value : "artists";
}

export function parseLegacyLibraryPeriod(value: string | null | undefined): LegacyLibraryPeriod {
  return value && isChoice(LEGACY_LIBRARY_PERIODS, value) ? value : "30d";
}

export function parseLegacyLibrarySort(value: string | null | undefined): LegacyLibrarySort {
  return value && isChoice(LEGACY_LIBRARY_SORTS, value) ? value : "plays_desc";
}

export function parseLegacyLibraryFilterType(
  value: string | null | undefined,
): LegacyLibraryFilterType | null {
  return value && isChoice(LEGACY_LIBRARY_FILTERS, value) ? value : null;
}

function isIsoDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}

function epochDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function chartModeFor(
  period: LegacyLibraryPeriod,
  start: string | undefined,
  end: string | undefined,
): LegacyLibraryChartMode {
  if (period === "all") return "year";
  const span = period === "custom" && start && end
    ? epochDay(end) - epochDay(start)
    : LIBRARY_PERIOD_DAYS[period] ?? 30;
  if (span > 730) return "year";
  if (span > 60) return "month";
  return "day";
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function fillLibraryChart(
  points: LegacyLibraryChartPoint[],
  startDate: string,
  endDate: string,
  mode: LegacyLibraryChartMode,
) {
  const values = new Map(points.map((point) => [point.label, Number(point.value)]));
  const filled: LegacyLibraryChartPoint[] = [];

  if (mode === "year") {
    const firstPointYear = points.length ? Number(points[0].label) : Number(startDate.slice(0, 4));
    const firstYear = Number.isFinite(firstPointYear) ? firstPointYear : Number(startDate.slice(0, 4));
    const lastYear = Number(endDate.slice(0, 4));
    for (let year = firstYear; year <= lastYear && filled.length < 5_000; year += 1) {
      const label = String(year);
      filled.push({ label, value: values.get(label) ?? 0 });
    }
    return filled;
  }

  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);
  let cursor = new Date(Date.UTC(startYear, startMonth - 1, mode === "month" ? 1 : startDay));
  const endCursor = new Date(Date.UTC(endYear, endMonth - 1, mode === "month" ? 1 : endDay));

  while (cursor <= endCursor && filled.length < 5_000) {
    const year = cursor.getUTCFullYear();
    const month = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    const day = String(cursor.getUTCDate()).padStart(2, "0");
    const label = mode === "month" ? `${year}-${month}` : `${year}-${month}-${day}`;
    filled.push({ label, value: values.get(label) ?? 0 });
    if (mode === "month") cursor = new Date(Date.UTC(year, cursor.getUTCMonth() + 1, 1));
    else cursor = addUtcDays(cursor, 1);
  }

  return filled;
}

function mapLibraryItems(mode: LegacyLibraryMode, rawItems: RawLibraryItem[]) {
  return rawItems.map((item): LegacyLibraryItem => {
    const count = item.count === null ? null : Number(item.count);
    const maximum = item.maxCount === null ? null : Number(item.maxCount);
    const id = item.id;
    const href = mode === "artists"
      ? `/artist/${encodePathSegment(item.title)}`
      : mode === "albums"
        ? albumHref(item.title, id)
        : trackHref(item.title, id);

    return {
      kind: mode,
      rank: Number(item.rank),
      title: item.title,
      subtitle: item.subtitle,
      imageUrl: item.imageUrl,
      count,
      percent: count === null || maximum === null || maximum === 0
        ? null
        : (count / maximum) * 100,
      id,
      albumId: item.albumId,
      playedAt: item.playedAt,
      href,
    };
  });
}

async function getLibraryPage(
  mode: LegacyLibraryMode,
  period: LegacyLibraryPeriod,
  filter: LegacyLibraryFilter | null,
  search: string,
  sort: LegacyLibrarySort,
  page: number,
  pageSize: number,
  start: string | undefined,
  end: string | undefined,
): Promise<{ total: number; items: LegacyLibraryItem[] }> {
  const days = LIBRARY_PERIOD_DAYS[period] ?? 0;
  const datePredicate = period === "all"
    ? sql``
    : period === "custom"
      ? sql`
          AND played_at >= (${start!}::date::timestamp AT TIME ZONE ${DISPLAY_TIME_ZONE})
          AND played_at < (((${end!}::date + 1)::timestamp) AT TIME ZONE ${DISPLAY_TIME_ZONE})
        `
      : sql`
          AND played_at >= (
            (((now() AT TIME ZONE ${DISPLAY_TIME_ZONE})::date - (${days} - 1))::timestamp)
            AT TIME ZONE ${DISPLAY_TIME_ZONE}
          )
          AND played_at <= now()
        `;
  const filterPredicate = !filter
    ? sql``
    : filter.type === "artist"
      ? sql`AND artist_name = ${filter.value}`
      : filter.type === "album"
        ? sql`AND album_name = ${filter.value}`
        : sql`AND track_name = ${filter.value}`;
  const term = `%${search}%`;
  const searchPredicate = !search
    ? sql``
    : mode === "artists"
      ? sql`AND artist_name ILIKE ${term}`
      : mode === "albums"
        ? sql`AND (album_name ILIKE ${term} OR artist_name ILIKE ${term})`
        : sql`AND (track_name ILIKE ${term} OR artist_name ILIKE ${term} OR album_name ILIKE ${term})`;
  const firstRank = (page - 1) * pageSize + 1;
  const lastRank = page * pageSize;

  if (mode === "scrobbles") {
    const order = sort === "name_asc"
      ? sql`track_name ASC, played_at DESC`
      : sql`played_at DESC, id DESC`;
    const [row] = await sql<LibraryPageRow[]>`
      WITH filtered AS (
        SELECT
          id,
          track_name,
          artist_name,
          image_url,
          spotify_id,
          album_id,
          played_at
        FROM public.scrobbles
        WHERE true ${datePredicate} ${filterPredicate} ${searchPredicate}
      ),
      ranked AS (
        SELECT *, (row_number() OVER (ORDER BY ${order}))::int AS rank
        FROM filtered
      ),
      page AS (
        SELECT * FROM ranked WHERE rank BETWEEN ${firstRank} AND ${lastRank}
      )
      SELECT
        (SELECT count(*)::text FROM filtered) AS total_count,
        COALESCE((
          SELECT json_agg(json_build_object(
            'rank', rank,
            'title', track_name,
            'subtitle', artist_name,
            'imageUrl', image_url,
            'count', NULL,
            'id', spotify_id,
            'albumId', album_id,
            'playedAt', played_at::text,
            'maxCount', NULL
          ) ORDER BY rank)
          FROM page
        ), '[]'::json) AS items
    `;
    return { total: Number(row?.total_count ?? 0), items: mapLibraryItems(mode, row?.items ?? []) };
  }

  const order = sort === "plays_asc"
    ? sql`play_count ASC, title ASC`
    : sort === "name_asc"
      ? sql`title ASC, subtitle ASC NULLS LAST`
      : sort === "recent_desc"
        ? sql`last_play DESC, title ASC`
        : sql`play_count DESC, title ASC`;

  if (mode === "artists") {
    const useRollup = period === "all" && !filter;
    const [row] = useRollup
      ? await sql<LibraryPageRow[]>`
          WITH grouped AS (
            SELECT
              artist_name AS title,
              NULL::text AS subtitle,
              plays::int AS play_count,
              image_url,
              artist_id AS entity_id,
              NULL::text AS album_id,
              last_play
            FROM public.mv_music_artist_totals
            WHERE (${search} = '' OR artist_name ILIKE ${term})
          ),
          ranked AS (
            SELECT *,
              (row_number() OVER (ORDER BY ${order}))::int AS rank,
              max(play_count) OVER ()::int AS max_count
            FROM grouped
          ),
          page AS (SELECT * FROM ranked WHERE rank BETWEEN ${firstRank} AND ${lastRank})
          SELECT
            (SELECT count(*)::text FROM grouped) AS total_count,
            COALESCE((SELECT json_agg(json_build_object(
              'rank', rank, 'title', title, 'subtitle', subtitle,
              'imageUrl', image_url, 'count', play_count, 'id', entity_id,
              'albumId', album_id, 'playedAt', NULL, 'maxCount', max_count
            ) ORDER BY rank) FROM page), '[]'::json) AS items
        `
      : await sql<LibraryPageRow[]>`
          WITH grouped AS (
            SELECT
              artist_name AS title,
              NULL::text AS subtitle,
              count(*)::int AS play_count,
              max(image_url) FILTER (WHERE image_url IS NOT NULL) AS image_url,
              max(artist_id) FILTER (WHERE artist_id IS NOT NULL) AS entity_id,
              NULL::text AS album_id,
              max(played_at) AS last_play
            FROM public.scrobbles
            WHERE true ${datePredicate} ${filterPredicate} ${searchPredicate}
            GROUP BY artist_name
          ),
          ranked AS (
            SELECT *,
              (row_number() OVER (ORDER BY ${order}))::int AS rank,
              max(play_count) OVER ()::int AS max_count
            FROM grouped
          ),
          page AS (SELECT * FROM ranked WHERE rank BETWEEN ${firstRank} AND ${lastRank})
          SELECT
            (SELECT count(*)::text FROM grouped) AS total_count,
            COALESCE((SELECT json_agg(json_build_object(
              'rank', rank, 'title', title, 'subtitle', subtitle,
              'imageUrl', image_url, 'count', play_count, 'id', entity_id,
              'albumId', album_id, 'playedAt', NULL, 'maxCount', max_count
            ) ORDER BY rank) FROM page), '[]'::json) AS items
        `;
    return { total: Number(row?.total_count ?? 0), items: mapLibraryItems(mode, row?.items ?? []) };
  }

  if (mode === "albums") {
    const useRollup = period === "all" && !filter;
    const [row] = useRollup
      ? await sql<LibraryPageRow[]>`
          WITH grouped AS (
            SELECT
              album_name AS title,
              artist_name AS subtitle,
              plays::int AS play_count,
              image_url,
              album_id AS entity_id,
              album_id,
              last_play
            FROM public.mv_music_album_totals
            WHERE (${search} = '' OR album_name ILIKE ${term} OR artist_name ILIKE ${term})
          ),
          ranked AS (
            SELECT *,
              (row_number() OVER (ORDER BY ${order}))::int AS rank,
              max(play_count) OVER ()::int AS max_count
            FROM grouped
          ),
          page AS (SELECT * FROM ranked WHERE rank BETWEEN ${firstRank} AND ${lastRank})
          SELECT
            (SELECT count(*)::text FROM grouped) AS total_count,
            COALESCE((SELECT json_agg(json_build_object(
              'rank', rank, 'title', title, 'subtitle', subtitle,
              'imageUrl', image_url, 'count', play_count, 'id', entity_id,
              'albumId', album_id, 'playedAt', NULL, 'maxCount', max_count
            ) ORDER BY rank) FROM page), '[]'::json) AS items
        `
      : await sql<LibraryPageRow[]>`
          WITH grouped AS (
            SELECT
              album_name AS title,
              artist_name AS subtitle,
              count(*)::int AS play_count,
              max(image_url) FILTER (WHERE image_url IS NOT NULL) AS image_url,
              max(album_id) FILTER (WHERE album_id IS NOT NULL) AS entity_id,
              max(album_id) FILTER (WHERE album_id IS NOT NULL) AS album_id,
              max(played_at) AS last_play
            FROM public.scrobbles
            WHERE album_name IS NOT NULL ${datePredicate} ${filterPredicate} ${searchPredicate}
            GROUP BY album_id, album_name, artist_name
          ),
          ranked AS (
            SELECT *,
              (row_number() OVER (ORDER BY ${order}))::int AS rank,
              max(play_count) OVER ()::int AS max_count
            FROM grouped
          ),
          page AS (SELECT * FROM ranked WHERE rank BETWEEN ${firstRank} AND ${lastRank})
          SELECT
            (SELECT count(*)::text FROM grouped) AS total_count,
            COALESCE((SELECT json_agg(json_build_object(
              'rank', rank, 'title', title, 'subtitle', subtitle,
              'imageUrl', image_url, 'count', play_count, 'id', entity_id,
              'albumId', album_id, 'playedAt', NULL, 'maxCount', max_count
            ) ORDER BY rank) FROM page), '[]'::json) AS items
        `;
    return { total: Number(row?.total_count ?? 0), items: mapLibraryItems(mode, row?.items ?? []) };
  }

  const useRollup = period === "all" && !filter;
  const [row] = useRollup
    ? await sql<LibraryPageRow[]>`
        WITH grouped AS (
          SELECT
            track_name AS title,
            artist_name AS subtitle,
            plays::int AS play_count,
            image_url,
            spotify_id AS entity_id,
            album_id,
            last_play
          FROM public.mv_music_track_totals
          WHERE (${search} = '' OR track_name ILIKE ${term} OR artist_name ILIKE ${term})
        ),
        ranked AS (
          SELECT *,
            (row_number() OVER (ORDER BY ${order}))::int AS rank,
            max(play_count) OVER ()::int AS max_count
          FROM grouped
        ),
        page AS (SELECT * FROM ranked WHERE rank BETWEEN ${firstRank} AND ${lastRank})
        SELECT
          (SELECT count(*)::text FROM grouped) AS total_count,
          COALESCE((SELECT json_agg(json_build_object(
            'rank', rank, 'title', title, 'subtitle', subtitle,
            'imageUrl', image_url, 'count', play_count, 'id', entity_id,
            'albumId', album_id, 'playedAt', NULL, 'maxCount', max_count
          ) ORDER BY rank) FROM page), '[]'::json) AS items
      `
    : await sql<LibraryPageRow[]>`
        WITH grouped AS (
          SELECT
            track_name AS title,
            artist_name AS subtitle,
            count(*)::int AS play_count,
            max(image_url) FILTER (WHERE image_url IS NOT NULL) AS image_url,
            max(spotify_id) FILTER (WHERE spotify_id IS NOT NULL) AS entity_id,
            max(album_id) FILTER (WHERE album_id IS NOT NULL) AS album_id,
            max(played_at) AS last_play
          FROM public.scrobbles
          WHERE true ${datePredicate} ${filterPredicate} ${searchPredicate}
          GROUP BY spotify_id, track_name, artist_name
        ),
        ranked AS (
          SELECT *,
            (row_number() OVER (ORDER BY ${order}))::int AS rank,
            max(play_count) OVER ()::int AS max_count
          FROM grouped
        ),
        page AS (SELECT * FROM ranked WHERE rank BETWEEN ${firstRank} AND ${lastRank})
        SELECT
          (SELECT count(*)::text FROM grouped) AS total_count,
          COALESCE((SELECT json_agg(json_build_object(
            'rank', rank, 'title', title, 'subtitle', subtitle,
            'imageUrl', image_url, 'count', play_count, 'id', entity_id,
            'albumId', album_id, 'playedAt', NULL, 'maxCount', max_count
          ) ORDER BY rank) FROM page), '[]'::json) AS items
      `;
  return { total: Number(row?.total_count ?? 0), items: mapLibraryItems(mode, row?.items ?? []) };
}

async function getLibraryChart(
  mode: LegacyLibraryMode,
  period: LegacyLibraryPeriod,
  filter: LegacyLibraryFilter | null,
  search: string,
  start: string | undefined,
  end: string | undefined,
  chartMode: LegacyLibraryChartMode,
) {
  const days = LIBRARY_PERIOD_DAYS[period] ?? 0;
  const datePredicate = period === "all"
    ? sql``
    : period === "custom"
      ? sql`
          AND played_at >= (${start!}::date::timestamp AT TIME ZONE ${DISPLAY_TIME_ZONE})
          AND played_at < (((${end!}::date + 1)::timestamp) AT TIME ZONE ${DISPLAY_TIME_ZONE})
        `
      : sql`
          AND played_at >= (
            (((now() AT TIME ZONE ${DISPLAY_TIME_ZONE})::date - (${days} - 1))::timestamp)
            AT TIME ZONE ${DISPLAY_TIME_ZONE}
          )
          AND played_at <= now()
        `;
  const filterPredicate = !filter
    ? sql``
    : filter.type === "artist"
      ? sql`AND artist_name = ${filter.value}`
      : filter.type === "album"
        ? sql`AND album_name = ${filter.value}`
        : sql`AND track_name = ${filter.value}`;
  const term = `%${search}%`;
  const searchPredicate = !search
    ? sql``
    : mode === "artists"
      ? sql`AND artist_name ILIKE ${term}`
      : mode === "albums"
        ? sql`AND (album_name ILIKE ${term} OR artist_name ILIKE ${term})`
        : sql`AND (track_name ILIKE ${term} OR artist_name ILIKE ${term} OR album_name ILIKE ${term})`;
  const labelExpression = chartMode === "year"
    ? sql`extract(year FROM local_day)::int::text`
    : chartMode === "month"
      ? sql`to_char(date_trunc('month', local_day::timestamp), 'YYYY-MM')`
      : sql`to_char(local_day, 'YYYY-MM-DD')`;

  const [row] = await sql<LibraryChartRow[]>`
    WITH local_now AS (
      SELECT (now() AT TIME ZONE ${DISPLAY_TIME_ZONE})::date AS today
    ),
    source AS (
      SELECT (played_at AT TIME ZONE ${DISPLAY_TIME_ZONE})::date AS local_day
      FROM public.scrobbles
      WHERE true ${datePredicate} ${filterPredicate} ${searchPredicate}
    ),
    grouped AS (
      SELECT ${labelExpression} AS label, count(*)::int AS value
      FROM source
      GROUP BY 1
      ORDER BY 1
    )
    SELECT
      CASE
        WHEN ${period} = 'all' THEN COALESCE((SELECT min(local_day) FROM source), local_now.today)::text
        WHEN ${period} = 'custom' THEN ${start ?? "1970-01-01"}::date::text
        ELSE (local_now.today - (${days}::int - 1))::text
      END AS start_date,
      CASE
        WHEN ${period} = 'custom' THEN ${end ?? "1970-01-01"}::date::text
        ELSE local_now.today::text
      END AS end_date,
      COALESCE((
        SELECT json_agg(json_build_object('label', label, 'value', value) ORDER BY label)
        FROM grouped
      ), '[]'::json) AS points
    FROM local_now
  `;

  const startDate = row?.start_date ?? start ?? end ?? "1970-01-01";
  const endDate = row?.end_date ?? end ?? startDate;
  return {
    currentStart: startDate,
    currentEnd: endDate,
    chart: fillLibraryChart(row?.points ?? [], startDate, endDate, chartMode),
  };
}

async function getLibraryRelated(
  period: LegacyLibraryPeriod,
  filter: LegacyLibraryFilter | null,
  start: string | undefined,
  end: string | undefined,
): Promise<{
  header: LegacyLibraryHeader | null;
  relatedAlbums: LegacyLibraryRelatedItem[];
  relatedTracks: LegacyLibraryRelatedItem[];
}> {
  if (!filter) return { header: null, relatedAlbums: [], relatedTracks: [] };

  const days = LIBRARY_PERIOD_DAYS[period] ?? 0;
  const datePredicate = period === "all"
    ? sql``
    : period === "custom"
      ? sql`
          AND played_at >= (${start!}::date::timestamp AT TIME ZONE ${DISPLAY_TIME_ZONE})
          AND played_at < (((${end!}::date + 1)::timestamp) AT TIME ZONE ${DISPLAY_TIME_ZONE})
        `
      : sql`
          AND played_at >= (
            (((now() AT TIME ZONE ${DISPLAY_TIME_ZONE})::date - (${days} - 1))::timestamp)
            AT TIME ZONE ${DISPLAY_TIME_ZONE}
          )
          AND played_at <= now()
        `;
  const filterPredicate = filter.type === "artist"
    ? sql`artist_name = ${filter.value}`
    : filter.type === "album"
      ? sql`album_name = ${filter.value}`
      : sql`track_name = ${filter.value}`;

  const [row] = await sql<RelatedRow[]>`
    WITH filtered AS (
      SELECT *
      FROM public.scrobbles
      WHERE ${filterPredicate} ${datePredicate}
    ),
    -- These lists group on the same identity the detail pages use, rather than
    -- on the display name. Grouping by name merged every release of a track but
    -- still linked to one id, so the count shown here could not be reproduced
    -- on the page it opened.
    album_groups AS (
      SELECT
        max(album_name) AS title,
        count(*)::int AS count,
        max(image_url) FILTER (WHERE image_url IS NOT NULL) AS image_url,
        max(album_id) FILTER (WHERE album_id IS NOT NULL) AS entity_id
      FROM filtered
      WHERE album_name IS NOT NULL
      GROUP BY COALESCE(album_id, md5(album_name || E'\x1f' || artist_name))
      ORDER BY count DESC, title
      LIMIT 10
    ),
    track_groups AS (
      SELECT
        max(track_name) AS title,
        count(*)::int AS count,
        max(image_url) FILTER (WHERE image_url IS NOT NULL) AS image_url,
        max(spotify_id) FILTER (WHERE spotify_id IS NOT NULL) AS entity_id
      FROM filtered
      GROUP BY COALESCE(spotify_id, md5(track_name || E'\x1f' || artist_name))
      ORDER BY count DESC, title
      LIMIT 10
    )
    SELECT
      count(*)::text AS count,
      max(image_url) FILTER (WHERE image_url IS NOT NULL) AS image_url,
      max(artist_name) AS artist_name,
      count(DISTINCT track_name)::text AS track_count,
      CASE WHEN ${filter.type} = 'artist' THEN COALESCE((
        SELECT json_agg(json_build_object(
          'title', title, 'count', count, 'imageUrl', image_url, 'id', entity_id
        ) ORDER BY count DESC, title)
        FROM album_groups
      ), '[]'::json) ELSE '[]'::json END AS albums,
      CASE WHEN ${filter.type} IN ('artist', 'album') THEN COALESCE((
        SELECT json_agg(json_build_object(
          'title', title, 'count', count, 'imageUrl', image_url, 'id', entity_id
        ) ORDER BY count DESC, title)
        FROM track_groups
      ), '[]'::json) ELSE '[]'::json END AS tracks
    FROM filtered
  `;

  const total = Number(row?.count ?? 0);
  if (!row || total === 0) return { header: null, relatedAlbums: [], relatedTracks: [] };
  const albums = row.albums ?? [];
  const tracks = row.tracks ?? [];
  const maximumTrackCount = tracks.reduce((maximum, track) => Math.max(maximum, Number(track.count)), 0);

  return {
    header: {
      type: filter.type,
      title: filter.value,
      subtitle: filter.type === "artist" ? "Artist" : row.artist_name ?? filter.type,
      imageUrl: row.image_url,
      count: total,
      trackCount: filter.type === "album" ? Number(row.track_count) : null,
    },
    relatedAlbums: albums.map((album, index) => ({
      rank: index + 1,
      title: album.title,
      count: Number(album.count),
      imageUrl: album.imageUrl,
      id: album.id,
      href: albumHref(album.title, album.id),
      percent: total === 0 ? 0 : (Number(album.count) / total) * 100,
    })),
    relatedTracks: tracks.map((track, index) => ({
      rank: index + 1,
      title: track.title,
      count: Number(track.count),
      imageUrl: track.imageUrl,
      id: track.id,
      href: trackHref(track.title, track.id),
      percent: maximumTrackCount === 0 ? 0 : (Number(track.count) / maximumTrackCount) * 100,
    })),
  };
}

export async function getLegacyLibraryData(
  options: LegacyLibraryOptions = {},
): Promise<LegacyLibraryResult> {
  const mode = options.mode ?? "artists";
  const period = options.period ?? "30d";
  const sort = options.sort ?? "plays_desc";
  if (!isChoice(LEGACY_LIBRARY_MODES, mode)) throw new Error("Invalid library mode");
  if (!isChoice(LEGACY_LIBRARY_PERIODS, period)) throw new Error("Invalid library period");
  if (!isChoice(LEGACY_LIBRARY_SORTS, sort)) throw new Error("Invalid library sort");

  const search = (options.search ?? "").trim().slice(0, 100);
  const page = clampInteger(options.page ?? 1, 1, 100_000);
  const pageSize = clampInteger(options.pageSize ?? 50, 1, 100);
  const start = options.start;
  const end = options.end;
  if (period === "custom") {
    if (!isIsoDate(start) || !isIsoDate(end)) {
      throw new Error("Custom library periods require valid YYYY-MM-DD start and end dates");
    }
    if (epochDay(start) > epochDay(end)) throw new Error("Library start date must be before end date");
  }

  const filter = options.filter?.value.trim()
    ? { type: options.filter.type, value: options.filter.value.trim().slice(0, 300) }
    : null;
  if (filter && !isChoice(LEGACY_LIBRARY_FILTERS, filter.type)) {
    throw new Error("Invalid library filter");
  }
  const chartMode = chartModeFor(period, start, end);

  // These three queries are independent. Awaiting them in sequence cost three
  // full round trips to the database, which is the dominant cost of this page
  // from Istanbul to a Tokyo-region pooler. The connection pool holds four
  // sockets, so all three can be in flight at once.
  const [pageData, chartData, related] = await Promise.all([
    getLibraryPage(mode, period, filter, search, sort, page, pageSize, start, end),
    getLibraryChart(mode, period, filter, search, start, end, chartMode),
    getLibraryRelated(period, filter, start, end),
  ]);

  return {
    mode,
    period,
    sort,
    search,
    filter,
    currentPage: page,
    totalPages: Math.ceil(pageData.total / pageSize),
    totalItems: pageData.total,
    pageSize,
    currentStart: chartData.currentStart,
    currentEnd: chartData.currentEnd,
    chartMode,
    chart: chartData.chart,
    items: pageData.items,
    header: related.header,
    relatedAlbums: related.relatedAlbums,
    relatedTracks: related.relatedTracks,
  };
}
