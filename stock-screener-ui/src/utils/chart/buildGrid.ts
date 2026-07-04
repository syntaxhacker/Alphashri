import type { ChartColors } from "./types";
import { formatVolume } from "../chartUtils";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatXAxisLabel(value: string): string {
  if (!value) return value;
  const spaceIdx = value.indexOf(" ");
  if (spaceIdx === -1) return value;
  const datePart = value.substring(0, spaceIdx);
  const timePart = value.substring(spaceIdx + 1);
  if (datePart.includes("-")) {
    const [, m, d] = datePart.split("-");
    return `${MONTHS[parseInt(m, 10) - 1]} ${parseInt(d, 10)}\n${timePart}`;
  }
  return value;
}

function isMultiDayLabel(value: string): boolean {
  return value.includes(" ") && value.substring(0, value.indexOf(" ")).includes("-");
}

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
  const dataZoom: GridResult["dataZoom"] = [
    { type: "inside", ...(showVolume ? { xAxisIndex: [0, 1] } : {}), start: 0, end: 100 },
    ...(showDataZoomSlider
      ? [{ type: "slider" as const, show: true, ...(showVolume ? { xAxisIndex: [0, 1] } : {}), start: 0, end: 100, bottom: 30 }]
      : []),
  ];

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
          axisLabel: {
            fontSize: 10,
            color: colors.mutedColor,
            rotate: 0,
            interval: 0,
            formatter: (value: string) => isMultiDayLabel(value) ? formatXAxisLabel(value) : value,
          },
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
          axisLabel: { show: true, color: colors.mutedColor, fontSize: 9, formatter: (value: number) => formatVolume(value) },
          splitLine: { show: false },
        },
      ],
      dataZoom,
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
        axisLabel: {
          color: colors.mutedColor,
          rotate: 0,
          interval: 0,
          formatter: (value: string) => isMultiDayLabel(value) ? formatXAxisLabel(value) : value,
        },
      },
    ],
    yAxes: [
      {
        type: "value",
        scale: true,
        splitArea: { show: false },
        splitLine: { lineStyle: { color: colors.gridLineColor } },
        axisLine: { lineStyle: { color: colors.borderColor } },
        axisLabel: {
          color: colors.mutedColor,
          formatter: (value: number) => "₹" + (value >= 100 ? value.toFixed(0) : value.toFixed(2)),
        },
      },
    ],
    dataZoom,
  };
}
