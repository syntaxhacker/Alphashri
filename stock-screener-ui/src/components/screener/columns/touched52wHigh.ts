import type { ColumnDef } from "./index";
import {
  symbolCol,
  rsiCol,
  adxCol,
  dayChangeCol,
  recentReturn5dCol,
  perfWCol,
  volumeMCol,
} from "./base";
import { numCol, fixedCellDash, daysAgoCell } from "./columnHelpers";

export function getTouched52wColumns(): ColumnDef[] {
  return [
    symbolCol,
    rsiCol,
    adxCol,
    dayChangeCol,
    recentReturn5dCol,
    numCol("high_52w", "52W", (value: number) => fixedCellDash(value, 2)),
    numCol("days_ago", "Days Ago", (value: number | null) => daysAgoCell(value)),
    perfWCol,
    volumeMCol,
  ];
}
