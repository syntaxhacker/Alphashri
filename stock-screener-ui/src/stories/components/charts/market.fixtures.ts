import type { MarketRow } from "@/types/marketScreener";
import type { CurrencyCode } from "@/config/currency";

/** Frozen session label shared by every viz story — no feed, no clock. */
export const SNAPSHOT_LABEL = "frozen NSE snapshot · 2026-11-20 15:30 IST";

/**
 * One NSE row with the full technical frame the Vis renderers read. Derived
 * range fields are computed from high/low so the 52W view sees honest values;
 * an explicit override still wins.
 */
function nse(
  symbol: string,
  name: string,
  sector: string,
  close: number,
  change: number,
  overrides: Partial<MarketRow> = {},
): MarketRow {
  const high52w = overrides.high52w ?? null;
  const low52w = overrides.low52w ?? null;
  const hasRange = high52w !== null && low52w !== null && high52w > low52w;
  const range = hasRange ? high52w! - low52w! : 0;
  return {
    symbol,
    name,
    sector,
    exchange: "NSE",
    close,
    change,
    change1m: null,
    change5m: null,
    relativeVolume: 1,
    marketCapCr: 100_000,
    currency: "INR" as CurrencyCode,
    capTier: "large",
    rsi: 50,
    adx: 20,
    sma20: null,
    sma50: null,
    sma200: null,
    perfW: null,
    perf1m: null,
    high52w,
    low52w,
    pos52w: hasRange ? ((close - low52w!) / range) * 100 : null,
    peRatio: null,
    pbRatio: null,
    dividendYield: null,
    roe: null,
    psRatio: null,
    fcfYield: null,
    revenue: null,
    netIncome: null,
    debtToEquity: null,
    currentRatio: null,
    grossMargin: null,
    operatingMargin: null,
    revYoy: null,
    epsYoy: null,
    fno: false,
    etf: false,
    volume: null,
    avgVolume: null,
    gap: null,
    atr: null,
    high: null,
    low: null,
    valueTraded: null,
    to52wHighPct: high52w !== null ? ((close - high52w) / high52w) * 100 : null,
    from52wLowPct: low52w !== null ? ((close - low52w) / low52w) * 100 : null,
    rangeVsAtr: null,
    ...overrides,
  };
}

