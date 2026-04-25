import type { ChartColors } from "./types";

interface GridResult {
  grids: any[];
  xAxes: any[];
  yAxes: any[];
  dataZoom: any[];
}

export function buildGrid(
  colors: ChartColors,
  showVolume: boolean,
  showDataZoomSlider: boolean,
): GridResult {
  if (showVolume) {
    return {
      grids: [
        { left: "8%", right: "3%", top: "5%", height: "60%" },
        { left: "8%", right: "3%", top: "72%", height: "18%" },
      ],
      xAxes: [
        {
          type: "category",
          boundaryGap: true,
          axisLine: { lineStyle: { color: colors.borderColor } },
          axisLabel: { fontSize: 10, color: colors.mutedColor },
          splitLine: { show: false },
          min: "dataMin",
          max: "dataMax",
        },
        {
          type: "category",
          gridIndex: 1,
          boundaryGap: true,
          axisLine: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false },
          min: "dataMin",
          max: "dataMax",
        },
      ],
      yAxes: [
        {
          scale: true,
          axisLine: { lineStyle: { color: colors.borderColor } },
          axisLabel: { color: colors.mutedColor, fontSize: 10 },
          splitLine: { lineStyle: { color: colors.gridLineColor } },
        },
        {
          scale: true,
          gridIndex: 1,
          axisLine: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false },
        },
      ],
      dataZoom: [
        { type: "inside", xAxisIndex: [0, 1], start: 0, end: 100 },
        ...(showDataZoomSlider
          ? [{ type: "slider", show: true, xAxisIndex: [0, 1], start: 0, end: 100, bottom: 30 }]
          : []),
      ],
    };
  }

  return {
    grids: [{ left: "8%", right: "8%", bottom: 82, top: 44 }],
    xAxes: [
      {
        type: "category",
        scale: true,
        splitLine: { show: false },
        axisLine: { lineStyle: { color: colors.borderColor } },
        axisLabel: { color: colors.mutedColor, rotate: 45 },
      },
    ],
    yAxes: [
      {
        type: "value",
        scale: true,
        splitArea: { show: true },
        splitLine: { lineStyle: { color: colors.gridLineColor } },
        axisLine: { lineStyle: { color: colors.borderColor } },
        axisLabel: {
          color: colors.mutedColor,
          formatter: (value: number) => "₹" + value.toFixed(0),
        },
      },
    ],
    dataZoom: [
      { type: "inside", start: 0, end: 100 },
      ...(showDataZoomSlider
        ? [{ type: "slider", show: true, start: 0, end: 100, bottom: 30 }]
        : []),
    ],
  };
}
