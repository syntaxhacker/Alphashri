import type { ColumnDef } from "./index";
import { symbolCol, scoreCol, sectorCol, dayChangeCol, volumeMCol } from "./base";
import { getPnLTextColor } from "../../../utils/ui-helpers";
import { numCol, fixedOrZero, signedFixed } from "./columnHelpers";

export function getNiftyMoversColumns(): ColumnDef[] {
  return [
    symbolCol,
    scoreCol,
    numCol("impact_score", "Impact Score", (value: number) => ({
      value: signedFixed(value, 2, true),
      className: getPnLTextColor(value),
    })),
    numCol("market_cap_b", "Market Cap (B)", (value: number) => `${fixedOrZero(value, 1)}B`),
    dayChangeCol,
    volumeMCol,
    sectorCol,
  ];
}
