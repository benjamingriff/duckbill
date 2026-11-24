const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

const gbpExact = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
});

export const money = (pence: number) => gbp.format(pence / 100);
export const moneyExact = (pence: number) => gbpExact.format(pence / 100);

/** A signed amount as the design shows it: −£86.40, +£1,200.00. */
export const signedExact = (pence: number) =>
  `${pence < 0 ? "−" : "+"}${gbpExact.format(Math.abs(pence) / 100)}`;

/** Thousands of pounds for chart labels: 2.95k, 840. `trim` drops trailing zeros (3k). */
export function kilo(pence: number, trim = false): string {
  const pounds = pence / 100;
  if (Math.abs(pounds) < 1000) return String(Math.round(pounds));
  const k = (pounds / 1000).toFixed(Math.abs(pounds) >= 10_000 ? 1 : 2);
  return `${trim ? String(Number(k)) : k}k`;
}

/** Pounds without the sign, for dense grids: 352, 1.8k. */
export function poundsShort(pence: number): string {
  const pounds = Math.round(pence / 100);
  return pounds >= 1000 ? `${(pounds / 1000).toFixed(1)}k` : String(pounds);
}

export const percent = (share: number) => `${Math.round(share * 100)}%`;

// Dates from the API are plain YYYY-MM-DD; parse as UTC to avoid TZ drift.
export const asDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

const fmt = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" });
// en-GB writes September as "Sept"; the design uses three letters throughout.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLong = fmt({ month: "long" });
const monthYear = fmt({ month: "long", year: "numeric" });
const dayMonthYear = fmt({ day: "numeric", month: "short", year: "numeric" });
const weekdayDayMonth = fmt({ weekday: "long", day: "numeric", month: "long" });
const weekdayShort = fmt({ weekday: "short", day: "numeric", month: "short", year: "numeric" });

export const formatMonthShort = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1] ?? "";
export const formatMonthName = (iso: string) => monthLong.format(asDate(iso));
export const formatMonth = (iso: string) => monthYear.format(asDate(iso));
export const formatMonthYearShort = (iso: string) => `${formatMonthShort(iso)} ${iso.slice(0, 4)}`;
export const formatDay = (iso: string) => dayMonthYear.format(asDate(iso));
export const formatDayHeading = (iso: string) => weekdayDayMonth.format(asDate(iso));
export const formatDayShort = (iso: string) => weekdayShort.format(asDate(iso));

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** ISO weekday (1 is Monday) to its name. */
export const weekdayName = (weekday: number) => WEEKDAYS[weekday - 1] ?? "";

/** 1 -> 1st, 22 -> 22nd. */
export function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** YYYY-MM-DD for a local date. */
export function isoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const weekdayDay = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** A sync time in local time, precise enough to compare with the bank: today at 09:14. */
export function formatSyncTime(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const days = Math.round(
    (new Date(now.toDateString()).getTime() - new Date(at.toDateString()).getTime()) / 86_400_000,
  );
  const day = days === 0 ? "today" : days === 1 ? "yesterday" : weekdayDay.format(at);
  return `${day} at ${clock.format(at)}`;
}
