/**
 * Single UI registry for the agri (mandi) redesign: groups, commodities,
 * range presets, chart modes and the formatters that read their metadata.
 * Mirrors `/api/agri/filters`; display labels are never restated in pages.
 */

import type { AgriChartMode, AgriGroupKey, AgriRangeKey } from "@/types/agri";

export const AGRI_COMMODITY_UNIT = "INR/quintal" as const;
export const AGRI_CURRENCY_SYMBOL = "₹";
export const AGRICULTURE_UNIT = `${AGRI_CURRENCY_SYMBOL}/quintal`;
export const AGRI_ARRIVALS_UNIT = "qtl";
export const AGRI_LOCALE = "en-IN";

export interface AgriGroupDescriptor {
  key: AgriGroupKey;
  label: string;
  order: number;
}

export const AGRI_GROUPS: readonly AgriGroupDescriptor[] = [
  { key: "cereals", label: "Cereals", order: 0 },
  { key: "pulses", label: "Pulses", order: 1 },
  { key: "vegetables", label: "Vegetables", order: 2 },
  { key: "oilseeds", label: "Oilseeds", order: 3 },
  { key: "spices", label: "Spices", order: 4 },
];

export const AGRI_GROUP_KEYS: readonly AgriGroupKey[] = AGRI_GROUPS.map((group) => group.key);

export interface AgriCommodityDescriptor {
  key: string;
  label: string;
  group: AgriGroupKey;
  unit: typeof AGRI_COMMODITY_UNIT;
  hasMsp: boolean;
  /** Raw Agmarknet spellings, only where they differ from the display label. */
  aliases?: readonly string[];
}

export const AGRI_COMMODITIES: readonly AgriCommodityDescriptor[] = [
  { key: "rice", label: "Rice", group: "cereals", unit: AGRI_COMMODITY_UNIT, hasMsp: true },
  { key: "wheat", label: "Wheat", group: "cereals", unit: AGRI_COMMODITY_UNIT, hasMsp: true },
  {
    key: "arhar_tur",
    label: "Arhar (Tur) Dal",
    group: "pulses",
    unit: AGRI_COMMODITY_UNIT,
    hasMsp: true,
    aliases: ["Arhar(Tur)", "Arhar", "Tur"],
  },
  { key: "urad", label: "Urad Dal", group: "pulses", unit: AGRI_COMMODITY_UNIT, hasMsp: true },
  { key: "moong", label: "Moong Dal", group: "pulses", unit: AGRI_COMMODITY_UNIT, hasMsp: true },
  { key: "masoor", label: "Masoor Dal", group: "pulses", unit: AGRI_COMMODITY_UNIT, hasMsp: true },
  {
    key: "chana",
    label: "Chana / Gram Dal",
    group: "pulses",
    unit: AGRI_COMMODITY_UNIT,
    hasMsp: true,
    aliases: ["Gram Dal"],
  },
  {
    key: "soyabean",
    label: "Soyabean",
    group: "oilseeds",
    unit: AGRI_COMMODITY_UNIT,
    hasMsp: true,
  },
  { key: "onion", label: "Onion", group: "vegetables", unit: AGRI_COMMODITY_UNIT, hasMsp: false },
  { key: "potato", label: "Potato", group: "vegetables", unit: AGRI_COMMODITY_UNIT, hasMsp: false },
  { key: "tomato", label: "Tomato", group: "vegetables", unit: AGRI_COMMODITY_UNIT, hasMsp: false },
  {
    key: "chilli",
    label: "Red Chilli",
    group: "spices",
    unit: AGRI_COMMODITY_UNIT,
    hasMsp: false,
    aliases: ["Chilli", "Chillies"],
  },
  { key: "turmeric", label: "Turmeric", group: "spices", unit: AGRI_COMMODITY_UNIT, hasMsp: false },
  {
    key: "coriander",
    label: "Coriander",
    group: "spices",
    unit: AGRI_COMMODITY_UNIT,
    hasMsp: false,
  },
];

export const AGRI_COMMODITY_KEYS: readonly string[] = AGRI_COMMODITIES.map((item) => item.key);

export interface AgriRangePreset {
  key: AgriRangeKey;
  label: string;
  description: string;
  /** Calendar days the backend should look back; `null` means the full history. */
  days: number | null;
}

