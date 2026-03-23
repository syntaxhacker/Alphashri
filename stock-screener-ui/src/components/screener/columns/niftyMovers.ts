import type { ColumnDef } from "./index";
import { symbolCol, scoreCol, sectorCol, dayChangeCol, volumeMCol } from "./base";

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
        const cls = value >= 0 ? "green" : "red";
        return { value: `${value >= 0 ? "+" : ""}${value.toFixed(2)}`, className: cls };
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
