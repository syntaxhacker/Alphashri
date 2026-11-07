// Shared review-mode UI building blocks.
// The factory default, 52W chaser and SMC iFVG stat chip panels were near-identical
// copies; tradeStatChips is the single markup/string source for the three shared
// chips (trade count, win rate, net P&L). Strategy-specific extras are appended
// via the `extra` argument (e.g. the SMC iFVG momentum/reversion stack chips).
import Chip from "@mui/material/Chip";
import { createElement, type ReactNode } from "react";
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
      label: `${trades.length} trades`,
      sx: { bgcolor: "#1F2937", color: "#00FF00" },
    }),
    createElement(Chip, {
      size: "small",
      key: "wins",
      label: `win ${wins}/${trades.length}`,
      sx: { bgcolor: "#1F2937", color: "#9CA3AF" },
    }),
    createElement(Chip, {
      size: "small",
      key: "net",
      label: `net ${net > 0 ? "+" : ""}${net.toFixed(1)} pts`,
      color: net > 0 ? "success" : "error",
    }),
    ...(extra ?? []),
  ];
}
