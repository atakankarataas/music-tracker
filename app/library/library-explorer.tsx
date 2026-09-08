"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Bookmark,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Disc3,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";

import { Artwork } from "@/components/ui";
import { entityHref, formatNumber } from "@/lib/format";

export type LibraryMode = "scrobbles" | "artists" | "albums" | "tracks";
export type LibraryPeriod = "7d" | "30d" | "90d" | "180d" | "365d" | "all" | "custom";
export type LibrarySort = "plays_desc" | "plays_asc" | "name_asc" | "recent_desc";
export type LibraryFilterType = "artist" | "album" | "track";

export type LibraryState = {
  mode: LibraryMode;
  period: LibraryPeriod;
  start: string;
  end: string;
  page: number;
  query: string;
  sort: LibrarySort;
  filterType: LibraryFilterType | null;
  filterValue: string;
};

export type LibraryItem = {
  rank?: number;
  title: string;
  subtitle?: string | null;
  count?: number;
  imageUrl?: string | null;
  date?: string | null;
  href?: string | null;
  artistId?: string | null;
  albumId?: string | null;
  spotifyId?: string | null;
  percent?: number;
};

export type LibraryHeaderInfo = {
  title: string;
  subtitle: string;
  count: number;
  imageUrl?: string | null;
  trackCount?: number | null;
};

export type LibraryViewData = {
  items: LibraryItem[];
  totalItems: number;
  currentPage: number;
  totalPages: number;
  chartMode: "day" | "month" | "year";
  chart: Array<{ label: string; value: number }>;
  currentStart: string;
  currentEnd: string;
  headerInfo: LibraryHeaderInfo | null;
  relatedAlbums: LibraryItem[];
  relatedTracks: LibraryItem[];
};

type SavedFilter = Omit<LibraryState, "page">;

const MODES: Array<{ value: LibraryMode; label: string }> = [
  { value: "scrobbles", label: "Scrobbles" },
  { value: "artists", label: "Artists" },
  { value: "albums", label: "Albums" },
  { value: "tracks", label: "Tracks" },
];

const PERIODS: Array<{ value: Exclude<LibraryPeriod, "custom">; label: string; short: string }> = [
  { value: "7d", label: "7 days", short: "7D" },
  { value: "30d", label: "30 days", short: "30D" },
  { value: "90d", label: "90 days", short: "90D" },
  { value: "180d", label: "180 days", short: "180D" },
  { value: "365d", label: "1 year", short: "1Y" },
  { value: "all", label: "All time", short: "All" },
];

const SORTS: Array<{ value: LibrarySort; label: string }> = [
  { value: "plays_desc", label: "Most played" },
  { value: "plays_asc", label: "Least played" },
  { value: "name_asc", label: "Name A–Z" },
  { value: "recent_desc", label: "Recently played" },
];

const STORAGE_KEY = "myscrobbler.filters";

function readSavedFilters(): SavedFilter[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): SavedFilter[] => {
      if (!item || typeof item !== "object") return [];
      const value = item as Partial<SavedFilter> & {
        q?: unknown;
        startDate?: unknown;
        endDate?: unknown;
      };
      if (!MODES.some((mode) => mode.value === value.mode)
        || ![...PERIODS.map((period) => period.value), "custom"].some((period) => period === value.period)
        || !SORTS.some((sort) => sort.value === value.sort)) return [];
      const query = typeof value.query === "string" ? value.query : typeof value.q === "string" ? value.q : "";
      const start = typeof value.start === "string" ? value.start : typeof value.startDate === "string" ? value.startDate : "";
      const end = typeof value.end === "string" ? value.end : typeof value.endDate === "string" ? value.endDate : "";
      const filterType = value.filterType && ["artist", "album", "track"].includes(value.filterType)
        ? value.filterType
        : null;
      return [{
        mode: value.mode!,
        period: value.period!,
        start,
        end,
        query,
        sort: value.sort!,
        filterType,
        filterValue: typeof value.filterValue === "string" ? value.filterValue : "",
      }];
    }).slice(0, 8);
  } catch {
    return [];
  }
}

function itemKind(mode: LibraryMode): "artist" | "album" | "track" {
  return mode === "artists" ? "artist" : mode === "albums" ? "album" : "track";
}

