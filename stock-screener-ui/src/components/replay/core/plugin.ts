import type { ReactNode } from "react";
import type { ReplayBundle, ReplayTrade, ReplayTrend, ReplayZone } from "../tick";

export interface ReplayParamSpec {
  name: string; label: string;
  type: "int" | "float" | "bool" | "select" | "text" | "symbol";
  default: unknown;
  min?: number; max?: number; step?: number;
  options?: string[]; description?: string;
}
export type ReplayParamValues = Record<string, unknown>;

export interface TimelineData {
  candles: { time: number; open: number; high: number; low: number; close: number }[];
  subs:    { time: number; open: number; high: number; low: number; close: number }[];
  vwap:    { time: number; value: number }[];
  levels:  { or_high: number; or_low: number; or_end: number };
}

export interface ReplayStrategyPlugin {
  id: string;
  label: string;
  subtitle?: string;
  mode: "timeline" | "review";
  endpoint: string;              // e.g. "/api/poc/replay/vwap-orb"
  dates: string[];               // selectable sessions
  params: ReplayParamSpec[];
  normalize: (json: any) => ReplayBundle;             // envelope -> canonical bundle
  /** Custom fetch when a strategy needs multiple calls merged. When absent the shell
   *  performs the default single GET `${endpoint}?${query}`. */
  load?: (ctx: { date: string; params: ReplayParamValues; signal: AbortSignal }) => Promise<any>;
  timeline?: (json: any) => TimelineData;             // required when mode === "timeline"
  card?: {                                            // used when mode === "review"
    zones?: (json: any) => ReplayZone[];
    trends?: (json: any) => ReplayTrend[];
    explainer?: (trade: ReplayTrade, json: any) => string;
    /** Visible window around each trade, in minutes. Defaults preserve intraday behavior. */
    fitPaddingBeforeMin?: number;
    fitPaddingAfterMin?: number;
  };
  /** Full-width row rendered after the param controls in review mode (e.g. KPI chips). */
  panel?: (bundle: ReplayBundle, json: any) => ReactNode;
  summary?: (bundle: ReplayBundle, json: any) => ReactNode;
}
