/**
 * Selectable Market Screener columns beyond the default table.
 *
 * Every entry is fetched in the same TradingView scan (see
 * `api/market_screen/fields.py`) but starts hidden; the column picker can turn
 * any of them on without widening the default screen. Keep the header, field
 * and formatter together so adding a column is one entry, not three edits.
 */
import type { MarketRow } from "../types/marketScreener";

export type MarketExtraFormat = "price" | "pct" | "num" | "ratio" | "volume" | "value";

export interface MarketExtraColumn {
  id: string;
  field: keyof MarketRow;
  header: string;
  size: number;
  format: MarketExtraFormat;
}

export const MARKET_EXTRA_COLUMNS = [
  // Trend / moving averages
  { id: "sma20", field: "sma20", header: "SMA20", size: 62, format: "price" },
  { id: "sma50", field: "sma50", header: "SMA50", size: 62, format: "price" },
  { id: "sma200", field: "sma200", header: "SMA200", size: 66, format: "price" },
  { id: "ema20", field: "ema20", header: "EMA20", size: 62, format: "price" },
  { id: "ema50", field: "ema50", header: "EMA50", size: 62, format: "price" },
  { id: "ema200", field: "ema200", header: "EMA200", size: 66, format: "price" },
  { id: "vwap", field: "vwap", header: "VWAP", size: 62, format: "price" },
  { id: "hull_ma9", field: "hullMa9", header: "HULL9", size: 62, format: "price" },
  { id: "psar", field: "psar", header: "PSAR", size: 62, format: "price" },
  // Momentum / oscillators
  { id: "macd", field: "macd", header: "MACD", size: 58, format: "num" },
  { id: "macd_signal", field: "macdSignal", header: "MACD SIG", size: 70, format: "num" },
  { id: "macd_hist", field: "macdHist", header: "MACD HIST", size: 74, format: "num" },
  { id: "stoch_k", field: "stochK", header: "STOCH K", size: 66, format: "num" },
  { id: "stoch_d", field: "stochD", header: "STOCH D", size: 66, format: "num" },
  { id: "stoch_rsi_k", field: "stochRsiK", header: "ST RSI K", size: 68, format: "num" },
  { id: "stoch_rsi_d", field: "stochRsiD", header: "ST RSI D", size: 68, format: "num" },
  { id: "cci20", field: "cci20", header: "CCI20", size: 58, format: "num" },
  { id: "momentum", field: "momentum", header: "MOM", size: 54, format: "num" },
  { id: "adx_plus", field: "adxPlus", header: "ADX+", size: 54, format: "num" },
  { id: "adx_minus", field: "adxMinus", header: "ADX-", size: 54, format: "num" },
  { id: "recommend_all", field: "recommendAll", header: "REC", size: 50, format: "num" },
  // Bands / volatility
  { id: "bb_upper", field: "bbUpper", header: "BB UP", size: 62, format: "price" },
  { id: "bb_lower", field: "bbLower", header: "BB DN", size: 62, format: "price" },
  { id: "volatility_d", field: "volatilityD", header: "VOL D", size: 60, format: "pct" },
  { id: "volatility_w", field: "volatilityW", header: "VOL W", size: 60, format: "pct" },
  // Returns
  { id: "perf_3m", field: "perf3m", header: "3M %", size: 56, format: "pct" },
  { id: "perf_6m", field: "perf6m", header: "6M %", size: 56, format: "pct" },
  { id: "perf_ytd", field: "perfYtd", header: "YTD %", size: 58, format: "pct" },
  { id: "perf_y", field: "perfY", header: "1Y %", size: 56, format: "pct" },
  // Range / liquidity
  { id: "high", field: "high", header: "HIGH", size: 58, format: "price" },
  { id: "low", field: "low", header: "LOW", size: 58, format: "price" },
  { id: "gap", field: "gap", header: "GAP %", size: 56, format: "pct" },
  { id: "atr", field: "atr", header: "ATR", size: 54, format: "num" },
  { id: "volume", field: "volume", header: "VOL", size: 62, format: "volume" },
  { id: "avgVolume", field: "avgVolume", header: "AVG10", size: 62, format: "volume" },
  { id: "avg_volume_30d", field: "avgVolume30d", header: "AVG30", size: 62, format: "volume" },
  { id: "valueTraded", field: "valueTraded", header: "VALUE", size: 68, format: "value" },
  { id: "to52wHighPct", field: "to52wHighPct", header: "52H %", size: 56, format: "pct" },
  { id: "from52wLowPct", field: "from52wLowPct", header: "52L %", size: 56, format: "pct" },
  { id: "rangeVsAtr", field: "rangeVsAtr", header: "RNG/ATR", size: 66, format: "ratio" },
  // Fundamentals
  { id: "peRatio", field: "peRatio", header: "P/E", size: 52, format: "ratio" },
  { id: "pbRatio", field: "pbRatio", header: "P/B", size: 52, format: "ratio" },
  { id: "psRatio", field: "psRatio", header: "P/S", size: 52, format: "ratio" },
  { id: "dividendYield", field: "dividendYield", header: "DIV %", size: 56, format: "pct" },
  { id: "roe", field: "roe", header: "ROE %", size: 58, format: "pct" },
  { id: "fcfYield", field: "fcfYield", header: "FCF %", size: 56, format: "pct" },
  { id: "debtToEquity", field: "debtToEquity", header: "D/E", size: 52, format: "ratio" },
  { id: "currentRatio", field: "currentRatio", header: "CUR", size: 52, format: "ratio" },
  { id: "grossMargin", field: "grossMargin", header: "GM %", size: 54, format: "pct" },
  { id: "operatingMargin", field: "operatingMargin", header: "OM %", size: 54, format: "pct" },
  { id: "revYoy", field: "revYoy", header: "REV YOY", size: 66, format: "pct" },
  { id: "epsYoy", field: "epsYoy", header: "EPS YOY", size: 66, format: "pct" },
  { id: "revenue", field: "revenue", header: "REV", size: 64, format: "value" },
  { id: "netIncome", field: "netIncome", header: "NET", size: 64, format: "value" },
] as const satisfies readonly MarketExtraColumn[];
