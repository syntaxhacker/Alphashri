import type { ColumnDef } from "./index";
import {
  symbolCol,
  scoreCol,
  sectorCol,
  rsiCol,
  dayChangeCol,
  volumeMCol,
  recentReturn5dCol,
  perfWCol,
} from "./base";

export function getHighMomentumColumns(): ColumnDef[] {
  return [
    symbolCol,
    scoreCol,
    rsiCol,
    dayChangeCol,
    volumeMCol,
    recentReturn5dCol,
    perfWCol,
    sectorCol,
  ];
}
