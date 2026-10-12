// BacktestEdgePanel — "Edge AI" right-rail panel for the selected symbol.
// Pure rule-based edge breakdown: long/short, time-of-day, weekday, hold
// duration, and exit reason, rendered as compact diverging bars.
import { useMemo } from "react";
import Box from "@mui/material/Box";
import * as palette from "@/ui/palette";
import { Text } from "@/ui";
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

function Row({ b, maxAbs }: { b: EdgeBucket; maxAbs: number }) {
  const positive = b.netPnl >= 0;
  const width = maxAbs > 0 ? Math.max(1.5, (Math.abs(b.netPnl) / maxAbs) * 50) : 0;
  const color = positive ? palette.POSITIVE : palette.NEGATIVE;
  return (
    <Box
      sx={{ display: "flex", alignItems: "center", gap: 0.75, py: "2px" }}
      title={`${b.label}: ${b.count} trades · ${winRate(b).toFixed(0)}% WR · ₹${b.netPnl.toFixed(0)}`}
      data-testid={`edge-row-${b.key}`}
    >
      <Text size="xs" c="dimmed" sx={{ width: 60, flex: "0 0 auto", whiteSpace: "nowrap" }}>{b.label}</Text>
      <Box sx={{ position: "relative", flex: 1, height: 14, bgcolor: "action.hover", borderRadius: "2px", overflow: "hidden" }}>
        <Box sx={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: "1px", bgcolor: "var(--mui-palette-divider)" }} />
        <Box
          sx={{
            position: "absolute",
            top: 1,
            bottom: 1,
            bgcolor: color,
            borderRadius: "1px",
            ...(positive ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` }),
          }}
        />
      </Box>
      <Text
        size="xs"
        c={positive ? "success.main" : "error.main"}
        sx={{ width: 62, flex: "0 0 auto", textAlign: "right", fontVariantNumeric: "tabular-nums" }}
      >
        {positive ? "+" : ""}{b.netPnl.toFixed(0)}
      </Text>
      <Text size="xs" c="dimmed" sx={{ width: 30, flex: "0 0 auto", textAlign: "right" }}>{b.count}t</Text>
    </Box>
  );
}

function Section({ title, buckets }: { title: string; buckets: EdgeBucket[] }) {
  if (buckets.length === 0) return null;
  const maxAbs = Math.max(1, ...buckets.map((b) => Math.abs(b.netPnl)));
  return (
    <Box sx={{ mb: 1.25 }} data-testid={`edge-section-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <Text size="xs" fw={600} c="dimmed" sx={{ display: "block", mb: 0.5, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {title}
      </Text>
      {buckets.map((b) => <Row key={b.key} b={b} maxAbs={maxAbs} />)}
    </Box>
  );
}

export function BacktestEdgePanel({ symbol, trades, filters }: { symbol?: string; trades: Trade[]; filters?: TradeFilters }) {
  const active = useMemo(
    () => (filters ? filterTrades(trades, filters) : trades),
    [trades, filters?.side, filters?.result, filters?.reason],
  );
  const hours = useMemo(() => hourEdge(active), [active]);
  const sides = useMemo(() => sideEdge(active), [active]);
  const weekdays = useMemo(() => weekdayEdge(active), [active]);
  const holds = useMemo(() => holdEdge(active), [active]);
  const reasons = useMemo(() => exitReasonEdge(active), [active]);

  if (!trades || trades.length === 0) {
    return (
      <Box sx={{ p: 1.5 }}>
        <Text size="xs" c="dimmed">Select a symbol with trades to see its edge profile.</Text>
      </Box>
    );
  }

  if (active.length === 0) {
    return (
      <Box sx={{ p: 1.5 }}>
        <Text size="xs" c="dimmed">No trades match the current filters.</Text>
      </Box>
    );
  }

  const total = active.reduce((s, t) => s + t.net_pnl, 0);
  const best = bestBucket(hours);
  const worst = worstBucket(hours);
  const fmtBucket = (b: EdgeBucket | null) =>
    b ? `${b.label} (${b.netPnl >= 0 ? "+" : ""}₹${b.netPnl.toFixed(0)}, ${winRate(b).toFixed(0)}% WR)` : "—";

  return (
    <Box sx={{ p: 1, overflow: "auto" }} data-testid="edge-panel">
      <Box sx={{ mb: 1 }}>
        <Text size="xs" c="text.secondary">
          {symbol ?? "—"} · {active.length} trades · net{" "}
          <Text span size="xs" c={total >= 0 ? "success.main" : "error.main"} fw={700}>
            {total >= 0 ? "+" : ""}₹{total.toFixed(0)}
          </Text>
        </Text>
        <Text size="xs" c="dimmed" sx={{ display: "block", mt: 0.25 }} data-testid="edge-insight-best">
          Best window: {fmtBucket(best)}
        </Text>
        <Text size="xs" c="dimmed" sx={{ display: "block" }} data-testid="edge-insight-worst">
          Worst window: {fmtBucket(worst)}
        </Text>
      </Box>

      <Section title="Side" buckets={sides} />
      <Section title="Time of day" buckets={hours} />
      <Section title="Weekday" buckets={weekdays} />
      <Section title="Hold duration" buckets={holds} />
      <Section title="Exit reason" buckets={reasons} />
    </Box>
  );
}
