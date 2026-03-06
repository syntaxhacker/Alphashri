import type { ColumnDef } from "./index";
import type { Stock } from "../../../types";

export function getTrendingColumns(): ColumnDef[] {
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
      key: "touched_52w",
      label: "Touched",
      type: "badge",
      sortable: true,
      format: (value: boolean) => (value ? "Yes" : "No"),
    },
    {
      key: "tv_price",
      label: "Price",
      type: "number",
      sortable: true,
      format: (value: number) => `₹${value.toFixed(2)}`,
    },
    {
      key: "upstox_price",
      label: "LTP",
      type: "number",
      sortable: true,
      format: (value: number) => `₹${value.toFixed(2)}`,
    },
    {
      key: "broker_diff",
      label: "Broker Diff",
      type: "number",
      sortable: true,
      format: (value: number, _stock: Stock) => {
        const cls = Math.abs(value) < 1.0 ? "green" : "yellow";
        return { value: `${value > 0 ? "+" : ""}${value.toFixed(2)}%`, className: cls };
      },
    },
    {
      key: "to_52w_high",
      label: "To 52W High",
      type: "number",
      sortable: true,
      format: (value: number) => {
        const cls = value < 0 ? "green" : value > 0.5 ? "red" : "";
        return { value: `${value > 0 ? "+" : ""}${value.toFixed(2)}%`, className: cls };
      },
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
