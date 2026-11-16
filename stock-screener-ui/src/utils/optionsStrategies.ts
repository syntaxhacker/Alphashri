/**
 * Strategy presets for the options dock: each preset turns the live chain into a
 * ready-to-price leg set, grouped by outlook, so the legs strip can answer "what
 * does this view cost?" without the user hand-picking six strikes.
 *
 * Hard rule: a preset only ever names strikes the chain actually lists. Percentage
 * targets ("sell ~2% OTM") snap to the listed strike nearest that price, and the
 * structure's wings are then clamped to what the chain can hold — a 2% offset on a
 * chain that stops at 1.5% becomes 1.5% rather than a fabricated contract.
 *
 * Structure is what must survive, not the exact offset:
 * - verticals are specified in strike counts ("buy ATM, sell ATM + 2") and
 *   compress to one strike apart when the chain does not reach two;
 * - every strike is confined to its own side of spot, so a call wing can never be
 *   built above a put wing or vice versa;
 * - a chain that cannot hold the minimum shape returns `null`, and the dock omits
 *   the chip instead of pricing a contract that does not exist.
 */

import type { OptionLeg, OptionType, Side } from "./optionsMath";

export type { OptionLeg, OptionType, Side };

export type Outlook = "bullish" | "bearish" | "neutral";

export interface ChainSideQuote {
  ltp: number;
  oi: number;
  iv: number | null;
}

export interface ChainRow {
  strike: number;
  ce: ChainSideQuote;
  pe: ChainSideQuote;
}

export interface StrategyContext {
  spot: number;
  rows: readonly ChainRow[];
  lotSize: number;
}

export interface StrategyPreset {
  id: string;
  name: string;
  outlook: Outlook;
  description: string;
  risk: "defined" | "undefined";
  legs: (ctx: StrategyContext) => OptionLeg[] | null;
}

/** The plan's leg strip is a single row of chips; five chips do not fit 480 px. */
const MAX_LEGS = 4;
/** Vertical wings are specified in strike counts, not percent. */
const VERTICAL_STEPS = 2;
/** Percent offsets snap to the listed strike nearest the target price. */
const OTM_PCT = 0.02;
const CONDOR_WING_PCT = 0.04;
const BUTTERFLY_WING_PCT = 0.02;

interface PreparedChain {
  spot: number;
  lotSize: number;
  grid: readonly ChainRow[];
  atmIndex: number;
}

function quoteOf(row: ChainRow, type: OptionType): ChainSideQuote {
  return type === "CE" ? row.ce : row.pe;
}

function isTradeable(row: ChainRow, type: OptionType): boolean {
  const ltp = quoteOf(row, type)?.ltp;
  return typeof ltp === "number" && Number.isFinite(ltp) && ltp > 0;
}

function legKey(type: OptionType, strike: number): string {
  return `${type}:${strike}`;
}

/**
 * A sorted, de-duplicated view of the chain. Sorting here (rather than trusting
 * the payload order) is what makes the ATM pick and every offset deterministic.
 */
function prepare(ctx: StrategyContext): PreparedChain | null {
  const { spot, lotSize, rows } = ctx;
  if (!Number.isFinite(spot) || spot <= 0) return null;
  if (!Number.isFinite(lotSize) || lotSize <= 0) return null;
  if (!rows || rows.length === 0) return null;

  const sorted: ChainRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !Number.isFinite(row.strike) || row.strike <= 0) continue;
    sorted.push(row);
  }
  sorted.sort((a, b) => a.strike - b.strike);

  const grid: ChainRow[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].strike === sorted[i - 1].strike) continue;
    grid.push(sorted[i]);
  }
  if (grid.length === 0) return null;

  let atmIndex = 0;
  for (let i = 1; i < grid.length; i++) {
    if (Math.abs(grid[i].strike - spot) < Math.abs(grid[atmIndex].strike - spot)) atmIndex = i;
  }

  return { spot, lotSize, grid, atmIndex };
}

