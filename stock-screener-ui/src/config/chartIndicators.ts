/**
 * Canonical chart-indicator registry.
 *
 * One source of truth for the pattern-chart indicator menu, the session
 * visibility store and the canvas tags drawn by `patternTVData`. Keep payload
 * keys here so the UI can disable a row when the backend omits its series
 * instead of silently drawing nothing.
 */

import { NEGATIVE, POSITIVE } from "@/ui/palette";
import type { ChartIndicators } from "@/types/chartPatterns";
import {
  CROSSES_LEGEND_NAME,
  INDICATOR_SERIES_META,
  SR_ZONE_COLORS,
  SR_ZONE_LEGEND_NAMES,
} from "@/components/patterns/patternIndicatorData";

export type ChartIndicatorId = "sma20" | "sma50" | "sma200" | "vwap" | "bb" | "crosses" | "srZones";

export type ChartIndicatorGroup = "MAs" | "Studies" | "Signals" | "Zones";
export type ChartIndicatorDash = "solid" | "dashed" | "dotted";

export type ChartIndicatorPrefs = Record<ChartIndicatorId, boolean>;

export type ChartIndicatorAvailabilityRule =
  | { kind: "always" }
  | { kind: "intraday" }
  | { kind: "min-bars"; bars: number };

export interface ChartIndicatorSpec {
  id: ChartIndicatorId;
  /** Menu row label. */
  label: string;
  /** Compact on-chart chip label (DOM strip; never a pattern legend entry). */
  chipLabel: string;
  /** Short canvas/legend tag shown in the menu/tag rail. */
  tag: string;
  /**
   * Names used by the chart's hidden-name set: indicator series legend names,
   * cross markers and S/R zone labels. A zone spec covers all three kinds.
   */
  visibilityNames: readonly string[];
  group: ChartIndicatorGroup;
  /** Palette token for the primary stroke / swatch. */
  color: string;
  /** Optional second palette token (bands, up/down crosses, zones). */
  secondaryColor?: string;
  dash: ChartIndicatorDash;
  defaultEnabled: boolean;
  availability: ChartIndicatorAvailabilityRule;
  /** Lower numbers draw/read first on the canvas tag rail. */
  tagPriority: number;
  /** `ChartIndicators` keys that can carry this series (defensive aliases). */
  payloadKeys: readonly string[];
  /** Static explanatory copy shown under the row label. */
  description?: string;
}

const GROUP_ORDER: readonly ChartIndicatorGroup[] = ["MAs", "Studies", "Signals", "Zones"];

/**
 * The seven canonical indicators. Colors come from palette tokens only; the
 * menu renders the same token as its line sample so the row and canvas agree.
 */
