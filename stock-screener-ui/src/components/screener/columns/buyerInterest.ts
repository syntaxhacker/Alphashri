import type { ColumnDef } from "./index";
import { symbolCol, scoreCol, sectorCol, touched52wCol, dayChangeCol, volumeMCol } from "./base";

export function getBuyerInterestColumns(): ColumnDef[] {
  return [
    symbolCol,
    scoreCol,
    touched52wCol,
    dayChangeCol,
    volumeMCol,
    {
      key: "recent_return_5d",
      label: "Return 5D",
      type: "number",
      sortable: true,
      format: (value: number) => {
        const cls = value > 0 ? "green" : "red";
        return { value: `${value > 0 ? "+" : ""}${value.toFixed(1)}%`, className: cls };
      },
    },
    sectorCol,
  ];
}
