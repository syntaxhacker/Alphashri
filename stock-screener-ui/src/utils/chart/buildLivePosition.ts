import type { UnifiedLivePosition, MarkLineData } from "./types";

export function buildLivePositionMarker(pos: UnifiedLivePosition, candleIdx: number): any[] {
  return [
    {
      name: "LIVE",
      type: "scatter",
      data: [
        {
          value: [candleIdx, pos.entry_price],
          itemStyle: { color: "#00FFFF", borderColor: "#FFFFFF", borderWidth: 3 },
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
  return [
    {
      yAxis: pos.stop_loss,
      lineStyle: { color: "#FF00FF", type: "dashed", width: 2 },
      label: { position: "insideEndTop", formatter: `SL ${pos.stop_loss}` },
    },
    {
      yAxis: pos.take_profit,
      lineStyle: { color: "#FFFF00", type: "dashed", width: 2 },
      label: { position: "insideEndTop", formatter: `TP ${pos.take_profit}` },
    },
  ];
}
