// Shared review-mode UI building blocks.
// The factory default, 52W chaser and SMC iFVG stat chip panels were near-identical
// copies; tradeStatChips is the single markup/string source for the three shared
// chips (trade count, win rate, net P&L). Strategy-specific extras are appended
// via the `extra` argument (e.g. the SMC iFVG momentum/reversion stack chips).
import type { JSX } from "solid-js";
import { Chip } from "@/ui";
import * as palette from "@/ui/palette";
import type { ReplayBundle } from "../tick";

/** The three shared stat chips: count, win rate, net "±x.x pts". */
export function tradeStatChips(bundle: ReplayBundle, extra?: JSX.Element[]): JSX.Element[] {
  const trades = bundle.trades;
  const net = trades.reduce((a, t) => a + t.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0).length;
  return [
    <Chip
      size="sm"
      style={{ "background-color": palette.REPLAY_CHIP_BG, color: palette.POSITIVE }}
    >
      {`${trades.length} trades`}
    </Chip>,
    <Chip
      size="sm"
      style={{ "background-color": palette.REPLAY_CHIP_BG, color: palette.TEXT_MUTED }}
    >
      {`win ${wins}/${trades.length}`}
    </Chip>,
    <Chip size="sm" color={net > 0 ? "success" : "error"}>
      {`net ${net > 0 ? "+" : ""}${net.toFixed(1)} pts`}
    </Chip>,
    ...(extra ?? []),
  ];
}