/**
 * First listed strike strictly above spot / last one strictly below it. Every
 * wing is confined to its own side, which is what stops a "call spread" from
 * being built out of puts that happen to sort nearby.
 */
function firstIndexAbove(prep: PreparedChain): number {
  for (let i = 0; i < prep.grid.length; i++) {
    if (prep.grid[i].strike > prep.spot) return i;
  }
  return -1;
}

function lastIndexBelow(prep: PreparedChain): number {
  for (let i = prep.grid.length - 1; i >= 0; i--) {
    if (prep.grid[i].strike < prep.spot) return i;
  }
  return -1;
}

/**
 * Nearest listed strike to a price target inside `[lo, hi]`. Ties resolve to the
 * lower strike. A target outside the window clamps to the window edge, which is
 * how a "2% OTM" request degrades to "furthest liquid strike" on a chain that
 * does not reach 2% — the structure survives, the offset shrinks.
 */
function nearestIndex(prep: PreparedChain, target: number, lo: number, hi: number): number | null {
  if (lo > hi) return null;
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = lo; i <= hi; i++) {
    const distance = Math.abs(prep.grid[i].strike - target);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best < 0 ? null : best;
}

/**
 * Exact index first; when that strike has no tradeable price on this side, walk
 * outwards (inside `[lo, hi]`) so the chip shows a real premium instead of 0.
 * Structural guards in the preset still reject the result if the substitute
 * breaks the shape — a fine but wrong-looking spread is worse than no chip.
 *
 * Returns the index actually chosen, which is what a wing bound must be built
 * from: the substitute can be one step away from the requested strike.
 */
function pickAt(
  prep: PreparedChain,
  index: number,
  type: OptionType,
  used: Set<string>,
  lo: number,
  hi: number,
): { row: ChainRow; index: number } | null {
  const { grid } = prep;
  if (lo > hi || index < lo || index > hi) return null;

  for (let distance = 0; distance <= hi - lo; distance++) {
    for (let s = 0; s < (distance === 0 ? 1 : 2); s++) {
      const i = distance === 0 ? index : s === 0 ? index - distance : index + distance;
      if (i < lo || i > hi) continue;
      const row = grid[i];
      if (used.has(legKey(type, row.strike))) continue;
      if (!isTradeable(row, type)) continue;
      return { row, index: i };
    }
  }
  return null;
}

/**
 * Nearest listed strike to `spot · (1 + pct)` inside a side's window. The offset
 * is signed (+ above spot, − below) so no caller has to remember which way a
 * wing leans.
 */
function pickByOffset(
  prep: PreparedChain,
  pct: number,
  type: OptionType,
  used: Set<string>,
  lo: number,
  hi: number,
): { row: ChainRow; index: number } | null {
  const target = prep.spot * (1 + pct);
  const index = nearestIndex(prep, target, lo, hi);
  if (index === null) return null;
  return pickAt(prep, index, type, used, lo, hi);
}

function makeLeg(
  row: ChainRow,
  type: OptionType,
  side: Side,
  prep: PreparedChain,
  used: Set<string>,
): OptionLeg {
  used.add(legKey(type, row.strike));
  return {
    side,
    type,
    strike: row.strike,
    premium: quoteOf(row, type).ltp,
    lots: 1,
    lotSize: prep.lotSize,
  };
}

const SIDE_RANK: Record<Side, number> = { sell: 0, buy: 1 };
const TYPE_RANK: Record<OptionType, number> = { CE: 0, PE: 1 };

/** sell/buy → CE/PE → ascending strike, so chips never reshuffle between renders. */
function compareLegs(a: OptionLeg, b: OptionLeg): number {
  const side = SIDE_RANK[a.side] - SIDE_RANK[b.side];
  if (side !== 0) return side;
  const type = TYPE_RANK[a.type] - TYPE_RANK[b.type];
  if (type !== 0) return type;
  return a.strike - b.strike;
}