/** Large, liquid NSE names across the sectors the Vis renderer aggregates. */
export const MARKET_ROWS: MarketRow[] = [
  nse("RELIANCE", "Reliance Industries", "Energy Minerals", 1428.6, 1.24, {
    relativeVolume: 2.4, marketCapCr: 1_934_000, rsi: 62.4, adx: 28.6,
    sma20: 1392.4, sma50: 1360.8, sma200: 1275.6,
    high52w: 1520.0, low52w: 1120.5, perfW: 2.8, perf1m: 6.4,
    volume: 18_420_000, valueTraded: 26_320_000_000, peRatio: 24.8, roe: 9.6,
  }),
  nse("HDFCBANK", "HDFC Bank", "Finance", 1682.35, 0.42, {
    relativeVolume: 1.3, marketCapCr: 1_284_000, rsi: 55.8, adx: 19.2,
    sma20: 1668.2, sma50: 1642.6, sma200: 1588.4,
    high52w: 1742.0, low52w: 1480.2, perfW: 1.1, perf1m: 3.2,
    volume: 9_640_000, valueTraded: 16_210_000_000, peRatio: 18.6, roe: 16.2,
  }),
  nse("TCS", "Tata Consultancy Services", "Electronic Technology", 4128.7, -0.86, {
    relativeVolume: 0.9, marketCapCr: 1_502_000, rsi: 48.6, adx: 22.4,
    sma20: 4164.5, sma50: 4210.8, sma200: 3988.2,
    high52w: 4560.0, low52w: 3450.0, perfW: -1.8, perf1m: -3.4,
    volume: 2_180_000, valueTraded: 9_020_000_000, peRatio: 22.4, roe: 28.6,
  }),
  nse("ICICIBANK", "ICICI Bank", "Finance", 1345.8, 1.86, {
    relativeVolume: 3.1, marketCapCr: 958_000, rsi: 68.2, adx: 31.5,
    sma20: 1318.4, sma50: 1286.2, sma200: 1184.6,
    high52w: 1362.0, low52w: 1012.4, perfW: 3.6, perf1m: 8.2,
    volume: 22_460_000, valueTraded: 30_180_000_000, peRatio: 16.8, roe: 18.4,
  }),
  nse("INFY", "Infosys", "Electronic Technology", 1876.25, -1.12, {
    relativeVolume: 1.8, marketCapCr: 778_000, rsi: 43.2, adx: 26.8,
    sma20: 1902.6, sma50: 1936.4, sma200: 1768.2,
    high52w: 2120.0, low52w: 1618.6, perfW: -2.4, perf1m: -5.6,
    volume: 6_840_000, valueTraded: 12_860_000_000, peRatio: 20.2, roe: 27.8,
  }),
  nse("BHARTIARTL", "Bharti Airtel", "Communications", 1724.5, 2.34, {
    relativeVolume: 4.2, marketCapCr: 1_036_000, rsi: 71.6, adx: 34.2,
    sma20: 1682.8, sma50: 1642.0, sma200: 1478.4,
    high52w: 1738.0, low52w: 1186.0, perfW: 4.2, perf1m: 9.8,
    volume: 14_260_000, valueTraded: 24_540_000_000, peRatio: 32.6, roe: 12.4,
  }),
  nse("SBIN", "State Bank of India", "Finance", 842.15, 0.68, {
    relativeVolume: 1.6, marketCapCr: 752_000, rsi: 58.4, adx: 24.6,
    sma20: 828.6, sma50: 812.4, sma200: 764.2,
    high52w: 920.0, low52w: 684.5, perfW: 1.8, perf1m: 4.6,
    volume: 18_920_000, valueTraded: 15_920_000_000, peRatio: 11.2, roe: 14.8,
  }),
  nse("HINDUNILVR", "Hindustan Unilever", "Consumer Non-Durables", 2386.4, -0.34, {
    relativeVolume: 0.8, marketCapCr: 560_000, rsi: 46.8, adx: 16.4,
    sma20: 2412.6, sma50: 2448.2, sma200: 2318.6,
    high52w: 2580.0, low52w: 2142.0, perfW: -0.8, perf1m: -2.2,
    volume: 1_640_000, valueTraded: 3_920_000_000, peRatio: 48.2, roe: 21.6,
  }),
  nse("ITC", "ITC", "Consumer Non-Durables", 428.75, 0.92, {
    relativeVolume: 1.2, marketCapCr: 536_000, rsi: 52.6, adx: 21.8,
    sma20: 424.2, sma50: 418.6, sma200: 402.4,
    high52w: 462.0, low52w: 372.5, perfW: 0.6, perf1m: 2.4,
    volume: 24_860_000, valueTraded: 10_660_000_000, peRatio: 15.4, roe: 24.2,
  }),
  nse("KOTAKBANK", "Kotak Mahindra Bank", "Finance", 1782.3, -0.54, {
    relativeVolume: 1.1, marketCapCr: 354_000, rsi: 49.4, adx: 18.6,
    sma20: 1796.8, sma50: 1812.4, sma200: 1728.6,
    high52w: 1928.0, low52w: 1586.0, perfW: -1.2, perf1m: -2.8,
    volume: 3_420_000, valueTraded: 6_100_000_000, peRatio: 19.8, roe: 15.2,
  }),
  nse("LT", "Larsen & Toubro", "Producer Manufacturing", 3682.9, 1.45, {
    relativeVolume: 2.2, marketCapCr: 506_000, rsi: 64.6, adx: 29.4,
    sma20: 3628.4, sma50: 3586.2, sma200: 3278.0,
    high52w: 3792.0, low52w: 2984.0, perfW: 2.2, perf1m: 5.8,
    volume: 3_860_000, valueTraded: 14_220_000_000, peRatio: 27.4, roe: 13.6,
  }),
  nse("MARUTI", "Maruti Suzuki", "Consumer Durables", 12840.0, -0.28, {
    relativeVolume: 0.7, marketCapCr: 404_000, rsi: 44.2, adx: 17.8,
    sma20: 12986.5, sma50: 13128.0, sma200: 12246.0,
    high52w: 14280.0, low52w: 10520.0, perfW: -1.4, perf1m: -3.8,
    volume: 486_000, valueTraded: 6_240_000_000, peRatio: 25.6, roe: 14.2,
  }),
  nse("ASIANPAINT", "Asian Paints", "Process Industries", 2684.6, -1.64, {
    relativeVolume: 2.6, marketCapCr: 257_000, rsi: 38.6, adx: 27.2,
    sma20: 2742.8, sma50: 2796.4, sma200: 2812.6,
    high52w: 3120.0, low52w: 2520.0, perfW: -3.2, perf1m: -7.4,
    volume: 2_240_000, valueTraded: 6_020_000_000, peRatio: 36.8, roe: 19.4,
  }),
  nse("AXISBANK", "Axis Bank", "Finance", 1236.75, 0.76, {
    relativeVolume: 1.4, marketCapCr: 384_000, rsi: 57.2, adx: 23.4,
    sma20: 1224.6, sma50: 1202.8, sma200: 1128.4,
    high52w: 1298.0, low52w: 964.0, perfW: 1.4, perf1m: 3.8,
    volume: 9_240_000, valueTraded: 11_420_000_000, peRatio: 13.4, roe: 16.8,
  }),
  nse("SUNPHARMA", "Sun Pharmaceutical", "Health Technology", 1824.4, 2.12, {
    relativeVolume: 3.6, marketCapCr: 438_000, rsi: 69.8, adx: 32.8,
    sma20: 1788.2, sma50: 1746.4, sma200: 1628.2,
    high52w: 1842.0, low52w: 1382.0, perfW: 3.8, perf1m: 7.2,
    volume: 7_860_000, valueTraded: 14_340_000_000, peRatio: 34.2, roe: 17.6,
  }),
  nse("NTPC", "NTPC", "Utilities", 328.65, 0.44, {
    relativeVolume: 1.0, marketCapCr: 319_000, rsi: 54.6, adx: 20.2,
    sma20: 326.2, sma50: 322.8, sma200: 308.6,
    high52w: 356.0, low52w: 286.4, perfW: 0.8, perf1m: 2.2,
    volume: 16_480_000, valueTraded: 5_420_000_000, peRatio: 14.6, roe: 12.8,
  }),
  nse("TITAN", "Titan Company", "Consumer Durables", 3428.2, -0.98, {
    relativeVolume: 1.5, marketCapCr: 304_000, rsi: 51.2, adx: 22.6,
    sma20: 3452.6, sma50: 3412.8, sma200: 3186.4,
    high52w: 3680.0, low52w: 2920.0, perfW: -0.6, perf1m: 1.8,
    volume: 1_240_000, valueTraded: 4_260_000_000, peRatio: 42.4, roe: 22.8,
  }),
  nse("ULTRACEMCO", "UltraTech Cement", "Non-Energy Minerals", 11428.5, 0.16, {
    relativeVolume: 0.8, marketCapCr: 330_000, rsi: 59.6, adx: 25.8,
    sma20: 11286.0, sma50: 11042.0, sma200: 10284.0,
    high52w: 11860.0, low52w: 8940.0, perfW: 1.6, perf1m: 4.2,
    volume: 286_000, valueTraded: 3_280_000_000, peRatio: 29.8, roe: 11.4,
  }),
];

