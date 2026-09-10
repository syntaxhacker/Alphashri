// TradeReplayCard — trade summary + TickReplayChart. The per-trade unit of every
// future strategy page (iFVG, LRL, ORB…): header chips + stats + explainer + chart.
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import * as palette from "@/ui/palette";
import TickReplayChart from "./TickReplayChart";
import type { Bar, ReplayTrade, ReplayTrend, ReplayZone, TradeStack } from "./types";

export const stackLabel = (stack: TradeStack | undefined): string =>
  stack === "inv" ? "MOMENTUM" : stack === "retest" ? "REVERSION" : "TRADE";
export const stackColor = (stack: TradeStack | undefined): string =>
  stack === "inv" ? "#2563EB" : stack === "retest" ? "#A855F7" : "#6B7280";
export const kindLabel = (kind: string): string =>
  kind === "inv" ? "iFVG inversion" : kind === "retest" ? "FVG retest" : kind;
export const resultColor = (result: string): "success" | "warning" | "error" | "default" =>
  result === "TP" ? "success" : result === "TRAIL" ? "warning" : result === "BE" ? "default" : "error";

interface TradeReplayCardProps {
  bars: Bar[];
  trade: ReplayTrade;
  index: number;
  zones?: ReplayZone[];
  trends?: ReplayTrend[];
  timeLabel: (ts: number) => string;
  explainer?: (trade: ReplayTrade) => string;
  chartHeight?: number;
}

export default function TradeReplayCard({
  bars, trade, index, zones = [], trends = [], timeLabel, explainer, chartHeight = 300,
}: TradeReplayCardProps) {
  return (
    <Card elevation={0} sx={{ bgcolor: palette.NT_BG, border: `1px solid ${palette.NT_GRID}`, mb: 2, overflow: "hidden" }} data-testid="trade-replay-card" id={`trade-replay-card-${index}`}>
      <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, alignItems: "stretch" }}>
        <Stack sx={{ flex: "0 0 280px", p: 1.5, bgcolor: palette.SURFACE, borderRight: { md: `1px solid ${palette.BORDER}` }, borderBottom: { xs: `1px solid ${palette.BORDER}`, md: 0 }, gap: 1 }}>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", justifyContent: "space-between" }}>
            <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
              <Chip size="small" label={trade.side} color={trade.side === "LONG" ? "success" : "error"} sx={{ height: 18, fontSize: 10, fontWeight: 700 }} />
              {trade.stack && (
                <Chip size="small" label={stackLabel(trade.stack)} sx={{ height: 18, fontSize: 9, bgcolor: "#1F2937", color: stackColor(trade.stack), border: `1px solid ${stackColor(trade.stack)}` }} />
              )}
              <Typography variant="caption" sx={{ color: palette.TEXT, fontWeight: 600, fontSize: 10 }}>#{index + 1} {kindLabel(trade.kind)}</Typography>
            </Stack>
            <Chip size="small" label={trade.result} color={resultColor(trade.result)} sx={{ height: 18, fontSize: 9 }} />
          </Stack>
          <Stack spacing={0.25}>
            <Typography variant="caption" sx={{ color: palette.TEXT, fontSize: 10, fontWeight: 600 }}>
              {timeLabel(trade.time)} → {timeLabel(trade.exit_time)}
            </Typography>
            <Typography variant="caption" sx={{ color: palette.TEXT_MUTED, fontSize: 9 }}>
              Entry {trade.entry.toFixed(2)} · SL {trade.sl.toFixed(2)}{trade.tp != null ? ` · TP ${trade.tp.toFixed(2)}` : " · trail"}
            </Typography>
            <Typography variant="caption" sx={{ color: trade.pnl > 0 ? palette.POSITIVE : palette.NEGATIVE, fontSize: 9, fontWeight: 600 }}>
              RR {trade.rr >= 0 ? "+" : ""}{trade.rr.toFixed(2)}R · {trade.pnl > 0 ? "+" : ""}{trade.pnl.toFixed(2)} pts ({Math.max(1, Math.round((trade.exit_time - trade.time) / 60))}m)
            </Typography>
          </Stack>
          {explainer && (
            <Box sx={{ p: 1, bgcolor: palette.SURFACE_ALT, borderRadius: 1, border: `1px solid ${palette.BORDER}` }}>
              <Typography variant="caption" sx={{ color: palette.TEXT_MUTED, display: "block", fontSize: 9, lineHeight: 1.6 }}>
                {explainer(trade)}
              </Typography>
            </Box>
          )}
        </Stack>
        <Box sx={{ flex: 1, minHeight: chartHeight, display: "flex", alignItems: "stretch" }}>
          <TickReplayChart bars={bars} trade={trade} zones={zones} trends={trends} height={chartHeight} id={`tick-replay-chart-${index}`} />
        </Box>
      </Box>
    </Card>
  );
}
