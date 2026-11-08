import type { ColumnDef } from "./index";
import { symbolCol, scoreCol, dayChangeCol } from "./base";
import {
  gapCell,
  fixedCellDash,
  fixedCellOrString,
  rupeePrice,
  daysAgoCell,
  fixedOrDash,
  intLocaleOrDash,
  numCol,
} from "./columnHelpers";

export type Week52Section = "approaching" | "touched";

const gapCol: ColumnDef = numCol("to_52w_high", "52W Gap %", (value: number) => gapCell(value, 2));

const coreCols: ColumnDef[] = [
  symbolCol,
  scoreCol,
  gapCol,
  numCol("high_52w", "52W High", (value: number) => fixedCellDash(value, 2)),
  numCol("low_52w", "52W Low", (value: number | undefined) => fixedCellOrString(value, 2)),
  numCol("upstox_price", "LTP", (value: number) => rupeePrice(value)),
  numCol("days_ago", "Days Ago", (value: number | null) => daysAgoCell(value, "Today")),
];

/** 52W high screener columns now expose volume (raw + _m), rsi, adx thanks to TV scanner enrichment. */
export function get52wHighColumns(_section: Week52Section = "approaching"): ColumnDef[] {
  return [
    ...coreCols,
    numCol("volume_m", "Vol M", (value: number) => fixedOrDash(value, 2)),
    numCol("volume", "Volume", (value: number) => intLocaleOrDash(value)),
    numCol("rsi", "RSI", (value: number) => fixedOrDash(value, 1)),
    numCol("adx", "ADX", (value: number) => fixedOrDash(value, 1)),
    dayChangeCol,
  ];
}
