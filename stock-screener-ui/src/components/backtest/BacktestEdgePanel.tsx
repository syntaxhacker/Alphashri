// BacktestEdgePanel — "Edge AI" right-rail panel for the selected symbol.
// Pure rule-based edge breakdown: long/short, time-of-day, weekday, hold
// duration, and exit reason, rendered as compact diverging bars.
import { For, Show, Switch, Match, createMemo } from "solid-js";
import { Text, Box } from "@/ui";
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
function Row(props: { b: EdgeBucket; maxAbs: number }) {
  const positive = () => props.b.netPnl >= 0;
  const width = () => (props.maxAbs > 0 ? Math.max(1.5, (Math.abs(props.b.netPnl) / props.maxAbs) * 50) : 0);
  return (
    <Box
      className="flex items-center gap-2 py-0.25"
      title={`${props.b.label}: ${props.b.count} trades · ${winRate(props.b).toFixed(0)}% WR · ₹${props.b.netPnl.toFixed(0)}`}
      data-testid={`edge-row-${props.b.key}`}
    >
      <Text size="xs" c="dimmed" style={{ width: "60px", flex: "0 0 auto", "white-space": "nowrap" }}>{props.b.label}</Text>
      <div class="relative flex-1 h-[14px] rounded-sm overflow-hidden" style={{ "background-color": palette.SURFACE_ALT }}>
        <div class="absolute top-0 bottom-0 left-1/2 w-[1px]" style={{ "background-color": palette.BROWN }} />
        <div
          class="absolute top-1 bottom-1 rounded-xs"
          style={{
            "background-color": positive() ? palette.POSITIVE : palette.NEGATIVE,
            ...(positive() ? { left: "50%", width: `${width()}%` } : { right: "50%", width: `${width()}%` }),
          }}
        />
      </div>
      <Text
        size="xs"
        c={positive() ? palette.POSITIVE : palette.NEGATIVE}
        style={{ width: "62px", flex: "0 0 auto", "text-align": "right", "font-variant-numeric": "tabular-nums" }}
      >
        {positive() ? "+" : ""}{props.b.netPnl.toFixed(0)}
      </Text>
      <Text size="xs" c="dimmed" style={{ width: "30px", flex: "0 0 auto", "text-align": "right" }}>{props.b.count}t</Text>
    </Box>
  );
}

function Section(props: { title: string; buckets: EdgeBucket[] }) {
  const maxAbs = () => Math.max(1, ...props.buckets.map((b) => Math.abs(b.netPnl)));
  return (
    <Show when={props.buckets.length > 0}>
      <Box className="mb-2" data-testid={`edge-section-${props.title.toLowerCase().replace(/\s+/g, "-")}`}>
        <Text size="xs" fw={600} c="dimmed" style={{ display: "block", "margin-bottom": "4px", "text-transform": "uppercase", "letter-spacing": "0.4px" }}>
          {props.title}
        </Text>
        <For each={props.buckets}>{(b) => <Row b={b} maxAbs={maxAbs()} />}</For>
      </Box>
    </Show>
  );
}

export function BacktestEdgePanel(props: { symbol?: string; trades: Trade[]; filters?: TradeFilters }) {
  const active = createMemo(
    () => (props.filters ? filterTrades(props.trades ?? [], props.filters) : (props.trades ?? [])),
  );
  const hours = createMemo(() => hourEdge(active()));
  const sides = createMemo(() => sideEdge(active()));
  const weekdays = createMemo(() => weekdayEdge(active()));
  const holds = createMemo(() => holdEdge(active()));
  const reasons = createMemo(() => exitReasonEdge(active()));
  const total = createMemo(() => active().reduce((s, t) => s + t.net_pnl, 0));
  const best = createMemo(() => bestBucket(hours()));
  const worst = createMemo(() => worstBucket(hours()));

  const fmtBucket = (b: EdgeBucket | null) =>
    b ? `${b.label} (${b.netPnl >= 0 ? "+" : ""}₹${b.netPnl.toFixed(0)}, ${winRate(b).toFixed(0)}% WR)` : "—";

  return (
    <Switch>
      <Match when={!props.trades || props.trades.length === 0}>
        <Box className="p-1.5">
          <Text size="xs" c="dimmed">Select a symbol with trades to see its edge profile.</Text>
        </Box>
      </Match>
      <Match when={active().length === 0}>
        <Box className="p-1.5">
          <Text size="xs" c="dimmed">No trades match the current filters.</Text>
        </Box>
      </Match>
      <Match when={true}>
        <Box className="p-1 overflow-auto" data-testid="edge-panel">
          <Box className="mb-1">
            <Text size="xs" c="dimmed">
              {props.symbol ?? "—"} · {active().length} trades · net{" "}
              <Text span size="xs" c={total() >= 0 ? palette.POSITIVE : palette.NEGATIVE} fw={700}>
                {total() >= 0 ? "+" : ""}₹{total().toFixed(0)}
              </Text>
            </Text>
            <Text size="xs" c="dimmed" style={{ display: "block", "margin-top": "2px" }} data-testid="edge-insight-best">
              Best window: {fmtBucket(best())}
            </Text>
            <Text size="xs" c="dimmed" style={{ display: "block" }} data-testid="edge-insight-worst">
              Worst window: {fmtBucket(worst())}
            </Text>
          </Box>

          <Section title="Side" buckets={sides()} />
          <Section title="Time of day" buckets={hours()} />
          <Section title="Weekday" buckets={weekdays()} />
          <Section title="Hold duration" buckets={holds()} />
          <Section title="Exit reason" buckets={reasons()} />
        </Box>
      </Match>
    </Switch>
  );
}
