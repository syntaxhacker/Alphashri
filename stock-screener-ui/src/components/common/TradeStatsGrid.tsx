import type { JSX } from "solid-js";
import { Show, createMemo } from "solid-js";
import { Box, Text, Progress, Stack } from "@/ui";
import { CompactStat, CompactStatGrid } from "./compact";
import { getPnLTextColor } from "../../utils/ui-helpers";

// `solid-js` does not re-export JSX.CSSProperties from its package root.
type CSSProperties = JSX.CSSProperties;


const signedCurrencyFormat = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  signDisplay: "exceptZero",
});

/** `+₹1,234` / `-₹1,234` / `₹0` — INR with an explicit non-zero sign. */
export function formatCurrencySigned(value: number): string {
  return signedCurrencyFormat.format(value);
}

/** The subset of a trade both stats panels render. */
export interface TradeStatsTradeLike {
  pnl: number;
  net_pnl: number;
}

/** The subset of a summary both stats panels render. */
export interface TradeStatsSummaryLike {
  win_rate: number;
  /** `null` when nothing has closed yet (replay summaries do this). */
  profit_factor: number | null;
  net_pnl: number;
  winners: number;
  losers: number;
}

export interface TradeStats {
  winRate: number;
  profitFactor: number;
  netPnl: number;
  winners: number;
  losers: number;
}

/**
 * Shared derivations for the replay + strategy-runner stats panels.
 * A supplied `summary` wins; otherwise the numbers are derived from `trades`.
 */
export function computeTradeStats(
  trades: readonly TradeStatsTradeLike[],
  summary: TradeStatsSummaryLike | null,
): TradeStats {
  return {
    winRate: summary
      ? summary.win_rate
      : trades.length > 0
        ? (trades.filter((t) => t.pnl > 0).length / trades.length) * 100
        : 0,
    profitFactor: summary?.profit_factor ?? 0,
    netPnl: summary?.net_pnl ?? trades.reduce((s, t) => s + t.net_pnl, 0),
    winners: summary?.winners ?? trades.filter((t) => t.pnl > 0).length,
    losers: summary?.losers ?? trades.filter((t) => t.pnl <= 0).length,
  };
}

interface TradeStatsGridProps {
  trades: readonly TradeStatsTradeLike[];
  summary: TradeStatsSummaryLike | null;
  isRunning: boolean;
  /** Copy shown when there are no trades and nothing is running. */
  emptyText: string;
  /** Applied to the root node (empty state and populated stack). */
  testId?: string;
  /** Extra stats rendered after "Winners / Losers" and before "Progress". */
  extraStats?: JSX.Element;
  progressStat?: { value: string; hint: string } | null;
  progressBar?: { percent: number; style?: CSSProperties } | null;
}

/**
 * Presentational stats grid shared by the replay and strategy-runner panels:
 * Total Trades, Win Rate, Profit Factor, Net P&L, Winners / Losers, plus
 * caller-supplied extra stats, an optional progress stat and progress bar.
 */
export function TradeStatsGrid(props: TradeStatsGridProps) {
  const isRunning = () => props.isRunning;
  const showEmpty = () => props.trades.length === 0 && !isRunning();
  const stats = createMemo(() => computeTradeStats(props.trades, props.summary));

  return (
    <Show
      when={showEmpty()}
      fallback={
        <Stack gap="sm" data-testid={props.testId}>
          <CompactStatGrid>
            <CompactStat label="Total Trades" value={props.trades.length} />
            <CompactStat
              label="Win Rate"
              value={`${stats().winRate.toFixed(1)}%`}
              tone={stats().winRate >= 50 ? "success" : "error"}
            />
            <CompactStat
              label="Profit Factor"
              value={stats().profitFactor === 0 ? "—" : stats().profitFactor.toFixed(2)}
              tone={stats().profitFactor > 1 ? "success" : stats().profitFactor < 1 ? "error" : "default"}
            />
            <CompactStat
              label="Net P&L"
              value={formatCurrencySigned(stats().netPnl)}
              tone={getPnLTextColor(stats().netPnl)}
            />
            <CompactStat label="Winners / Losers" value={`${stats().winners} / ${stats().losers}`} />
            {props.extraStats}
            <Show when={isRunning() && props.progressStat}>
              {(progressStat) => (
                <CompactStat label="Progress" value={progressStat().value} hint={progressStat().hint} />
              )}
            </Show>
          </CompactStatGrid>

          <Show when={props.progressBar}>
            {(progressBar) => <Progress value={progressBar().percent} size="sm" animated style={progressBar().style} />}
          </Show>
        </Stack>
      }
    >
      <Box data-testid={props.testId}>
        <Text c="dimmed" ta="center">
          {props.emptyText}
        </Text>
      </Box>
    </Show>
  );
}
