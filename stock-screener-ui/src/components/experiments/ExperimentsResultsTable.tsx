import { useMemo, useState } from "react";
import { Badge, Box, Group, Select, Text, UnstyledButton } from "@/ui";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import {
  getExperimentState,
  selectRun,
  subscribe,
} from "../../state/experiments";
import type { ExperimentRun, RunMetrics } from "../../types/experiments";
import {
  formatSignedPnl,
  getPnLTextColor,
} from "../../utils/ui-helpers";
import { TanStackTable } from "../common/TanStackTable";
import type { ColumnDef } from "@tanstack/react-table";

function configLabel(run: ExperimentRun): string {
  if (run.description) return run.description;
  const entries = Object.entries(run.config || {});
  if (entries.length === 0) return run.strategy;
  return entries.map(([k, v]) => `${k}=${v}`).join(", ");
}

function RunStatusBadge({ run }: { run: ExperimentRun }) {
  if (run.status === "keep") {
    return (
      <Badge
        color="success"
        variant="light"
        size="sm"
        data-testid={`experiments-status-${run.run}`}
      >
        ✅ Keep
      </Badge>
    );
  }
  return (
    <Badge
      color="error"
      variant="light"
      size="sm"
      data-testid={`experiments-status-${run.run}`}
    >
      ❌ Discard
    </Badge>
  );
}

interface SymbolRow {
  symbol: string;
  metrics: RunMetrics;
}

function PerSymbolTable({
  run,
  symbolFilter,
}: {
  run: ExperimentRun;
  symbolFilter: string | null;
}) {
  const rows = useMemo<SymbolRow[]>(() => {
    const symbols = symbolFilter
      ? [symbolFilter]
      : Object.keys(run.per_symbol || {});
    return symbols
      .map((symbol) => ({ symbol, metrics: run.per_symbol?.[symbol] }))
      .filter((r): r is SymbolRow => !!r.metrics);
  }, [run, symbolFilter]);

  const columns = useMemo<ColumnDef<SymbolRow>[]>(
    () => [
      {
        id: "symbol",
        header: "Symbol",
        accessorKey: "symbol",
        cell: (info) => (
          <Text size="sm" fw={500}>
            {info.getValue<string>()}
          </Text>
        ),
      },
      {
        id: "profit_factor",
        header: "PF",
        accessorFn: (row) => row.metrics.profit_factor,
        meta: { align: "right" },
        cell: (info) => <Text size="sm">{info.getValue<number>().toFixed(2)}</Text>,
      },
      {
        id: "win_rate",
        header: "WR%",
        accessorFn: (row) => row.metrics.win_rate,
        meta: { align: "right" },
        cell: (info) => <Text size="sm">{info.getValue<number>().toFixed(0)}%</Text>,
      },
      {
        id: "net_pnl",
        header: "Net",
        accessorFn: (row) => row.metrics.net_pnl,
        meta: { align: "right" },
        cell: (info) => (
          <Text size="sm" c={getPnLTextColor(info.getValue<number>())}>
            {formatSignedPnl(info.getValue<number>())}
          </Text>
        ),
      },
      {
        id: "total_trades",
        header: "Trades",
        accessorFn: (row) => row.metrics.total_trades,
        meta: { align: "right" },
        cell: (info) => <Text size="sm">{info.getValue<number>()}</Text>,
      },
    ],
    [],
  );

  if (rows.length === 0) {
    return (
      <Text size="xs" c="dimmed">
        No per-symbol breakdown
      </Text>
    );
  }

  return (
    <TanStackTable<SymbolRow>
      data={rows}
      columns={columns}
      enableSorting={false}
      dataTestId={`experiments-symbol-table-${run.run}`}
      getRowTestId={(row) => `experiments-symbol-row-${run.run}-${row.symbol}`}
    />
  );
}

