import type { ColumnDef } from "./index";
import { symbolCol, scoreCol, dayChangeCol, volumeMCol, volumeSurgeCol, sectorCol, rsiCol, moveCol } from "./base";

export function getIntraday5mColumns(): ColumnDef[] {
  return [
    symbolCol,
    moveCol("move_5m", "5-Min Move"),
    scoreCol,
    volumeSurgeCol,
    rsiCol,
    { key: "upstox_price", label: "Price", type: "number", sortable: true },
    dayChangeCol,
    volumeMCol,
    sectorCol,
  ];
}

export function getIntraday10mColumns(): ColumnDef[] {
  return [
    symbolCol,
    moveCol("move_10m", "10-Min Move"),
    scoreCol,
    volumeSurgeCol,
    rsiCol,
    { key: "upstox_price", label: "Price", type: "number", sortable: true },
    dayChangeCol,
    volumeMCol,
    sectorCol,
  ];
}

export function getIntraday15mColumns(): ColumnDef[] {
  return [
    symbolCol,
    moveCol("move_15m", "15-Min Move"),
    scoreCol,
    volumeSurgeCol,
    rsiCol,
    { key: "upstox_price", label: "Price", type: "number", sortable: true },
    dayChangeCol,
    volumeMCol,
    sectorCol,
  ];
}
