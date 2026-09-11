// week52-chaser — third ReplayStrategyPlugin, first "review" strategy on DAILY bars.
// Runs trading/week52_chaser_signals.py (Week52ChaserSignalGenerator) over NSE daily
// candles: multi-day swing entries on a confirmed breakout above the rolling 52W high,
// exits via SL/TP/trailing/max-holding. Unlike the intraday plugins, each trade spans
// days, so the chart window is widened to ~3 days on either side of the trade.
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import { createElement } from "react";
import { TZ_IST_LABEL } from "@/config/constants";
import type { ReplayTrade } from "../tick";
import type { ReplayStrategyPlugin } from "../core/plugin";

// Month-end trading sessions — recent venues to exercise multi-day swing trades.
export const DATES = ["2026-08-28", "2026-07-31", "2026-06-30", "2026-05-29", "2026-04-30", "2026-03-31"];

const DAY_MIN = 1440;
const DEFAULT_ENTRY =
  "Breakout above the rolling 52W high, filtered to stay within the configured entry band.";

interface Week52TradeMeta {
  entry_reason?: string;
  exit_reason?: string;
}

const week52Chaser: ReplayStrategyPlugin = {
  id: "week52-chaser",
  label: "52W High Chaser",
  subtitle: "trading/week52_chaser_signals.py · NSE daily bars · multi-day swing",
  mode: "timeline",
  runMode: "manual",
  endpoint: "/api/poc/replay/week52-chaser",
  dates: DATES,
  params: [
    { name: "symbol", label: "Symbol", type: "symbol", default: "NETWEB" },
    { name: "lookback_days", label: "Lookback days", type: "int", default: 400, min: 60, max: 1000, step: 10 },
    { name: "sl_pct", label: "SL %", type: "float", default: 2.0, min: 0, step: 0.1 },
    { name: "tp_pct", label: "TP %", type: "float", default: 3.0, min: 0, step: 0.1 },
    { name: "entry_threshold_pct", label: "Max entry % above high", type: "float", default: 3.0, min: 0, step: 0.1 },
    { name: "min_breakout_pct", label: "Min breakout %", type: "float", default: 0.5, min: 0, step: 0.1 },
    { name: "max_holding_days", label: "Max holding days", type: "int", default: 30, min: 1, step: 1 },
    { name: "enable_trailing_stop", label: "Trailing stop", type: "bool", default: false },
    { name: "trailing_stop_pct", label: "Trailing %", type: "float", default: 2.0, min: 0, step: 0.1 },
  ],
  normalize: (json) => ({
    bars: json?.bars ?? [],
    trades: json?.trades ?? [],
    error: json?.error,
  }),
  timeline: (json) => ({
    candles: json?.bars ?? [],
    subs: [],
    vwap: [],
    levels: { or_high: 0, or_low: 0, or_end: 0 },
    barSeconds: 86400,
  }),
  card: {
    explainer: (trade: ReplayTrade) => {
      const meta = (trade.meta ?? {}) as Week52TradeMeta;
      const entry = meta.entry_reason || DEFAULT_ENTRY;
      return meta.exit_reason ? `${entry} · Exit: ${meta.exit_reason}` : entry;
    },
    fitPaddingBeforeMin: 3 * DAY_MIN,
    fitPaddingAfterMin: 3 * DAY_MIN,
  },
  panel: (bundle) => {
    const trades = bundle.trades;
    const net = trades.reduce((a, t) => a + t.pnl, 0);
    const wins = trades.filter(t => t.pnl > 0).length;
    return createElement(
      Stack,
      { direction: "row", spacing: 1, sx: { mb: 1, flexWrap: "wrap" } },
      createElement(Chip, { size: "small", label: `${trades.length} trades`, sx: { bgcolor: "#1F2937", color: "#00FF00" } }),
      createElement(Chip, { size: "small", label: `win ${wins}/${trades.length}`, sx: { bgcolor: "#1F2937", color: "#9CA3AF" } }),
      createElement(Chip, { size: "small", label: `net ${net > 0 ? "+" : ""}${net.toFixed(1)} pts`, color: net > 0 ? "success" : "error" }),
    );
  },
  summary: (bundle) =>
    `daily NSE bars · breakout of rolling 52W high · SL/TP or trailing/max-holding exit · ${bundle.trades.length} trades · ${TZ_IST_LABEL}`,
};

export default week52Chaser;