function finalize(legs: readonly (OptionLeg | null)[]): OptionLeg[] | null {
  if (legs.length === 0 || legs.length > MAX_LEGS) return null;

  const out: OptionLeg[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (!leg) return null;
    if (!(Number.isFinite(leg.strike) && leg.strike > 0)) return null;
    if (!(Number.isFinite(leg.premium) && leg.premium > 0)) return null;
    if (!(Number.isFinite(leg.lots) && leg.lots > 0)) return null;
    if (!(Number.isFinite(leg.lotSize) && leg.lotSize > 0)) return null;
    const key = legKey(leg.type, leg.strike);
    if (seen.has(key)) return null;
    seen.add(key);
    out.push(leg);
  }
  out.sort(compareLegs);
  return out;
}

function buildLongCall(ctx: StrategyContext): OptionLeg[] | null {
  const prep = prepare(ctx);
  if (!prep) return null;
  const used = new Set<string>();
  const atm = pickAt(prep, prep.atmIndex, "CE", used, 0, prep.grid.length - 1);
  return finalize([atm ? makeLeg(atm.row, "CE", "buy", prep, used) : null]);
}

function buildLongPut(ctx: StrategyContext): OptionLeg[] | null {
  const prep = prepare(ctx);
  if (!prep) return null;
  const used = new Set<string>();
  const atm = pickAt(prep, prep.atmIndex, "PE", used, 0, prep.grid.length - 1);
  return finalize([atm ? makeLeg(atm.row, "PE", "buy", prep, used) : null]);
}

function buildBullCallSpread(ctx: StrategyContext): OptionLeg[] | null {
  const prep = prepare(ctx);
  if (!prep) return null;
  const last = prep.grid.length - 1;
  const used = new Set<string>();

  const lower = pickAt(prep, prep.atmIndex, "CE", used, 0, last);
  if (!lower) return null;
  // One strike up is the minimum a spread can hold; the two-strike default
  // compresses on a chain that does not reach it.
  const upperTarget = Math.min(prep.atmIndex + VERTICAL_STEPS, last);
  const upper = pickAt(prep, upperTarget, "CE", used, lower.index + 1, last);
  if (!upper) return null;

  return finalize([
    makeLeg(lower.row, "CE", "buy", prep, used),
    makeLeg(upper.row, "CE", "sell", prep, used),
  ]);
}

function buildBearPutSpread(ctx: StrategyContext): OptionLeg[] | null {
  const prep = prepare(ctx);
  if (!prep) return null;
  const used = new Set<string>();

  const higher = pickAt(prep, prep.atmIndex, "PE", used, 0, prep.grid.length - 1);
  if (!higher) return null;
  const lowerTarget = Math.max(prep.atmIndex - VERTICAL_STEPS, 0);
  const lower = pickAt(prep, lowerTarget, "PE", used, 0, higher.index - 1);
  if (!lower) return null;

  return finalize([
    makeLeg(higher.row, "PE", "buy", prep, used),
    makeLeg(lower.row, "PE", "sell", prep, used),
  ]);
}

function buildShortPut(ctx: StrategyContext): OptionLeg[] | null {
  const prep = prepare(ctx);
  if (!prep) return null;
  const below = lastIndexBelow(prep);
  if (below < 0) return null;
  const used = new Set<string>();
  const picked = pickByOffset(prep, -OTM_PCT, "PE", used, 0, below);
  if (!picked) return null;
  return finalize([makeLeg(picked.row, "PE", "sell", prep, used)]);
}

function buildShortCall(ctx: StrategyContext): OptionLeg[] | null {
  const prep = prepare(ctx);
  if (!prep) return null;
  const above = firstIndexAbove(prep);
  if (above < 0) return null;
  const used = new Set<string>();
  const picked = pickByOffset(prep, OTM_PCT, "CE", used, above, prep.grid.length - 1);
  if (!picked) return null;
  return finalize([makeLeg(picked.row, "CE", "sell", prep, used)]);
}

