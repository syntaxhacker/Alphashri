import type { ColumnDef } from "./index";
import { symbolCol, scoreCol, sectorCol, dayChangeCol } from "./base";
import { numCol, rupeePrice, fixedOrZero, pctOrEmpty } from "./columnHelpers";

export function getUndervaluedColumns(): ColumnDef[] {
  return [
    symbolCol,
    scoreCol,
    numCol("tv_price", "Price", (value: number) => rupeePrice(value)),
    dayChangeCol,
    numCol("pe", "P/E", (value: number) => fixedOrZero(value, 1)),
    numCol("pb", "P/B", (value: number) => fixedOrZero(value, 2)),
    numCol("roe", "ROE%", (value: number) => `${fixedOrZero(value, 1)}%`),
    numCol("de", "D/E", (value: number) => fixedOrZero(value, 2)),
    numCol("div_yield", "Div%", (value: number) => pctOrEmpty(value, 1)),
    numCol("market_cap_b", "Mcap(B)", (value: number) => `₹${fixedOrZero(value, 1)}B`),
    sectorCol,
  ];
}
