import type { Season } from "@duckbill/api/types";

// Meteorological seasons, as in dbt's season() macro. Each month has its own
// shade so neighbouring bars stay distinct; the label uses the season's colour.
export const SEASONS: Record<Season, { label: string; colour: string; shades: string[] }> = {
  winter: { label: "Winter", colour: "#c9ced6", shades: ["#8b93a0", "#a9b0bb", "#c9ced6"] },
  spring: { label: "Spring", colour: "#5cc07a", shades: ["#2e8b4a", "#3fa35c", "#5cc07a"] },
  summer: { label: "Summer", colour: "#b0d944", shades: ["#7fa834", "#96c23a", "#b0d944"] },
  autumn: { label: "Autumn", colour: "#de8e6e", shades: ["#a86a52", "#c47a5e", "#de8e6e"] },
};

/** The season of a YYYY-MM-DD date. */
export function seasonOf(iso: string): Season {
  const month = Number(iso.slice(5, 7));
  if (month === 12 || month <= 2) return "winter";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "autumn";
}

/** The month's own shade within its season. */
export function seasonShade(iso: string): string {
  const month = Number(iso.slice(5, 7));
  // Seasons start in months 12, 3, 6 and 9, so month % 3 is the position in it.
  return SEASONS[seasonOf(iso)].shades[month % 3] ?? "#8b93a0";
}