/**
 * The pin strike: ATM, or the nearest row outwards where *both* sides are
 * tradeable. A one-sided dead quote is common on the pin strike of a thin chain,
 * and a straddle/butterfly whose legs sit on different strikes is not the
 * structure the chip promises. The drift is capped so a chain with a wide dead
 * band cannot produce a straddle that is 5% away from spot.
 */
const MAX_PIN_DRIFT = 2;

function findPin(prep: PreparedChain): { row: ChainRow; index: number } | null {
  const { grid, atmIndex } = prep;
  const limit = Math.min(MAX_PIN_DRIFT, grid.length - 1);
  for (let distance = 0; distance <= limit; distance++) {
    for (let s = 0; s < (distance === 0 ? 1 : 2); s++) {
      const i = distance === 0 ? atmIndex : s === 0 ? atmIndex - distance : atmIndex + distance;
      if (i < 0 || i >= grid.length) continue;
      const row = grid[i];
      if (!isTradeable(row, "CE") || !isTradeable(row, "PE")) continue;
      return { row, index: i };
    }
  }
  return null;
}

function buildStraddle(ctx: StrategyContext, side: Side): OptionLeg[] | null {
  const prep = prepare(ctx);
  if (!prep) return null;
  const pin = findPin(prep);
  if (!pin) return null;
  const used = new Set<string>();
  return finalize([
    makeLeg(pin.row, "CE", side, prep, used),
    makeLeg(pin.row, "PE", side, prep, used),
  ]);
}

function buildShortStrangle(ctx: StrategyContext): OptionLeg[] | null {
  const prep = prepare(ctx);
  if (!prep) return null;
  const above = firstIndexAbove(prep);
  const below = lastIndexBelow(prep);
  if (above < 0 || below < 0) return null;

  const used = new Set<string>();
  const put = pickByOffset(prep, -OTM_PCT, "PE", used, 0, below);
  if (!put) return null;
  const call = pickByOffset(prep, OTM_PCT, "CE", used, above, prep.grid.length - 1);
  if (!call) return null;
  if (put.row.strike >= call.row.strike) return null;

  return finalize([
    makeLeg(put.row, "PE", "sell", prep, used),
    makeLeg(call.row, "CE", "sell", prep, used),
  ]);
}

function buildIronCondor(ctx: StrategyContext): OptionLeg[] | null {
  const prep = prepare(ctx);
  if (!prep) return null;
  const last = prep.grid.length - 1;
  const above = firstIndexAbove(prep);
  const below = lastIndexBelow(prep);
  // Each wing needs a strike strictly beyond its short, so the chain must hold
  // at least two strikes on each side of spot.
  if (above < 0 || below < 1 || above > last - 1) return null;

  const used = new Set<string>();
  const shortCall = pickByOffset(prep, OTM_PCT, "CE", used, above, last - 1);
  if (!shortCall) return null;
  const longCall = pickByOffset(prep, CONDOR_WING_PCT, "CE", used, shortCall.index + 1, last);
  if (!longCall) return null;

  const shortPut = pickByOffset(prep, -OTM_PCT, "PE", used, 1, below);
  if (!shortPut) return null;
  const longPut = pickByOffset(prep, -CONDOR_WING_PCT, "PE", used, 0, shortPut.index - 1);
  if (!longPut) return null;

  return finalize([
    makeLeg(shortCall.row, "CE", "sell", prep, used),
    makeLeg(longCall.row, "CE", "buy", prep, used),
    makeLeg(shortPut.row, "PE", "sell", prep, used),
    makeLeg(longPut.row, "PE", "buy", prep, used),
  ]);
}

