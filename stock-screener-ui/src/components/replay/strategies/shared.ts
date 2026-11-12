// Shared review-mode UI building blocks.
// The factory default, 52W chaser and SMC iFVG stat chip panels were near-identical
// copies; tradeStatChips is the single markup/string source for the three shared
// chips (trade count, win rate, net P&L). Strategy-specific extras are appended
// via the `extra` argument (e.g. the SMC iFVG momentum/reversion stack chips).
import { createElement, type ReactNode } from "react";
import { Chip } from "@/ui";
import * as palette from "@/ui/palette";
import type { ReplayBundle } from "../tick";

/** The three shared stat chips: count, win rate, net "±x.x pts". */
export function tradeStatChips(bundle: ReplayBundle, extra?: ReactNode[]): ReactNode[] {
  const trades = bundle.trades;
  const net = trades.reduce((a, t) => a + t.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0).length;
  return [
    createElement(Chip, {
      size: "small",
      key: "trades",
      children: `${trades.length} trades`,
      style: { "background-color": "#1F2937", color: palette.POSITIVE },
    }),
    createElement(Chip, {
      size: "small",
      key: "wins",
      children: `win ${wins}/${trades.length}`,
      style: { "background-color": "#1F2937", color: palette.TEXT_MUTED },
    }),
    createElement(Chip, {
      size: "small",
      key: "net",
      children: `net ${net > 0 ? "+" : ""}${net.toFixed(1)} pts`,
      color: net > 0 ? "success" : "error",
    }),
    ...(extra ?? []),
  ];
}
