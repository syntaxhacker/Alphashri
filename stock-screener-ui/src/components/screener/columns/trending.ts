import type { ColumnDef } from "./index";
import { symbolCol, scoreCol, sectorCol, recentReturn5dCol, perfWCol, touched52wCol, dayChangeCol } from "./base";
import { numCol, rupeePrice, gapCell } from "./columnHelpers";

export function getTrendingColumns(): ColumnDef[] {
  return [
    symbolCol,
    scoreCol,
    touched52wCol,
    numCol("tv_price", "Price", (value: number) => rupeePrice(value)),
    numCol("upstox_price", "LTP", (value: number) => rupeePrice(value)),
    dayChangeCol,
    numCol("to_52w_high", "To 52W High", (value: number) => gapCell(value, 0.5)),
    recentReturn5dCol,
    perfWCol,
    sectorCol,
  ];
}