function itemHref(item: LibraryItem, mode: LibraryMode) {
  if (item.href) return item.href;
  const kind = itemKind(mode);
  const id = kind === "album" ? item.albumId : kind === "track" ? item.spotifyId : item.artistId;
  return entityHref(kind, item.title, id);
}

function artistHref(name: string) {
  return entityHref("artist", name);
}

function filterLabel(filter: SavedFilter) {
  const mode = MODES.find((item) => item.value === filter.mode)?.label ?? "Library";
  const period = filter.period === "custom"
    ? `${filter.start || "…"} – ${filter.end || "…"}`
    : PERIODS.find((item) => item.value === filter.period)?.short ?? filter.period;
  return `${mode} · ${period}${filter.query ? ` · ${filter.query}` : ""}`;
}

function chartDateRange(label: string, mode: LibraryViewData["chartMode"]) {
  if (mode === "year") return { start: `${label}-01-01`, end: `${label}-12-31` };
  if (mode === "month") {
    const [year, month] = label.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { start: `${label}-01`, end: `${label}-${String(lastDay).padStart(2, "0")}` };
  }
  return { start: label, end: label };
}

function shortChartLabel(label: string, mode: LibraryViewData["chartMode"]) {
  if (mode === "year") return label;
  if (mode === "month") {
    const month = Number(label.slice(5, 7));
    return new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" })
      .format(new Date(Date.UTC(2024, month - 1, 1)));
  }
  return label.slice(8, 10);
}

