import type { ColumnDef } from "./index";
import { symbolCol, scoreCol, sectorCol, rsiCol, adxCol, recentReturn5dCol, perfWCol, dayChangeCol } from "./base";

export function getNear52wBreakoutColumns(): ColumnDef[] {
  return [
    symbolCol,
    scoreCol,
    rsiCol,
    adxCol,
    dayChangeCol,
    {
      key: "to_52w_high",
      label: "52W Gap %",
      type: "number",
      sortable: true,
      format: (value: number) => {
        const cls = value < 0 ? "green" : value > 2 ? "red" : "";
        return { value: `${value > 0 ? "+" : ""}${value.toFixed(2)}%`, className: cls };
      },
    },
    recentReturn5dCol,
    perfWCol,
    sectorCol,
  ];
}