// smc-ifvg — second ReplayStrategyPlugin. Ports the /poc/smc-trades page:
// SMC iFVG engine on real NQ ticks, merging the `inv` + `retest` entry feeds.
import { createElement } from "react";
import { TZ_IST_LABEL } from "@/config/constants";
import * as palette from "@/ui/palette";
import { Stack, Chip } from "@/ui";
import { tradeStatChips } from "./shared";
import { stackColor, type ReplayTrade, type TradeStack } from "../tick";
import type { ReplayStrategyPlugin } from "../core/plugin";

// Real trades from /api/poc/smc-ifvg — SMCIFVGEngine (trading/smc_ifvg.py) run bar-by-bar
// on Dukascopy ticks: history-only signals, tick-accurate fills (ask/bid), SL-first exits.
const DUKA_DATES = ["2026-09-02", "2026-08-26", "2026-07-24", "2026-07-22", "2026-07-10", "2026-07-02"];
const WINDOW = { from: "14:10", to: "19:00" };

const explainer = (kind: string) =>
  kind === "inv"
    ? "1m close through FVG opposite edge, BOS-aligned. Entry next tick, SL beyond nearest opposing structure."
    : "Pullback into active FVG zone (touch within 2pts). SL beyond zone edge.";

const smcIfvg: ReplayStrategyPlugin = {
  id: "smc-ifvg",
  label: "SMC iFVG",
  subtitle: "validated engine on real NQ ticks",
  mode: "review",
  endpoint: "/api/poc/smc-ifvg",
  dates: DUKA_DATES,
  params: [
    { name: "windowOnly", label: `${WINDOW.from}–${WINDOW.to} window only`, type: "bool", default: true },
    { name: "earlyInv", label: "early-inversion catch (experimental)", type: "bool", default: false },
  ],
  load: async ({ date, params, signal }) => {
    const q = params.windowOnly ? `&from_ist=${WINDOW.from}&to_ist=${WINDOW.to}` : "";
    const f = params.earlyInv ? `&flip=3` : "";
    const [mi, mr] = await Promise.all([
      fetch(`/api/poc/smc-ifvg?date=${date}${q}&entries=inv${f}`, { signal }).then(r => r.json()),
      fetch(`/api/poc/smc-ifvg?date=${date}${q}&entries=retest${f}`, { signal }).then(r => r.json()),
    ]);
    const allBars = (mi.bars || mr.bars || []);
    const ti = ((mi.trades || []) as Omit<ReplayTrade, "stack">[]).map(t => ({ ...t, stack: "inv" as TradeStack }));
    const tr = ((mr.trades || []) as Omit<ReplayTrade, "stack">[]).map(t => ({ ...t, stack: "retest" as TradeStack }));
    const all = [...ti, ...tr].sort((a, b) => a.time - b.time);
    return { bars: allBars, trades: all, basis: mi.basis ?? mr.basis, error: mi.error && mr.error ? mi.error : undefined };
  },
  normalize: (json) => ({
    bars: json.bars ?? [],
    trades: json.trades ?? [],
    basis: json.basis,
    error: json.error,
  }),
  card: {
    explainer: (trade) => explainer(trade.kind),
  },
  panel: (bundle) => {
    const trades = bundle.trades;
    const netStack = (st: TradeStack) => trades.filter(t => t.stack === st).reduce((a, t) => a + t.pnl, 0);
    return createElement(
      Stack,
      { direction: "row", gap: "sm", mb: "sm", wrap: "wrap" },
      ...tradeStatChips(bundle, [
        createElement(Chip, {
          size: "small",
          key: "momentum",
          children: `MOMENTUM ${netStack("inv") > 0 ? "+" : ""}${netStack("inv").toFixed(1)}`,
          style: { "background-color": "#1F2937", color: palette.PRIMARY, border: `1px solid ${stackColor("inv")}` },
        }),
        createElement(Chip, {
          size: "small",
          key: "reversion",
          children: `REVERSION ${netStack("retest") > 0 ? "+" : ""}${netStack("retest").toFixed(1)}`,
          style: { "background-color": "#1F2937", color: "#CE9BFC", border: `1px solid ${stackColor("retest")}` },
        }),
      ]),
    );
  },
  summary: (bundle) =>
    `trading/smc_ifvg.py · history-only signals · tick fills (ask/bid, SL-first) · structure TP (RR≥3) or trail · NQ=F ${bundle.basis != null ? `(basis +${bundle.basis.toFixed(1)})` : ""} · ${TZ_IST_LABEL}`,
};

export default smcIfvg;
