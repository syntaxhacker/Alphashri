// TradeReplayCard — trade summary + TickReplayChart. The per-trade unit of every
// future strategy page (iFVG, LRL, ORB…): header chips + stats + explainer + chart.
import { Text, Chip } from "@/ui";
import * as palette from "@/ui/palette";
import TickReplayChart from "./TickReplayChart";
import type { Bar, ReplayTrade, ReplayTrend, ReplayZone, TradeStack } from "./types";
import { Box, Card, Stack } from "../../paper-trading/primitives";

export const stackLabel = (stack: TradeStack | undefined): string =>
  stack === "inv" ? "MOMENTUM" : stack === "retest" ? "REVERSION" : "TRADE";
export const stackColor = (stack: TradeStack | undefined): string =>
  stack === "inv" ? "#2563EB" : stack === "retest" ? "#A855F7" : "#6B7280";
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

export default function TradeReplayCard({
  bars, trade, index, zones = [], trends = [], timeLabel, explainer, chartHeight = 300,
  fitPaddingBeforeMin, fitPaddingAfterMin,
}: TradeReplayCardProps) {
  return (
    <Card
      bg={palette.NT_BG}
      style={{ border: `1px solid ${palette.NT_GRID}`, "margin-bottom": "16px", overflow: "hidden" }}
      data-testid="trade-replay-card"
      id={`trade-replay-card-${index}`}
    >
      <Box
        className="flex flex-col md:flex-row items-stretch"
        style={{ display: "flex", "align-items": "stretch" }}
      >
        <Stack
          flex="0 0 280px"
          style={{ padding: "12px", "background-color": palette.SURFACE, borderRight: `1px solid ${palette.BORDER}`, gap: "8px" }}
          gap="xs"
        >
          <Stack direction="row" align="center" justify="space-between" gap="xs">
            <Stack direction="row" align="center" gap="xs">
              <Chip size="small" children={trade.side} color={trade.side === "LONG" ? "success" : "error"} style={{ height: "18px", "font-size": "10px", "font-weight": 700 }} />
              {trade.stack && (
                <Chip size="small" children={stackLabel(trade.stack)} style={{ height: "18px", "font-size": "9px", "background-color": "#1F2937", color: stackColor(trade.stack), border: `1px solid ${stackColor(trade.stack)}` }} />
              )}
              <Text size="xs" fw={600} style={{ color: palette.TEXT, "font-size": "10px" }}>
                #{index + 1} {kindLabel(trade.kind)}
              </Text>
            </Stack>
            <Chip size="small" children={trade.result} color={resultColor(trade.result)} style={{ height: "18px", "font-size": "9px" }} />
          </Stack>
          <Stack gap="xs">
            <Text size="xs" fw={600} style={{ color: palette.TEXT, "font-size": "10px" }}>
              {timeLabel(trade.time)} → {timeLabel(trade.exit_time)}
            </Text>
            <Text size="xs" style={{ color: palette.TEXT_MUTED, "font-size": "9px" }}>
              Entry {trade.entry.toFixed(2)} · SL {trade.sl.toFixed(2)}{trade.tp != null ? ` · TP ${trade.tp.toFixed(2)}` : " · trail"}
            </Text>
            <Text size="xs" fw={600} style={{ color: trade.pnl > 0 ? palette.POSITIVE : palette.NEGATIVE, "font-size": "9px" }}>
              RR {trade.rr >= 0 ? "+" : ""}{trade.rr.toFixed(2)}R · {trade.pnl > 0 ? "+" : ""}{trade.pnl.toFixed(2)} pts ({Math.max(1, Math.round((trade.exit_time - trade.time) / 60))}m)
            </Text>
          </Stack>
          {explainer && (
            <Box
              style={{
                padding: "8px",
                "background-color": palette.SURFACE_ALT,
                "border-radius": "4px",
                border: `1px solid ${palette.BORDER}`,
              }}
            >
              <Text size="xs" style={{ color: palette.TEXT_MUTED, display: "block", "font-size": "9px", "line-height": 1.6 }}>
                {explainer(trade)}
              </Text>
            </Box>
          )}
        </Stack>
        <Box style={{ flex: "1", "min-height": chartHeight, display: "flex", "align-items": "stretch" }}>
          <TickReplayChart bars={bars} trade={trade} zones={zones} trends={trends} height={chartHeight} id={`tick-replay-chart-${index}`} fitPaddingBeforeMin={fitPaddingBeforeMin} fitPaddingAfterMin={fitPaddingAfterMin} />
        </Box>
      </Box>
    </Card>
  );
}
