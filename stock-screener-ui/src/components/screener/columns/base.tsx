import type { ColumnDef } from "./index";
import { formatPercentage, formatTimeAgo } from "../../../utils/ui-helpers";
import { Tooltip } from "@/ui";
import { BadgeCell, NumCell } from "@/components/common/tableCells";
import { fixedOrZero, numCol, signedPercent, tonePositive } from "./columnHelpers";

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
  format: (value: number) => (
    <NumCell value={value} signed format={(v) => formatPercentage(v, 2, true)} />
  ),
};

export const volumeMCol: ColumnDef = {
  key: "volume_m",
  label: "Volume (M)",
  type: "number",
  sortable: true,
  format: (value: number) => <NumCell value={value ?? 0} format={(v) => fixedOrZero(v, 2)} />,
};

export const rsiCol: ColumnDef = {
  key: "rsi",
  label: "RSI",
  type: "number",
  sortable: true,
  format: (value: number) => <NumCell value={value ?? 0} format={(v) => fixedOrZero(v, 1)} />,
};

export const adxCol: ColumnDef = {
  key: "adx",
  label: "ADX",
  type: "number",
  sortable: true,
  format: (value: number) => <NumCell value={value ?? 0} format={(v) => fixedOrZero(v, 1)} />,
};

export const touched52wCol: ColumnDef = {
  key: "touched_52w",
  label: "Touched",
  type: "badge",
  sortable: true,
  format: (value: boolean, stock: any) => {
    if (!value) return <BadgeCell label="No" color="secondary" />;
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
          <BadgeCell label={`Yes (${timeAgo})`} color="success" />
        </Tooltip>
      );
    }
    return <BadgeCell label="Yes" color="success" />;
  },
};

export const volumeSurgeCol: ColumnDef = {
  key: "volume_surge",
  label: "Vol Surge",
  type: "number",
  sortable: true,
  format: (value: number) => <NumCell value={value ?? 1} format={(v) => `${v.toFixed(1)}x`} />,
};

export const moveCol = (key: string, label: string): ColumnDef =>
  numCol(key, label, (value: number) => (
    <NumCell value={value} signed dash="-" format={(v) => signedPercent(v, 2)} />
  ));

export const recentReturn5dCol: ColumnDef = {
  key: "recent_return_5d",
  label: "Return 5D",
  type: "number",
  sortable: true,
  format: (value: number) => (
    <NumCell
      value={value}
      tone={tonePositive(value)}
      format={(v) => `${v > 5 ? "🚀" : v > 0 ? "🟢" : "🔴"} ${signedPercent(v, 1)}`}
    />
  ),
};

export const perfWCol: ColumnDef = {
  key: "perf_w",
  label: "Perf W",
  type: "number",
  sortable: true,
  format: (value: number) => (
    <NumCell value={value} tone={tonePositive(value)} format={(v) => signedPercent(v, 1)} />
  ),
};
