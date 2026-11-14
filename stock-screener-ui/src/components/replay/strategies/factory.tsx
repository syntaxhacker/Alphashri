// makeReplayPlugin — DRY factory for review-mode replay strategies. Every catalog
// entry is a plain spec; the factory fills in the shape every review plugin shares
// (normalize/envelope, chip panel, summary, trade explainer, chart fit padding) so a
// new strategy is one config object, not another near-identical module.
import type { JSX } from "solid-js";

import { TZ_IST_LABEL } from "@/config/constants";
import { tradeStatChips } from "./shared";
import type { ReplayBundle, ReplayTrade } from "../tick";
import type { ReplayParamSpec, ReplayStrategyPlugin, TimelineData } from "../core/plugin";
import { Stack } from "@/ui";
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
  panel?: (bundle: ReplayBundle, json: any) => JSX.Element;
  summary?: (bundle: ReplayBundle, json: any) => JSX.Element | string;
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
    ((bundle: ReplayBundle) => (
      <Stack direction="row" gap="sm" mb="sm" wrap="wrap">
        {tradeStatChips(bundle)}
      </Stack>
    ));
  return plugin;
}
