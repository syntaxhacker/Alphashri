// vwap-orb — first ReplayStrategyPlugin. Ports the original /poc/tick-replay page:
// 1m NQ=F candles + live-forming subs, opening-range breakout above/below VWAP.
import { orRangeLabel } from "@/utils/replayTime";
import { TZ_IST_LABEL } from "@/config/constants";
import type { ReplayStrategyPlugin } from "../core/plugin";

const DATES = ["2026-09-02", "2026-08-26", "2026-07-24", "2026-08-27", "2026-07-22", "2026-07-02"];

const vwapOrb: ReplayStrategyPlugin = {
  id: "vwap-orb",
  label: "VWAP + ORB",
  mode: "timeline",
  endpoint: "/api/poc/replay/vwap-orb",
  dates: DATES,
  params: [
    { name: "secs", label: "Sub secs", type: "int", default: 2, min: 1, max: 60, step: 1, description: "sub-candle seconds for the forming bar" },
    { name: "orb", label: "OR TF", type: "int", default: 15, options: ["5m", "15m", "30m"], description: "opening-range window" },
    { name: "hist", label: "Hist bars", type: "int", default: 8, min: 0, max: 48, step: 1, description: "overnight history hours for structure" },
  ],
  normalize: (json) => ({
    bars: json.candles ?? [],
    trades: json.trades ?? [],
    basis: json.basis,
    error: json.error,
  }),
  timeline: (json) => ({
    candles: json.candles ?? [],
    subs: json.subs ?? [],
    vwap: json.vwap ?? [],
    levels: {
      or_high: json.or_high ?? 0,
      or_low: json.or_low ?? 0,
      or_end: json.or_end ?? 0,
    },
  }),
  summary: (bundle, json) => {
    const secs = json?.sub_secs ?? 2;
    const hist = json?.hist_bars;
    const orMin = json?.or_minutes ?? 15;
    const first = bundle?.bars?.[0]?.time;
    return `1m NQ=F candles, forming bar ticks live from ${secs}s subs${bundle?.basis != null ? ` · basis +${bundle.basis.toFixed(1)}` : ""}${hist ? ` · +${hist} overnight bars` : ""} · OR ${orMin}m${first ? ` (${orRangeLabel(first, orMin)})` : ""} · LONG above OR-H + VWAP / SHORT below OR-L + VWAP · SL opposite edge, TP nearest structure · ${TZ_IST_LABEL}`;
  },
};

export default vwapOrb;
