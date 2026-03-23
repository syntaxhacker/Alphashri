import type { ColumnDef } from "./index";
import { symbolCol, scoreCol, sectorCol, dayChangeCol, volumeMCol } from "./base";

export function getMarketOpenGapColumns(): ColumnDef[] {
  return [
    symbolCol,
    scoreCol,
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
    dayChangeCol,
    volumeMCol,
    sectorCol,
  ];
}
