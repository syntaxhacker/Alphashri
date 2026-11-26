import { Show, createMemo } from "solid-js";
import { Badge, Box, Text } from "@/ui";
import { AGRI_CONTEXT, AGRI_DOWN, AGRI_UP } from "@/ui/palette";
import { CompactPanel } from "@/components/common/compact";
import { ErrorAlert } from "@/components/common/states";
import { Sparkline } from "@/components/common/Sparkline";
import { NumCell } from "@/components/common/tableCells";
import { TanStackTable, type TableColumnDef } from "@/components/common/TanStackTable";
import { agriCommodityLabel, agriGroup, formatChangePct } from "@/config/agri";
import { formatAgriSessionDate } from "./agriDates";
import {
  coverageTierTitle,
  coverageTierTone,
  resolveCoverageTier,
  type AgriCoverageTier,
} from "./AgriGroupOverview";

/**
 * One commodity row of the group fluctuation matrix. Field names mirror the
 * `/api/agri` snapshot payload so a caller can pass snapshot rows after adding
 * the 3M change and coverage metadata. Every numeric field is optional and may
 * be null; a missing cell is rendered as an em dash, never as zero.
 */
export interface AgriFluctuationMatrixRow {
  key: string;
  label?: string | null;
  group?: string | null;
  chg_1w_pct?: number | null;
  chg_1m_pct?: number | null;
  chg_3m_pct?: number | null;
  chg_6m_pct?: number | null;
  /** Mandis reporting for the quoted sample. */
  markets?: number | null;
  /** Observations in the sample, when available. */
  dates?: number | null;
  coverage_pct?: number | null;
  tier?: AgriCoverageTier | string | null;
  as_of?: string | null;
  /** Optional normalized price path used for the in-cell sparkline. */
  sparkline?: ReadonlyArray<number | null> | null;
  /** Pre-computed horizon cells, accepted instead of the flat change fields. */
  cells?: ReadonlyArray<{ key?: string; label?: string; value?: number | null }> | null;
  /** Horizon-keyed changes, accepted instead of the flat change fields. */
  changes?: Partial<Record<string, number | null>> | null;
}

export interface AgriFluctuationMatrixProps {
  rows?: readonly AgriFluctuationMatrixRow[] | null;
  asOf?: string | null;
  /** Group key or label shown in the panel description. */
  group?: string | null;
  title?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onSelect?: (commodity: string) => void;
  selected?: string | null;
  className?: string;
  testId?: string;
  "data-testid"?: string;
}

interface MatrixPeriod {
  id: string;
  header: string;
  field: "chg_1w_pct" | "chg_1m_pct" | "chg_3m_pct" | "chg_6m_pct";
  title: string;
}

const MATRIX_PERIODS: readonly MatrixPeriod[] = [
  { id: "1w", header: "1W", field: "chg_1w_pct", title: "1 week" },
  { id: "1m", header: "1M", field: "chg_1m_pct", title: "1 month" },
  { id: "3m", header: "3M", field: "chg_3m_pct", title: "3 month" },
  { id: "6m", header: "6M", field: "chg_6m_pct", title: "6 month" },
];

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function labelOf(row: AgriFluctuationMatrixRow): string {
  const label = typeof row.label === "string" ? row.label.trim() : "";
  return label || agriCommodityLabel(row.key, row.key);
}

/**
 * Accepts the flat snapshot field first, then the horizon-keyed / pre-computed
 * cell shapes returned by the agri aggregation helpers. The first finite value
 * wins; a null stays null so a real gap is never filled by a fallback zero.
 */
function valueOf(row: AgriFluctuationMatrixRow, period: MatrixPeriod): number | null {
  const direct = finiteNumber(row[period.field]);
  if (direct != null) return direct;

  const changes = row.changes;
  if (changes && typeof changes === "object") {
    const fromChanges =
      finiteNumber(changes[period.header]) ??
      finiteNumber(changes[period.id]) ??
      finiteNumber(changes[period.id.toUpperCase()]);
    if (fromChanges != null) return fromChanges;
  }

  const cells = Array.isArray(row.cells) ? row.cells : [];
  for (const cell of cells) {
    if (!cell) continue;
    const key = typeof cell.key === "string" ? cell.key.toUpperCase() : "";
    const label = typeof cell.label === "string" ? cell.label.toUpperCase() : "";
    if (key === period.header || label === period.header) {
      return finiteNumber(cell.value);
    }
  }
  return null;
}

