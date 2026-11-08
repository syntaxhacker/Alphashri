import type { ColumnDef } from "./index";
import {
  symbolCol,
  scoreCol,
  sectorCol,
  rsiCol,
  adxCol,
  recentReturn5dCol,
  perfWCol,
  dayChangeCol,
} from "./base";
import { numCol, gapCell } from "./columnHelpers";

export function getNear52wBreakoutColumns(): ColumnDef[] {
  return [
    symbolCol,
    scoreCol,
    rsiCol,
    adxCol,
    dayChangeCol,
    numCol("to_52w_high", "52W Gap %", (value: number) => gapCell(value, 2)),
    recentReturn5dCol,
    perfWCol,
    sectorCol,
  ];
}
