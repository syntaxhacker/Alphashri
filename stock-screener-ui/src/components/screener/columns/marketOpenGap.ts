import type { ColumnDef } from "./index";
import { symbolCol, scoreCol, sectorCol, dayChangeCol, volumeMCol } from "./base";
import { numCol, pnlPctCell } from "./columnHelpers";

const pctFormat = (value: number) => pnlPctCell(value);

export function getMarketOpenGapColumns(): ColumnDef[] {
  return [
    symbolCol,
    scoreCol,
    numCol("gap_pct", "Gap %", pctFormat),
    numCol("premarket_change", "Premarket Change", pctFormat),
    dayChangeCol,
    volumeMCol,
    sectorCol,
  ];
}
