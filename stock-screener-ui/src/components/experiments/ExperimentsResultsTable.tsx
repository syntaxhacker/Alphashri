import { Fragment, useCallback, useMemo, useState } from "react";
import { Badge, Box, Group, Select, Table, Text, UnstyledButton } from "@/ui";
import type { UITableProps } from "@/ui";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import {
  getExperimentState,
  selectRun,
  subscribe,
} from "../../state/experiments";
import type { ExperimentRun, RunMetrics } from "../../types/experiments";
import {
  formatSignedPnl,
  getNextSortDirection,
  getPnLTextColor,
  renderSortIndicator,
} from "../../utils/ui-helpers";

type SortKey = "profit_factor" | "win_rate" | "net_pnl" | "total_trades";

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "profit_factor", label: "PF" },
  { key: "win_rate", label: "WR%" },
  { key: "net_pnl", label: "Net P&L" },
  { key: "total_trades", label: "Trades" },
];

function sortValue(run: ExperimentRun, key: SortKey): number {
  return run.metrics[key];
}

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
        color="green"
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
      color="red"
      variant="light"
      size="sm"
      data-testid={`experiments-status-${run.run}`}
    >
      ❌ Discard
    </Badge>
  );
}

function PerSymbolTable({
  run,
  symbolFilter,
}: {
  run: ExperimentRun;
  symbolFilter: string | null;
}) {
  const symbols = symbolFilter
    ? [symbolFilter]
    : Object.keys(run.per_symbol || {});
  if (symbols.length === 0) {
    return (
      <Text size="xs" c="dimmed">
        No per-symbol breakdown
      </Text>
    );
  }
  return (
    <Table
      withTableBorder
      verticalSpacing="xs"
      horizontalSpacing="sm"
      style={{ maxWidth: 560 }}
    >
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Symbol</Table.Th>
          <Table.Th style={{ textAlign: "right" }}>PF</Table.Th>
          <Table.Th style={{ textAlign: "right" }}>WR%</Table.Th>
          <Table.Th style={{ textAlign: "right" }}>Net</Table.Th>
          <Table.Th style={{ textAlign: "right" }}>Trades</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {symbols.map((symbol) => {
          const m: RunMetrics | undefined = run.per_symbol?.[symbol];
          if (!m) return null;
          return (
            <Table.Tr
              key={symbol}
              data-testid={`experiments-symbol-row-${run.run}-${symbol}`}
            >
              <Table.Td>
                <Text size="sm" fw={500}>
                  {symbol}
                </Text>
              </Table.Td>
              <Table.Td style={{ textAlign: "right" }}>
                <Text size="sm">{m.profit_factor.toFixed(2)}</Text>
              </Table.Td>
              <Table.Td style={{ textAlign: "right" }}>
                <Text size="sm">{m.win_rate.toFixed(0)}%</Text>
              </Table.Td>
              <Table.Td style={{ textAlign: "right" }}>
                <Text size="sm" c={getPnLTextColor(m.net_pnl)}>
                  {formatSignedPnl(m.net_pnl)}
                </Text>
              </Table.Td>
              <Table.Td style={{ textAlign: "right" }}>
                <Text size="sm">{m.total_trades}</Text>
              </Table.Td>
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}

export function ExperimentsResultsTable() {
  useStoreSubscription(subscribe);
  const { results, selectedRun } = getExperimentState();

  const [expandedRuns, setExpandedRuns] = useState<Set<number>>(new Set());
  const [sortColumn, setSortColumn] = useState<SortKey>("profit_factor");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [symbolFilter, setSymbolFilter] = useState<string | null>(null);

  const handleSort = useCallback(
    (column: SortKey) => {
      setSortDirection((dir) => getNextSortDirection(sortColumn, column, dir));
      setSortColumn(column);
    },
    [sortColumn],
  );

  const toggleExpand = useCallback((run: number) => {
    setExpandedRuns((prev) => {
      const next = new Set(prev);
      if (next.has(run)) next.delete(run);
      else next.add(run);
      return next;
    });
  }, []);

  const allSymbols = useMemo(() => {
    if (!results) return [];
    const set = new Set<string>();
    for (const run of results) {
      for (const symbol of run.symbols) set.add(symbol);
    }
    return [...set].sort();
  }, [results]);

  const sortedResults = useMemo(() => {
    if (!results) return [];
    return [...results].sort((a, b) => {
      const diff = sortValue(a, sortColumn) - sortValue(b, sortColumn);
      return sortDirection === "asc" ? diff : -diff;
    });
  }, [results, sortColumn, sortDirection]);

  const visibleRuns = useMemo(() => {
    if (!symbolFilter) return sortedResults;
    return sortedResults.filter((run) => run.symbols.includes(symbolFilter));
  }, [sortedResults, symbolFilter]);

  const bestRun = useMemo(() => {
    if (!results || results.length === 0) return null;
    return results.reduce((best, run) =>
      run.metrics.profit_factor > best.metrics.profit_factor ? run : best,
    );
  }, [results]);

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

      <Table
        striped
        highlightOnHover
        withTableBorder
        verticalSpacing="xs"
        horizontalSpacing="sm"
      >
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ width: 40 }} />
            <Table.Th>#</Table.Th>
            <Table.Th>Config</Table.Th>
            {SORT_COLUMNS.map(({ key, label }) => (
              <Table.Th
                key={key}
                onClick={() => handleSort(key)}
                style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                data-testid={`experiments-sort-${key}`}
              >
                {label}
                {renderSortIndicator(key, sortColumn, sortDirection)}
              </Table.Th>
            ))}
            <Table.Th>TP/SL/EOD</Table.Th>
            <Table.Th>Status</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {visibleRuns.map((run) => {
            const expanded = expandedRuns.has(run.run);
            const isSelected = selectedRun?.run === run.run;
            const isBest = bestRun?.run === run.run;
            const rowStyle = {
              cursor: "pointer",
              backgroundColor: isSelected
                ? "var(--mantine-color-blue-light)"
                : isBest
                  ? "var(--mantine-color-teal-light)"
                  : undefined,
            };
            return (
              <Fragment key={run.run}>
                <Table.Tr
                  data-testid={`experiments-run-row-${run.run}`}
                  onClick={() => void selectRun(run)}
                  style={rowStyle}
                >
                  <Table.Td>
                    <UnstyledButton
                      data-testid={`experiments-expand-${run.run}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(run.run);
                      }}
                      aria-expanded={expanded}
                    >
                      <Text size="sm" c="dimmed">
                        {expanded ? "▾" : "▸"}
                      </Text>
                    </UnstyledButton>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {run.run}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" lineClamp={1}>
                      {configLabel(run)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">
                      {run.metrics.profit_factor.toFixed(2)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text
                      size="sm"
                      c={
                        run.metrics.win_rate >= 50
                          ? "green"
                          : run.metrics.win_rate >= 40
                            ? "dimmed"
                            : "red"
                      }
                    >
                      {run.metrics.win_rate.toFixed(0)}%
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text
                      size="sm"
                      c={getPnLTextColor(run.metrics.net_pnl)}
                      fw={500}
                    >
                      {formatSignedPnl(run.metrics.net_pnl)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <Text size="sm">{run.metrics.total_trades}</Text>
                      {run.metrics.total_trades < 10 && (
                        <Badge
                          color="yellow"
                          variant="light"
                          size="xs"
                          data-testid={`experiments-low-sample-${run.run}`}
                        >
                          ⚠ Low sample
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">
                      {run.metrics.tp_exits}/{run.metrics.sl_exits}/
                      {run.metrics.eod_exits}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <RunStatusBadge run={run} />
                  </Table.Td>
                </Table.Tr>
                {expanded && (
                  <Table.Tr data-testid={`experiments-subtable-${run.run}`}>
                    <Table.Td {...({ colSpan: 9 } as UITableProps)}>
                      <Box p="xs">
                        <Text
                          size="xs"
                          fw={600}
                          c="dimmed"
                          style={{ marginBottom: 4 }}
                        >
                          Per-symbol breakdown
                        </Text>
                        <PerSymbolTable run={run} symbolFilter={symbolFilter} />
                      </Box>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Fragment>
            );
          })}
        </Table.Tbody>
      </Table>
    </Box>
  );
}