export const CHART_INDICATOR_SPECS: readonly ChartIndicatorSpec[] = [
  {
    id: "sma20",
    label: "SMA20",
    chipLabel: "SMA20",
    tag: INDICATOR_SERIES_META.sma20.legendName,
    visibilityNames: [INDICATOR_SERIES_META.sma20.legendName],
    group: "MAs",
    color: INDICATOR_SERIES_META.sma20.color,
    dash: INDICATOR_SERIES_META.sma20.lineStyle,
    defaultEnabled: true,
    availability: { kind: "always" },
    tagPriority: 10,
    payloadKeys: ["sma20", "sma_20"],
  },
  {
    id: "sma50",
    label: "SMA50",
    chipLabel: "SMA50",
    tag: INDICATOR_SERIES_META.sma50.legendName,
    visibilityNames: [INDICATOR_SERIES_META.sma50.legendName],
    group: "MAs",
    color: INDICATOR_SERIES_META.sma50.color,
    dash: INDICATOR_SERIES_META.sma50.lineStyle,
    defaultEnabled: false,
    availability: { kind: "always" },
    tagPriority: 20,
    payloadKeys: ["sma50", "sma_50"],
  },
  {
    id: "sma200",
    label: "SMA200",
    chipLabel: "SMA200",
    tag: INDICATOR_SERIES_META.sma200.legendName,
    visibilityNames: [INDICATOR_SERIES_META.sma200.legendName],
    group: "MAs",
    color: INDICATOR_SERIES_META.sma200.color,
    dash: INDICATOR_SERIES_META.sma200.lineStyle,
    defaultEnabled: false,
    availability: { kind: "min-bars", bars: 200 },
    tagPriority: 30,
    payloadKeys: ["sma200", "sma_200"],
  },
  {
    id: "vwap",
    label: "VWAP",
    chipLabel: "VWAP",
    tag: INDICATOR_SERIES_META.vwap.legendName,
    visibilityNames: [INDICATOR_SERIES_META.vwap.legendName],
    group: "Studies",
    color: INDICATOR_SERIES_META.vwap.color,
    dash: INDICATOR_SERIES_META.vwap.lineStyle,
    defaultEnabled: false,
    availability: { kind: "intraday" },
    tagPriority: 40,
    payloadKeys: ["vwap", "vwap_line"],
  },
  {
    id: "bb",
    label: "BB 20,2",
    chipLabel: "BB",
    tag: INDICATOR_SERIES_META.bbMiddle.legendName,
    visibilityNames: [INDICATOR_SERIES_META.bbMiddle.legendName],
    group: "Studies",
    color: INDICATOR_SERIES_META.bbMiddle.color,
    secondaryColor: INDICATOR_SERIES_META.bbUpper.color,
    dash: INDICATOR_SERIES_META.bbMiddle.lineStyle,
    defaultEnabled: false,
    availability: { kind: "always" },
    tagPriority: 50,
    payloadKeys: [
      "bb",
      "bb_bands",
      "bollinger",
      "bollinger_bands",
      "bb_upper",
      "bb_mid",
      "bb_middle",
      "bb_lower",
    ],
  },
  {
    id: "crosses",
    label: "Crosses 50/200",
    chipLabel: "Crosses",
    tag: CROSSES_LEGEND_NAME,
    visibilityNames: [CROSSES_LEGEND_NAME],
    group: "Signals",
    color: POSITIVE,
    secondaryColor: NEGATIVE,
    dash: "dashed",
    defaultEnabled: false,
    availability: { kind: "always" },
    tagPriority: 60,
    payloadKeys: ["crosses", "ma_crosses", "sma_crosses", "sma_cross", "crosses50_200"],
  },
  {
    id: "srZones",
    label: "S/R zones",
    chipLabel: "S/R",
    tag: SR_ZONE_LEGEND_NAMES.sr,
    visibilityNames: [
      SR_ZONE_LEGEND_NAMES.support,
      SR_ZONE_LEGEND_NAMES.resistance,
      SR_ZONE_LEGEND_NAMES.sr,
    ],
    group: "Zones",
    color: SR_ZONE_COLORS.sr,
    secondaryColor: SR_ZONE_COLORS.support,
    dash: "dashed",
    defaultEnabled: false,
    availability: { kind: "always" },
    tagPriority: 70,
    payloadKeys: [],
    description: "Historical reaction zones, not forecasts",
  },
];

export const CHART_INDICATOR_GROUPS: readonly ChartIndicatorGroup[] = GROUP_ORDER;

/** Canonical defaults; every entry is explicit so a schema change fails loudly. */
export const DEFAULT_CHART_INDICATOR_PREFS: ChartIndicatorPrefs = {
  sma20: true,
  sma50: false,
  sma200: false,
  vwap: false,
  bb: false,
  crosses: false,
  srZones: false,
};

const SPEC_BY_ID = new Map<ChartIndicatorId, ChartIndicatorSpec>(
  CHART_INDICATOR_SPECS.map((spec) => [spec.id, spec]),
);

export function chartIndicatorSpec(id: ChartIndicatorId): ChartIndicatorSpec {
  const spec = SPEC_BY_ID.get(id);
  if (!spec) throw new Error(`Unknown chart indicator: ${id}`);
  return spec;
}

/** Timeframes where VWAP is not meaningful (session-anchored volume). */
const VWAP_DISABLED_TIMEFRAMES = new Set(["1D", "1W", "1M"]);

export function normalizeChartTimeframe(timeframe: string | null | undefined): string {
  return typeof timeframe === "string" ? timeframe.trim().toUpperCase() : "";
}

/** True only for the daily/weekly/monthly frames named in the UI contract. */
export function isVwapDisabledTimeframe(timeframe: string | null | undefined): boolean {
  return VWAP_DISABLED_TIMEFRAMES.has(normalizeChartTimeframe(timeframe));
}

