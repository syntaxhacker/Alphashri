import type { ColumnDef } from "./index";
import { symbolCol, scoreCol, dayChangeCol, volumeMCol, volumeSurgeCol, sectorCol, rsiCol, moveCol } from "./base";
import { numCol } from "./columnHelpers";

function intradayColumns(moveKey: string, moveLabel: string): ColumnDef[] {
  return [
    symbolCol,
    moveCol(moveKey, moveLabel),
    scoreCol,
    volumeSurgeCol,
    rsiCol,
    numCol("upstox_price", "Price"),
    dayChangeCol,
    volumeMCol,
    sectorCol,
  ];
}

export function getIntraday5mColumns(): ColumnDef[] {
  return intradayColumns("move_5m", "5-Min Move");
}

export function getIntraday10mColumns(): ColumnDef[] {
  return intradayColumns("move_10m", "10-Min Move");
}

export function getIntraday15mColumns(): ColumnDef[] {
  return intradayColumns("move_15m", "15-Min Move");
}
