import type { ColumnDef } from "./index";
import { symbolCol, scoreCol, sectorCol, dayChangeCol, volumeMCol } from "./base";
import { NumCell } from "@/components/common/tableCells";
import { numCol, fixedOrZero, signedFixed } from "./columnHelpers";

export function getNiftyMoversColumns(): ColumnDef[] {
  return [
    symbolCol,
    scoreCol,
    numCol("impact_score", "Impact Score", (value: number) => (
      <NumCell value={value} signed format={(v) => signedFixed(v, 2, true)} />
    )),
    numCol("market_cap_b", "Market Cap (B)", (value: number) => (
      <NumCell value={value ?? 0} format={(v) => `${fixedOrZero(v, 1)}B`} />
    )),
    dayChangeCol,
    volumeMCol,
    sectorCol,
  ];
}
