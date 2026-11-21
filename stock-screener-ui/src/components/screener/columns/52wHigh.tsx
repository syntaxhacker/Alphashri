import type { ColumnDef } from "./index";
import { symbolCol, scoreCol, dayChangeCol } from "./base";
import { NumCell } from "@/components/common/tableCells";
import {
  daysAgoCell,
  fixedCellDash,
  fixedCellOrString,
  fixedOrDash,
  formattedText,
  intLocaleOrDash,
  numCol,
  rupeePrice,
  signedPercent,
  gapTone,
} from "./columnHelpers";

export type Week52Section = "approaching" | "touched";

const gapCol: ColumnDef = numCol("to_52w_high", "52W Gap %", (value: number) => (
  <NumCell value={value} format={(v) => signedPercent(v, 2)} tone={gapTone(value, 2) || undefined} />
));

const coreCols: ColumnDef[] = [
  symbolCol,
  scoreCol,
  gapCol,
  numCol("high_52w", "52W High", (value: number) => (
    <NumCell value={value} dash="-" format={(v) => formattedText(fixedCellDash(v, 2))} />
  )),
  numCol("low_52w", "52W Low", (value: number | undefined) => (
    <NumCell value={value} dash="-" format={(v) => formattedText(fixedCellOrString(v, 2))} />
  )),
  numCol("upstox_price", "LTP", (value: number) => (
    <NumCell value={value} dash="-" format={rupeePrice} />
  )),
  numCol("days_ago", "Days Ago", (value: number | null) => (
    <NumCell value={value} dash="-" format={(v) => formattedText(daysAgoCell(v, "Today"))} />
  )),
];

/** 52W high screener columns now expose volume (raw + _m), rsi, adx thanks to TV scanner enrichment. */
export function get52wHighColumns(_section: Week52Section = "approaching"): ColumnDef[] {
  return [
    ...coreCols,
    numCol("volume_m", "Vol M", (value: number) => (
      <NumCell value={value} dash="-" format={(v) => fixedOrDash(v, 2)} />
    )),
    numCol("volume", "Volume", (value: number) => (
      <NumCell value={value} dash="-" format={(v) => intLocaleOrDash(v)} />
    )),
    numCol("rsi", "RSI", (value: number) => (
      <NumCell value={value} dash="-" format={(v) => fixedOrDash(v, 1)} />
    )),
    numCol("adx", "ADX", (value: number) => (
      <NumCell value={value} dash="-" format={(v) => fixedOrDash(v, 1)} />
    )),
    dayChangeCol,
  ];
}