export const AGRI_RANGE_PRESETS: readonly AgriRangePreset[] = [
  { key: "1m", label: "1M", description: "Last 1 month", days: 30 },
  { key: "3m", label: "3M", description: "Last 3 months", days: 90 },
  { key: "6m", label: "6M", description: "Last 6 months", days: 180 },
  { key: "1y", label: "1Y", description: "Last 1 year", days: 365 },
  { key: "max", label: "Max", description: "Full available history", days: null },
];

export const AGRI_RANGES = AGRI_RANGE_PRESETS;
export const AGRI_RANGE_KEYS: readonly AgriRangeKey[] = AGRI_RANGE_PRESETS.map((preset) => preset.key);
export const AGRI_DEFAULT_RANGE: AgriRangeKey = "6m";

export interface AgriChartModeDescriptor {
  key: AgriChartMode;
  label: string;
  description: string;
}

export const AGRI_CHART_MODES: readonly AgriChartModeDescriptor[] = [
  {
    key: "band",
    label: "Price band",
    description: "Daily modal price with the min–max band",
  },
  {
    key: "compare",
    label: "Compare",
    description: "Overlay two or more commodities on one price chart",
  },
  {
    key: "distribution",
    label: "Distribution",
    description: "Histogram of daily modal prices showing where prices cluster",
  },
  {
    key: "supplyDemand",
    label: "Supply vs price",
    description: "Arrivals in quintals plotted against modal price to read supply–price interplay",
  },
  {
    key: "heatmap",
    label: "Heatmap",
    description: "Month-by-year modal price heatmap for spotting seasonal highs and lows",
  },
  {
    key: "rolling",
    label: "Rolling",
    description: "Rolling mean price with a band to smooth out daily noise",
  },
  {
    key: "seasonality",
    label: "Seasonality",
    description: "Average monthly price pattern across years to expose seasonal cycles",
  },
];

export const AGRI_CHART_MODE_KEYS: readonly AgriChartMode[] = AGRI_CHART_MODES.map((mode) => mode.key);
export const AGRI_DEFAULT_CHART_MODE: AgriChartMode = "band";

const GROUP_BY_KEY = new Map<AgriGroupKey, AgriGroupDescriptor>(
  AGRI_GROUPS.map((group) => [group.key, group]),
);
const COMMODITY_BY_KEY = new Map<string, AgriCommodityDescriptor>(
  AGRI_COMMODITIES.map((item) => [item.key, item]),
);
const RANGE_BY_KEY = new Map<AgriRangeKey, AgriRangePreset>(
  AGRI_RANGE_PRESETS.map((preset) => [preset.key, preset]),
);

export function agriGroup(key: string | null | undefined): AgriGroupDescriptor | undefined {
  return typeof key === "string" ? GROUP_BY_KEY.get(key as AgriGroupKey) : undefined;
}

export function agriGroupLabel(key: string | null | undefined): string {
  return agriGroup(key)?.label ?? "Other";
}

export function agriCommodity(key: string | null | undefined): AgriCommodityDescriptor | undefined {
  return typeof key === "string" ? COMMODITY_BY_KEY.get(key) : undefined;
}

export function agriCommodityLabel(key: string | null | undefined, fallback = "—"): string {
  return agriCommodity(key)?.label ?? fallback;
}

export function agriRange(key: string | null | undefined): AgriRangePreset | undefined {
  return typeof key === "string" ? RANGE_BY_KEY.get(key as AgriRangeKey) : undefined;
}

export function agriCommoditiesInGroup(group: string | null | undefined): readonly AgriCommodityDescriptor[] {
  return AGRI_COMMODITIES.filter((item) => item.group === group);
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Grouped Indian rupees without the unit suffix: `₹2,450.50`. */
export function formatAgriPrice(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return "—";
  return `${AGRI_CURRENCY_SYMBOL}${value.toLocaleString(AGRI_LOCALE, {
    maximumFractionDigits: 2,
  })}`;
}

/** Arrivals in quintals, compacted with the Indian lakh/crore ladder. */
export function formatArrivals(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(1)}Cr ${AGRI_ARRIVALS_UNIT}`;
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(1)}L ${AGRI_ARRIVALS_UNIT}`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K ${AGRI_ARRIVALS_UNIT}`;
  return `${sign}${Math.round(abs)} ${AGRI_ARRIVALS_UNIT}`;
}

/** Signed one-decimal percentage: `+2.4%` / `-1.8%`; null/NaN stay visible as `—`. */
export function formatChangePct(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return "—";
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}
