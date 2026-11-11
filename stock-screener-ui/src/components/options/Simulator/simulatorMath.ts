import type { PayoffLeg } from "../PremiumTracker/payoff";
import {
  breakevens,
  maxLossAtExpiry,
  maxProfitAtExpiry,
  netEntry,
  payoffAtExpiry,
} from "../PremiumTracker/payoff";

export interface SimulatorLeg {
  legId: string;
  action: "BUY" | "SELL";
  optionType: "CE" | "PE";
  strike: number;
  qty: number;
  entry: number;
}

export interface ScenarioRow {
  label: string;
  pct: number;
  spot: number | null;
  pnl: number | null;
}

export interface SimulatorStats {
  netEntry: number; // > 0 = net debit paid, < 0 = net credit received, 0 = flat
  kind: "debit" | "credit" | "flat";
  maxProfit: number | null; // null = unbounded ("open")
  maxLoss: number | null;   // null = unbounded
  breakevens: number[];
  riskReward: number | null; // reward per unit risk; null when not meaningful
}

const SCENARIO_PCTS = [-10, -5, 0, 5, 10] as const;

/** Spot levels (−10%, −5%, 0, +5%, +10%) for the scenario table. */
export function scenarioSpots(spot: number | null) {
  return SCENARIO_PCTS.map((pct) => ({
    label: pct === 0 ? "Spot" : `${pct < 0 ? "" : "+"}${pct}%`,
    pct,
    spot: spot == null ? null : spot * (1 + pct / 100),
  }));
}

/** P&L at expiry for each scenario spot. Null spot → null P&L. */
export function scenarioRows(legs: PayoffLeg[], spot: number | null): ScenarioRow[] {
  return scenarioSpots(spot).map(({ label, pct, spot: s }) => ({
    label,
    pct,
    spot: s,
    pnl: s == null ? null : payoffAtExpiry(legs, s),
  }));
}

/** Convert builder legs (with local legId) to payoff legs. Never mutates inputs. */
export function toPayoffLegs(legs: SimulatorLeg[]): PayoffLeg[] {
  return legs.map(({ legId: _, ...rest }) => rest);
}

/** Aggregate payoff stats for the stat strip. Null-safe for empty legs. */
export function statsFor(legs: PayoffLeg[], spot: number | null): SimulatorStats {
  const net = netEntry(legs);
  const kind: SimulatorStats["kind"] = net > 0 ? "debit" : net < 0 ? "credit" : "flat";
  if (legs.length === 0) {
    return { netEntry: 0, kind: "flat", maxProfit: 0, maxLoss: 0, breakevens: [], riskReward: null };
  }
  const maxProfit = maxProfitAtExpiry(legs);
  const maxLoss = maxLossAtExpiry(legs);
  const base = spot ?? (Math.min(...legs.map((leg) => leg.strike)) + Math.max(...legs.map((leg) => leg.strike))) / 2;
  const scan = Math.max(
    Math.max(...legs.map((leg) => leg.strike)) - Math.min(...legs.map((leg) => leg.strike)),
    base * 0.08,
    1,
  );
  const breakevensList = breakevens(
    legs,
    Math.min(...legs.map((leg) => leg.strike), base) - scan,
    Math.max(...legs.map((leg) => leg.strike), base) + scan,
  );
  let riskReward: number | null = null;
  if (kind === "debit" && maxProfit != null && net > 0) {
    riskReward = maxProfit / net;
  } else if (kind === "credit" && maxLoss != null && maxLoss < 0) {
    riskReward = Math.abs(net) / Math.abs(maxLoss);
  }
  return { netEntry: net, kind, maxProfit, maxLoss, breakevens: breakevensList, riskReward };
}

/** Range % (either side of spot) that brackets all strikes, with a 10pt buffer. */
export function rangePctFor(spot: number | null, strikes: number[]): number {
  if (!spot || spot <= 0 || strikes.length === 0) return 12;
  const lo = Math.min(...strikes);
  const hi = Math.max(...strikes);
  const dev = Math.max(Math.abs(hi - spot), Math.abs(lo - spot)) / spot;
  return Math.round(Math.max(dev * 100 + 1.5, 5) * 10) / 10;
}

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/** Calendar days to expiry. ISO dates and "25MAY"-style expiries supported. */
export function daysToExpiry(expiry: string | null, reference: Date = new Date()): number | null {
  if (!expiry) return null;
  const m = /^\s*(\d{1,2})\s*-?\s*([A-Za-z]{3})(?:\s*(\d{2,4}))?\s*$/.exec(expiry);
  if (m) {
    const month = MONTHS[m[2].toUpperCase()];
    if (month === undefined) return null;
  const year = m[3] ? Number(m[3]) : reference.getFullYear();
  let target = new Date(year, month, Number(m[1]));
  if (target <= reference) target = new Date(year + 1, month, Number(m[1]));
  return Math.ceil((target.getTime() - reference.getTime()) / 86400000);
  }

  const iso = Date.parse(expiry);
  if (!Number.isNaN(iso)) {
    const target = new Date(iso);
    target.setUTCHours(0, 0, 0, 0);
    reference.setUTCHours(0, 0, 0, 0);
    const diff = (target.getTime() - reference.getTime()) / 86400000;
    return diff > 0 ? Math.ceil(diff) : 0;
  }
  return null;
}
