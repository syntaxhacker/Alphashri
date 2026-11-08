import type { ColumnDef } from "./index";
import { symbolCol, scoreCol, sectorCol, rsiCol, dayChangeCol, volumeMCol } from "./base";
import { numCol, fixedOrZero } from "./columnHelpers";

export function getRsiReversalColumns(): ColumnDef[] {
  return [
    symbolCol,
    scoreCol,
    rsiCol,
    numCol("stoch_k", "Stoch K", (value: number) => fixedOrZero(value, 1)),
    dayChangeCol,
    volumeMCol,
    sectorCol,
  ];
}
