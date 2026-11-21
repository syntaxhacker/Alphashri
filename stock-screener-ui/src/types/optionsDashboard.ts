/**
 * Contract for the full-screen Options Analytics dashboard.
 *
 * The wire payload is `GET /api/options/analytics/{symbol}`. On top of the
 * established volatility blocks (expiries / term / surface / levels / probability)
 * the dashboard adds one block per expiry — positioning, dealer, liquidity, rnd —
 * and a top-level `rv` (realised volatility) term. Every numeric is nullable:
 * a missing greek is unknown, never a fabricated `0`, and every list is empty
 * rather than absent so panels never have to guard for `undefined`.
 *
 * The four engine blocks carry the RAW parallel arrays the backend emits
 * (`strikes`, `netGex`, `ceSpreadPct`, `density`, `cdf`, …). They are never
 * flattened to a single aggregate: a panel needs the whole curve. On top of
 * them the top-level `positioning` / `dealer` / `liquidity` / `realisedVol`
 * fields are the chart-ready (strike, value) projections the panels read.
 */

export type PillarKey = "volatility" | "positioning" | "dealer" | "liquidity";

export interface IvPoint {
  strike: number;
  moneyness: number | null;
  iv: number | null;
  delta: number | null;
  oi: number | null;
}

export interface TermPoint {
  dte: number | null;
  atmIv: number | null;
  rr25: number | null;
  bf25: number | null;
}

export interface Surface {
  strikes: number[];
  expiries: string[];
  /** Nullable cells: a missing strike/expiry intersection is `null`, never `0`. */
  iv: Array<Array<number | null>>;
  missing: boolean[][];
}

export interface LevelDetail {
  strike: number | null;
  side: string | null;
  strength: number | null;
}

export interface Levels {
  callWall: number | null;
  putWall: number | null;
  maxPain: number | null;
  gex: {
    support: number | null;
    resistance: number | null;
    fuelUp: number | null;
    fuelDown: number | null;
  };
  details?: {
    callWall?: LevelDetail | null;
    putWall?: LevelDetail | null;
    maxPain?: LevelDetail | null;
    gex?: {
      support?: LevelDetail | null;
      resistance?: LevelDetail | null;
      fuelUp?: LevelDetail | null;
      fuelDown?: LevelDetail | null;
    } | null;
  };
}

export interface DensityPoint {
  spot: number | null;
  prob: number | null;
}

export interface Quantiles {
  p05: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p95: number | null;
}

export interface ConePoint extends Quantiles {
  dte: number | null;
}

export interface Probability {
  model: string | null;
  flatPop: number | null;
  skewPop: number | null;
  expectedPnl: number | null;
  sigma: number | null;
  density: DensityPoint[];
  quantiles: Quantiles;
  cone: ConePoint[];
}

export interface Warning {
  code: string | null;
  message: string;
}

/** One row of the backend dealer `strikes` profile (all greeks nullable). */
export interface DealerStrike {
  strike: number;
  netGex: number | null;
  netDex: number | null;
  vanna: number | null;
  charm: number | null;
  theta: number | null;
  ceOi: number | null;
  peOi: number | null;
  ceIv: number | null;
  peIv: number | null;
}

/** Max-pain payout curve point from `api/options_positioning`. */
export interface MaxPainPoint {
  strike: number;
  payout: number | null;
}

export interface PositioningTotals {
  ceOi: number | null;
  peOi: number | null;
  ceVolume: number | null;
  peVolume: number | null;
}

/** Delta-weighted "who initiated today" read, per expiry. */
export interface PositioningStrike {
  strike: number | null;
  netDelta: number | null;
  oiChange: number | null;
}

/**
 * Per-expiry positioning. The `topN/total*` fields are the desk summary; the
 * parallel arrays below are the exact engine output and are never zero-filled.
 */
export interface Positioning {
  netDealerDelta: number | null;
  netClientDelta: number | null;
  callWriterOi: number | null;
  putWriterOi: number | null;
  pcrOi: number | null;
  pcrVolume: number | null;
  initiativeRatio: number | null;
  topStrikes: PositioningStrike[];
  /** Raw `api/options_positioning` arrays, parallel to `strikes`. */
  strikes: number[];
  ceOi: Array<number | null>;
  peOi: Array<number | null>;
  ceOiChange: Array<number | null>;
  peOiChange: Array<number | null>;
  ceVolume: Array<number | null>;
  peVolume: Array<number | null>;
  pcrByStrike: Array<number | null>;
  pcrVolumeByStrike: Array<number | null>;
  maxPainCurve: MaxPainPoint[];
  maxPain: number | null;
  walls: { callWall: LevelDetail | null; putWall: LevelDetail | null } | null;
  totals: PositioningTotals | null;
  warnings: string[];
}

