import type { ColumnDef } from "./index";
import type { Stock } from "../../../types";

export function getMarketOpenGapColumns(): ColumnDef[] {
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
      key: "gap_pct",
      label: "Gap %",
      type: "number",
      sortable: true,
      format: (value: number) => {
        const cls = value >= 0 ? "green" : "red";
        return { value: `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`, className: cls };
      },
    },
    {
      key: "premarket_change",
      label: "Premarket Change",
      type: "number",
      sortable: true,
      format: (value: number) => {
        const cls = value >= 0 ? "green" : "red";
        return { value: `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`, className: cls };
      },
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
