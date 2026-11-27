/**
 * Client for the full-screen Options Analytics dashboard.
 *
 * The transport is shared with the options dock: one `requestJson` call, the
 * same typed `OptionDockError` kinds and the same single retry + deadline. An
 * aborted request resolves to `null` — leaving the dashboard is not an error.
 *
 * The wire payload is the analytics endpoint's camelCase envelope with optional
 * new blocks (positioning / dealer / liquidity / rnd per expiry, `rv` at the
 * top). Cached and fixture payloads may still be snake_case, so both spellings
 * are read defensively and every number is parsed through `finiteNumber()`: a missing or
 * malformed greek is `null`, never a fabricated `0`. The engine blocks carry
 * parallel arrays — those are copied element-by-element (nulls included) and
 * projected into the chart-ready series the panels consume.
 */

import { ANALYTICS_MAX_EXPIRIES } from "../config/optionsAnalytics";
import type {
  ConePoint,
  DashboardExpiry,
  Dealer,
  DealerStrike,
  DensityPoint,
  IvPoint,
  IvVsRv,
  IvVsRvRow,
  LevelDetail,
  Levels,
  Liquidity,
  MaxPainPoint,
  OptionsDashboardData,
  PanelDealerBlock,
  PanelLiquidityBlock,
  PanelPositioningBlock,
  PanelSpreadCell,
  PanelStrikePair,
  PanelTenorValue,
  Positioning,
  PositioningStrike,
  Probability,
  Quantiles,
  RealizedVolatility,
  Rnd,
  RvCone,
  RvTenor,
  Surface,
  TermPoint,
  Warning,
} from "../types/optionsDashboard";
import { API_BASE } from "./config";
import { requestJson } from "./optionsDock";
import { finiteNumber, finiteText } from "./wireParse";

export { OptionDockError, type DockErrorKind } from "./optionsDock";

