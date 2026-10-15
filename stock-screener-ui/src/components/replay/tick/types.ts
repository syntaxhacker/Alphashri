// Shared types for POC tick-replay (extracted from src/pages/poc/SmcTrades.tsx).
// Single place so every future strategy (iFVG, LRL, ORB, …) reuses one shape.
import type { Bar } from "@/utils/smc";

export type { Bar };

export type TradeStack = "inv" | "retest";
export type TradeSide = "LONG" | "SHORT";
export type TradeKind = "inv" | "retest";
export type ReplayResult = "TP" | "SL" | "TRAIL" | "BE" | "EOD" | "REV" | "REJ" | "MAX_HOLD";
export type TradeResult = ReplayResult;

export interface ReplayTrade {
  stack?: TradeStack;
  time: number; // entry bar unix sec
  exit_time: number;
  side: TradeSide;
  kind: TradeKind;
  entry: number;
  sl: number;
  tp: number | null; // null = structure trail, no fixed target
  exit: number;
  result: ReplayResult;
  pnl: number; // points
  rr: number; // R multiple
  meta?: Record<string, unknown>;
}

export type ZoneKind = "supply" | "demand" | "fvg-bull" | "fvg-bear" | "ifvg" | "lrl";

export interface ReplayZone {
  kind: ZoneKind;
  t1: number; // unix sec
  t2: number; // unix sec
  top: number;
  bottom: number;
  label?: string;
}

export interface ReplayTrend {
  t1: number;
  p1: number;
  t2: number;
  p2: number;
  label?: string;
}

export interface ReplayBundle {
  bars: Bar[];
  trades: ReplayTrade[];
  zones?: ReplayZone[];
  trends?: ReplayTrend[];
  basis?: number;
  error?: string;
  meta?: Record<string, unknown>;
}
