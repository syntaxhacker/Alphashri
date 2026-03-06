import type { ColumnDef } from "./index";
import type { Stock } from "../../../types";

export function getHighMomentumColumns(): ColumnDef[] {
  return [
    {
      key: "symbol",
      label: "Symbol",
      type: "string",
      sortable: true,
    },
    {
      key: "score",
      label: "Score",
      type: "number",
      sortable: true,
      format: (value: number) => String(value),
    },
    {
      key: "rsi",
      label: "RSI",
      type: "number",
      sortable: true,
      format: (value: number) => (value ?? 0).toFixed(1),
    },
    {
      key: "day_change",
      label: "Day Change",
      type: "number",
      sortable: true,
      format: (value: number) => {
        const cls = value >= 0 ? "green" : "red";
        return { value: `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`, className: cls };
      },
    },
    {
      key: "volume_m",
      label: "Volume (M)",
      type: "number",
      sortable: true,
      format: (value: number) => (value ?? 0).toFixed(2),
    },
    {
      key: "recent_return_5d",
      label: "Return 5D",
      type: "number",
      sortable: true,
      format: (value: number) => {
        const icon = value > 5 ? "🚀" : value > 0 ? "🟢" : "🔴";
        const cls = value > 0 ? "green" : "red";
        return { value: `${icon} ${value > 0 ? "+" : ""}${value.toFixed(1)}%`, className: cls };
      },
    },
    {
      key: "perf_w",
      label: "Perf W",
      type: "number",
      sortable: true,
      format: (value: number) => {
        const cls = value > 0 ? "green" : "red";
        return { value: `${value > 0 ? "+" : ""}${value.toFixed(1)}%`, className: cls };
      },
    },
    {
      key: "sector",
      label: "Sector",
      type: "string",
      sortable: true,
    },
  ];
}
