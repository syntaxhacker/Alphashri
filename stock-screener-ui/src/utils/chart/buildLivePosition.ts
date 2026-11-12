import type { UnifiedLivePosition, MarkLineData } from "./types";
import { MARKER_ENTRY, MARKER_BORDER, MARKER_SL, MARKER_TP } from "../../config/colors";

export function buildLivePositionMarker(pos: UnifiedLivePosition, candleIdx: number): any[] {
  return [
    {
      name: "LIVE",
      type: "scatter",
      data: [
        {
          value: [candleIdx, pos.entry_price],
          itemStyle: { color: MARKER_ENTRY, borderColor: MARKER_BORDER, borderWidth: 3 },
          symbol: pos.side === "BUY" ? "triangle" : "triangleRotated",
          symbolSize: 22,
          trade: pos,
          isLive: true,
        },
      ],
      symbolSize: 22,
      z: 10,
    },
  ];
}

export function buildLivePositionMarkLines(pos: UnifiedLivePosition): MarkLineData[] {
  const lines: MarkLineData[] = [];
  if (pos.stop_loss && pos.stop_loss > 0) {
    lines.push({
      yAxis: pos.stop_loss,
      lineStyle: { color: MARKER_SL, type: "dashed", width: 2 },
      label: { position: "insideEndTop", formatter: `SL ${pos.stop_loss}` },
    });
  }
  if (pos.take_profit && pos.take_profit > 0) {
    lines.push({
      yAxis: pos.take_profit,
      lineStyle: { color: MARKER_TP, type: "dashed", width: 2 },
      label: { position: "insideEndTop", formatter: `TP ${pos.take_profit}` },
    });
  }
  return lines;
}
