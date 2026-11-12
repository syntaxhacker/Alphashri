import { Show, createMemo, createSignal } from "solid-js";
import { Badge, Box, Group, Select, Text, UnstyledButton } from "@/ui";
import { selectRun } from "../../state/experiments";
import { useExperimentState } from "./useExperimentState";
import type { ExperimentRun, RunMetrics } from "../../types/experiments";
import {
  formatSignedPnl,
  getPnLTextColor,
} from "../../utils/ui-helpers";
import { TanStackTable } from "../common/TanStackTable";
import type { TableColumnDef as ColumnDef } from "../common/TanStackTable";

function configLabel(run: ExperimentRun): string {
  if (run.description) return run.description;
  const entries = Object.entries(run.config || {});
  if (entries.length === 0) return run.strategy;
  return entries.map(([k, v]) => `${k}=${v}`).join(", ");
}

function RunStatusBadge(props: { run: ExperimentRun }) {
  const keep = () => props.run.status === "keep";
  return (
    <Badge
      color={keep() ? "success" : "error"}
      variant="filled"
      size="sm"
      data-testid={`experiments-status-${props.run.run}`}
    >
      {keep() ? "✅ Keep" : "❌ Discard"}
    </Badge>
  );
}

interface SymbolRow {
  symbol: string;
  metrics: RunMetrics;
}

function PerSymbolTable(props: {
  run: ExperimentRun;
  symbolFilter: () => string | null;
}) {
  const rows = createMemo<SymbolRow[]>(() => {
    const filter = props.symbolFilter();
    const symbols = filter
      ? [filter]
      : Object.keys(props.run.per_symbol || {});
    return symbols
      .map((symbol) => ({ symbol, metrics: props.run.per_symbol?.[symbol] }))
      .filter((r): r is SymbolRow => !!r.metrics);
  });

  const columns = createMemo<ColumnDef<SymbolRow>[]>(() => [
    {
      id: "symbol",
      header: "Symbol",
      accessorKey: "symbol",
      meta: { align: "left" },
      cell: (info) => (
        <Text size="sm" fw={500}>
          {info.row.original.symbol}
        </Text>
      ),
    },
    {
      id: "profit_factor",
      header: "PF",
      accessorFn: (row) => row.metrics.profit_factor,
      meta: { align: "right" },
      cell: (info) => <Text size="sm">{info.row.original.metrics.profit_factor.toFixed(2)}</Text>,
    },
    {
      id: "win_rate",
      header: "WR%",
      accessorFn: (row) => row.metrics.win_rate,
      meta: { align: "right" },
      cell: (info) => <Text size="sm">{info.row.original.metrics.win_rate.toFixed(0)}%</Text>,
    },
    {
      id: "net_pnl",
      header: "Net",
      accessorFn: (row) => row.metrics.net_pnl,
      meta: { align: "right" },
      cell: (info) => (
        <Text size="sm" c={getPnLTextColor(info.row.original.metrics.net_pnl)}>
          {formatSignedPnl(info.row.original.metrics.net_pnl)}
        </Text>
      ),
    },
    {
      id: "total_trades",
      header: "Trades",
      accessorFn: (row) => row.metrics.total_trades,
      meta: { align: "right" },
      cell: (info) => <Text size="sm">{info.row.original.metrics.total_trades}</Text>,
    },
  ]);

  return (
    <Show
      when={rows().length > 0}
      fallback={
        <Text size="xs" c="dimmed">
          No per-symbol breakdown
        </Text>
      }
    >
      <TanStackTable<SymbolRow>
        data={rows()}
        columns={columns()}
        enableSorting={false}
        dataTestId={`experiments-symbol-table-${props.run.run}`}
        getRowTestId={(row) => `experiments-symbol-row-${props.run.run}-${row.symbol}`}
        dense
      />
    </Show>
  );
}

