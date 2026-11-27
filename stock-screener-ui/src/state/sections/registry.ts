import type { SectionConcept, SectionDefinition, SectionDescriptor } from "./types";

export type {
  SectionConcept,
  SectionCondition,
  SectionDefinition,
  SectionDescriptor,
  SectionOp,
} from "./types";

/** Raw TradingView flat fields only — never alias or re-case these. */
export const SECTION_METRICS = [
  "close",
  "VWAP",
  "change|1",
  "change|5",
  "change|15",
  "volume_change|5",
  "relative_volume_10d_calc",
  "average_volume_10d_calc",
  "price_52_week_high",
  "price_52_week_low",
  "EMA20",
  "EMA50",
  "market_cap_basic",
  "update_mode",
] as const;

export const SECTION_OPS = [
  "gt",
  "gte",
  "lt",
  "lte",
  "crosses_above",
  "crosses_below",
  "eq",
] as const;

const METRIC_SET: ReadonlySet<string> = new Set(SECTION_METRICS);
const OP_SET: ReadonlySet<string> = new Set(SECTION_OPS);

export const SECTION_CONCEPTS: SectionConcept[] = [
  "vwap_above",
  "vwap_below",
  "vwap_cross",
  "momentum_1m",
  "momentum_5m",
  "momentum_15m",
  "volume_surge_5m",
  "rvol_spike",
  "52w_touch",
  "ema_cross",
  "orb_proxy",
];

