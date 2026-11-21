// TradeReplayCard — trade summary + TickReplayChart. The per-trade unit of every
// future strategy page (iFVG, LRL, ORB…): header chips + stats + explainer + chart.
import { Text, Chip, Box, Card, Stack } from "@/ui";
import { Show } from "solid-js";
import * as palette from "@/ui/palette";
import TickReplayChart from "./TickReplayChart";
import type { Bar, ReplayTrade, ReplayTrend, ReplayZone, TradeStack } from "./types";
export const stackLabel = (stack: TradeStack | undefined): string =>
  stack === "inv" ? "MOMENTUM" : stack === "retest" ? "REVERSION" : "TRADE";
export const stackColor = (stack: TradeStack | undefined): string =>
  stack === "inv" ? palette.STACK_MOMENTUM : stack === "retest" ? palette.STACK_REVERSION : palette.SERIES_STACK_DEFAULT;
export const kindLabel = (kind: string): string =>
  kind === "inv" ? "iFVG inversion" : kind === "retest" ? "FVG retest" : kind;
export const resultColor = (result: string): "success" | "warning" | "error" | "default" =>
  result === "TP" ? "success"
  : result === "TRAIL" || result === "MAX_HOLD" ? "warning"
  : result === "BE" ? "default" : "error";

interface TradeReplayCardProps {
  bars: Bar[];
  trade: ReplayTrade;
  index: number;
  zones?: ReplayZone[];
  trends?: ReplayTrend[];
  timeLabel: (ts: number) => string;
  explainer?: (trade: ReplayTrade) => string;
  chartHeight?: number;
  fitPaddingBeforeMin?: number;
  fitPaddingAfterMin?: number;
}

export default function TradeReplayCard(props: TradeReplayCardProps) {
  const chartHeight = () => props.chartHeight ?? 300;

  return (
    <Card
      bg={palette.NT_BG}
      style={{ border: `1px solid ${palette.NT_GRID}`, "margin-bottom": "16px", overflow: "hidden" }}
      data-testid="trade-replay-card"
      id={`trade-replay-card-${props.index}`}
    >
      <Box
        className="flex flex-col md:flex-row items-stretch"
        style={{ display: "flex", "align-items": "stretch" }}
      >
        <Stack
          flex="0 0 280px"
          style={{ padding: "12px", "background-color": palette.SURFACE, "border-right": `1px solid ${palette.BORDER}`, gap: "8px" }}
          gap="xs"
        >
          <Stack direction="row" align="center" justify="space-between" gap="xs">
            <Stack direction="row" align="center" gap="xs">
              <Chip size="xs" color={props.trade.side === "LONG" ? "success" : "error"} style={{ height: "18px", "font-size": "10px", "font-weight": 700 }}>{props.trade.side}</Chip>
              <Show when={props.trade.stack}>
                <Chip size="xs" style={{ height: "18px", "font-size": "9px", "background-color": palette.REPLAY_CHIP_BG, color: stackColor(props.trade.stack), border: `1px solid ${stackColor(props.trade.stack)}` }}>{stackLabel(props.trade.stack)}</Chip>
              </Show>
              <Text size="xs" fw={600} style={{ color: palette.TEXT, "font-size": "10px" }}>
                #{props.index + 1} {kindLabel(props.trade.kind)}
              </Text>
            </Stack>
            <Chip size="xs" color={resultColor(props.trade.result)} style={{ height: "18px", "font-size": "9px" }}>{props.trade.result}</Chip>
          </Stack>
          <Stack gap="xs">
            <Text size="xs" fw={600} style={{ color: palette.TEXT, "font-size": "10px" }}>
              {props.timeLabel(props.trade.time)} → {props.timeLabel(props.trade.exit_time)}
            </Text>
            <Text size="xs" style={{ color: palette.TEXT_MUTED, "font-size": "9px" }}>
              Entry {props.trade.entry.toFixed(2)} · SL {props.trade.sl.toFixed(2)}{props.trade.tp != null ? ` · TP ${props.trade.tp.toFixed(2)}` : " · trail"}
            </Text>
            <Text size="xs" fw={600} style={{ color: props.trade.pnl > 0 ? palette.POSITIVE : palette.NEGATIVE, "font-size": "9px" }}>
              RR {props.trade.rr >= 0 ? "+" : ""}{props.trade.rr.toFixed(2)}R · {props.trade.pnl > 0 ? "+" : ""}{props.trade.pnl.toFixed(2)} pts ({Math.max(1, Math.round((props.trade.exit_time - props.trade.time) / 60))}m)
            </Text>
          </Stack>
          <Show when={props.explainer}>
            <Box
              style={{
                padding: "8px",
                "background-color": palette.SURFACE_ALT,
                "border-radius": "4px",
                border: `1px solid ${palette.BORDER}`,
              }}
            >
              <Text size="xs" style={{ color: palette.TEXT_MUTED, display: "block", "font-size": "9px", "line-height": 1.6 }}>
                {props.explainer!(props.trade)}
              </Text>
            </Box>
          </Show>
        </Stack>
        <Box style={{ flex: "1", "min-height": `${chartHeight()}px`, display: "flex", "align-items": "stretch" }}>
          <TickReplayChart bars={props.bars} trade={props.trade} zones={props.zones} trends={props.trends} height={chartHeight()} id={`tick-replay-chart-${props.index}`} fitPaddingBeforeMin={props.fitPaddingBeforeMin} fitPaddingAfterMin={props.fitPaddingAfterMin} />
        </Box>
      </Box>
    </Card>
  );
}
