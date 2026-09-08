import type { Metadata } from "next";

import {
  LibraryExplorer,
  type LibraryItem,
  type LibraryState,
  type LibraryViewData,
} from "@/app/library/library-explorer";
import {
  getLegacyLibraryData,
  parseLegacyLibraryFilterType,
  parseLegacyLibraryMode,
  parseLegacyLibraryPeriod,
  parseLegacyLibrarySort,
} from "@/lib/legacy-features";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Library",
  description: "Browse and filter your complete Spotify listening archive.",
};

type SearchParams = Record<string, string | string[] | undefined>;

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Europe/Istanbul",
});

function firstValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : value?.[0];
}

function validIsoDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function positivePage(value: string | undefined) {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? Math.min(page, 100_000) : 1;
}

function mapItem(
  item: Awaited<ReturnType<typeof getLegacyLibraryData>>["items"][number],
): LibraryItem {
  return {
    rank: item.rank,
    title: item.title,
    subtitle: item.subtitle,
    count: item.count ?? undefined,
    imageUrl: item.imageUrl,
    date: item.playedAt ? dateTimeFormatter.format(new Date(item.playedAt)) : null,
    href: item.href,
    artistId: item.kind === "artists" ? item.id : null,
    albumId: item.kind === "albums" ? item.id : item.albumId,
    spotifyId: item.kind === "tracks" || item.kind === "scrobbles" ? item.id : null,
    percent: item.percent ?? undefined,
  };
}

export default async function LibraryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const mode = parseLegacyLibraryMode(firstValue(params.mode));
  let period = parseLegacyLibraryPeriod(firstValue(params.period));
  const sort = parseLegacyLibrarySort(firstValue(params.sort));
  const query = (firstValue(params.q) ?? "").trim().slice(0, 100);
  const filterType = parseLegacyLibraryFilterType(firstValue(params.filter_type));
  const filterValue = (firstValue(params.filter_value) ?? "").trim().slice(0, 300);
  const page = positivePage(firstValue(params.page));
  let start = firstValue(params.start);
  let end = firstValue(params.end);

  if (period === "custom" && (!validIsoDate(start) || !validIsoDate(end) || start! > end!)) {
    period = "30d";
    start = undefined;
    end = undefined;
  }

  const result = await getLegacyLibraryData({
    mode,
    period,
    start,
    end,
    filter: filterType && filterValue ? { type: filterType, value: filterValue } : null,
    search: query,
    sort,
    page,
    pageSize: 50,
  });

  const relatedSubtitle = result.header?.type === "artist"
    ? result.header.title
    : result.header?.subtitle ?? null;
  const data: LibraryViewData = {
    items: result.items.map(mapItem),
    totalItems: result.totalItems,
    currentPage: result.currentPage,
    totalPages: result.totalPages,
    chartMode: result.chartMode,
    chart: result.chart,
    currentStart: result.currentStart,
    currentEnd: result.currentEnd,
    headerInfo: result.header ? {
      title: result.header.title,
      subtitle: result.header.subtitle,
      count: result.header.count,
      imageUrl: result.header.imageUrl,
      trackCount: result.header.trackCount,
    } : null,
    relatedAlbums: result.relatedAlbums.map((item) => ({
      rank: item.rank,
      title: item.title,
      subtitle: relatedSubtitle,
      count: item.count,
      imageUrl: item.imageUrl,
      href: item.href,
      albumId: item.id,
      percent: item.percent,
    })),
    relatedTracks: result.relatedTracks.map((item) => ({
      rank: item.rank,
      title: item.title,
      subtitle: relatedSubtitle,
      count: item.count,
      imageUrl: item.imageUrl,
      href: item.href,
      spotifyId: item.id,
      percent: item.percent,
    })),
  };
  const state: LibraryState = {
    mode: result.mode,
    period: result.period,
    start: period === "custom" ? result.currentStart : "",
    end: period === "custom" ? result.currentEnd : "",
    page: result.currentPage,
    query: result.search,
    sort: result.sort,
    filterType: result.filter?.type ?? null,
    filterValue: result.filter?.value ?? "",
  };

  return (
    <LibraryExplorer
      data={data}
      key={`${state.mode}:${state.period}:${state.start}:${state.end}:${state.page}:${state.query}:${state.sort}:${state.filterType}:${state.filterValue}`}
      state={state}
    />
  );
}
