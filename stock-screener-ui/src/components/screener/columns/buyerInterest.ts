import type { ColumnDef } from "./index";
import { symbolCol, scoreCol, sectorCol, touched52wCol, dayChangeCol, volumeMCol, perfWCol } from "./base";

export function getBuyerInterestColumns(): ColumnDef[] {
  return [
    symbolCol,
    scoreCol,
    touched52wCol,
    dayChangeCol,
    volumeMCol,
    { ...perfWCol, key: "recent_return_5d", label: "Return 5D" },
    sectorCol,
  ];
}