/** Net-gamma / dealer-regime read, per expiry. */
export interface Dealer {
  netGex: number | null;
  gammaFlip: number | null;
  regime: string | null;
  support: number | null;
  resistance: number | null;
  fuelUp: number | null;
  fuelDown: number | null;
  degraded: boolean | null;
  /** Raw `api/options_dealer` output. */
  netDex: number | null;
  vanna: number | null;
  charm: number | null;
  theta: number | null;
  zeroGamma: number | null;
  gammaFlipRegime: string | null;
  gammaFlipFlipped: boolean | null;
  strikes: DealerStrike[];
  thetaByDte: Array<{ dteDays: number | null; theta: number | null }>;
  warnings: string[];
}

/** Chain depth / tradability read, per expiry. */
export interface Liquidity {
  totalOi: number | null;
  totalVolume: number | null;
  avgSpreadPct: number | null;
  liquidStrikes: number | null;
  maxOiStrike: number | null;
  score: number | null;
  thin: boolean | null;
  /** Raw `api/options_liquidity` arrays, parallel to `strikes`. */
  strikes: number[];
  ceSpreadPct: Array<number | null>;
  peSpreadPct: Array<number | null>;
  ceSpreadAbs: Array<number | null>;
  peSpreadAbs: Array<number | null>;
  ceVolOi: Array<number | null>;
  peVolOi: Array<number | null>;
  medianSpreadPct: number | null;
  illiquidCount: number | null;
  warnings: string[];
}

/** Risk-neutral distribution derived from the smile, per expiry. */
export interface Rnd {
  model: string | null;
  mean: number | null;
  stdDev: number | null;
  skew: number | null;
  kurtosis: number | null;
  expectedMove: number | null;
  /** (spot, prob) points; numeric wire arrays are zipped with `strikes`. */
  density: DensityPoint[];
  quantiles: Quantiles;
  /** Raw `api/options_rnd` arrays, parallel to `strikes`. */
  strikes: number[];
  cdf: Array<number | null>;
  forward: number | null;
  warnings: string[];
}

export interface DashboardExpiry {
  date: string;
  dte: number | null;
  spot: number | null;
  atmIv: number | null;
  rr25: number | null;
  bf25: number | null;
  slope: number | null;
  fitR2: number | null;
  n: number | null;
  points: IvPoint[];
  levels: Levels;
  positioning: Positioning;
  dealer: Dealer;
  liquidity: Liquidity;
  rnd: Rnd;
}

/** One tenor of the backend `rv.cone.tenors` profile. */
export interface RvTenor {
  days: number | null;
  current: number | null;
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  rankPct: number | null;
}

export interface RvCone {
  symbol: string | null;
  asOf: string | null;
  tenors: RvTenor[];
  warnings: string[];
}

export interface IvVsRvRow {
  date: string | null;
  dte: number | null;
  atmIv: number | null;
  tenorDays: number | null;
  rvP50: number | null;
  ivMinusRv: number | null;
  ivRankInCone: number | null;
}

export interface IvVsRv {
  rows: IvVsRvRow[];
  warnings: string[];
}

/**
 * Realised-volatility term, top level. The scalar `rv5`…`rv30` fields serve
 * legacy cached payloads; the live API sends `cone.tenors` (days/current/p10…
 * p90/rank_pct) and `ivVsRv.rows`. Both are preserved and the cone is projected
 * into the chart-ready `realisedVol` series.
 */
export interface RealizedVolatility {
  current: number | null;
  rv5: number | null;
  rv10: number | null;
  rv20: number | null;
  rv30: number | null;
  source: string | null;
  cone: RvCone;
  ivVsRv: IvVsRv;
}

/* ------------------------------------------------------------------ */
/* Chart-ready projections consumed by the pillar panels               */
/* ------------------------------------------------------------------ */

export interface PanelStrikePair {
  strike: number;
  ce: number | null;
  pe: number | null;
}

export interface PanelStrikeValue {
  strike: number;
  value: number | null;
}

export interface PanelTenorValue {
  dte: number;
  value: number | null;
}

export interface PanelSpreadCell {
  strike: number;
  expiry: string;
  spread: number | null;
}

export interface PanelPositioningBlock {
  deltaOi: PanelStrikePair[];
  volume: PanelStrikePair[];
}

export interface PanelDealerBlock {
  gex: PanelStrikeValue[];
  dex: PanelStrikeValue[];
  vanna: PanelStrikeValue[];
  charm: PanelStrikeValue[];
  theta: PanelTenorValue[];
}

export interface PanelLiquidityBlock {
  spread: PanelSpreadCell[];
  volumeOi: PanelStrikeValue[];
}

export interface OptionsDashboardData {
  symbol: string;
  spot: number | null;
  asOf: string | null;
  quotesLive: boolean;
  marketState: string | null;
  sessionDate: string | null;
  expiries: DashboardExpiry[];
  term: TermPoint[];
  surface: Surface;
  levels: Levels;
  probability: Probability;
  rv: RealizedVolatility;
  warnings: Warning[];
  /** Chart-ready per-strike series the panels read (front expiry by default). */
  positioning: PanelPositioningBlock;
  dealer: PanelDealerBlock;
  liquidity: PanelLiquidityBlock;
  realisedVol: PanelTenorValue[];
}
