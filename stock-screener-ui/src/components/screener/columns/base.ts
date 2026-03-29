import type { ColumnDef } from "./index";
import { getPnLTextColor, formatPercentage } from "../../../utils/ui-helpers";

export const symbolCol: ColumnDef = {
  key: "symbol",
  label: "Symbol",
  type: "string",
  sortable: true,
};

export const scoreCol: ColumnDef = {
  key: "score",
  label: "Score",
  type: "badge",
  sortable: true,
};

export const sectorCol: ColumnDef = {
  key: "sector",
  label: "Sector",
  type: "string",
  sortable: true,
};

export const dayChangeCol: ColumnDef = {
  key: "day_change",
  label: "Day Change",
  type: "number",
  sortable: true,
  format: (value: number) => {
    return { value: formatPercentage(value, 2, true), className: getPnLTextColor(value) };
  },
};

export const volumeMCol: ColumnDef = {
  key: "volume_m",
  label: "Volume (M)",
  type: "number",
  sortable: true,
  format: (value: number) => (value ?? 0).toFixed(2),
};

export const rsiCol: ColumnDef = {
  key: "rsi",
  label: "RSI",
  type: "number",
  sortable: true,
  format: (value: number) => (value ?? 0).toFixed(1),
};

export const touched52wCol: ColumnDef = {
  key: "touched_52w",
  label: "Touched",
  type: "badge",
  sortable: true,
  format: (value: boolean) => (value ? "Yes" : "No"),
};

export const recentReturn5dCol: ColumnDef = {
  key: "recent_return_5d",
  label: "Return 5D",
  type: "number",
  sortable: true,
  format: (value: number) => {
    const icon = value > 5 ? "🚀" : value > 0 ? "🟢" : "🔴";
    const cls = value > 0 ? "green" : "red";
    return { value: `${icon} ${value > 0 ? "+" : ""}${value.toFixed(1)}%`, className: cls };
  },
};

export const perfWCol: ColumnDef = {
  key: "perf_w",
  label: "Perf W",
  type: "number",
  sortable: true,
  format: (value: number) => {
    const cls = value > 0 ? "green" : "red";
    return { value: `${value > 0 ? "+" : ""}${value.toFixed(1)}%`, className: cls };
  },
};
