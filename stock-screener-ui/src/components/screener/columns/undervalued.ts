import type { ColumnDef } from "./index";
import type { Stock } from "../../../types";
import { symbolCol, scoreCol, sectorCol, dayChangeCol } from "./base";

export function getUndervaluedColumns(): ColumnDef[] {
  return [
    symbolCol,
    scoreCol,
    {
      key: "tv_price",
      label: "Price",
      type: "number" as const,
      sortable: true,
      format: (value: number) => `₹${(value ?? 0).toFixed(2)}`,
    },
    dayChangeCol,
    {
      key: "pe",
      label: "P/E",
      type: "number" as const,
      sortable: true,
      format: (value: number) => (value ?? 0).toFixed(1),
    },
    {
      key: "pb",
      label: "P/B",
      type: "number" as const,
      sortable: true,
      format: (value: number) => (value ?? 0).toFixed(2),
    },
    {
      key: "roe",
      label: "ROE%",
      type: "number" as const,
      sortable: true,
      format: (value: number) => `${(value ?? 0).toFixed(1)}%`,
    },
    {
      key: "de",
      label: "D/E",
      type: "number" as const,
      sortable: true,
      format: (value: number) => (value ?? 0).toFixed(2),
    },
    {
      key: "div_yield",
      label: "Div%",
      type: "number" as const,
      sortable: true,
      format: (value: number) => (value && value > 0 ? `${value.toFixed(1)}%` : ""),
    },
    {
      key: "market_cap_b",
      label: "Mcap(B)",
      type: "number" as const,
      sortable: true,
      format: (value: number) => `₹${(value ?? 0).toFixed(1)}B`,
    },
    sectorCol,
  ];
}