const DASHBOARD_BASE = `${API_BASE}/api/options`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function obj(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** First non-null / non-undefined value; `0` and `false` are real values. */
function pick(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

// The dashboard also accepts finite numbers as text (e.g. numeric warning codes).
function text(value: unknown): string | null {
  return finiteText(value) ?? (typeof value === "number" && Number.isFinite(value) ? String(value) : null);
}

function bool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

type Bag = Record<string, unknown>;
const numOf = (bag: Bag | null, camel: string, snake?: string): number | null =>
  finiteNumber(pick(bag?.[camel], bag?.[snake ?? camel]));
const textOf = (bag: Bag | null, camel: string, snake?: string): string | null =>
  text(pick(bag?.[camel], bag?.[snake ?? camel]));
const boolOf = (bag: Bag | null, camel: string, snake?: string): boolean | null =>
  bool(pick(bag?.[camel], bag?.[snake ?? camel]));

/** Read an array under either spelling; `[]` is a real (empty) array. */
const arrayOf = (bag: Bag | null, camel: string, snake?: string): unknown[] =>
  list(pick(bag?.[camel], bag?.[snake ?? camel]));

/** Copy a parallel numeric array element-by-element so nulls keep their slot. */
function numArray(value: unknown): Array<number | null> {
  if (!Array.isArray(value)) return [];
  return value.map(finiteNumber);
}

function normalizeIvPoint(raw: unknown): IvPoint | null {
  const row = obj(raw);
  const strike = numOf(row, "strike");
  if (strike == null || !(strike > 0)) return null;
  return {
    strike,
    moneyness: numOf(row, "moneyness"),
    iv: numOf(row, "iv"),
    delta: numOf(row, "delta"),
    oi: numOf(row, "oi"),
  };
}

function normalizeIvRows(raw: unknown, spot: number | null): IvPoint[] {
  const points: IvPoint[] = [];
  for (const item of list(raw)) {
    const row = obj(item);
    if (!row) continue;
    // Backend CE/PE rows expand to two points; a legacy point stays one.
    const backendRow =
      "ceIv" in row || "peIv" in row || "ceDelta" in row ||
      "peDelta" in row || "ceOi" in row || "peOi" in row;
    if (backendRow) {
      for (const side of ["CE", "PE"] as const) {
        const call = side === "CE";
        const strike = numOf(row, "strike");
        if (strike == null || !(strike > 0)) continue;
        const rawIv = call ? row.ceIv : row.peIv;
        const rawDelta = call ? row.ceDelta : row.peDelta;
        const rawOi = call ? row.ceOi : row.peOi;
        points.push({
          strike,
          moneyness: spot != null && spot > 0 && strike > 0
            ? Math.log(strike / spot)
            : null,
          iv: finiteNumber(rawIv),
          delta: finiteNumber(rawDelta),
          oi: finiteNumber(rawOi),
        });
      }
    } else {
      const point = normalizeIvPoint(item);
      if (point) points.push(point);
    }
  }
  return points.sort((a, b) => a.strike - b.strike);
}

function normalizeTermPoint(raw: unknown): TermPoint | null {
  const row = obj(raw);
  if (!row) return null;
  return {
    dte: numOf(row, "dte", "dteDays"),
    atmIv: numOf(row, "atmIv", "atm_iv"),
    rr25: numOf(row, "rr25"),
    bf25: numOf(row, "bf25", "fly25"),
  };
}

function normalizeSurface(raw: unknown): Surface {
  const source = obj(raw) ?? {};
  const matrix = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  return {
    strikes: list(source.strikes).map(finiteNumber).filter((n): n is number => n != null),
    expiries: list(source.expiries).filter(
      (d): d is string => typeof d === "string" && DATE_RE.test(d),
    ),
    iv: matrix(source.iv).map((row) => matrix(row).map(finiteNumber)),
    missing: matrix(source.missing).map((row) => matrix(row).map(Boolean)),
  };
}

function levelDetail(raw: unknown): LevelDetail | null {
  if (raw == null) return null;
  const row = obj(raw);
  return {
    strike: numOf(row, "strike"),
    side: textOf(row, "side"),
    strength: numOf(row, "strength"),
  };
}

function levelStrike(raw: unknown): number | null {
  const row = obj(raw);
  return row ? numOf(row, "strike") : finiteNumber(raw);
}

function normalizeLevels(raw: unknown): Levels {
  const source = obj(raw) ?? {};
  const gex = obj(source.gex);
  const detail = (camel: string, snake: string): LevelDetail | null =>
    levelDetail(pick(source[camel], source[snake]));
  return {
    callWall: levelStrike(pick(source.callWall, source.call_wall)),
    putWall: levelStrike(pick(source.putWall, source.put_wall)),
    maxPain: levelStrike(pick(source.maxPain, source.max_pain)),
    gex: {
      support: levelStrike(gex?.support),
      resistance: levelStrike(gex?.resistance),
      fuelUp: levelStrike(pick(gex?.fuelUp, gex?.fuel_up)),
      fuelDown: levelStrike(pick(gex?.fuelDown, gex?.fuel_down)),
    },
    details: {
      callWall: detail("callWall", "call_wall"),
      putWall: detail("putWall", "put_wall"),
      maxPain: detail("maxPain", "max_pain"),
      gex: {
        support: levelDetail(gex?.support),
        resistance: levelDetail(gex?.resistance),
        fuelUp: levelDetail(pick(gex?.fuelUp, gex?.fuel_up)),
        fuelDown: levelDetail(pick(gex?.fuelDown, gex?.fuel_down)),
      },
    },
  };
}

function normalizeQuantiles(raw: unknown): Quantiles {
  const source = obj(raw) ?? {};
  return {
    p05: numOf(source, "p05"),
    p25: numOf(source, "p25"),
    p50: numOf(source, "p50"),
    p75: numOf(source, "p75"),
    p95: numOf(source, "p95"),
  };
}

function normalizeDensityPoint(raw: unknown): DensityPoint | null {
  const row = obj(raw);
  if (!row) return null;
  return { spot: numOf(row, "spot"), prob: numOf(row, "prob") };
}

function normalizeConePoint(raw: unknown): ConePoint | null {
  const row = obj(raw);
  if (!row) return null;
  return { dte: numOf(row, "dte", "dteDays"), ...normalizeQuantiles(row) };
}

function normalizeProbability(raw: unknown): Probability {
  const source = obj(raw) ?? {};
  return {
    model: textOf(source, "model"),
    flatPop: numOf(source, "flatPop", "flat_pop"),
    skewPop: numOf(source, "skewPop", "skew_pop"),
    expectedPnl: numOf(source, "expectedPnl", "expected_pnl"),
    sigma: numOf(source, "sigma"),
    density: list(source.density)
      .map(normalizeDensityPoint)
      .filter((point): point is DensityPoint => point != null),
    quantiles: normalizeQuantiles(source.quantiles),
    cone: list(source.cone)
      .map(normalizeConePoint)
      .filter((point): point is ConePoint => point != null),
  };
}

const WARNING_MESSAGES: Record<string, string> = {
  quotes_not_live: "Quotes are not live — values may be stale",
  iv_coverage_below_60pct: "IV coverage below 60% — smile metrics degraded",
  gex_degraded: "GEX levels degraded — greeks unavailable",
  thin_chain: "Thin chain — few strikes or low open interest",
  missing_greeks: "Some legs are missing greeks",
};

function normalizeWarning(raw: unknown): Warning | null {
  if (typeof raw === "string") {
    const code = raw.trim();
    if (!code) return null;
    return { code: code in WARNING_MESSAGES ? code : null, message: WARNING_MESSAGES[code] ?? code };
  }
  const row = obj(raw);
  if (!row) return null;
  const message = textOf(row, "message", "detail");
  if (!message) return null;
  return { code: textOf(row, "code"), message };
}

function normalizePositioningStrike(raw: unknown): PositioningStrike | null {
  const row = obj(raw);
  if (!row) return null;
  return {
    strike: numOf(row, "strike"),
    netDelta: numOf(row, "netDelta", "net_delta"),
    oiChange: numOf(row, "oiChange", "oi_change"),
  };
}

function normalizeMaxPainPoint(raw: unknown): MaxPainPoint | null {
  const row = obj(raw);
  if (!row) return null;
  const strike = numOf(row, "strike");
  if (strike == null) return null;
  return { strike, payout: numOf(row, "payout") };
}

function normalizePositioning(raw: unknown): Positioning {
  const source = obj(raw) ?? {};
  const walls = obj(source.walls);
  const totals = obj(source.totals);
  const detail = (value: unknown): LevelDetail | null => levelDetail(value);
  return {
    netDealerDelta: numOf(source, "netDealerDelta", "net_dealer_delta"),
    netClientDelta: numOf(source, "netClientDelta", "net_client_delta"),
    callWriterOi: numOf(source, "callWriterOi", "call_writer_oi"),
    putWriterOi: numOf(source, "putWriterOi", "put_writer_oi"),
    // The backend headline PCR is `pcr`; fixtures use `pcrOi`/`pcr_oi`.
    pcrOi: finiteNumber(pick(source.pcrOi, source.pcr_oi, source.pcr)),
    pcrVolume: numOf(source, "pcrVolume", "pcr_volume"),
    initiativeRatio: numOf(source, "initiativeRatio", "initiative_ratio"),
    topStrikes: arrayOf(source, "topStrikes", "top_strikes")
      .map(normalizePositioningStrike)
      .filter((item): item is PositioningStrike => item != null),
    strikes: numArray(arrayOf(source, "strikes")).filter(
      (n): n is number => n != null,
    ),
    ceOi: numArray(arrayOf(source, "ceOi", "ce_oi")),
    peOi: numArray(arrayOf(source, "peOi", "pe_oi")),
    ceOiChange: numArray(arrayOf(source, "ceOiChange", "ce_oi_change")),
    peOiChange: numArray(arrayOf(source, "peOiChange", "pe_oi_change")),
    ceVolume: numArray(arrayOf(source, "ceVolume", "ce_volume")),
    peVolume: numArray(arrayOf(source, "peVolume", "pe_volume")),
    pcrByStrike: numArray(arrayOf(source, "pcrByStrike", "pcr_by_strike")),
    pcrVolumeByStrike: numArray(arrayOf(source, "pcrVolumeByStrike", "pcr_volume_by_strike")),
    maxPainCurve: arrayOf(source, "maxPainCurve", "max_pain_curve")
      .map(normalizeMaxPainPoint)
      .filter((item): item is MaxPainPoint => item != null),
    maxPain: numOf(source, "maxPain", "max_pain"),
    walls: walls
      ? {
          callWall: detail(pick(walls.callWall, walls.call_wall)),
          putWall: detail(pick(walls.putWall, walls.put_wall)),
        }
      : null,
    totals: totals
      ? {
          ceOi: numOf(totals, "ceOi", "ce_oi"),
          peOi: numOf(totals, "peOi", "pe_oi"),
          ceVolume: numOf(totals, "ceVolume", "ce_volume"),
          peVolume: numOf(totals, "peVolume", "pe_volume"),
        }
      : null,
    warnings: arrayOf(source, "warnings").map((w) => text(w)).filter(
      (w): w is string => w != null,
    ),
  };
}

function normalizeDealerStrike(raw: unknown): DealerStrike | null {
  const row = obj(raw);
  if (!row) return null;
  const strike = numOf(row, "strike");
  if (strike == null) return null;
  return {
    strike,
    netGex: numOf(row, "netGex", "net_gex"),
    netDex: numOf(row, "netDex", "net_dex"),
    vanna: numOf(row, "vanna"),
    charm: numOf(row, "charm"),
    theta: numOf(row, "theta"),
    ceOi: numOf(row, "ceOi", "ce_oi"),
    peOi: numOf(row, "peOi", "pe_oi"),
    ceIv: numOf(row, "ceIv", "ce_iv"),
    peIv: numOf(row, "peIv", "pe_iv"),
  };
}

function normalizeDealer(raw: unknown): Dealer {
  const source = obj(raw) ?? {};
  const rawFlip = pick(source.gammaFlip, source.gamma_flip);
  const flip = obj(rawFlip);
  return {
    netGex: numOf(source, "netGex", "net_gex"),
    gammaFlip: finiteNumber(flip ? pick(flip.level, flip.strike) : rawFlip),
    regime: textOf(source, "regime") ?? textOf(flip, "regime"),
    support: numOf(source, "support"),
    resistance: numOf(source, "resistance"),
    fuelUp: numOf(source, "fuelUp", "fuel_up"),
    fuelDown: numOf(source, "fuelDown", "fuel_down"),
    degraded: boolOf(source, "degraded"),
    netDex: numOf(source, "netDex", "net_dex"),
    vanna: numOf(source, "vanna"),
    charm: numOf(source, "charm"),
    theta: numOf(source, "theta"),
    zeroGamma: numOf(source, "zeroGamma", "zero_gamma"),
    gammaFlipRegime: textOf(flip, "regime"),
    gammaFlipFlipped: boolOf(flip, "flipped"),
    strikes: arrayOf(source, "strikes")
      .map(normalizeDealerStrike)
      .filter((item): item is DealerStrike => item != null),
    thetaByDte: arrayOf(source, "thetaByDte", "theta_by_dte")
      .map((item) => {
        const row = obj(item);
        if (!row) return null;
        return {
          dteDays: finiteNumber(pick(row.dteDays, row.dte_days, row.dte)),
          theta: numOf(row, "theta"),
        };
      })
      .filter((item): item is { dteDays: number | null; theta: number | null } => item != null),
    warnings: arrayOf(source, "warnings").map((w) => text(w)).filter(
      (w): w is string => w != null,
    ),
  };
}

function normalizeLiquidity(raw: unknown): Liquidity {
  const source = obj(raw) ?? {};
  return {
    totalOi: numOf(source, "totalOi", "total_oi"),
    totalVolume: numOf(source, "totalVolume", "total_volume"),
    avgSpreadPct: finiteNumber(pick(source.avgSpreadPct, source.avg_spread_pct, source.medianSpreadPct, source.median_spread_pct)),
    liquidStrikes: numOf(source, "liquidStrikes", "liquid_strikes"),
    maxOiStrike: numOf(source, "maxOiStrike", "max_oi_strike"),
    score: numOf(source, "score"),
    thin: boolOf(source, "thin"),
    strikes: numArray(arrayOf(source, "strikes")).filter(
      (n): n is number => n != null,
    ),
    ceSpreadPct: numArray(arrayOf(source, "ceSpreadPct", "ce_spread_pct")),
    peSpreadPct: numArray(arrayOf(source, "peSpreadPct", "pe_spread_pct")),
    ceSpreadAbs: numArray(arrayOf(source, "ceSpreadAbs", "ce_spread_abs")),
    peSpreadAbs: numArray(arrayOf(source, "peSpreadAbs", "pe_spread_abs")),
    ceVolOi: numArray(arrayOf(source, "ceVolOi", "ce_vol_oi")),
    peVolOi: numArray(arrayOf(source, "peVolOi", "pe_vol_oi")),
    medianSpreadPct: numOf(source, "medianSpreadPct", "median_spread_pct"),
    illiquidCount: numOf(source, "illiquidCount", "illiquid_count"),
    warnings: arrayOf(source, "warnings").map((w) => text(w)).filter(
      (w): w is string => w != null,
    ),
  };
}

function normalizeRnd(raw: unknown): Rnd {
  const source = obj(raw) ?? {};
  const strikes = numArray(arrayOf(source, "strikes")).filter(
    (n): n is number => n != null,
  );
  const rawDensity = arrayOf(source, "density");
  // Wire density is a numeric array parallel to `strikes`; fixtures carry
  // (spot, prob) objects. Both keep their length and null slots.
  const asPoints = rawDensity.some((item) => obj(item) != null);
  const density: DensityPoint[] = asPoints
    ? rawDensity
        .map(normalizeDensityPoint)
        .filter((point): point is DensityPoint => point != null)
    : rawDensity.map((value, index) => ({
        spot: strikes[index] ?? null,
        prob: finiteNumber(value),
      }));
  return {
    model: textOf(source, "model"),
    mean: numOf(source, "mean"),
    stdDev: numOf(source, "stdDev", "std_dev"),
    skew: numOf(source, "skew"),
    kurtosis: numOf(source, "kurtosis"),
    expectedMove: numOf(source, "expectedMove", "expected_move"),
    density,
    quantiles: normalizeQuantiles(source.quantiles),
    strikes,
    cdf: numArray(arrayOf(source, "cdf")),
    forward: numOf(source, "forward"),
    warnings: arrayOf(source, "warnings").map((w) => text(w)).filter(
      (w): w is string => w != null,
    ),
  };
}

function normalizeRvTenor(raw: unknown): RvTenor | null {
  const row = obj(raw);
  if (!row) return null;
  return {
    days: finiteNumber(pick(row.days, row.dte, row.dteDays)),
    current: numOf(row, "current"),
    p10: numOf(row, "p10"),
    p25: numOf(row, "p25"),
    p50: numOf(row, "p50"),
    p75: numOf(row, "p75"),
    p90: numOf(row, "p90"),
    rankPct: numOf(row, "rankPct", "rank_pct"),
  };
}

function normalizeRvCone(raw: unknown): RvCone {
  const source = obj(raw) ?? {};
  return {
    symbol: textOf(source, "symbol"),
    asOf: textOf(source, "asOf", "as_of"),
    tenors: arrayOf(source, "tenors")
      .map(normalizeRvTenor)
      .filter((item): item is RvTenor => item != null),
    warnings: arrayOf(source, "warnings").map((w) => text(w)).filter(
      (w): w is string => w != null,
    ),
  };
}

function normalizeIvVsRvRow(raw: unknown): IvVsRvRow | null {
  const row = obj(raw);
  if (!row) return null;
  return {
    date: textOf(row, "date"),
    dte: numOf(row, "dte", "dteDays"),
    atmIv: numOf(row, "atmIv", "atm_iv"),
    tenorDays: numOf(row, "tenorDays", "tenor_days"),
    rvP50: numOf(row, "rvP50", "rv_p50"),
    ivMinusRv: numOf(row, "ivMinusRv", "iv_minus_rv"),
    ivRankInCone: numOf(row, "ivRankInCone", "iv_rank_in_cone"),
  };
}

function normalizeIvVsRv(raw: unknown): IvVsRv {
  const source = obj(raw) ?? {};
  return {
    rows: arrayOf(source, "rows")
      .map(normalizeIvVsRvRow)
      .filter((item): item is IvVsRvRow => item != null),
    warnings: arrayOf(source, "warnings").map((w) => text(w)).filter(
      (w): w is string => w != null,
    ),
  };
}

function normalizeRv(raw: unknown): RealizedVolatility {
  const source = obj(raw) ?? {};
  const cone = normalizeRvCone(source.cone);
  return {
    current: numOf(source, "current", "rv"),
    rv5: numOf(source, "rv5", "rv_5"),
    rv10: numOf(source, "rv10", "rv_10"),
    rv20: numOf(source, "rv20", "rv_20"),
    rv30: numOf(source, "rv30", "rv_30"),
    source: textOf(source, "source"),
    cone,
    ivVsRv: normalizeIvVsRv(source.ivVsRv),
  };
}

function normalizeExpiry(raw: unknown, topSpot: number | null): DashboardExpiry | null {
  const row = obj(raw);
  const date = textOf(row, "date");
  if (!row || !date || !DATE_RE.test(date)) return null;

  const metrics = obj(row.metrics);
  const spot = numOf(row, "spot") ?? topSpot;
  const rows = [...list(row.iv), ...list(row.points)];
  return {
    date,
    dte: finiteNumber(pick(row.dteDays, row.dte)),
    spot,
    atmIv: numOf(row, "atmIv", "atm_iv"),
    rr25: numOf(metrics, "rr25"),
    bf25: finiteNumber(pick(metrics?.fly25, row.bf25)),
    slope: numOf(metrics, "slope"),
    fitR2: finiteNumber(pick(metrics?.r2, row.fitR2, row.fit_r2)),
    n: numOf(metrics, "n"),
    points: normalizeIvRows(rows, spot),
    levels: normalizeLevels(row.levels),
    positioning: normalizePositioning(row.positioning),
    dealer: normalizeDealer(row.dealer),
    liquidity: normalizeLiquidity(row.liquidity),
    rnd: normalizeRnd(row.rnd),
  };
}

/** A representative scalar for a CE/PE pair without inventing a value. */
function combine(a: number | null, b: number | null): number | null {
  if (a != null && b != null) return (a + b) / 2;
  return a ?? b;
}

function strikePairs(
  strikes: number[],
  ce: Array<number | null>,
  pe: Array<number | null>,
): PanelStrikePair[] {
  return strikes.map((strike, index) => ({
    strike,
    ce: ce[index] ?? null,
    pe: pe[index] ?? null,
  }));
}

/**
 * The panel's RV cone reads `{ dte, value }` points. The live API carries them
 * as `rv.cone.tenors[]` (`days` / `current`); older cached payloads use the
 * `rv5`…`rv30` scalars. A cone with no readable current value stays empty so
 * the panel reports "RV unavailable" instead of plotting a fabricated series.
 */
function rvTerm(rv: RealizedVolatility): PanelTenorValue[] {
  const fromCone: PanelTenorValue[] = rv.cone.tenors
    .filter((tenor) => tenor.days != null && tenor.current != null)
    .map((tenor) => ({ dte: tenor.days as number, value: tenor.current as number }))
    .sort((a, b) => a.dte - b.dte);
  if (fromCone.length) return fromCone;

  return ([
    [5, rv.rv5],
    [10, rv.rv10],
    [20, rv.rv20],
    [30, rv.rv30],
  ] as Array<[number, number | null]>)
    .filter((row): row is [number, number] => row[1] != null)
    .map(([dte, value]) => ({ dte, value }));
}

/**
 * Project the raw per-expiry arrays into the shapes the pillar panels read.
 * Per-strike profiles come from the front expiry (the default selection); the
 * spread heatmap spans every expiry. Missing profiles stay empty — a panel
 * shows its "feed unavailable" reason rather than a fabricated zero series.
 */
function panelProjection(
  expiries: DashboardExpiry[],
  rv: RealizedVolatility,
): {
  positioning: PanelPositioningBlock;
  dealer: PanelDealerBlock;
  liquidity: PanelLiquidityBlock;
  realisedVol: PanelTenorValue[];
} {
  const front = expiries[0];
  const pos = front?.positioning;
  const dealer = front?.dealer;
  const liq = front?.liquidity;

  const positioning: PanelPositioningBlock = {
    deltaOi: pos ? strikePairs(pos.strikes, pos.ceOiChange, pos.peOiChange) : [],
    volume: pos ? strikePairs(pos.strikes, pos.ceVolume, pos.peVolume) : [],
  };

  const dealerBlock: PanelDealerBlock = {
    gex: dealer ? dealer.strikes.map((row) => ({ strike: row.strike, value: row.netGex })) : [],
    dex: dealer ? dealer.strikes.map((row) => ({ strike: row.strike, value: row.netDex })) : [],
    vanna: dealer ? dealer.strikes.map((row) => ({ strike: row.strike, value: row.vanna })) : [],
    charm: dealer ? dealer.strikes.map((row) => ({ strike: row.strike, value: row.charm })) : [],
    theta: dealer
      ? dealer.thetaByDte
          .filter((row) => row.dteDays != null)
          .map((row) => ({ dte: row.dteDays as number, value: row.theta }))
      : [],
  };

  const spread: PanelSpreadCell[] = expiries.flatMap((expiry) => {
    const block = expiry.liquidity;
    return block.strikes.map((strike, index) => ({
      strike,
      expiry: expiry.date,
      spread: combine(block.ceSpreadPct[index] ?? null, block.peSpreadPct[index] ?? null),
    }));
  });
  const liquidity: PanelLiquidityBlock = {
    spread,
    volumeOi: liq
      ? liq.strikes.map((strike, index) => ({
          strike,
          value: combine(liq.ceVolOi[index] ?? null, liq.peVolOi[index] ?? null),
        }))
      : [],
  };

  const realisedVol = rvTerm(rv);

  return { positioning, dealer: dealerBlock, liquidity, realisedVol };
}

/** Wire → DTO. Tolerates camelCase and snake_case; never invents numbers. */
export function normalizeDashboard(raw: unknown): OptionsDashboardData {
  const source = obj(raw) ?? {};
  const spot = numOf(source, "spot");
  const rawExpiries = list(source.expiries);
  const expiries = rawExpiries
    .map((expiry) => normalizeExpiry(expiry, spot))
    .filter((expiry): expiry is DashboardExpiry => expiry != null)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Levels live on the front expiry in the wire payload; the top level is a
  // convenience mirror used by some cached fixtures.
  const rawLevels = pick(source.levels, obj(rawExpiries[0])?.levels);

  const rv = normalizeRv(source.rv);

  return {
    symbol: text(pick(source.symbol, source.underlying))?.trim().toUpperCase() ?? "",
    spot,
    asOf: textOf(source, "asOf", "as_of"),
    quotesLive: boolOf(source, "quotesLive", "quotes_live") === true,
    marketState: textOf(source, "marketState", "market_state"),
    sessionDate: textOf(source, "sessionDate", "session_date"),
    expiries,
    term: list(source.term)
      .map(normalizeTermPoint)
      .filter((point): point is TermPoint => point != null),
    surface: normalizeSurface(source.surface),
    levels: normalizeLevels(rawLevels),
    probability: normalizeProbability(source.probability),
    rv,
    warnings: list(source.warnings)
      .map(normalizeWarning)
      .filter((warning): warning is Warning => warning != null),
    ...panelProjection(expiries, rv),
  };
}

/**
 * Fetch the dashboard payload for one symbol. An aborted request resolves to
 * `null`; transport/HTTP failures throw a typed `OptionDockError`.
 */
export async function fetchDashboard(
  symbol: string,
  signal?: AbortSignal,
): Promise<OptionsDashboardData | null> {
  const upper = String(symbol ?? "").trim().toUpperCase();
  if (!upper) return null;

  const body = await requestJson<unknown>(
    `${DASHBOARD_BASE}/analytics/${encodeURIComponent(upper)}?expiries=${ANALYTICS_MAX_EXPIRIES}`,
    signal,
    "Could not load the options analytics",
  );
  if (!body || signal?.aborted) return null;
  return normalizeDashboard(body);
}
