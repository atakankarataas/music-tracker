export const numberFormatter = new Intl.NumberFormat("en-US");

export function formatNumber(value: number | string | null | undefined) {
  return numberFormatter.format(Number(value ?? 0));
}

export function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Istanbul",
  }).format(new Date(value));
}

const istanbulYearFormatter = new Intl.DateTimeFormat("en", {
  year: "numeric",
  timeZone: "Europe/Istanbul",
});

// Every other date in the app is pinned to Europe/Istanbul. Reading years off a
// bare Date would use the server's zone instead, which is UTC on Vercel and
// silently shifts the answer around New Year.
export function istanbulYear(value: string | Date = new Date()) {
  return Number(istanbulYearFormatter.format(new Date(value)));
}

export function formatRelativeDate(value: string | Date) {
  const date = new Date(value);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];

  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size || unit === "minute") {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }

  return "just now";
}

export function entityHref(
  kind: "artist" | "album" | "track",
  name: string,
  id?: string | null,
) {
  if (id && kind !== "artist") {
    return `/${kind}/id/${encodeURIComponent(id)}`;
  }

  return `/${kind}/${encodeURIComponent(name)}`;
}
