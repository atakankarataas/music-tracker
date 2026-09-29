export const DISPLAY_TIME_ZONE = "Europe/Istanbul";
export const PERIOD_DAYS = { "7d": 7, "30d": 30, "90d": 90, "180d": 180, "365d": 365 } as const;
export type CalendarPeriod = keyof typeof PERIOD_DAYS | "all" | "custom" | "wrapped";

export function localToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DISPLAY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function isIsoDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
export function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function calendarRange(period: CalendarPeriod, start?: string, end?: string, today = localToday()) {
  const invalid = period === "custom" && (!isIsoDate(start) || !isIsoDate(end) || start > end);
  const selected = invalid ? "30d" : period;
  return {
    period: selected,
    start: selected === "all" ? null : selected === "wrapped" ? `${today.slice(0, 4)}-01-01`
      : selected === "custom" ? start! : addDays(today, -(PERIOD_DAYS[selected] - 1)),
    end: selected === "custom" ? end! : today,
    error: invalid ? "Choose a valid range with the start on or before the end." : null,
  };
}

/** Spotify publishes “mid-November”, not an exact day. This is a model
 * assumption, never an official cutoff. Keep it out of free-range browsing. */
export const WRAPPED_CUTOFF = "11-12";

export function wrappedRange(requested?: string, today = localToday()) {
  const currentYear = Number(today.slice(0, 4));
  const latestYear = currentYear;
  const candidate = requested && /^\d{4}$/.test(requested) ? Number(requested) : latestYear;
  const year = candidate >= 2018 && candidate <= latestYear ? candidate : latestYear;
  const cutoff = `${year}-${WRAPPED_CUTOFF}`;
  return { year, currentYear, latestYear, start: `${year}-01-01`, end: year === currentYear && today < cutoff ? today : cutoff,
    cutoff, estimated: true as const };
}
