import type { ColumnDef } from "./index";

export function getNiftyMoversColumns(): ColumnDef[] {
  return [
    {
      key: "symbol",
      label: "Symbol",
      type: "string",
      sortable: true,
    },
    {
      key: "score",
      label: "Score",
      type: "number",
      sortable: true,
      format: (value: number) => String(value),
    },
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
    {
      key: "day_change",
      label: "Day Change",
      type: "number",
      sortable: true,
      format: (value: number) => {
        const cls = value >= 0 ? "green" : "red";
        return { value: `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`, className: cls };
      },
    },
    {
      key: "volume_m",
      label: "Volume (M)",
      type: "number",
      sortable: true,
      format: (value: number) => (value ?? 0).toFixed(2),
    },
    {
      key: "sector",
      label: "Sector",
      type: "string",
      sortable: true,
    },
  ];
}
