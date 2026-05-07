import type { ColumnDef } from "./index";
import {
  symbolCol,
  rsiCol,
  adxCol,
  dayChangeCol,
  recentReturn5dCol,
  perfWCol,
  volumeMCol,
} from "./base";

export function getTouched52wColumns(): ColumnDef[] {
  return [
    symbolCol,
    rsiCol,
    adxCol,
    dayChangeCol,
    recentReturn5dCol,
    {
      key: "high_52w",
      label: "52W",
      type: "number",
      sortable: true,
      format: (value: number) => ({ value: value?.toFixed(2) || "-" }),
    },
    {
      key: "days_ago",
      label: "Days Ago",
      type: "number",
      sortable: true,
      format: (value: number | null) => {
        if (value === null || value === undefined) return "-";
        const suffix = value === 1 ? "d" : "d";
        return { value: `${value}${suffix}` };
      },
    },
    perfWCol,
    volumeMCol,
  ];
}
