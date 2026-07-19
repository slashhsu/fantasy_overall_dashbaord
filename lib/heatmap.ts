import type { LeagueCategory, Matchup } from "@/lib/types";

const PIYG_STOPS = [
  "#8e0152",
  "#c51b7d",
  "#de77ae",
  "#f1b6da",
  "#fde0ef",
  "#f7f7f7",
  "#e6f5d0",
  "#b8e186",
  "#7fbc41",
  "#4d9221",
  "#276419",
] as const;

const LOWER_IS_BETTER = new Set([
  "Turnovers",
  "Personal Fouls",
  "Technical Fouls",
  "Ejections",
  "Flagrant Fouls",
  "Times Fouled Out",
]);

export interface HeatmapRange {
  min: number;
  max: number;
  reverse: boolean;
}

export const parseHeatmapValue = (rawValue: string | number | undefined) => {
  if (typeof rawValue === "number") return Number.isFinite(rawValue) ? rawValue : null;
  const raw = String(rawValue ?? "").trim().replaceAll(",", "");
  if (!raw || raw === "-" || raw === "--") return null;
  if (raw.includes("/")) {
    const [made, attempted] = raw.split("/").map(Number);
    return Number.isFinite(made) && Number.isFinite(attempted) && attempted !== 0
      ? made / attempted
      : null;
  }
  const value = Number(raw.replace("%", ""));
  if (!Number.isFinite(value)) return null;
  return raw.includes("%") ? value / 100 : value;
};

const hexToRgb = (hex: string) => ({
  red: Number.parseInt(hex.slice(1, 3), 16),
  green: Number.parseInt(hex.slice(3, 5), 16),
  blue: Number.parseInt(hex.slice(5, 7), 16),
});

const interpolatePiYG = (position: number) => {
  const clamped = Math.min(1, Math.max(0, position));
  const scaled = clamped * (PIYG_STOPS.length - 1);
  const lowerIndex = Math.floor(scaled);
  const upperIndex = Math.min(PIYG_STOPS.length - 1, lowerIndex + 1);
  const fraction = scaled - lowerIndex;
  const lower = hexToRgb(PIYG_STOPS[lowerIndex]);
  const upper = hexToRgb(PIYG_STOPS[upperIndex]);
  const channel = (start: number, end: number) => Math.round(start + (end - start) * fraction);
  return {
    red: channel(lower.red, upper.red),
    green: channel(lower.green, upper.green),
    blue: channel(lower.blue, upper.blue),
  };
};

const readableTextColor = ({ red, green, blue }: ReturnType<typeof interpolatePiYG>) => {
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance < 0.48 ? "#ffffff" : "#252a2f";
};

export const heatmapCellStyle = (rawValue: string | number | undefined, range: HeatmapRange) => {
  const value = parseHeatmapValue(rawValue);
  if (value === null) return undefined;
  const normalized = range.max === range.min ? 0.5 : (value - range.min) / (range.max - range.min);
  const position = range.reverse ? 1 - normalized : normalized;
  const color = interpolatePiYG(position);
  return {
    backgroundColor: `rgb(${color.red}, ${color.green}, ${color.blue})`,
    color: readableTextColor(color),
  };
};

export const buildHeatmapRanges = (matchups: Matchup[], categories: LeagueCategory[]) =>
  new Map(categories.filter((category) => category.enabled).map((category) => {
    const values = matchups.flatMap((matchup) => [
      parseHeatmapValue(matchup.teamA.stats[category.statId]),
      parseHeatmapValue(matchup.teamB.stats[category.statId]),
    ]).filter((value): value is number => value !== null);
    return [category.statId, {
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 0,
      reverse: LOWER_IS_BETTER.has(category.name),
    } satisfies HeatmapRange] as const;
  }));