export function ExperimentsResultsTable() {
  useStoreSubscription(subscribe);
  const { results, selectedRun } = getExperimentState();

  const [symbolFilter, setSymbolFilter] = useState<string | null>(null);

  const allSymbols = useMemo(() => {
    if (!results) return [];
    const set = new Set<string>();
    for (const run of results) {
      for (const symbol of run.symbols) set.add(symbol);
    }
    return [...set].sort();
  }, [results]);

  const visibleRuns = useMemo(() => {
    if (!results) return [];
    if (!symbolFilter) return results;
    return results.filter((run) => run.symbols.includes(symbolFilter));
  }, [results, symbolFilter]);

  const bestRun = useMemo(() => {
    if (!results || results.length === 0) return null;
    return results.reduce((best, run) =>
      run.metrics.profit_factor > best.metrics.profit_factor ? run : best,
    );
  }, [results]);

  const columns = useMemo<ColumnDef<ExperimentRun>[]>(
    () => [
      {
        id: "toggle",
        header: "",
        enableSorting: false,
        size: 40,
        cell: ({ row }) => (
          <UnstyledButton
            data-testid={`experiments-expand-${row.original.run}`}
            onClick={(e) => {
              e.stopPropagation();
              row.toggleExpanded();
            }}
            aria-expanded={row.getIsExpanded()}
          >
            <Text size="sm" c="dimmed">
              {row.getIsExpanded() ? "▾" : "▸"}
            </Text>
          </UnstyledButton>
        ),
      },
      {
        id: "run",
        header: "#",
        enableSorting: false,
        accessorKey: "run",
        cell: (info) => (
          <Text size="sm" fw={500}>
            {info.getValue<number>()}
          </Text>
        ),
      },
      {
        id: "config",
        header: "Config",
        enableSorting: false,
        accessorFn: (run) => configLabel(run),
        cell: (info) => (
          <Text size="sm" lineClamp={1}>
            {info.getValue<string>()}
          </Text>
        ),
      },
      {
        id: "profit_factor",
        header: () => (
          <span data-testid="experiments-sort-profit_factor">PF</span>
        ),
        accessorFn: (run) => run.metrics.profit_factor,
        sortDescFirst: true,
        meta: { align: "right" },
        cell: (info) => (
          <Text size="sm">{info.getValue<number>().toFixed(2)}</Text>
        ),
      },
      {
        id: "win_rate",
        header: () => (
          <span data-testid="experiments-sort-win_rate">WR%</span>
        ),
        accessorFn: (run) => run.metrics.win_rate,
        sortDescFirst: true,
        meta: { align: "right" },
        cell: (info) => {
          const val = info.getValue<number>();
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
          <span data-testid="experiments-sort-net_pnl">Net P&L</span>
        ),
        accessorFn: (run) => run.metrics.net_pnl,
        sortDescFirst: true,
        meta: { align: "right" },
        cell: (info) => {
          const val = info.getValue<number>();
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
        sortDescFirst: true,
        meta: { align: "right" },
        cell: ({ row }) => (
          <Group gap={6} wrap="nowrap">
            <Text size="sm">{row.original.metrics.total_trades}</Text>
            {row.original.metrics.total_trades < 10 && (
              <Badge
                color="warning"
                variant="light"
                size="xs"
                data-testid={`experiments-low-sample-${row.original.run}`}
              >
                ⚠ Low sample
              </Badge>
            )}
          </Group>
        ),
      },
      {
        id: "tp_sl_eod",
        header: "TP/SL/EOD",
        enableSorting: false,
        accessorFn: (run) =>
          `${run.metrics.tp_exits}/${run.metrics.sl_exits}/${run.metrics.eod_exits}`,
        cell: (info) => <Text size="sm">{info.getValue<string>()}</Text>,
      },
      {
        id: "status",
        header: "Status",
        enableSorting: false,
        accessorFn: (run) => run.status,
        cell: ({ row }) => <RunStatusBadge run={row.original} />,
      },
    ],
    [],
  );

  if (!results || results.length === 0) {
    return (
      <Box data-testid="experiments-results-empty" py="md">
        <Text c="dimmed" ta="center">
          No results yet. Start an experiment to see runs.
        </Text>
      </Box>
    );
  }

  return (
    <Box data-testid="experiments-results-table">
      <Group justify="space-between" align="center" mb="xs">
        <Text fw={600} size="sm">
          Results ({results.length})
        </Text>
        <Select
          data-testid="experiments-symbol-filter"
          data={allSymbols.map((symbol) => ({ value: symbol, label: symbol }))}
          value={symbolFilter}
          onChange={setSymbolFilter}
          placeholder="All symbols"
          clearable
          searchable
          style={{ width: 170 }}
          size="sm"
        />
      </Group>

      <TanStackTable<ExperimentRun>
        data={visibleRuns}
        columns={columns}
        dataTestId="experiments-results-table-inner"
        initialState={{ sorting: [{ id: "profit_factor", desc: true }] }}
        enableSortingRemoval={false}
        getRowCanExpand={() => true}
        renderSubComponent={(run) => (
          <Box p="xs">
            <Text size="xs" fw={600} c="dimmed" style={{ marginBottom: 4 }}>
              Per-symbol breakdown
            </Text>
            <PerSymbolTable run={run} symbolFilter={symbolFilter} />
          </Box>
        )}
        onRowClick={(run) => void selectRun(run)}
        getRowTestId={(run) => `experiments-run-row-${run.run}`}
        getRowStyle={(run) => ({
          cursor: "pointer",
          backgroundColor:
            selectedRun?.run === run.run
              ? "primary.light"
              : bestRun?.run === run.run
                ? "success.light"
                : undefined,
        })}
      />
    </Box>
  );
}
