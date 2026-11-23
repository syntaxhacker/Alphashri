/**
 * Pure helpers for the dense strike × expiry payoff table.
 *
 * The matrix itself is built by `src/utils/payoffMatrix.buildPayoffTable` (owned
 * by a separate lane). This module only shapes that output for display: column
 * heads, cell ink/fill, tooltips and the view registry. No stores, no DOM, no
 * network — everything here is assertable without mounting a table.
 */

import * as palette from "@/ui/palette";
import { compositeOver, pickTextColor } from "@/utils/contrast";
import * as payoffMatrix from "@/utils/payoffMatrix";

export interface PayoffTableLeg {
  action: "BUY" | "SELL";
  opt: "CE" | "PE";
  strike: number;
  premium: number;
  qty: number;
}

export interface PayoffTableStrike {
  strike: number;
  spotPct: number;
  isAtm: boolean;
}

export interface PayoffTableExpiry {
  date: string;
  label: string;
  dte: number;
  month: string;
}

export interface PayoffTableCell {
  pnl: number | null;
  priced: boolean;
  basis: string;
}

export interface PayoffTableKpis {
  netDebit?: number;
  maxProfit?: number | null;
  maxLoss?: number | null;
  breakevens?: number[];
  pop?: number | null;
}

export interface PayoffTable {
  strikes: PayoffTableStrike[];
  expiries: PayoffTableExpiry[];
  cells: PayoffTableCell[][];
  spot: number;
  kpis: PayoffTableKpis;
}

export interface PayoffTableInput {
  legs: PayoffTableLeg[];
  spot: number;
  iv?: number | null;
  rangePct?: number;
  asOf?: string;
  expiries?: string[];
}

/** A single TanStackTable row: one strike with its expiry cells. */
export interface PayoffRow {
  key: string;
  strike: number;
  spotPct: number;
  isAtm: boolean;
  cells: PayoffTableCell[];
}

export interface PnlDomain {
  min: number;
  max: number;
}

export interface CellFill {
  background: string;
  ink: string;
  tone: string;
  alpha: number;
  ratio: number;
}

/** Note shown on a hatched, genuinely unpriceable cell. */
export const UNPRICED_NOTE = "Unpriced — no P&L available (no valid IV quote)";
/** Note shown on a priced cell whose P&L has no time-value component. */
export const INTRINSIC_ONLY_NOTE = "intrinsic only — no IV";
/** Basis label used in the tooltip. */
export const BASIS_TIMED = "intrinsic + time value";
export const BASIS_INTRINSIC = INTRINSIC_ONLY_NOTE;

export const PAYOFF_VIEWS = [
  { id: "table", label: "Table" },
  { id: "graph", label: "Graph" },
  { id: "pnl-usd", label: "Profit/Loss $" },
  { id: "pnl-pct", label: "Profit/Loss %" },
  { id: "contract-value", label: "Contract Value" },
  { id: "pct-max-risk", label: "% of Max Risk" },
] as const;

export type PayoffViewId = (typeof PAYOFF_VIEWS)[number]["id"];

export const EMPTY_TABLE: PayoffTable = {
  strikes: [],
  expiries: [],
  cells: [],
  spot: 0,
  kpis: {},
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Read the matrix builder through a namespace so a still-in-flight export does
 * not turn into a tsc error. Once the dependent lane lands `buildPayoffTable`
 * the same call resolves to it; tests replace it with `vi.mock`.
 */
export function buildTable(input: PayoffTableInput): PayoffTable {
  const builder = (
    payoffMatrix as unknown as {
      buildPayoffTable?: (value: PayoffTableInput) => PayoffTable | null | undefined;
    }
  ).buildPayoffTable;
  if (typeof builder !== "function") return EMPTY_TABLE;
  try {
    return builder(input) ?? EMPTY_TABLE;
  } catch (error) {
    console.warn("PayoffTable: matrix build failed", error);
    return EMPTY_TABLE;
  }
}

function signed(value: number): string {
  return value > 0 ? "+" : value < 0 ? "−" : "";
}

const RUPEE = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });
const STRIKE = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** Signed rupee P&L: compact only for large magnitudes, never round away a small fraction. */
export function formatCellPnl(value: unknown): string {
  if (!isFiniteNumber(value)) return "—";
  const abs = Math.abs(value);
  let magnitude: string;
  if (abs >= 10_000_000) magnitude = `${(abs / 10_000_000).toFixed(1)}Cr`;
  else if (abs >= 100_000) magnitude = `${(abs / 100_000).toFixed(1)}L`;
  else if (abs >= 1_000) magnitude = `${(abs / 1_000).toFixed(1)}k`;
  else magnitude = RUPEE.format(abs);
  return `${signed(value)}${magnitude}`;
}

/** Signed percentage from spot, e.g. `+1.7%` / `−2.0%`. */
export function formatSpotPct(value: unknown): string {
  if (!isFiniteNumber(value)) return "—";
  return `${signed(value)}${Math.abs(value).toFixed(1)}%`;
}

/** Full strike with Indian digit grouping: `1420` → `1,420`, `24000` → `24,000`. */
export function formatStrike(value: unknown): string {
  if (!isFiniteNumber(value)) return "—";
  return STRIKE.format(value);
}

