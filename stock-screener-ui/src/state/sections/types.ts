/**
 * Shared vocabulary for native signal sections. A `metric` is always a raw
 * TradingView flat field name; aliasing it here would split the contract
 * between the UI, saved configs and the evaluator.
 */

export type SectionConcept =
  | "vwap_above"
  | "vwap_below"
  | "vwap_cross"
  | "momentum_1m"
  | "momentum_5m"
  | "momentum_15m"
  | "volume_surge_5m"
  | "rvol_spike"
  | "52w_touch"
  | "ema_cross"
  | "orb_proxy";

export type SectionOp = "gt" | "gte" | "lt" | "lte" | "crosses_above" | "crosses_below" | "eq";

/**
 * `value: null` means the concept supplies the comparison reference at
 * evaluation time (VWAP, EMA50, 52w high, opening range). A number is a fixed
 * threshold applied to `metric`.
 */
export interface SectionCondition {
  metric: string;
  op: SectionOp;
  value: number | null;
}

export interface SectionDefinition {
  id: string;
  name: string;
  description: string;
  concept: SectionConcept;
  side: "long" | "short" | "both";
  conditions: SectionCondition[];
  render: { type: "table"; columns: string[] };
  refreshSec: number;
  enabled: boolean;
  pinned: boolean;
}

export interface SectionDescriptor {
  id: SectionConcept;
  label: string;
  description: string;
  fieldOptions: { metric: string; label: string; op: SectionOp[]; unit?: string }[];
  requires: "tv" | "bars";
  defaultConditions: SectionCondition[];
  defaultColumns: string[];
}
