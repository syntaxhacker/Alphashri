import type { ColumnDef } from "./index";
import { symbolCol, scoreCol, sectorCol, rsiCol, dayChangeCol, volumeMCol } from "./base";

export function getRsiReversalColumns(): ColumnDef[] {
  return [
    symbolCol,
    scoreCol,
    rsiCol,
    {
      key: "stoch_k",
      label: "Stoch K",
      type: "number",
      sortable: true,
      format: (value: number) => (value ?? 0).toFixed(1),
    },
    dayChangeCol,
    volumeMCol,
    sectorCol,
  ];
}
