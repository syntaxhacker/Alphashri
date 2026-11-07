/**
 * Option-trade helpers for the paper-trading history view.
 *
 * Pure functions only (no React / ECharts imports) so they stay unit-testable:
 *  - parseOptionSymbol       contract symbol -> { underlying, optionType, strike, expiry? }
 *  - resolveUnderlyingSymbol any trade symbol -> chartable underlying (no spaces)
 *  - isOptionTrade           source-first (`options_paper*`) classification with
 *                            symbol-parse fallback
 *  - optionPayoffAt          payoff at expiry for a single leg at one underlying price
 *  - buildPayoffSeries       payoff-at-expiry grid (P&L vs underlying price)
 *  - optionBreakeven         strike +/- premium breakeven (chart marker)
 *  - computeTradePayoffSeries convenience wrapper over a PaperTrade
 *  - bookKeyForSource        trade source prefix -> asset-class "book"
 *  - bookLabelForSource      trade source prefix -> human label
 *  - bookKeyForTrade         the book a trade really belongs to (options wins)
 *  - tradeMatchesBook        book membership test used by the history filter
 *  - listBookFilters         data-driven options for the Source filter
 */

import type { PaperTrade, TradeBookKey } from "../../types/paperTrading";

export interface OptionContract {
  underlying: string;
  optionType: "CE" | "PE" | "STRADDLE";
  strike: number;
  /** Expiry (YYYY-MM or YYYY-MM-DD) when the symbol encodes one. */
  expiry?: string;
}

// "NIFTY 2026-10-19 22900CE" — underlying, ISO expiry, strike, CE/PE
const SPACED_RE = /^([A-Z][A-Z&-]*)\s+(\d{4}-\d{2}-\d{2})\s+(\d+(?:\.\d+)?)(CE|PE)$/i;
// "NIFTY 2026-10-19 22850STRADDLE" — structured option on a spaced symbol
const SPACED_STRUCT_RE =
  /^([A-Z][A-Z&-]*)\s+(\d{4}-\d{2}-\d{2})\s+(\d+(?:\.\d+)?)(STRADDLE)$/i;
// "NIFTY26OCT23000PE" — underlying, YY + MMM, strike, CE/PE
const MONTHLY_RE =
  /^([A-Z][A-Z&-]*?)(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d+(?:\.\d+)?)(CE|PE)$/i;
// "NIFTY25O0924000CE" — underlying, YY + M (1-9/O/N/D) + DD, strike, CE/PE
const WEEKLY_RE = /^([A-Z][A-Z&-]*?)(\d{2})([1-9OND])(\d{2})(\d+(?:\.\d+)?)(CE|PE)$/i;

const MONTH_MAP: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

/** Parse an option contract symbol, or return null for non-option symbols. */
export function parseOptionSymbol(symbol: string): OptionContract | null {
  const raw = (symbol || "").trim();
  if (!raw) return null;

  const spaced = SPACED_RE.exec(raw);
  if (spaced) {
    const strike = Number(spaced[3]);
    if (!Number.isFinite(strike) || strike <= 0) return null;
    return {
      underlying: spaced[1].toUpperCase(),
      expiry: spaced[2],
      strike,
      optionType: spaced[4].toUpperCase() as "CE" | "PE",
    };
  }

  const monthly = MONTHLY_RE.exec(raw);
  if (monthly) {
    const strike = Number(monthly[4]);
    if (!Number.isFinite(strike) || strike <= 0) return null;
    const month = MONTH_MAP[monthly[3].toUpperCase()];
    return {
      underlying: monthly[1].toUpperCase(),
      expiry: month
        ? `${2000 + Number(monthly[2])}-${String(month).padStart(2, "0")}`
        : undefined,
      strike,
      optionType: monthly[5].toUpperCase() as "CE" | "PE",
    };
  }

  const weekly = WEEKLY_RE.exec(raw);
  if (weekly) {
    const strike = Number(weekly[5]);
    if (!Number.isFinite(strike) || strike <= 0) return null;
    return {
      underlying: weekly[1].toUpperCase(),
      strike,
      optionType: weekly[6].toUpperCase() as "CE" | "PE",
    };
  }

  const struct = SPACED_STRUCT_RE.exec(raw);
  if (struct) {
    const strike = Number(struct[3]);
    if (!Number.isFinite(strike) || strike <= 0) return null;
    return {
      underlying: struct[1].toUpperCase(),
      expiry: struct[2],
      strike,
      optionType: "STRADDLE",
    };
  }

  return null;
}

