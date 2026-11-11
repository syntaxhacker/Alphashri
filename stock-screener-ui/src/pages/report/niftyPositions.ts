/**
 * Paper-position helpers shared by the NIFTY desk's P&L attribution, the
 * POSITIONS drawer and the toolbar button. Kept out of `NiftyReportPanel.tsx`
 * so the drawer can reuse the option-leg parser without importing the panel
 * (which imports the drawer).
 */

import type { PaperPosition } from "@/types/paperTrading";
import type { NiftyOptionSide, NiftyStrike } from "@/types/niftyReport";
import type { NiftyPnlPosition } from "./niftyPnlAttribution";

/**
 * Map one paper position to a NIFTY P&L leg. Paper symbols are usually
 * equity (`RELIANCE`) and carry no option strike — those map to `[]` so the
 * attribution panel shows its empty state instead of crashing. NIFTY option
 * legs (`NIFTY…25700CE`) map through; `entry_spot` falls back to the strike
 * (the journal records the premium, not the spot at entry).
 */
export function paperToPnlLeg(p: PaperPosition): NiftyPnlPosition[] {
  if (!p || typeof p.symbol !== "string") return [];
  const sym = p.symbol.toUpperCase().replace(/\s+/g, "");
  if (!sym.includes("NIFTY")) return [];
  const m = sym.match(/(\d{4,6})\s*(CE|PE)/);
  if (!m) return [];
  const strike = Number(m[1]);
  if (!Number.isFinite(strike) || strike <= 0) return [];
  const opt = m[2] as "CE" | "PE";
  const direction = p.side === "SELL" ? "short" : "long";
  const qty = Number(p.quantity);
  const entry = Number(p.entry_price);
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(entry)) return [];
  return [
    {
      opt,
      strike,
      direction,
      entry_premium: entry,
      qty,
      entry_spot: strike,
    },
  ];
}

/** One open leg, flattened for the drawer table. */
export interface PositionRow {
  key: string;
  symbol: string;
  /** `CE` / `PE` when the symbol parses as a NIFTY option, else null. */
  opt: "CE" | "PE" | null;
  strike: number | null;
  side: "BUY" | "SELL";
  qty: number;
  entry: number;
  mark: number;
  pnl: number;
  stop: number;
  target: number;
}

function finite(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Option strike / side parsed from a NIFTY option symbol (`NIFTY25700CE`). */
export function parsePositionLeg(symbol: string): { opt: "CE" | "PE"; strike: number } | null {
  if (typeof symbol !== "string") return null;
  const sym = symbol.toUpperCase().replace(/\s+/g, "");
  if (!sym.includes("NIFTY")) return null;
  const m = sym.match(/(\d{4,6})\s*(CE|PE)/);
  if (!m) return null;
  const strike = Number(m[1]);
  if (!Number.isFinite(strike) || strike <= 0) return null;
  return { opt: m[2] as "CE" | "PE", strike };
}

/** Flatten the open book for the drawer. Missing numbers render as 0. */
export function buildPositionRows(
  positions: PaperPosition[] | null | undefined,
): PositionRow[] {
  if (!Array.isArray(positions)) return [];
  return positions
    .filter((p) => p && typeof p.symbol === "string")
    .map((p, index) => {
      const leg = parsePositionLeg(p.symbol);
      return {
        key: p.id ?? `${p.symbol}-${p.side}-${p.entry_time ?? index}-${index}`,
        symbol: p.symbol,
        opt: leg?.opt ?? null,
        strike: leg?.strike ?? null,
        side: p.side === "SELL" ? "SELL" : "BUY",
        qty: finite(p.quantity) ?? 0,
        entry: finite(p.entry_price) ?? 0,
        mark: finite(p.current_price) ?? 0,
        pnl: finite(p.pnl) ?? 0,
        stop: finite(p.stop_loss) ?? 0,
        target: finite(p.take_profit) ?? 0,
      };
    });
}

/** Net unrealised P&L over the open book. */
export function netPositionPnl(
  positions: PaperPosition[] | null | undefined,
): number {
  if (!Array.isArray(positions)) return 0;
  let total = 0;
  for (const p of positions) {
    const pnl = finite(p?.pnl);
    if (pnl !== null) total += pnl;
  }
  return total;
}

/** Book greeks: signed-qty × chain greek, summed over every mappable leg. */
interface BookGreeks {
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  /** Legs that resolved a chain row and contributed at least one greek. */
  legs: number;
}

const GREEK_KEYS = ["delta", "gamma", "theta", "vega"] as const;
type GreekKey = (typeof GREEK_KEYS)[number];

/**
 * Sum the chain greeks for each open NIFTY option leg. `SELL` flips the sign
 * (short calls are negative gamma/vega, short puts are positive delta).
 * Missing greeks — and legs with no matching chain row — are skipped, so a
 * partially-populated chain still yields honest totals. A greek nobody
 * contributed renders `null` (→ dash), never a fake zero.
 */
export function sumBookGreeks(
  positions: PaperPosition[] | null | undefined,
  strikes: NiftyStrike[] | null | undefined,
): BookGreeks {
  const rows = buildPositionRows(positions);
  const sums: Record<GreekKey, number> = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  const seen: Record<GreekKey, boolean> = {
    delta: false,
    gamma: false,
    theta: false,
    vega: false,
  };
  let legs = 0;

  if (!Array.isArray(strikes) || strikes.length === 0) {
    return { delta: null, gamma: null, theta: null, vega: null, legs: 0 };
  }
  const chain = new Map<number, NiftyStrike>();
  for (const row of strikes) {
    if (row && Number.isFinite(row.strike)) chain.set(row.strike, row);
  }

  for (const row of rows) {
    if (row.opt === null || row.strike === null) continue;
    const strikeRow = chain.get(row.strike);
    if (!strikeRow) continue;
    const leg: NiftyOptionSide = row.opt === "CE" ? strikeRow.ce : strikeRow.pe;
    const sign = row.side === "SELL" ? -1 : 1;
    let contributed = false;
    for (const key of GREEK_KEYS) {
      const value = finite(leg?.[key]);
      if (value === null) continue;
      sums[key] += sign * row.qty * value;
      seen[key] = true;
      contributed = true;
    }
    if (contributed) legs += 1;
  }

  return {
    delta: seen.delta ? sums.delta : null,
    gamma: seen.gamma ? sums.gamma : null,
    theta: seen.theta ? sums.theta : null,
    vega: seen.vega ? sums.vega : null,
    legs,
  };
}

/** `+12.40` / `-0.05` / `—` (true dash when nobody contributed). */
export function formatGreek(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return (0).toFixed(digits);
  const sign = rounded > 0 ? "+" : "-";
  return `${sign}${Math.abs(rounded).toFixed(digits)}`;
}

/** Premium in rupees: `₹120.00` / `—` when absent. */
export function formatRupees(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `₹${value.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}