const bySymbol = (symbols: readonly string[]): MarketRow[] =>
  symbols.map((symbol) => MARKET_ROWS.find((row) => row.symbol === symbol)!);

/** Nested sector → stock fixture: eight sectors with two to four concrete names. */
export const TREEMAP_ROWS = bySymbol([
  "RELIANCE", "ULTRACEMCO", "HDFCBANK", "ICICIBANK", "SBIN", "AXISBANK",
  "TCS", "INFY", "LT", "BHARTIARTL", "ASIANPAINT", "NTPC", "MARUTI",
]);

/** Turnover-heavy winners: every signed-turnover rail points inward. */
export const INFLOW_ROWS = bySymbol([
  "RELIANCE", "ICICIBANK", "BHARTIARTL", "LT", "SBIN", "SUNPHARMA", "ITC", "AXISBANK",
]);

/** Turnover-heavy decliners: every signed-turnover rail points outward. */
export const OUTFLOW_ROWS = bySymbol([
  "TCS", "INFY", "HINDUNILVR", "KOTAKBANK", "ASIANPAINT", "MARUTI", "TITAN",
]);

/** Near-high and deep-drawdown names exercise the 52W proximity filters. */
export const RANGE52_ROWS = bySymbol([
  "ICICIBANK", "BHARTIARTL", "SUNPHARMA", "RELIANCE", "HDFCBANK", "LT",
  "TCS", "INFY", "ASIANPAINT", "MARUTI", "NTPC", "ITC",
]);

