// catalog — frozen backend replay strategy ids mapped to review-mode plugin specs.
// Params mirror trading/replay ParamSpecs (name/label/type/default/options) so the
// generic /api/poc/replay/{id} query string round-trips unchanged. Intraday NQ
// engines reuse vwapOrb's sessions; daily NSE engines reuse week52Chaser's month-ends.
import { DATES as INTRADAY_DATES } from "./vwapOrb";
import { DATES as DAILY_DATES } from "./week52Chaser";
import { makeReplayPlugin, type ReplayPluginSpec } from "./factory";
import type { ReplayStrategyPlugin } from "../core/plugin";

export const REPLAY_STRATEGY_SPECS: ReplayPluginSpec[] = [
  {
    id: "orb",
    label: "Opening Range Breakout",
    dates: INTRADAY_DATES,
    daily: false,
    params: [
      { name: "or_minutes", label: "OR minutes", type: "int", default: 45 },
      { name: "sl_pct", label: "SL %", type: "float", default: 1.0 },
      { name: "tp_pct", label: "TP %", type: "float", default: 1.5 },
      { name: "min_or_range_pct", label: "Min OR range %", type: "float", default: 0.5 },
      { name: "max_or_range_pct", label: "Max OR range %", type: "float", default: 3.0 },
      { name: "breakout_buffer_pct", label: "Breakout buffer %", type: "float", default: 0.3 },
      { name: "warmup", label: "Warmup bars", type: "int", default: 5 },
    ],
  },
  {
    id: "sr-breakout",
    label: "Pivot S/R Breakout",
    dates: INTRADAY_DATES,
    daily: false,
    params: [
      { name: "sl_pct", label: "SL %", type: "float", default: 1.5 },
      { name: "tp_pct", label: "TP %", type: "float", default: 2.5 },
      { name: "pivot_type", label: "Pivot type", type: "select", default: "classic", options: ["classic", "camarilla", "fibonacci", "woodie"] },
      { name: "breakout_buffer_pct", label: "Breakout buffer %", type: "float", default: 1.0 },
      { name: "max_distance_from_r1_pct", label: "Max distance from R1 %", type: "float", default: 5.0 },
      { name: "hist", label: "History (h)", type: "int", default: 8, min: 0, max: 24 },
      { name: "warmup", label: "Warmup bars", type: "int", default: 5 },
    ],
  },
  {
    id: "ema-cross",
    label: "EMA 9/21 Crossover",
    dates: INTRADAY_DATES,
    daily: false,
    params: [
      { name: "ema_fast_period", label: "EMA fast period", type: "int", default: 9 },
      { name: "ema_slow_period", label: "EMA slow period", type: "int", default: 21 },
      { name: "sl_pct", label: "SL %", type: "float", default: 1.0 },
      { name: "tp_pct", label: "TP %", type: "float", default: 1.5 },
      { name: "enable_shorts", label: "Enable shorts", type: "bool", default: false },
      { name: "cooldown_bars", label: "Cooldown bars", type: "int", default: 3 },
      { name: "warmup", label: "Warmup bars", type: "int", default: 21 },
    ],
  },
  {
    id: "smc",
    label: "Smart Money Concepts",
    dates: INTRADAY_DATES,
    daily: false,
    params: [
      { name: "sl_pct", label: "SL %", type: "float", default: 1.2 },
      { name: "tp_pct", label: "TP %", type: "float", default: 2.5 },
      { name: "risk_reward", label: "Risk/reward", type: "float", default: 3.0 },
      { name: "swing_lookback", label: "Swing lookback", type: "int", default: 12 },
      { name: "min_rr", label: "Min RR", type: "float", default: 2.2 },
      { name: "warmup", label: "Warmup bars", type: "int", default: 30 },
    ],
  },
  {
    id: "52w-target",
    label: "52W Target",
    dates: DAILY_DATES,
    daily: true,
    params: [
      { name: "symbol", label: "Symbol", type: "text", default: "NETWEB" },
      { name: "lookback_days", label: "Lookback days", type: "int", default: 400 },
      { name: "sl_pct", label: "SL %", type: "float", default: 2.0 },
      { name: "entry_threshold_pct", label: "Entry threshold %", type: "float", default: 2.0 },
      { name: "trailing_stop_pct", label: "Trailing stop %", type: "float", default: 2.0 },
      { name: "max_holding_days", label: "Max holding days", type: "int", default: 15 },
      { name: "cooldown_days", label: "Cooldown days", type: "int", default: 7 },
      { name: "recent_touch_days", label: "Recent touch days", type: "int", default: 5 },
      { name: "warmup", label: "Warmup bars", type: "int", default: 20 },
    ],
  },
  {
    id: "blind-52w",
    label: "Blind 52W",
    dates: DAILY_DATES,
    daily: true,
    params: [
      { name: "symbol", label: "Symbol", type: "text", default: "NETWEB" },
      { name: "lookback_days", label: "Lookback days", type: "int", default: 400 },
      { name: "near_high_threshold_pct", label: "Near-high threshold %", type: "float", default: 3.0 },
      { name: "min_days_since_52w_high", label: "Min days since 52W high", type: "int", default: 20 },
      { name: "max_holding_days", label: "Max holding days", type: "int", default: 30 },
      { name: "sl_pct", label: "SL %", type: "float", default: 5.0 },
      { name: "warmup", label: "Warmup bars", type: "int", default: 20 },
    ],
  },
  {
    id: "short-52w-failed",
    label: "Short Failed 52W Breakout",
    dates: DAILY_DATES,
    daily: true,
    params: [
      { name: "symbol", label: "Symbol", type: "text", default: "NETWEB" },
      { name: "lookback_days", label: "Lookback days", type: "int", default: 400 },
      { name: "sl_pct", label: "SL %", type: "float", default: 3.0 },
      { name: "tp_pct", label: "TP %", type: "float", default: 5.0 },
      { name: "max_holding_days", label: "Max holding days", type: "int", default: 15 },
      { name: "cooldown_days", label: "Cooldown days", type: "int", default: 15 },
      { name: "signal_lookback_days", label: "Signal lookback days", type: "int", default: 5 },
      { name: "warmup", label: "Warmup bars", type: "int", default: 20 },
    ],
  },
  {
    id: "adx-trend",
    label: "ADX/DI Trend",
    dates: DAILY_DATES,
    daily: true,
    params: [
      { name: "symbol", label: "Symbol", type: "text", default: "NETWEB" },
      { name: "lookback_days", label: "Lookback days", type: "int", default: 400 },
      { name: "sl_pct", label: "SL %", type: "float", default: 3.0 },
      { name: "tp_pct", label: "TP %", type: "float", default: 6.0 },
      { name: "adx_threshold", label: "ADX threshold", type: "float", default: 25.0 },
      { name: "max_holding_days", label: "Max holding days", type: "int", default: 20 },
      { name: "cooldown_days", label: "Cooldown days", type: "int", default: 10 },
      { name: "enable_shorts", label: "Enable shorts", type: "bool", default: true },
      { name: "adx_period", label: "ADX period", type: "int", default: 14 },
      { name: "warmup", label: "Warmup bars", type: "int", default: 30 },
    ],
  },
  {
    id: "volume-surge",
    label: "Volume Surge Breakout",
    dates: DAILY_DATES,
    daily: true,
    params: [
      { name: "symbol", label: "Symbol", type: "text", default: "NETWEB" },
      { name: "lookback_days", label: "Lookback days", type: "int", default: 400 },
      { name: "sl_pct", label: "SL %", type: "float", default: 5.0 },
      { name: "tp_pct", label: "TP %", type: "float", default: 8.0 },
      { name: "min_volume_ratio", label: "Min volume ratio", type: "float", default: 2.0 },
      { name: "min_adx", label: "Min ADX", type: "float", default: 20.0 },
      { name: "max_holding_days", label: "Max holding days", type: "int", default: 15 },
      { name: "cooldown_days", label: "Cooldown days", type: "int", default: 10 },
      { name: "enable_shorts", label: "Enable shorts", type: "bool", default: false },
      { name: "warmup", label: "Warmup bars", type: "int", default: 20 },
    ],
  },
  {
    id: "smc-chop",
    label: "SMC Chop (mean reversion)",
    dates: INTRADAY_DATES,
    daily: false,
    params: [
      { name: "lookback", label: "Lookback bars", type: "int", default: 20 },
      { name: "sl_buf", label: "SL buffer", type: "float", default: 4.0 },
      { name: "min_rr", label: "Min RR", type: "float", default: 2.0 },
      { name: "min_risk", label: "Min risk", type: "float", default: 8.0 },
      { name: "max_risk", label: "Max risk", type: "float", default: 30.0 },
      { name: "min_wick", label: "Min wick", type: "float", default: 1.5 },
      { name: "cooldown", label: "Cooldown bars", type: "int", default: 8 },
    ],
  },
];

export const replayCatalog: ReplayStrategyPlugin[] = REPLAY_STRATEGY_SPECS.map(makeReplayPlugin);

export default replayCatalog;
