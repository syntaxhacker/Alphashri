import type { ColumnDef } from "./index";
import { symbolCol, scoreCol, sectorCol, dayChangeCol, volumeMCol } from "./base";
import { getPnLTextColor } from "../../../utils/ui-helpers";

export function getNiftyMoversColumns(): ColumnDef[] {
  return [
    symbolCol,
    scoreCol,
    {
      key: "impact_score",
      label: "Impact Score",
      type: "number",
      sortable: true,
      format: (value: number) => {
        return {
          value: `${value >= 0 ? "+" : ""}${value.toFixed(2)}`,
          className: getPnLTextColor(value),
        };
      },
    },
    {
      key: "market_cap_b",
      label: "Market Cap (B)",
      type: "number",
      sortable: true,
      format: (value: number) => `${(value ?? 0).toFixed(1)}B`,
    },
    dayChangeCol,
    volumeMCol,
    sectorCol,
  ];
}