/** Two-tier column head: month over a weekday/date label, derived from the ISO date. */
export function formatExpiryHead(expiry: PayoffTableExpiry): { month: string; date: string } {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry?.date ?? "");
  if (!parts) return { month: expiry?.month ?? "—", date: expiry?.label ?? "—" };
  const monthIndex = Number(parts[2]) - 1;
  const day = Number(parts[3]);
  const weekday = WEEKDAYS[new Date(Date.UTC(Number(parts[1]), monthIndex, day)).getUTCDay()] ?? "";
  return {
    month: expiry?.month ?? MONTHS[monthIndex] ?? "—",
    date: `${weekday} ${String(day).padStart(2, "0")} ${MONTHS[monthIndex] ?? "—"}`.trim(),
  };
}

/** Robust symmetric domain anchored to defined risk, falling back to observed magnitude. */
export function robustDomain(cells: readonly PayoffTableCell[][], kpis: PayoffTableKpis): PnlDomain {
  const magnitudes = cells
    .flat()
    .map((cell) => cell?.pnl)
    .filter(isFiniteNumber)
    .map(Math.abs)
    .sort((a, b) => a - b);
  const clipped = magnitudes.length > 0 ? magnitudes[Math.floor(magnitudes.length * 0.96)] : 0;
  const defined = [kpis?.maxProfit, kpis?.maxLoss].filter(isFiniteNumber).map(Math.abs);
  const definedMag = defined.length > 0 ? Math.max(...defined) : 0;
  const mag = definedMag > 0 ? definedMag : clipped > 0 ? clipped : 1;
  return { min: -mag, max: mag };
}

/**
 * Continuous green→red fill. Alpha rises with the magnitude of the move; the
 * ink is always derived with `pickTextColor` on the composited solid, never a
 * hardcoded colour sitting on a saturated fill.
 */
export function cellFill(pnl: unknown, domain: PnlDomain): CellFill | null {
  if (!isFiniteNumber(pnl)) return null;
  const mag = Math.max(Math.abs(domain.min), Math.abs(domain.max), 1);
  const ratio = Math.max(-1, Math.min(1, pnl / mag));
  const alpha = Number((0.08 + 0.5 * Math.abs(ratio)).toFixed(3));
  const tone = ratio >= 0 ? palette.POSITIVE : palette.NEGATIVE;
  return {
    background: palette.alpha(tone, alpha),
    ink: pickTextColor(compositeOver(tone, palette.SURFACE, alpha)),
    tone,
    alpha,
    ratio,
  };
}

/** Fill for a hatched, unpriceable cell. The hatch itself is added by the component. */
export function unpricedFill(): CellFill {
  return {
    background: palette.SURFACE_ALT,
    ink: pickTextColor(palette.SURFACE_ALT),
    tone: palette.SURFACE_ALT,
    alpha: 1,
    ratio: 0,
  };
}

export function basisLabel(cell: PayoffTableCell | null | undefined): string {
  return cell?.basis === "intrinsic-only" ? BASIS_INTRINSIC : BASIS_TIMED;
}

export function nearbyLegs(legs: readonly PayoffTableLeg[], strike: number): PayoffTableLeg[] {
  return legs.filter((leg) => isFiniteNumber(leg?.strike) && Math.abs(leg.strike - strike) < 1e-6);
}

/**
 * Rich, deterministic tooltip copy. Every field has a fallback so the rendered
 * `title`/`aria-label` can never read `undefined` or `NaN`.
 */
export function buildCellTooltip(args: {
  strike: number;
  spotPct: number | null;
  expiry: PayoffTableExpiry;
  cell: PayoffTableCell | null | undefined;
  legs: readonly PayoffTableLeg[];
}): string {
  const { strike, expiry, cell } = args;
  const lines = [
    `Strike ${formatStrike(strike)}`,
    `% from spot ${formatSpotPct(args.spotPct)}`,
    `Expiry ${expiry?.label ?? "—"} · ${expiry?.date ?? "—"} · ${isFiniteNumber(expiry?.dte) ? `${expiry.dte}d` : "—"}`,
    `P&L ${formatCellPnl(cell?.pnl)}`,
    `Basis ${basisLabel(cell)}`,
  ];
  const legs = nearbyLegs(args.legs ?? [], strike);
  if (legs.length > 0) {
    lines.push(`Legs ${legs.map((leg) => `${leg.action} ${leg.opt} ${formatStrike(leg.strike)}`).join(", ")}`);
  }
  if (!cell || !cell.priced || !isFiniteNumber(cell.pnl)) lines.push(UNPRICED_NOTE);
  else if (cell.basis === "intrinsic-only") lines.push(INTRINSIC_ONLY_NOTE);
  return lines.join(" · ");
}

/** Matrix output → stable TanStackTable rows. Never mutates the source. */
export function toRows(table: PayoffTable): PayoffRow[] {
  return (table?.strikes ?? []).map((entry, index) => ({
    key: `${index}:${entry.strike}`,
    strike: entry.strike,
    spotPct: entry.spotPct,
    isAtm: entry.isAtm,
    cells: table.cells[index] ?? [],
  }));
}

/** Normalise a caller rangePct (fraction 0.08 or percent 8) into a slider percent. */
export function rangeToPercent(value: unknown, fallback = 8): number {
  if (!isFiniteNumber(value)) return fallback;
  return value > 0 && value <= 1 ? value * 100 : value;
}

/** Decimal IV → slider percent; null/absent becomes 0 (intrinsic-only mode). */
export function ivToPercent(value: unknown): number {
  if (!isFiniteNumber(value) || value <= 0) return 0;
  return Math.min(100, Math.round(value * 100));
}