function changeColour(value: number | null): string {
  if (value == null || value === 0) return "var(--color-fin-text-muted)";
  return value > 0 ? AGRI_UP : AGRI_DOWN;
}

function coverageTone(value: number | null): string {
  if (value == null) return AGRI_CONTEXT;
  if (value >= 80) return AGRI_UP;
  if (value >= 50) return AGRI_CONTEXT;
  return AGRI_DOWN;
}

function tierOf(row: AgriFluctuationMatrixRow): AgriCoverageTier | null {
  return resolveCoverageTier({
    tier: row.tier,
    mandis: row.markets,
    coverage_pct: row.coverage_pct,
  });
}

function tierText(tier: AgriCoverageTier | null): string {
  if (!tier) return "Tier —";
  return tier === "C" ? "Tier C · thin" : `Tier ${tier}`;
}

function normalizeRows(
  rows: readonly AgriFluctuationMatrixRow[] | null | undefined,
): AgriFluctuationMatrixRow[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const output: AgriFluctuationMatrixRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (typeof row.key !== "string" || row.key === "" || seen.has(row.key)) continue;
    seen.add(row.key);
    output.push(row);
  }
  return output;
}

function ChangeCell(props: { row: AgriFluctuationMatrixRow; period: MatrixPeriod }) {
  const value = () => valueOf(props.row, props.period);
  const sparkline = () =>
    Array.isArray(props.row.sparkline) ? props.row.sparkline.slice() : [];
  const title = () => {
    if (value() == null) return `${props.period.title} change unavailable (gap)`;
    return `${props.period.title} change vs the prior period`;
  };

  return (
    <Box
      className="flex min-w-0 items-center justify-end gap-1"
      data-testid={`agri-matrix-cell-${props.row.key}-${props.period.id}`}
    >
      <Show when={value() != null}>
        <Sparkline
          values={sparkline()}
          width={16}
          height={9}
          color={changeColour(value())}
        />
      </Show>
      <NumCell
        value={value()}
        signed
        format={formatChangePct}
        title={title()}
        testId={`agri-matrix-value-${props.row.key}-${props.period.id}`}
      />
    </Box>
  );
}

function CommodityCell(props: { row: AgriFluctuationMatrixRow }) {
  const tier = () => tierOf(props.row);
  const markets = () => finiteNumber(props.row.markets);
  const dates = () => finiteNumber(props.row.dates);
  const coverage = () => finiteNumber(props.row.coverage_pct);

  const sampleText = () => {
    const count = markets();
    if (count != null) return `${Math.round(count)}m`;
    const sessions = dates();
    if (sessions != null) return `${Math.round(sessions)} obs`;
    return "sample —";
  };

  const sampleTitle = () => {
    const parts: string[] = [];
    const count = markets();
    const sessions = dates();
    if (count != null) parts.push(`${Math.round(count)} mandis reporting`);
    if (sessions != null) parts.push(`${Math.round(sessions)} observations`);
    return parts.length > 0 ? `Sample: ${parts.join(" · ")}` : "Sample coverage unavailable";
  };

  return (
    <Box
      className="flex min-w-0 flex-col justify-center gap-0.5"
      title={`${labelOf(props.row)} · ${sampleTitle()}`}
      data-testid={`agri-matrix-commodity-${props.row.key}`}
    >
      <Box className="flex min-w-0 items-center gap-1">
        <Text size="xs" fw={700} truncate className="min-w-0 flex-1">
          {labelOf(props.row)}
        </Text>
        <Badge
          size="xs"
          color={coverageTierTone(tier())}
          title={coverageTierTitle(tier())}
          data-testid={`agri-matrix-tier-${props.row.key}`}
        >
          {tierText(tier())}
        </Badge>
      </Box>
      <Box className="flex min-w-0 items-center gap-1">
        <Badge
          size="xs"
          color="secondary"
          title={sampleTitle()}
          data-testid={`agri-matrix-sample-${props.row.key}`}
        >
          {sampleText()}
        </Badge>
        <Badge
          size="xs"
          color={coverageTone(coverage())}
          title={
            coverage() == null
              ? "Date coverage unavailable"
              : `${Math.round(coverage() as number)}% of expected sessions have data`
          }
          data-testid={`agri-matrix-coverage-${props.row.key}`}
        >
          {coverage() == null ? "cov —" : `${Math.round(coverage() as number)}%`}
        </Badge>
      </Box>
    </Box>
  );
}

