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

const gbpCompact = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  notation: "compact",
  maximumFractionDigits: 1,
});

export const money = (pence: number) => gbp.format(pence / 100);
export const moneyExact = (pence: number) => gbpExact.format(pence / 100);
export const moneyCompact = (pence: number) => gbpCompact.format(pence / 100);

// Dates from the API are plain YYYY-MM-DD; parse as UTC to avoid TZ drift.
const asDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

const monthShort = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });
const monthYear = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const dayMonthYear = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export const formatMonthTick = (iso: string) => {
  const d = asDate(iso);
  // January carries the year, kept short so it survives tick-collision culling.
  const year = String(d.getUTCFullYear()).slice(2);
  return d.getUTCMonth() === 0 ? `${monthShort.format(d)} ’${year}` : monthShort.format(d);
};
export const formatMonth = (iso: string) => monthYear.format(asDate(iso));
export const formatDay = (iso: string) => dayMonthYear.format(asDate(iso));

export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
