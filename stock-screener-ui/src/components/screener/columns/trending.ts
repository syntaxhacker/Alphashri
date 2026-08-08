import type { ColumnDef } from "./index";
import { symbolCol, scoreCol, sectorCol, recentReturn5dCol, perfWCol, touched52wCol, dayChangeCol } from "./base";

const formatSignedPercent = (v: number) => {
  const n = v ?? 0;
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
};

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
    dayChangeCol,
    {
      key: "to_52w_high",
      label: "To 52W High",
      type: "number",
      sortable: true,
      format: (value: number) => {
        const cls = value < 0 ? "green" : value > 0.5 ? "red" : "";
        return { value: formatSignedPercent(value), className: cls };
      },
    },
    recentReturn5dCol,
    perfWCol,
    sectorCol,
  ];
}