const MATRIX_WIDTH = 512;

/** Commodity names share a line with their tier; sample/coverage sit beneath.
 *  The taller rows keep both lines legible without clipping either badge. */
const MATRIX_TABLE_CLASS =
  "[&_.paper-tanstack-header-cell]:h-[30px]! [&_.paper-tanstack-cell]:h-[34px]!";

const matrixColumnDefs: TableColumnDef<AgriFluctuationMatrixRow>[] = [
  {
    id: "commodity",
    header: "Commodity",
    accessorFn: (row) => labelOf(row),
    size: 176,
    meta: { align: "left" },
    cell: (ctx) => <CommodityCell row={ctx.row.original} />,
  },
  ...MATRIX_PERIODS.map((period) => ({
    id: period.id,
    header: period.header,
    accessorFn: (row: AgriFluctuationMatrixRow) => valueOf(row, period),
    size: 84,
    meta: { align: "right" as const },
    enableSorting: true,
    cell: (ctx: { row: { original: AgriFluctuationMatrixRow } }) => (
      <ChangeCell row={ctx.row.original} period={period} />
    ),
  })),
];

export function AgriFluctuationMatrix(props: AgriFluctuationMatrixProps) {
  const testId = () => props.testId ?? props["data-testid"] ?? "agri-fluctuation-matrix";
  const panelId = () => `${testId()}-panel`;
  const rows = createMemo(() => normalizeRows(props.rows));

  const groupText = () => {
    if (!props.group) return null;
    return agriGroup(props.group)?.label ?? props.group;
  };

  const asOf = () => {
    if (props.asOf) return props.asOf;
    for (const row of rows()) {
      if (typeof row.as_of === "string" && row.as_of) return row.as_of;
    }
    return null;
  };

  const description = () => {
    const parts: string[] = [];
    const group = groupText();
    if (group) parts.push(group);
    parts.push(`${rows().length} ${rows().length === 1 ? "commodity" : "commodities"}`);
    parts.push(`as of ${formatAgriSessionDate(asOf())}`);
    parts.push("— = gap");
    return parts.join(" · ");
  };

  const table = (
    <Box
      className="flex min-h-0 flex-1 flex-col"
      style={{ "min-height": "180px" }}
      data-testid={`${testId()}-region`}
    >
      <TanStackTable<AgriFluctuationMatrixRow>
        data={rows()}
        columns={matrixColumnDefs}
        dataTestId={testId()}
        className={MATRIX_TABLE_CLASS}
        bare
        stickyHeader
        minTableWidth={MATRIX_WIDTH}
        rowWindowSize={80}
        loading={props.loading}
        loadingMessage="Loading fluctuation matrix…"
        emptyMessage="No commodities in this group"
        onRowClick={props.onSelect ? (row) => props.onSelect?.(row.key) : undefined}
        getRowTestId={(row) => `agri-matrix-row-${row.key}`}
        getRowClassName={(row) =>
          props.selected === row.key ? "bg-fin-surface-alt" : undefined
        }
        getRowAttributes={(row) => ({
          "data-selected": props.selected === row.key ? "true" : "false",
        })}
        ariaLabel="Agricultural commodity fluctuation matrix"
      />
      <Text
        size="xs"
        c="dimmed"
        className="shrink-0 px-1 pb-1 text-ui-micro sm:hidden"
        data-testid={`${testId()}-scroll-hint`}
      >
        Swipe horizontally for 3M and 6M →
      </Text>
    </Box>
  );

  return (
    <CompactPanel
      testId={panelId()}
      title={props.title ?? "Fluctuation matrix"}
      description={description()}
      action={
        props.loading && rows().length > 0 ? (
          <Badge size="xs" color="primary">
            Updating
          </Badge>
        ) : undefined
      }
      className={["flex min-h-0 flex-1 flex-col", props.className].filter(Boolean).join(" ")}
      scrollable
      style={{ "min-height": "260px" }}
    >
      <Show when={props.error} fallback={table}>
        {(message) => (
          <ErrorAlert
            message={message()}
            withRetry={!!props.onRetry}
            onRetry={props.onRetry}
            data-testid={`${testId()}-error`}
          />
        )}
      </Show>
    </CompactPanel>
  );
}
