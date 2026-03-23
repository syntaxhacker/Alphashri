import type { ColumnDef } from "./index";
import type { Stock } from "../../../types";
import { symbolCol, scoreCol, sectorCol, recentReturn5dCol, perfWCol, touched52wCol } from "./base";

export function getTrendingColumns(): ColumnDef[] {
  return [
    symbolCol,
    scoreCol,
    touched52wCol,
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
    recentReturn5dCol,
    perfWCol,
    sectorCol,
  ];
}
