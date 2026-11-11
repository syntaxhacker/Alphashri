import type { ColumnDef } from "./index";
import { getPnLTextColor, formatTimeAgo } from "../../../utils/ui-helpers";
import { Tooltip, Text } from "@/ui";
import {
  pnlPctCell,
  fixedOrZero,
  signedPercent,
  signedPercentCell,
  numCol,
} from "./columnHelpers";

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
  format: (value: number) => pnlPctCell(value),
};

export const volumeMCol: ColumnDef = {
  key: "volume_m",
  label: "Volume (M)",
  type: "number",
  sortable: true,
  format: (value: number) => fixedOrZero(value, 2),
};

export const rsiCol: ColumnDef = {
  key: "rsi",
  label: "RSI",
  type: "number",
  sortable: true,
  format: (value: number) => fixedOrZero(value, 1),
};

export const adxCol: ColumnDef = {
  key: "adx",
  label: "ADX",
  type: "number",
  sortable: true,
  format: (value: number) => fixedOrZero(value, 1),
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
          <Text span fw={500} c="primary">
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

export const moveCol = (key: string, label: string): ColumnDef =>
  numCol(key, label, (value: number) =>
    value != null
      ? { value: signedPercent(value, 2), className: getPnLTextColor(value) }
      : { value: "-", className: "" },
  );

export const recentReturn5dCol: ColumnDef = {
  key: "recent_return_5d",
  label: "Return 5D",
  type: "number",
  sortable: true,
  format: (value: number) => {
    const cell = signedPercentCell(value, 1);
    return {
      ...cell,
      value: `${value > 5 ? "🚀" : value > 0 ? "🟢" : "🔴"} ${cell.value}`,
    };
  },
};

export const perfWCol: ColumnDef = {
  key: "perf_w",
  label: "Perf W",
  type: "number",
  sortable: true,
  format: (value: number) => signedPercentCell(value, 1),
};
