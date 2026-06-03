import type { ColumnDef } from "./index";
import { symbolCol, scoreCol } from "./base";

export type Week52Section = "approaching" | "touched";

const gapCol: ColumnDef = {
  key: "to_52w_high",
  label: "52W Gap %",
  type: "number",
  sortable: true,
  format: (value: number) => {
    const cls = value < 0 ? "green" : value > 2 ? "red" : "";
    return { value: `${value > 0 ? "+" : ""}${value.toFixed(2)}%`, className: cls };
  },
};

const coreCols: ColumnDef[] = [
  symbolCol,
  scoreCol,
  gapCol,
  {
    key: "high_52w",
    label: "52W High",
    type: "number",
    sortable: true,
    format: (value: number) => ({ value: value?.toFixed(2) || "-" }),
  },
  {
    key: "low_52w",
    label: "52W Low",
    type: "number",
    sortable: true,
    format: (value: number | undefined) => {
      if (value === null || value === undefined) return "-";
      return { value: value.toFixed(2) };
    },
  },
  {
    key: "upstox_price",
    label: "LTP",
    type: "number",
    sortable: true,
    format: (value: number) => `₹${value.toFixed(2)}`,
  },
  {
    key: "days_ago",
    label: "Days Ago",
    type: "number",
    sortable: true,
    format: (value: number | null) => {
      if (value === null || value === undefined) return "-";
      if (value === 0) return { value: "Today" };
      if (value === 1) return { value: "1d" };
      return { value: `${value}d` };
    },
  },
];

/** 52W high screener columns now expose volume (raw + _m), rsi, adx thanks to TV scanner enrichment. */
export function get52wHighColumns(_section: Week52Section = "approaching"): ColumnDef[] {
  return [
    ...coreCols,
    {
      key: "volume_m",
      label: "Vol M",
      type: "number",
      sortable: true,
      format: (value: number) => (value != null ? value.toFixed(2) : "-"),
    },
    {
      key: "volume",
      label: "Volume",
      type: "number",
      sortable: true,
      format: (value: number) => (value != null ? Math.round(value).toLocaleString() : "-"),
    },
    {
      key: "rsi",
      label: "RSI",
      type: "number",
      sortable: true,
      format: (value: number) => (value != null ? value.toFixed(1) : "-"),
    },
    {
      key: "adx",
      label: "ADX",
      type: "number",
      sortable: true,
      format: (value: number) => (value != null ? value.toFixed(1) : "-"),
    },
  ];
}