import type { ColumnDef } from "./index";
import { symbolCol, scoreCol, sectorCol, dayChangeCol, volumeMCol } from "./base";
import { getPnLTextColor, formatPercentage } from "../../../utils/ui-helpers";

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
        return { value: formatPercentage(value, 2, true), className: getPnLTextColor(value) };
      },
    },
    {
      key: "premarket_change",
      label: "Premarket Change",
      type: "number",
      sortable: true,
      format: (value: number) => {
        return { value: formatPercentage(value, 2, true), className: getPnLTextColor(value) };
      },
    },
    dayChangeCol,
    volumeMCol,
    sectorCol,
  ];
}
