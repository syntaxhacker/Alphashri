// makeReplayPlugin — DRY factory for review-mode replay strategies. Every catalog
// entry is a plain spec; the factory fills in the shape every review plugin shares
// (normalize/envelope, chip panel, summary, trade explainer, chart fit padding) so a
// new strategy is one config object, not another near-identical module.
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import { createElement, type ReactNode } from "react";
import { TZ_IST_LABEL } from "@/config/constants";
import type { ReplayBundle, ReplayTrade } from "../tick";
import type { ReplayParamSpec, ReplayStrategyPlugin, TimelineData } from "../core/plugin";

const DAY_MIN = 1440;

interface TradeMeta {
  entry_reason?: string;
  exit_reason?: string;
}

export interface ReplayPluginSpec {
  id: string;
  label: string;
  subtitle?: string;
  /** Plot mode: "timeline" = progressive bar replay, "review" = per-trade cards. */
  mode?: "review" | "timeline";
  /** Bar duration in seconds when mode === "timeline" (60 intraday, 86400 daily). */
  barSeconds?: number;
  /** "manual" requires an explicit Run click (no auto-fetch). Defaults to "auto". */
  runMode?: "auto" | "manual";
  dates: string[];
  params: ReplayParamSpec[];
  /** Daily-bar strategy (multi-day holds) — widens the review trade chart window. */
  daily?: boolean;
  /** Custom timeline mapper when mode === "timeline"; defaults to json.bars bars. */
  timeline?: (json: any) => TimelineData;
  explainer?: (trade: ReplayTrade, json: any) => string;
  panel?: (bundle: ReplayBundle, json: any) => ReactNode;
  summary?: (bundle: ReplayBundle, json: any) => ReactNode;
}

export function makeReplayPlugin(spec: ReplayPluginSpec): ReplayStrategyPlugin {
  const { id, label, subtitle, dates, params, daily } = spec;
  const mode = spec.mode ?? "review";
  const barSeconds = spec.barSeconds ?? 60;
  const runMode = spec.runMode ?? "auto";

  const plugin: ReplayStrategyPlugin = {
    id,
    label,
    subtitle,
    mode,
    runMode,
    endpoint: `/api/poc/replay/${id}`,
    dates,
    params,
    normalize: (json) => ({
      bars: json?.bars ?? [],
      trades: json?.trades ?? [],
      error: json?.error,
    }),
    summary:
      spec.summary ??
      ((bundle: ReplayBundle) => `${label} · ${bundle.trades.length} trades · ${TZ_IST_LABEL}`),
  };

  if (mode === "timeline") {
    plugin.timeline =
      spec.timeline ??
      ((json: any) => ({
        candles: json?.bars ?? [],
        subs: [],
        vwap: [],
        levels: { or_high: 0, or_low: 0, or_end: 0 },
        barSeconds,
      }));
    return plugin;
  }

  plugin.card = {
    explainer:
      spec.explainer ??
      ((trade: ReplayTrade) => {
        const meta = (trade.meta ?? {}) as TradeMeta;
        const entry = meta.entry_reason || `${label} signal`;
        return meta.exit_reason ? `${entry} · Exit: ${meta.exit_reason}` : entry;
      }),
    fitPaddingBeforeMin: daily ? 3 * DAY_MIN : 120,
    fitPaddingAfterMin: daily ? 3 * DAY_MIN : 60,
  };
  plugin.panel =
    spec.panel ??
    ((bundle: ReplayBundle) => {
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
    });
  return plugin;
}
