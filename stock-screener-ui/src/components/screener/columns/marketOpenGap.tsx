import type { ColumnDef } from "./index";
import { symbolCol, scoreCol, sectorCol, dayChangeCol, volumeMCol } from "./base";
import { NumCell } from "@/components/common/tableCells";
import { numCol } from "./columnHelpers";
import { formatPercentage } from "../../../utils/ui-helpers";

const pctFormat = (value: number) => (
  <NumCell value={value} signed format={(v) => formatPercentage(v, 2, true)} />
);

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