export function ExperimentsResultsTable() {
  const state = useExperimentState();
  const results = createMemo(() => state().results);
  const selectedRun = createMemo(() => state().selectedRun);

  const [symbolFilter, setSymbolFilter] = createSignal<string | null>(null);

  const allSymbols = createMemo(() => {
    const r = results();
    if (!r) return [];
    const set = new Set<string>();
    for (const run of r) {
      for (const symbol of run.symbols) set.add(symbol);
    }
    return [...set].sort();
  });

  const visibleRuns = createMemo(() => {
    const r = results();
    if (!r) return [];
    if (!symbolFilter()) return r;
    return r.filter((run) => run.symbols.includes(symbolFilter()!));
  });

  const bestRun = createMemo(() => {
    const r = results();
    if (!r || r.length === 0) return null;
    return r.reduce((best, run) =>
      run.metrics.profit_factor > best.metrics.profit_factor ? run : best,
    );
  });

  const columns = createMemo<ColumnDef<ExperimentRun>[]>(() => [
    {
      id: "toggle",
      header: "",
      enableSorting: false,
      size: 40,
      meta: { align: "center" },
      cell: (info) => (
        <UnstyledButton
          data-testid={`experiments-expand-${info.row.original.run}`}
          onClick={(e) => {
            e.stopPropagation();
            info.row.toggle();
          }}
          aria-expanded={info.row.isExpanded()}
        >
          <Text size="sm" c="dimmed">
            {info.row.isExpanded() ? "▾" : "▸"}
          </Text>
        </UnstyledButton>
      ),
    },
    {
      id: "run",
      header: "#",
      enableSorting: false,
      accessorKey: "run",
      meta: { align: "right" },
      cell: (info) => (
        <Text size="sm" fw={500}>
          {info.row.original.run}
        </Text>
      ),
    },
    {
      id: "config",
      header: "Config",
      enableSorting: false,
      accessorFn: (run) => configLabel(run),
      meta: { align: "left" },
      cell: (info) => (
        <Text size="sm" lineClamp={1}>
          {configLabel(info.row.original)}
        </Text>
      ),
    },
    {
      id: "profit_factor",
      header: () => (
        <span data-testid="experiments-sort-profit_factor">PF</span>
      ),
      accessorFn: (run) => run.metrics.profit_factor,
      meta: { align: "right" },
      cell: (info) => (
        <Text size="sm">{info.row.original.metrics.profit_factor.toFixed(2)}</Text>
      ),
    },
    {
      id: "win_rate",
      header: () => (
        <span data-testid="experiments-sort-win_rate">WR%</span>
      ),
      accessorFn: (run) => run.metrics.win_rate,
      meta: { align: "right" },
      cell: (info) => {
        const val = info.row.original.metrics.win_rate;
        return (
          <Text
            size="sm"
            c={
              val >= 50
                ? "success"
                : val >= 40
                  ? "dimmed"
                  : "error"
            }
          >
            {val.toFixed(0)}%
          </Text>
        );
      },
    },
    {
      id: "net_pnl",
      header: () => (
        <span data-testid="experiments-sort-net_pnl">Net P&amp;L</span>
      ),
      accessorFn: (run) => run.metrics.net_pnl,
      meta: { align: "right" },
      cell: (info) => {
        const val = info.row.original.metrics.net_pnl;
        return (
          <Text size="sm" c={getPnLTextColor(val)} fw={500}>
            {formatSignedPnl(val)}
          </Text>
        );
      },
    },
    {
      id: "total_trades",
      header: () => (
        <span data-testid="experiments-sort-total_trades">Trades</span>
      ),
      accessorFn: (run) => run.metrics.total_trades,
      meta: { align: "right" },
      cell: (info) => (
        <Group gap={6} wrap="nowrap" align="center">
          <Text size="sm">{info.row.original.metrics.total_trades}</Text>
          <Show when={info.row.original.metrics.total_trades < 10}>
            <Badge
              color="warning"
              variant="light"
              size="xs"
              data-testid={`experiments-low-sample-${info.row.original.run}`}
            >
              ⚠ Low sample
            </Badge>
          </Show>
        </Group>
      ),
    },
    {
      id: "tp_sl_eod",
      header: "TP/SL/EOD",
      enableSorting: false,
      meta: { align: "center" },
      accessorFn: (run) =>
        `${run.metrics.tp_exits}/${run.metrics.sl_exits}/${run.metrics.eod_exits}`,
      cell: (info) => (
        <Text size="sm">
          {info.row.original.metrics.tp_exits}/{info.row.original.metrics.sl_exits}/{info.row.original.metrics.eod_exits}
        </Text>
      ),
    },
    {
      id: "status",
      header: "Status",
      enableSorting: false,
      meta: { align: "center" },
      accessorFn: (run) => run.status,
      cell: (info) => <RunStatusBadge run={info.row.original} />,
    },
  ]);

  return (
    <Show
      when={results() && results()!.length > 0}
      fallback={
        <Box data-testid="experiments-results-empty" py="md">
          <Text c="dimmed" ta="center">
            No results yet. Start an experiment to see runs.
          </Text>
        </Box>
      }
    >
      <Box data-testid="experiments-results-table">
        <Group justify="space-between" align="center" mb="xs">
          <Text fw={600} size="sm">
            Results ({results()!.length})
          </Text>
          <Select
            data-testid="experiments-symbol-filter"
            data={allSymbols().map((symbol) => ({ value: symbol, label: symbol }))}
            value={symbolFilter()}
            onChange={(v) => setSymbolFilter(v)}
            placeholder="All symbols"
            clearable
            searchable
            w={170}
            size="sm"
          />
        </Group>

        <TanStackTable<ExperimentRun>
          data={visibleRuns()}
          columns={columns()}
          dataTestId="experiments-results-table-inner"
          initialState={{ sorting: [{ id: "profit_factor", desc: true }] }}
          enableSorting
          enableSortingRemoval={false}
          dense
          getRowCanExpand={() => true}
          renderSubComponent={(run) => (
            <Box p={0.5}>
              <Text size="xs" fw={600} c="dimmed" style={{ "margin-bottom": 4 }}>
                Per-symbol breakdown
              </Text>
              <PerSymbolTable run={run} symbolFilter={symbolFilter} />
            </Box>
          )}
          onRowClick={(run) => void selectRun(run)}
          getRowTestId={(run) => `experiments-run-row-${run.run}`}
          getRowStyle={(run) => ({
            cursor: "pointer",
            "background-color":
              selectedRun()?.run === run.run
                ? "primary.light"
                : bestRun()?.run === run.run
                  ? "success.light"
                  : undefined,
          })}
        />
      </Box>
    </Show>
  );
}