export const SECTION_REGISTRY: Record<SectionConcept, SectionDescriptor> = {
  vwap_above: {
    id: "vwap_above",
    label: "VWAP Above",
    description: "Price reclaiming or holding above VWAP.",
    fieldOptions: [
      { metric: "close", label: "Close vs VWAP", op: ["gt", "gte"] },
      { metric: "VWAP", label: "VWAP", op: ["gt", "gte", "lt", "lte"] },
    ],
    requires: "tv",
    defaultConditions: [{ metric: "close", op: "gt", value: null }],
    defaultColumns: ["symbol", "close", "VWAP", "change|1", "relative_volume_10d_calc"],
  },
  vwap_below: {
    id: "vwap_below",
    label: "VWAP Below",
    description: "Price rejected at or trading below VWAP.",
    fieldOptions: [
      { metric: "close", label: "Close vs VWAP", op: ["lt", "lte"] },
      { metric: "VWAP", label: "VWAP", op: ["lt", "lte", "gt", "gte"] },
    ],
    requires: "tv",
    defaultConditions: [{ metric: "close", op: "lt", value: null }],
    defaultColumns: ["symbol", "close", "VWAP", "change|1", "relative_volume_10d_calc"],
  },
  vwap_cross: {
    id: "vwap_cross",
    label: "VWAP Cross",
    description: "Close crossing VWAP in either direction.",
    fieldOptions: [
      { metric: "close", label: "Close crosses VWAP", op: ["crosses_above", "crosses_below"] },
      { metric: "VWAP", label: "VWAP", op: ["crosses_above", "crosses_below"] },
    ],
    requires: "tv",
    defaultConditions: [{ metric: "close", op: "crosses_above", value: null }],
    defaultColumns: ["symbol", "close", "VWAP", "change|1", "change|5"],
  },
  momentum_1m: {
    id: "momentum_1m",
    label: "Momentum 1m",
    description: "One-minute price momentum threshold.",
    fieldOptions: [
      { metric: "change|1", label: "1m change", op: ["gt", "gte", "lt", "lte"], unit: "%" },
    ],
    requires: "tv",
    defaultConditions: [{ metric: "change|1", op: "gt", value: 0 }],
    defaultColumns: ["symbol", "close", "change|1", "relative_volume_10d_calc"],
  },
  momentum_5m: {
    id: "momentum_5m",
    label: "Momentum 5m",
    description: "Five-minute price momentum threshold.",
    fieldOptions: [
      { metric: "change|5", label: "5m change", op: ["gt", "gte", "lt", "lte"], unit: "%" },
    ],
    requires: "tv",
    defaultConditions: [{ metric: "change|5", op: "gt", value: 0 }],
    defaultColumns: ["symbol", "close", "change|5", "relative_volume_10d_calc"],
  },
  momentum_15m: {
    id: "momentum_15m",
    label: "Momentum 15m",
    description: "Fifteen-minute price momentum threshold.",
    fieldOptions: [
      { metric: "change|15", label: "15m change", op: ["gt", "gte", "lt", "lte"], unit: "%" },
    ],
    requires: "tv",
    defaultConditions: [{ metric: "change|15", op: "gt", value: 0 }],
    defaultColumns: ["symbol", "close", "change|15", "relative_volume_10d_calc"],
  },
  volume_surge_5m: {
    id: "volume_surge_5m",
    label: "Volume Surge 5m",
    description: "Five-minute volume expansion against average volume.",
    fieldOptions: [
      { metric: "volume_change|5", label: "5m volume change", op: ["gt", "gte"], unit: "%" },
      {
        metric: "average_volume_10d_calc",
        label: "10d average volume",
        op: ["gt", "gte"],
        unit: "shares",
      },
    ],
    requires: "tv",
    defaultConditions: [{ metric: "volume_change|5", op: "gt", value: 100 }],
    defaultColumns: ["symbol", "close", "volume_change|5", "average_volume_10d_calc"],
  },
  rvol_spike: {
    id: "rvol_spike",
    label: "RVOL Spike",
    description: "Relative volume spike versus the 10-day baseline.",
    fieldOptions: [
      {
        metric: "relative_volume_10d_calc",
        label: "Relative volume (10d)",
        op: ["gt", "gte"],
        unit: "×",
      },
      {
        metric: "average_volume_10d_calc",
        label: "10d average volume",
        op: ["gt", "gte"],
        unit: "shares",
      },
    ],
    requires: "tv",
    defaultConditions: [{ metric: "relative_volume_10d_calc", op: "gt", value: 2 }],
    defaultColumns: ["symbol", "close", "relative_volume_10d_calc", "change|5"],
  },
  "52w_touch": {
    id: "52w_touch",
    label: "52W Touch",
    description: "Price testing its 52-week high or low band.",
    fieldOptions: [
      { metric: "price_52_week_high", label: "52w high", op: ["gte", "lte", "crosses_above"] },
      { metric: "price_52_week_low", label: "52w low", op: ["lte", "gte"] },
      { metric: "close", label: "Close", op: ["gte", "lte", "crosses_above"] },
      { metric: "market_cap_basic", label: "Market cap", op: ["gt", "gte"], unit: "USD" },
    ],
    requires: "tv",
    defaultConditions: [{ metric: "close", op: "gte", value: null }],
    defaultColumns: ["symbol", "close", "price_52_week_high", "price_52_week_low", "change|5"],
  },
  ema_cross: {
    id: "ema_cross",
    label: "EMA Cross",
    description: "EMA20 crossing EMA50 in either direction.",
    fieldOptions: [
      {
        metric: "EMA20",
        label: "EMA20",
        op: ["crosses_above", "crosses_below", "gt", "lt"],
      },
      {
        metric: "EMA50",
        label: "EMA50",
        op: ["crosses_above", "crosses_below", "gt", "lt"],
      },
    ],
    requires: "tv",
    defaultConditions: [{ metric: "EMA20", op: "crosses_above", value: null }],
    defaultColumns: ["symbol", "close", "EMA20", "EMA50", "change|5"],
  },
  orb_proxy: {
    id: "orb_proxy",
    label: "ORB Proxy",
    description: "Opening-range breakout proxy; needs bar history, not a TV snapshot.",
    fieldOptions: [
      {
        metric: "close",
        label: "Close vs opening range",
        op: ["gt", "crosses_above", "lt", "crosses_below"],
      },
      {
        metric: "average_volume_10d_calc",
        label: "10d average volume",
        op: ["gt", "gte"],
        unit: "shares",
      },
      { metric: "update_mode", label: "Update mode", op: ["eq"] },
    ],
    requires: "bars",
    defaultConditions: [{ metric: "close", op: "crosses_above", value: null }],
    defaultColumns: ["symbol", "close", "change|5", "relative_volume_10d_calc"],
  },
};

export function validateSection(def: SectionDefinition): string[] {
  const errors: string[] = [];

  if (!SECTION_CONCEPTS.includes(def.concept)) {
    errors.push(`unknown concept: ${def.concept}`);
  }
  if (typeof def.id !== "string" || def.id.trim().length === 0) {
    errors.push("id is required");
  }
  if (!def.conditions || def.conditions.length === 0) {
    errors.push("at least one condition is required");
  } else {
    def.conditions.forEach((condition, index) => {
      if (!METRIC_SET.has(condition.metric)) {
        errors.push(`condition ${index}: unknown metric ${condition.metric}`);
      }
      if (!OP_SET.has(condition.op)) {
        errors.push(`condition ${index}: unknown op ${condition.op}`);
      }
    });
  }
  if (def.side !== "long" && def.side !== "short" && def.side !== "both") {
    errors.push(`invalid side: ${def.side}`);
  }
  if (!def.render || def.render.type !== "table") {
    errors.push("render.type must be 'table'");
  }
  if (!Number.isFinite(def.refreshSec) || def.refreshSec <= 0) {
    errors.push("refreshSec must be positive");
  }

  return errors;
}