/**
 * Map any trade symbol to a chartable symbol: option contracts resolve to
 * their underlying (spaces stripped), everything else passes through trimmed.
 */
export function resolveUnderlyingSymbol(symbol: string): string {
  const trimmed = (symbol || "").trim();
  if (!trimmed) return "";
  const parsed = parseOptionSymbol(trimmed);
  return parsed ? parsed.underlying : trimmed;
}

/**
 * True when the trade is an option trade. `options_paper*` sources are
 * authoritative; without a source we fall back to parsing the symbol.
 */
export function isOptionTrade(trade: Pick<PaperTrade, "symbol" | "source">): boolean {
  const source = (trade.source || "").trim().toLowerCase();
  if (source) return source.startsWith("options_paper");
  return parseOptionSymbol((trade.symbol || "").trim()) !== null;
}

/* ------------------------------------------------------------------ *
 * Asset-class "books" (equity / options / futures / commodities)
 * ------------------------------------------------------------------ */

/** Display label for each book key. */
export const BOOK_LABELS: Record<TradeBookKey, string> = {
  equity: "Equity",
  options: "Options",
  futures: "Futures",
  commodities: "Commodities",
};

/** Canonical order books appear in the Source filter. */
export const BOOK_KEYS: TradeBookKey[] = ["equity", "options", "futures", "commodities"];

/** Source prefix -> book key. Order matters: first match wins. */
const SOURCE_BOOK_PREFIXES: ReadonlyArray<readonly [string, TradeBookKey]> = [
  ["options_paper", "options"],
  ["futures_paper", "futures"],
  ["commodities_paper", "commodities"],
];

/**
 * The book a source prefix belongs to. `options_paper*` -> options,
 * `futures_paper*` -> futures, `commodities_paper*` -> commodities, everything
 * else (including `live`, `paper`, null/undefined) -> equity.
 */
export function bookKeyForSource(source: string | undefined | null): TradeBookKey {
  const src = (source || "").trim().toLowerCase();
  if (!src) return "equity";
  for (const [prefix, key] of SOURCE_BOOK_PREFIXES) {
    if (src.startsWith(prefix)) return key;
  }
  return "equity";
}

/** Human label of the book a source prefix belongs to. */
export function bookLabelForSource(source: string | undefined | null): string {
  return BOOK_LABELS[bookKeyForSource(source)];
}

/**
 * The book a trade actually belongs to. Options wins — it is detected
 * source-first with a symbol-parse fallback (see `isOptionTrade`) — so the
 * books stay mutually exclusive even for legacy rows without a source.
 */
export function bookKeyForTrade(
  trade: Pick<PaperTrade, "symbol" | "source">,
): TradeBookKey {
  if (isOptionTrade(trade)) return "options";
  return bookKeyForSource(trade.source);
}

/** True when the trade belongs to the given book. */
export function tradeMatchesBook(
  trade: Pick<PaperTrade, "symbol" | "source">,
  book: TradeBookKey,
): boolean {
  return bookKeyForTrade(trade) === book;
}

export interface BookFilterOption {
  value: TradeBookKey | "all";
  label: string;
}

/**
 * Options for the history toolbar's Source filter. `All`, `Equity` and
 * `Options` are always offered; the remaining books (futures, commodities)
 * appear only when the loaded trades actually contain them — so a new asset
 * class shows up automatically, with no UI change.
 */