export function LibraryExplorer({ data, state }: { data: LibraryViewData; state: LibraryState }) {
  const router = useRouter();
  const pathname = usePathname();
  const currentSearchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [searchValue, setSearchValue] = useState(state.query);
  const [customStart, setCustomStart] = useState(state.period === "custom" ? state.start : data.currentStart);
  const [customEnd, setCustomEnd] = useState(state.period === "custom" ? state.end : data.currentEnd);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [savedNotice, setSavedNotice] = useState("");
  const [activeChartPoint, setActiveChartPoint] = useState<{ label: string; value: number; index: number } | null>(null);
  const hasMounted = useRef(false);

  useEffect(() => {
    hasMounted.current = true;
    const timer = window.setTimeout(() => setSavedFilters(readSavedFilters()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const navigate = (changes: Partial<LibraryState>, replace = false) => {
    const next = { ...state, ...changes };
    const params = new URLSearchParams(currentSearchParams.toString());
    params.set("mode", next.mode);
    params.set("period", next.period);
    params.set("sort", next.sort);
    params.set("page", String(Math.max(1, next.page)));

    if (next.query) params.set("q", next.query);
    else params.delete("q");

    if (next.period === "custom" && next.start && next.end) {
      params.set("start", next.start);
      params.set("end", next.end);
    } else {
      params.delete("start");
      params.delete("end");
    }

    if (next.filterType && next.filterValue) {
      params.set("filter_type", next.filterType);
      params.set("filter_value", next.filterValue);
    } else {
      params.delete("filter_type");
      params.delete("filter_value");
    }

    startTransition(() => {
      const href = `${pathname}?${params.toString()}`;
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
      // Visited search-param variants live in the in-memory Router Cache. A
      // refresh guarantees that 7D/30D and Scrobbles transitions reconcile
      // against the database instead of reviving an older RSC payload.
      router.refresh();
    });
  };

  useEffect(() => {
    if (!hasMounted.current || searchValue === state.query) return;
    const timer = window.setTimeout(() => navigate({ query: searchValue.trim().slice(0, 100), page: 1 }, true), 300);
    return () => window.clearTimeout(timer);
    // navigate intentionally derives the newest URL state on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchValue, state.query]);

  const showRelated = Boolean(data.headerInfo)
    && ((state.filterType === "artist" && state.mode === "artists") || state.filterType === "album");
  const resultLabel = `${formatNumber(data.totalItems)} ${MODES.find((mode) => mode.value === state.mode)?.label.toLowerCase()}`;
  const maxChartValue = Math.max(...data.chart.map((point) => point.value), 1);
  const customDateError = customStart && customEnd && customStart > customEnd;

  const saveFilter = () => {
    const current: SavedFilter = {
      mode: state.mode,
      period: state.period,
      start: state.start,
      end: state.end,
      query: state.query,
      sort: state.sort,
      filterType: state.filterType,
      filterValue: state.filterValue,
    };
    const fingerprint = JSON.stringify(current);
    const next = [current, ...savedFilters.filter((item) => JSON.stringify(item) !== fingerprint)].slice(0, 8);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSavedFilters(next);
    setSavedNotice("Filter saved");
    window.setTimeout(() => setSavedNotice(""), 1800);
  };

  const removeSavedFilter = (index: number) => {
    const next = savedFilters.filter((_, itemIndex) => itemIndex !== index);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSavedFilters(next);
  };

  const applySavedFilter = (filter: SavedFilter) => navigate({ ...filter, page: 1 });

  const applyEntityFilter = (mode: Exclude<LibraryMode, "scrobbles">, value: string) => {
    const filterType: LibraryFilterType = mode === "artists" ? "artist" : mode === "albums" ? "album" : "track";
    const nextMode: LibraryMode = filterType === "track" ? "scrobbles" : "artists";
    navigate({ mode: nextMode, filterType, filterValue: value, query: "", page: 1 });
  };

  return (
    <div className="library-explorer" aria-busy={isPending}>
      {isPending ? (
        <div className="library-loading" role="status">
          <span className="library-spinner" aria-hidden="true" />
          <span>Updating library…</span>
        </div>
      ) : null}

      <div className="library-heading-row">
        <div className="library-heading-copy">
          {state.filterType ? (
            <button
              className="library-back"
              onClick={() => navigate({ mode: "artists", filterType: null, filterValue: "", page: 1 })}
              type="button"
            >
              <ArrowLeft aria-hidden="true" size={16} />
              Back to library
            </button>
          ) : <p className="eyebrow">Collection</p>}
          <h1>{data.headerInfo?.title ?? "Library"}</h1>
          <p className="page-description">
            {data.headerInfo
              ? `${formatNumber(data.headerInfo.count)} scrobbles${data.headerInfo.trackCount ? ` · ${formatNumber(data.headerInfo.trackCount)} tracks` : ""}`
              : "Every artist, album, track and scrobble in your listening archive."}
          </p>
        </div>
        {data.headerInfo ? (
          <Artwork
            kind={state.filterType === "artist" ? "artist" : state.filterType === "album" ? "album" : "track"}
            size={104}
            src={data.headerInfo.imageUrl}
          />
        ) : (
          <div className="library-context" aria-label="Current view">
            <span>{MODES.find((mode) => mode.value === state.mode)?.label}</span>
            <i aria-hidden="true" />
            <span>{state.period === "custom" ? "Custom range" : PERIODS.find((period) => period.value === state.period)?.label}</span>
          </div>
        )}
      </div>

      <nav className="library-modes" aria-label="Library sections">
        {MODES.map((mode) => (
          <button
            aria-current={state.mode === mode.value ? "page" : undefined}
            data-active={state.mode === mode.value || undefined}
            key={mode.value}
            onClick={() => navigate({ mode: mode.value, filterType: null, filterValue: "", query: "", page: 1 })}
            type="button"
          >
            {mode.label}
          </button>
        ))}
      </nav>

      <section className="library-controls" aria-label="Library controls">
        <div className="library-search">
          <Search aria-hidden="true" size={16} strokeWidth={1.6} />
          <input
            aria-label="Search this library view"
            autoComplete="off"
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="Search this view"
            type="search"
            value={searchValue}
          />
          {searchValue ? (
            <button aria-label="Clear search" onClick={() => setSearchValue("")} type="button">
              <X aria-hidden="true" size={14} />
            </button>
          ) : null}
        </div>

        <label className="library-select">
          <SlidersHorizontal aria-hidden="true" size={15} />
          <span className="sr-only">Sort library</span>
          <select value={state.sort} onChange={(event) => navigate({ sort: event.target.value as LibrarySort, page: 1 })}>
            {SORTS.map((sort) => <option key={sort.value} value={sort.value}>{sort.label}</option>)}
          </select>
        </label>

        <button className="library-save" onClick={saveFilter} type="button">
          <Bookmark aria-hidden="true" size={15} />
          Save filter
        </button>
        <span className="sr-only" aria-live="polite">{savedNotice}</span>
      </section>

      {savedFilters.length ? (
        <section className="saved-filters" aria-label="Saved filters">
          <span>Saved</span>
          <div>
            {savedFilters.map((filter, index) => (
              <span className="saved-filter" key={`${filterLabel(filter)}-${index}`}>
                <button onClick={() => applySavedFilter(filter)} type="button">{filterLabel(filter)}</button>
                <button aria-label={`Remove ${filterLabel(filter)}`} onClick={() => removeSavedFilter(index)} type="button">
                  <X aria-hidden="true" size={12} />
                </button>
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <section className="library-period-panel" aria-label="Date range">
        <div className="library-periods" role="group" aria-label="Quick date ranges">
          {PERIODS.map((period) => (
            <button
              aria-pressed={state.period === period.value}
              data-active={state.period === period.value || undefined}
              key={period.value}
              onClick={() => navigate({ period: period.value, start: "", end: "", page: 1 })}
              title={period.label}
              type="button"
            >
              {period.short}
            </button>
          ))}
        </div>
        <div className="library-custom-dates">
          <CalendarDays aria-hidden="true" size={15} />
          <label>
            <span className="sr-only">Start date</span>
            <input max={customEnd || undefined} onChange={(event) => setCustomStart(event.target.value)} type="date" value={customStart} />
          </label>
          <span aria-hidden="true">to</span>
          <label>
            <span className="sr-only">End date</span>
            <input min={customStart || undefined} onChange={(event) => setCustomEnd(event.target.value)} type="date" value={customEnd} />
          </label>
          <button
            disabled={!customStart || !customEnd || Boolean(customDateError)}
            onClick={() => navigate({ period: "custom", start: customStart, end: customEnd, page: 1 })}
            type="button"
          >
            Apply
          </button>
        </div>
      </section>

      {customDateError ? <p className="library-date-error" role="alert">The end date must be on or after the start date.</p> : null}

      <div className="library-layout">
        <section className="library-results surface">
          <div className="library-section-heading">
            <div>
              <p className="eyebrow">{data.headerInfo?.subtitle ?? "Results"}</p>
              <h2>{showRelated ? "Related listening" : state.mode === "scrobbles" ? "Scrobbles timeline" : `${state.mode[0].toUpperCase()}${state.mode.slice(1)}`}</h2>
            </div>
            {!showRelated ? <span>{resultLabel}</span> : null}
          </div>

          {showRelated ? (
            <RelatedLists
              data={data}
              filterType={state.filterType}
              onFilter={applyEntityFilter}
              onViewAll={(mode) => navigate({ mode, page: 1 })}
            />
          ) : data.items.length ? (
            <LibraryRows items={data.items} mode={state.mode} onFilter={applyEntityFilter} />
          ) : (
            <div className="library-empty">
              <Disc3 aria-hidden="true" size={22} strokeWidth={1.4} />
              <strong>No matches</strong>
              <span>Try another search, period or filter.</span>
            </div>
          )}

          {!showRelated && data.totalPages > 1 ? (
            <nav className="library-pagination" aria-label="Library pages">
              <button
                disabled={data.currentPage <= 1}
                onClick={() => navigate({ page: data.currentPage - 1 })}
                type="button"
              >
                <ChevronLeft aria-hidden="true" size={15} />
                Previous
              </button>
              <span>Page {formatNumber(data.currentPage)} of {formatNumber(data.totalPages)}</span>
              <button
                disabled={data.currentPage >= data.totalPages}
                onClick={() => navigate({ page: data.currentPage + 1 })}
                type="button"
              >
                Next
                <ChevronRight aria-hidden="true" size={15} />
              </button>
            </nav>
          ) : null}
        </section>

        <aside className="library-activity surface">
          <div className="library-section-heading">
            <div>
              <p className="eyebrow">Activity</p>
              <h2>Listening over time</h2>
            </div>
            {state.period === "custom" ? (
              <button onClick={() => navigate({ period: "30d", start: "", end: "", page: 1 })} type="button">Reset</button>
            ) : null}
          </div>
          {activeChartPoint ? (
            <div
              className="chart-tooltip library-chart-tooltip"
              role="status"
              // Follows the hovered bar instead of sitting in a fixed corner.
              style={{ "--tooltip-x": `${((activeChartPoint.index + 0.5) / Math.max(data.chart.length, 1)) * 100}%` } as CSSProperties}
            >
              <span>{activeChartPoint.label}</span>
              <strong>{formatNumber(activeChartPoint.value)} plays</strong>
              <small>Click to filter this exact {data.chartMode}</small>
            </div>
          ) : null}
          {data.chart.length ? (
            <div className="library-chart" role="list" aria-label="Listening activity; select a bar to focus on that date">
              {data.chart.map((point, index) => (
                <div key={`${point.label}-${index}`} role="listitem">
                  <button
                    aria-label={`${point.label}, ${formatNumber(point.value)} scrobbles`}
                    onBlur={() => setActiveChartPoint(null)}
                    onClick={() => {
                      const range = chartDateRange(point.label, data.chartMode);
                      setCustomStart(range.start);
                      setCustomEnd(range.end);
                      navigate({ period: "custom", ...range, page: 1 });
                    }}
                    onFocus={() => setActiveChartPoint({ ...point, index })}
                    onPointerEnter={() => setActiveChartPoint({ ...point, index })}
                    onPointerMove={() => setActiveChartPoint({ ...point, index })}
                    onPointerLeave={() => setActiveChartPoint(null)}
                    type="button"
                  >
                    <span>{formatNumber(point.value)}</span>
                    <i style={{ height: `${Math.max(3, (point.value / maxChartValue) * 100)}%` }} />
                    <small>{data.chart.length <= 16 || index % Math.ceil(data.chart.length / 8) === 0 ? shortChartLabel(point.label, data.chartMode) : ""}</small>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="library-chart-empty">No activity in this range.</div>
          )}
          <p className="library-chart-note">Select any bar to inspect that day, month or year.</p>
        </aside>
      </div>
    </div>
  );
}

function LibraryRows({
  items,
  mode,
  onFilter,
}: {
  items: LibraryItem[];
  mode: LibraryMode;
  onFilter: (mode: Exclude<LibraryMode, "scrobbles">, value: string) => void;
}) {
  return (
    <div className="library-rows">
      {items.map((item, index) => {
        const kind = itemKind(mode);
        const isScrobble = mode === "scrobbles";
        const rank = item.rank ?? index + 1;
        return (
          <article
            className={isScrobble ? "library-row library-row-scrobble" : "library-row"}
            key={`${item.title}-${item.subtitle ?? ""}-${item.date ?? rank}-${index}`}
          >
            {!isScrobble ? <span className="library-rank">{String(rank).padStart(2, "0")}</span> : null}
            <Link aria-label={`Open ${item.title}`} href={itemHref(item, mode)}>
              <Artwork kind={kind} size={44} src={item.imageUrl} />
            </Link>
            <div className="library-row-copy">
              <Link href={itemHref(item, mode)}>{item.title}</Link>
              {item.subtitle ? (
                <Link className="library-artist-link" href={artistHref(item.subtitle)}>{item.subtitle}</Link>
              ) : null}
            </div>
            {isScrobble ? (
              <time>{item.date}</time>
            ) : (
              <button
                className="library-count"
                onClick={() => onFilter(mode as Exclude<LibraryMode, "scrobbles">, item.title)}
                title={`Explore ${item.title} within this period`}
                type="button"
              >
                <i style={{ width: `${Math.max(2, Math.min(100, item.percent ?? 0))}%` }} />
                <span><strong>{formatNumber(item.count)}</strong> scrobbles</span>
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}

function RelatedLists({
  data,
  filterType,
  onFilter,
  onViewAll,
}: {
  data: LibraryViewData;
  filterType: LibraryFilterType | null;
  onFilter: (mode: Exclude<LibraryMode, "scrobbles">, value: string) => void;
  onViewAll: (mode: LibraryMode) => void;
}) {
  return (
    <div className="library-related">
      {filterType === "artist" && data.relatedAlbums.length ? (
        <section>
          <div className="library-related-heading">
            <h3>Top albums</h3>
            <button onClick={() => onViewAll("albums")} type="button">View all</button>
          </div>
          <LibraryRows items={data.relatedAlbums} mode="albums" onFilter={onFilter} />
        </section>
      ) : null}
      {data.relatedTracks.length ? (
        <section>
          <div className="library-related-heading">
            <h3>Top tracks</h3>
            {filterType === "artist" ? <button onClick={() => onViewAll("tracks")} type="button">View all</button> : null}
          </div>
          <LibraryRows items={data.relatedTracks} mode="tracks" onFilter={onFilter} />
        </section>
      ) : null}
      {!data.relatedAlbums.length && !data.relatedTracks.length ? (
        <div className="library-empty"><strong>No related listening found</strong></div>
      ) : null}
    </div>
  );
}
