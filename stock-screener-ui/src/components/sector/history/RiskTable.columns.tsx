import type { TableColumnDef } from "../../common/TanStackTable";
import { NumCell, TextCell } from "../../common/tableCells";
import type { SectorHistoryRisk } from "../../../types/sectorHistory";
import { formatPercentage } from "../../../utils/ui-helpers";
import { MiniSparkline } from "./visuals/MiniSparkline";
import { CHART_MUTED, CHART_NEGATIVE, CHART_POSITIVE } from "./visuals/chartPalette";

export interface RiskRow extends SectorHistoryRisk {
  spark: (number | null)[];
}

const DASH = "—";

const missingTone = (value: number | null): "dimmed" | undefined =>
  value == null ? "dimmed" : undefined;

const drawdownTone = (value: number | null): "dimmed" | "error" | undefined =>
  value == null ? "dimmed" : value < 0 ? "error" : undefined;

/** Compound the monthly returns, clamped at -100% so a bad print cannot flip the sign. */
export function cumulativeReturn(values: (number | null)[]): number | null {
  let factor = 1;
  let seen = false;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    factor *= 1 + Math.max(-100, value) / 100;
    seen = true;
  }
  return seen ? (factor - 1) * 100 : null;
}

function CumulativeCell(props: { row: RiskRow }) {
  const final = () => cumulativeReturn(props.row.spark);
  const value = () => {
    const current = final();
    return current == null ? DASH : formatPercentage(current, 1);
  };
  const label = () => {
    const current = final();
    return current == null ? "Cumulative return unavailable" : `Cumulative return ${value()}`;
  };
  const color = () => {
    const current = final();
    return current == null ? CHART_MUTED : current >= 0 ? CHART_POSITIVE : CHART_NEGATIVE;
  };
  return (
    <div
      class="flex items-center justify-center gap-1 leading-none"
      title={label()}
      data-testid={`sector-history-risk-spark-${props.row.name}`}
      aria-label={label()}
    >
      <MiniSparkline values={props.row.spark} width={80} height={18} tone="neutral" />
      <span
        data-testid={`sector-history-risk-cumulative-${props.row.name}`}
        class="text-ui-micro font-mono tabular-nums whitespace-nowrap"
        style={{ color: color() }}
      >
        {value()}
      </span>
    </div>
  );
}

/** Column descriptors for the sector-history risk table; kept beside the consumer. */
export const columns: TableColumnDef<RiskRow>[] = [
  {
    id: "sector",
    header: "Sector",
    accessorKey: "name",
    size: 160,
    meta: { align: "left" },
    cell: ({ row }) => <TextCell value={row.original.name} title={row.original.name} fw={600} />,
  },
  {
    id: "max_drawdown",
    header: "Max DD",
    accessorKey: "max_drawdown",
    size: 76,
    meta: { align: "right" },
    cell: ({ row }) => (
      <NumCell
        value={row.original.max_drawdown}
        tone={drawdownTone(row.original.max_drawdown)}
        format={(value) => formatPercentage(value, 1, false)}
        testId={`sector-history-risk-max-dd-${row.original.name}`}
      />
    ),
  },
  {
    id: "current_drawdown",
    header: "Current DD",
    accessorKey: "current_drawdown",
    size: 88,
    meta: { align: "right" },
    cell: ({ row }) => (
      <NumCell
        value={row.original.current_drawdown}
        tone={drawdownTone(row.original.current_drawdown)}
        format={(value) => formatPercentage(value, 1, false)}
        testId={`sector-history-risk-current-dd-${row.original.name}`}
      />
    ),
  },
  {
    id: "recovery_days",
    header: "Recovery days",
    accessorKey: "recovery_days",
    size: 96,
    meta: { align: "right" },
    cell: ({ row }) => (
      <NumCell
        value={row.original.recovery_days}
        tone={missingTone(row.original.recovery_days)}
        format={(value) => `${value}d`}
        testId={`sector-history-risk-recovery-${row.original.name}`}
      />
    ),
  },
  {
    id: "sharpe",
    header: "Sharpe",
    accessorKey: "sharpe",
    size: 68,
    meta: { align: "right" },
    cell: ({ row }) => (
      <NumCell
        value={row.original.sharpe}
        tone={missingTone(row.original.sharpe)}
        signed
        format={(value) => value.toFixed(2)}
        testId={`sector-history-risk-sharpe-${row.original.name}`}
      />
    ),
  },
  {
    id: "volatility",
    header: "Vol",
    accessorKey: "volatility",
    size: 68,
    meta: { align: "right" },
    cell: ({ row }) => (
      <NumCell
        value={row.original.volatility}
        tone={missingTone(row.original.volatility)}
        format={(value) => formatPercentage(value, 1, false)}
        testId={`sector-history-risk-volatility-${row.original.name}`}
      />
    ),
  },
  {
    id: "spark",
    header: "Cumulative return",
    size: 152,
    enableSorting: false,
    meta: { align: "center" },
    cell: ({ row }) => <CumulativeCell row={row.original} />,
  },
];
