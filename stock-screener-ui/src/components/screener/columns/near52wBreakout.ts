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
import { gapCol } from "./columnHelpers";

export function getNear52wBreakoutColumns(): ColumnDef[] {
  return [
    symbolCol,
    scoreCol,
    rsiCol,
    adxCol,
    dayChangeCol,
    gapCol(),
    recentReturn5dCol,
    perfWCol,
    sectorCol,
  ];
}