/** A non-empty series/band. Objects recurse so `{upper:[],middle:[]}` is absent. */
function hasSeriesValue(value: unknown, depth = 0): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") {
    if (depth > 4) return false;
    return Object.values(value as Record<string, unknown>).some((entry) =>
      hasSeriesValue(entry, depth + 1),
    );
  }
  return true;
}

/** `ChartIndicators.series` ids behind each menu row. */
const INDICATOR_SERIES_IDS: Partial<Record<ChartIndicatorId, readonly string[]>> = {
  sma20: ["sma20"],
  sma50: ["sma50"],
  sma200: ["sma200"],
  bb: ["bbUpper", "bbMiddle", "bbLower"],
  vwap: ["vwap"],
};

/**
 * Whether the payload actually carries a drawable series for `id`. A missing
 * `indicators` object (older backend / failed enrichment) reads as absent.
 */
export function hasIndicatorSeries(
  indicators: ChartIndicators | null | undefined,
  id: ChartIndicatorId,
): boolean {
  if (!indicators) return false;

  if (id === "crosses") {
    return Array.isArray(indicators.crosses) && indicators.crosses.length > 0;
  }

  const seriesIds = INDICATOR_SERIES_IDS[id];
  if (seriesIds && Array.isArray(indicators.series)) {
    return indicators.series.some(
      (series) =>
        seriesIds.includes(series.id) &&
        Array.isArray(series.values) &&
        series.values.some((value) => value != null),
    );
  }

  // Defensive fallback for older payload shapes that nested series directly.
  const spec = chartIndicatorSpec(id);
  if (spec.payloadKeys.length === 0) return false;
  const record = indicators as unknown as Record<string, unknown>;
  return spec.payloadKeys.some((key) => hasSeriesValue(record[key]));
}

export interface ChartIndicatorAvailabilityContext {
  timeframe?: string | null;
  candleCount?: number | null;
  indicators?: ChartIndicators | null;
  /** Number of `sr_zones` entries in the payload (0/undefined = absent). */
  srZoneCount?: number | null;
  /**
   * Drawable series actually present in the built chart data. When supplied it
   * wins over payload-key sniffing, so menu rows, chips and the trigger count
   * cannot disagree with what the chart renders.
   */
  presentIndicatorIds?: ReadonlySet<ChartIndicatorId> | null;
}

export interface ChartIndicatorAvailability {
  enabled: boolean;
  /** User-facing reason shown on a disabled row; null when drawable. */
  reason: string | null;
}

/**
 * Resolve one row's disabled state. Timeframe and candle-count rules win over
 * "no data" so the reason explains the most actionable blocker.
 */
export function chartIndicatorAvailability(
  id: ChartIndicatorId,
  ctx: ChartIndicatorAvailabilityContext,
): ChartIndicatorAvailability {
  const spec = chartIndicatorSpec(id);

  if (spec.availability.kind === "intraday" && isVwapDisabledTimeframe(ctx.timeframe)) {
    return { enabled: false, reason: "Intraday only" };
  }

  if (spec.availability.kind === "min-bars") {
    const bars = Math.max(0, ctx.candleCount ?? 0);
    if (bars < spec.availability.bars) {
      return { enabled: false, reason: `Needs ${spec.availability.bars} bars` };
    }
  }

  const present = ctx.presentIndicatorIds?.has(id);
  if (id === "srZones") {
    const zoneDrawable =
      present === true || (present === undefined && (ctx.srZoneCount ?? 0) > 0);
    return zoneDrawable
      ? { enabled: true, reason: null }
      : { enabled: false, reason: "No zones" };
  }

  const drawable = present === true || (present !== false && hasIndicatorSeries(ctx.indicators, id));
  return drawable
    ? { enabled: true, reason: null }
    : { enabled: false, reason: "No data" };
}

/** Drawable + switched-on rows, in tag order (menu trigger count / canvas tags). */
export function activeChartIndicatorSpecs(
  prefs: ChartIndicatorPrefs,
  ctx: ChartIndicatorAvailabilityContext,
): ChartIndicatorSpec[] {
  return CHART_INDICATOR_SPECS.filter(
    (spec) => prefs[spec.id] && chartIndicatorAvailability(spec.id, ctx).enabled,
  ).sort((a, b) => a.tagPriority - b.tagPriority);
}