function buildIronButterfly(ctx: StrategyContext): OptionLeg[] | null {
  const prep = prepare(ctx);
  if (!prep) return null;
  const last = prep.grid.length - 1;

  const pin = findPin(prep);
  // Wings must sit outside the body, so the pin needs a strike on each side.
  if (!pin || pin.index < 1 || pin.index > last - 1) return null;
  const atmIndex = pin.index;

  const used = new Set<string>();
  const atmCall = makeLeg(pin.row, "CE", "sell", prep, used);
  const atmPut = makeLeg(pin.row, "PE", "sell", prep, used);

  const longCall = pickByOffset(prep, BUTTERFLY_WING_PCT, "CE", used, atmIndex + 1, last);
  if (!longCall) return null;
  const longPut = pickByOffset(prep, -BUTTERFLY_WING_PCT, "PE", used, 0, atmIndex - 1);
  if (!longPut) return null;

  return finalize([
    atmCall,
    makeLeg(longCall.row, "CE", "buy", prep, used),
    atmPut,
    makeLeg(longPut.row, "PE", "buy", prep, used),
  ]);
}

export const STRATEGY_PRESETS: readonly StrategyPreset[] = [
  {
    id: "long_call",
    name: "Long call",
    outlook: "bullish",
    description: "Buy the at-the-money call: unlimited upside, loss limited to the premium.",
    risk: "defined",
    legs: buildLongCall,
  },
  {
    id: "bull_call_spread",
    name: "Bull call spread",
    outlook: "bullish",
    description: "Buy the at-the-money call and sell the call two strikes higher to cut the cost.",
    risk: "defined",
    legs: buildBullCallSpread,
  },
  {
    id: "short_put",
    name: "Short put",
    outlook: "bullish",
    description: "Sell a put about 2% below spot: collect premium, own the stock lower.",
    risk: "undefined",
    legs: buildShortPut,
  },
  {
    id: "long_put",
    name: "Long put",
    outlook: "bearish",
    description: "Buy the at-the-money put: gains as spot falls, loss limited to the premium.",
    risk: "defined",
    legs: buildLongPut,
  },
  {
    id: "bear_put_spread",
    name: "Bear put spread",
    outlook: "bearish",
    description: "Buy the at-the-money put and sell the put two strikes lower to cut the cost.",
    risk: "defined",
    legs: buildBearPutSpread,
  },
  {
    id: "short_call",
    name: "Short call",
    outlook: "bearish",
    description: "Sell a call about 2% above spot: collect premium, but upside risk is unlimited.",
    risk: "undefined",
    legs: buildShortCall,
  },
  {
    id: "short_straddle",
    name: "Short straddle",
    outlook: "neutral",
    description: "Sell the at-the-money call and put: profit if spot pins the strike.",
    risk: "undefined",
    legs: (ctx) => buildStraddle(ctx, "sell"),
  },
  {
    id: "short_strangle",
    name: "Short strangle",
    outlook: "neutral",
    description: "Sell a put and a call about 2% either side of spot: wider range, smaller credit.",
    risk: "undefined",
    legs: buildShortStrangle,
  },
  {
    id: "iron_condor",
    name: "Iron condor",
    outlook: "neutral",
    description: "Sell a strangle near 2% and buy wings near 4%: defined risk, range-bound profit.",
    risk: "defined",
    legs: buildIronCondor,
  },
  {
    id: "iron_butterfly",
    name: "Iron butterfly",
    outlook: "neutral",
    description: "Sell the at-the-money straddle and buy wings 2% out: pin the strike, risk capped.",
    risk: "defined",
    legs: buildIronButterfly,
  },
  {
    id: "long_straddle",
    name: "Long straddle",
    outlook: "neutral",
    description: "Buy the at-the-money call and put: profit on a large move in either direction.",
    risk: "defined",
    legs: (ctx) => buildStraddle(ctx, "buy"),
  },
];

export function strategiesFor(outlook: Outlook): readonly StrategyPreset[] {
  return STRATEGY_PRESETS.filter((preset) => preset.outlook === outlook);
}

export function buildPreset(id: string, ctx: StrategyContext): OptionLeg[] | null {
  for (let i = 0; i < STRATEGY_PRESETS.length; i++) {
    if (STRATEGY_PRESETS[i].id === id) return STRATEGY_PRESETS[i].legs(ctx);
  }
  return null;
}