export function listBookFilters(
  trades: Array<Pick<PaperTrade, "symbol" | "source">> | null | undefined,
): BookFilterOption[] {
  const present = new Set<TradeBookKey>();
  for (const trade of trades ?? []) {
    if (trade) present.add(bookKeyForTrade(trade));
  }

  const options: BookFilterOption[] = [
    { value: "all", label: "All" },
    { value: "equity", label: BOOK_LABELS.equity },
    { value: "options", label: BOOK_LABELS.options },
  ];
  for (const key of BOOK_KEYS) {
    if (key === "equity" || key === "options") continue;
    if (present.has(key)) options.push({ value: key, label: BOOK_LABELS[key] });
  }
  return options;
}

export interface PayoffPoint {
  underlying: number;
  pnl: number;
}

export interface PayoffInputs {
  optionType: "CE" | "PE" | "STRADDLE";
  strike: number;
  /** "BUY" (long) or "SELL" (short). */
  side: string;
  /** Entry premium per unit. */
  premium: number;
  qty: number;
  /** Grid step in underlying points (default 50). */
  step?: number;
  /** Grid half-range as % of strike (default 3). */
  pctRange?: number;
}

/**
 * Payoff at expiry for a single option leg.
 * Long CE: (max(S-K,0) - premium) * qty; long PE: (max(K-S,0) - premium) * qty;
 * negated for SHORT. Never mutates inputs.
 */
export function optionPayoffAt(inputs: PayoffInputs, underlying: number): number {
  const intrinsic =
    inputs.optionType === "STRADDLE"
      ? Math.abs(underlying - inputs.strike)
      : inputs.optionType === "CE"
        ? Math.max(0, underlying - inputs.strike)
        : Math.max(0, inputs.strike - underlying);
  const perUnit = intrinsic - inputs.premium;
  const signed = inputs.side.toUpperCase() === "SELL" ? -perUnit : perUnit;
  return signed * inputs.qty;
}

/**
 * Payoff-at-expiry grid: strike ±pctRange% sampled in step-point increments
 * (aligned to step multiples so points are stable). When the range is narrower
 * than one step (small strikes), falls back to a uniform 21-point grid so the
 * chart still renders. Returns [] for invalid inputs.
 */
export function buildPayoffSeries(inputs: PayoffInputs): PayoffPoint[] {
  const step = inputs.step ?? 50;
  const pctRange = inputs.pctRange ?? 3;
  if (
    !(inputs.strike > 0) ||
    !(step > 0) ||
    !Number.isFinite(inputs.premium) ||
    !Number.isFinite(inputs.qty)
  ) {
    return [];
  }
  const lo = inputs.strike * (1 - pctRange / 100);
  const hi = inputs.strike * (1 + pctRange / 100);
  const start = Math.ceil(lo / step) * step;
  const count = Math.floor((hi - start) / step);
  const out: PayoffPoint[] = [];
  if (count >= 1) {
    for (let i = 0; i <= count; i += 1) {
      const underlying = start + i * step;
      out.push({ underlying, pnl: optionPayoffAt(inputs, underlying) });
    }
  } else {
    const n = 20;
    for (let i = 0; i <= n; i += 1) {
      const underlying = lo + ((hi - lo) * i) / n;
      out.push({ underlying, pnl: optionPayoffAt(inputs, underlying) });
    }
  }
  return out;
}

/** Breakeven underlying price at expiry (strike ± premium), or null if invalid. */
export function optionBreakeven(
  optionType: "CE" | "PE" | "STRADDLE",
  strike: number,
  premium: number,
): number | null {
  if (!(strike > 0) || !Number.isFinite(premium)) return null;
  // A straddle has two breakevens (K ± premium); a single marker would mislead.
  if (optionType === "STRADDLE") return null;
  return optionType === "CE" ? strike + premium : strike - premium;
}

/** Payoff series for a completed trade, or null for non-option trades. */
export function computeTradePayoffSeries(
  trade: Pick<PaperTrade, "symbol" | "side" | "quantity" | "entry_price">,
): PayoffPoint[] | null {
  const contract = parseOptionSymbol((trade.symbol || "").trim());
  if (!contract) return null;
  return buildPayoffSeries({
    optionType: contract.optionType,
    strike: contract.strike,
    side: trade.side || "BUY",
    premium: trade.entry_price,
    qty: trade.quantity,
  });
}
