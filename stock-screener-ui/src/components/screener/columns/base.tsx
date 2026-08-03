import type { ColumnDef } from "./index";
import { getPnLTextColor, formatPercentage, formatTimeAgo } from "../../../utils/ui-helpers";
import { Tooltip, Text } from "@/ui";

export const symbolCol: ColumnDef = {
  key: "symbol",
  label: "Symbol",
  type: "string",
  sortable: true,
};

export const scoreCol: ColumnDef = {
  key: "score",
  label: "Score",
  type: "badge",
  sortable: true,
};

export const sectorCol: ColumnDef = {
  key: "sector",
  label: "Sector",
  type: "string",
  sortable: true,
};

export const dayChangeCol: ColumnDef = {
  key: "day_change",
  label: "Day Change",
  type: "number",
  sortable: true,
  format: (value: number) => {
    return { value: formatPercentage(value, 2, true), className: getPnLTextColor(value) };
  },
};

export const volumeMCol: ColumnDef = {
  key: "volume_m",
  label: "Volume (M)",
  type: "number",
  sortable: true,
  format: (value: number) => (value ?? 0).toFixed(2),
};

export const rsiCol: ColumnDef = {
  key: "rsi",
  label: "RSI",
  type: "number",
  sortable: true,
  format: (value: number) => (value ?? 0).toFixed(1),
};

export const adxCol: ColumnDef = {
  key: "adx",
  label: "ADX",
  type: "number",
  sortable: true,
  format: (value: number) => (value ?? 0).toFixed(1),
};

export const touched52wCol: ColumnDef = {
  key: "touched_52w",
  label: "Touched",
  type: "badge",
  sortable: true,
  format: (value: boolean, stock: any) => {
    if (!value) return "No";
    const lastTouched = stock?.last_touched;
    if (lastTouched) {
      const timeAgo = formatTimeAgo(lastTouched);
      const fullDate = new Date(lastTouched).toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      return (
        <Tooltip label={`Touched on ${fullDate} (${timeAgo})`}>
          <Text span fw={500} c="blue">
            Yes ({timeAgo})
          </Text>
        </Tooltip>
      );
    }
    return "Yes";
  },
};

export const volumeSurgeCol: ColumnDef = {
  key: "volume_surge",
  label: "Vol Surge",
  type: "number",
  sortable: true,
  format: (value: number) => (value ?? 1).toFixed(1) + "x",
};

export const moveCol = (key: string, label: string): ColumnDef => ({
  key,
  label,
  type: "number",
  sortable: true,
  format: (value: number) => ({
    value: value != null ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "-",
    className: value != null ? getPnLTextColor(value) : "",
  }),
});

function pctFormat(value: number) {
  const cls = value > 0 ? "green" : "red";
  return { value: `${value > 0 ? "+" : ""}${value.toFixed(1)}%`, className: cls };
}

export const recentReturn5dCol: ColumnDef = {
  key: "recent_return_5d",
  label: "Return 5D",
  type: "number",
  sortable: true,
  format: (value: number) => ({
    ...pctFormat(value),
    value: `${value > 5 ? "🚀" : value > 0 ? "🟢" : "🔴"} ${pctFormat(value).value}`,
  }),
};

export const perfWCol: ColumnDef = {
  key: "perf_w",
  label: "Perf W",
  type: "number",
  sortable: true,
  format: pctFormat,
};
