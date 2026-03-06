import type { ColumnDef } from "./index";
import type { Stock } from "../../../types";

export function getRsiReversalColumns(): ColumnDef[] {
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
      key: "stoch_k",
      label: "Stoch K",
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
      key: "sector",
      label: "Sector",
      type: "string",
      sortable: true,
    },
  ];
}
