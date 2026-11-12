// BacktestEdgePanel — "Edge AI" right-rail panel for the selected symbol.
// Pure rule-based edge breakdown: long/short, time-of-day, weekday, hold
// duration, and exit reason, rendered as compact diverging bars.
import { createMemo } from "solid-js";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import type { Trade } from "../../types/backtest";
import { filterTrades, type TradeFilters } from "./tradeFilters";
import {
  bestBucket,
  exitReasonEdge,
  holdEdge,
  hourEdge,
  sideEdge,
  weekdayEdge,
  winRate,
  worstBucket,
  type EdgeBucket,
} from "./edgeAnalytics";
import { For } from "solid-js";
import { Box } from "../paper-trading/primitives";

function Row({ b, maxAbs }: { b: EdgeBucket; maxAbs: number }) {
  const positive = b.netPnl >= 0;
  const width = maxAbs > 0 ? Math.max(1.5, (Math.abs(b.netPnl) / maxAbs) * 50) : 0;
  const color = positive ? palette.POSITIVE : palette.NEGATIVE;
  return (
    <Box
      className="flex items-center gap-2 py-0.25"
      title={`${b.label}: ${b.count} trades · ${winRate(b).toFixed(0)}% WR · ₹${b.netPnl.toFixed(0)}`}
      data-testid={`edge-row-${b.key}`}
    >
      <Text size="xs" c="muted" style={{ width: 60, flex: "0 0 auto", whiteSpace: "nowrap" }}>{b.label}</Text>
      <div className="relative flex-1 h-[14px] rounded-sm overflow-hidden" style={{ backgroundColor: "#121212" }}>
        <div className="absolute top-0 bottom-0 left-1/2 w-[1px]" style={{ backgroundColor: "#30363D" }} />
        <div
          className="absolute top-1 bottom-1 rounded-xs"
          style={{
            backgroundColor: color,
            ...(positive ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` }),
          }}
        />
      </div>
      <Text
        size="xs"
        c={positive ? "positive" : "negative"}
        style={{ width: 62, flex: "0 0 auto", textAlign: "right", fontVariantNumeric: "tabular-nums" }}
      >
        {positive ? "+" : ""}{b.netPnl.toFixed(0)}
      </Text>
      <Text size="xs" c="muted" style={{ width: 30, flex: "0 0 auto", textAlign: "right" }}>{b.count}t</Text>
    </Box>
  );
}

function Section({ title, buckets }: { title: string; buckets: EdgeBucket[] }) {
  if (buckets.length === 0) return null;
  const maxAbs = Math.max(1, ...buckets.map((b) => Math.abs(b.netPnl)));
  return (
    <Box className="mb-2" data-testid={`edge-section-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <Text size="xs" fw={600} c="muted" style={{ display: "block", mb: 0.5 * 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {title}
      </Text>
      <For each={buckets}>{(b) => <Row key={b.key} b={b} maxAbs={maxAbs} />}</For>
    </Box>
  );
}

export function BacktestEdgePanel({ symbol, trades, filters }: { symbol?: string; trades: Trade[]; filters?: TradeFilters }) {
  const active = createMemo(
    () => (filters ? filterTrades(trades, filters) : trades),
  );
  const hours = createMemo(() => hourEdge(active()));
  const sides = createMemo(() => sideEdge(active()));
  const weekdays = createMemo(() => weekdayEdge(active()));
  const holds = createMemo(() => holdEdge(active()));
  const reasons = createMemo(() => exitReasonEdge(active()));

  if (!trades || trades.length === 0) {
    return (
      <Box className="p-1.5">
        <Text size="xs" c="muted">Select a symbol with trades to see its edge profile.</Text>
      </Box>
    );
  }

  if (active().length === 0) {
    return (
      <Box className="p-1.5">
        <Text size="xs" c="muted">No trades match the current filters.</Text>
      </Box>
    );
  }

  const total = active().reduce((s, t) => s + t.net_pnl, 0);
  const best = bestBucket(hours());
  const worst = worstBucket(hours());
  const fmtBucket = (b: EdgeBucket | null) =>
    b ? `${b.label} (${b.netPnl >= 0 ? "+" : ""}₹${b.netPnl.toFixed(0)}, ${winRate(b).toFixed(0)}% WR)` : "—";

  return (
    <Box className="p-1 overflow-auto" data-testid="edge-panel">
      <Box className="mb-1">
        <Text size="xs" c="text-muted">
          {symbol ?? "—"} · {active().length} trades · net{" "}
          <Text span size="xs" c={total >= 0 ? "positive" : "negative"} fw={700}>
            {total >= 0 ? "+" : ""}₹{total.toFixed(0)}
          </Text>
        </Text>
        <Text size="xs" c="muted" style={{ display: "block", marginTop: 2 }} data-testid="edge-insight-best">
          Best window: {fmtBucket(best)}
        </Text>
        <Text size="xs" c="muted" style={{ display: "block" }} data-testid="edge-insight-worst">
          Worst window: {fmtBucket(worst)}
        </Text>
      </Box>

      <Section title="Side" buckets={sides()} />
      <Section title="Time of day" buckets={hours()} />
      <Section title="Weekday" buckets={weekdays()} />
      <Section title="Hold duration" buckets={holds()} />
      <Section title="Exit reason" buckets={reasons()} />
    </Box>
  );
}