/** Highest relative volume first — ASIANPAINT/TITAN carry negative day change. */
export const REL_VOL_ROWS = bySymbol([
  "BHARTIARTL", "SUNPHARMA", "ICICIBANK", "ASIANPAINT", "RELIANCE", "LT",
  "INFY", "SBIN", "TITAN", "AXISBANK", "HDFCBANK", "ITC",
]);

/** RSI 38–72 and ADX 16–34 span the weak/trending/overbought quadrants. */
export const RSI_ADX_ROWS = bySymbol([
  "RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "BHARTIARTL", "SBIN",
  "TCS", "ASIANPAINT", "SUNPHARMA", "NTPC", "MARUTI", "HINDUNILVR",
]);

/** 3/3, 2/3 and below-200 states in one aligned matrix. */
export const TREND_ROWS = bySymbol([
  "RELIANCE", "ICICIBANK", "BHARTIARTL", "LT", "SUNPHARMA", "HDFCBANK",
  "SBIN", "ITC", "NTPC", "AXISBANK", "TITAN", "TCS", "INFY", "MARUTI", "ASIANPAINT",
]);

/** Sector-history matrix: rank 1 is strongest, null is a missing session. */
export const MATRIX_MONTHS = [
  "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
  "2026-07", "2026-08", "2026-09", "2026-10", "2026-11",
] as const;

export const MATRIX_SECTORS = [
  { label: "Finance", ranks: [1, 1, 2, 2, 1, 3, 2, 1, 2, 1, 1] },
  { label: "Information Tech", ranks: [2, 3, 1, 1, 3, 2, 4, 3, 1, 2, 3] },
  { label: "Energy", ranks: [4, 2, 3, 4, 2, 1, 1, 2, 3, 4, 2] },
  { label: "Healthcare", ranks: [3, 4, 5, 3, 4, 5, 3, 5, 4, 3, 4] },
  { label: "Industrials", ranks: [6, 5, 4, 5, 6, 4, 5, 4, 5, 5, 5] },
  { label: "Consumer", ranks: [5, 6, 6, 6, 5, 6, 6, 6, 6, 6, 6] },
  { label: "Materials", ranks: [7, 7, 7, 7, 7, 7, 8, 7, 7, 7, 8] },
  { label: "Utilities", ranks: [8, 8, 8, 8, 8, 8, 7, 8, 8, 8, 7] },
] as const;
