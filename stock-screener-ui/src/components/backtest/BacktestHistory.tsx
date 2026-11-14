import { createEffect, createSignal, createMemo, Switch, Match } from "solid-js";
import { Text, Button, Badge, ActionIcon, Tooltip, Alert, Group, Card, Stack } from "@/ui";
import {
  IconTrash,
  IconExternalLink,
  IconDatabase,
  IconAlertCircle,
  IconRefresh,
} from "@/components/common/Icons";
import { fetchBacktestHistory, deleteBacktest, fetchBacktestDetails } from "../../api/backtest";
import type { BacktestHistoryItem } from "../../types/backtest";
import {
  setResults,
  setParams,
  setSelectedStrategy,
  setSelectedSymbols,
  setDays,
  setChartDataBatch,
  setSelectedChartSymbol,
  setSelectedVariationId,
  getBacktestState,
} from "../../state/backtest";
import { TanStackTable } from "../paper-trading/TanStackTable";
import type { TableColumnDef } from "../paper-trading/TanStackTable";
import { InlineLoader, EmptyState } from "../common/states";
import { getPnLTextColor } from "../../utils/ui-helpers";
import * as palette from "@/ui/palette";

interface BacktestHistoryProps {
  onLoad?: () => void;
  active?: boolean;
}

export function BacktestHistory(props: BacktestHistoryProps) {
  const [history, setHistory] = createSignal<BacktestHistoryItem[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const data = await fetchBacktestHistory();
      setHistory(data);
      setError(null);
    } catch {
      setError("Failed to load backtest history");
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    if (props.active) {
      void loadHistory();
    }
  });

  const handleDelete = async (id: string) => {
    if (window.confirm("Are you sure you want to delete this backtest result?")) {
      const success = await deleteBacktest(id);
      if (success) {
        setHistory((prev) => prev.filter((item) => item.id !== id));
      }
    }
  };

  const handleClearAll = async () => {
    if (
      window.confirm("Are you sure you want to delete ALL backtest history? This cannot be undone.")
    ) {
      const deletePromises = history().map((item) => deleteBacktest(item.id));
      await Promise.all(deletePromises);
      setHistory([]);
    }
  };

  const handleLoad = async (id: string) => {
    try {
      const details = await fetchBacktestDetails(id);
      if (details) {
        setSelectedStrategy(details.strategy_id);
        setParams(details.parameters);
        setDays(details.parameters.days || 90);

        if (details.variation_id) {
          const currentState = getBacktestState();
          const variationExists = currentState.variations.some(
            (v) => v.id === details.variation_id,
          );
          if (variationExists) {
            setSelectedVariationId(details.variation_id);
          }
        }

        setSelectedSymbols(details.symbols);
        setResults(details.results, details.totals);

        if (details.chart_data) {
          setChartDataBatch(details.chart_data);
          const symbols = Object.keys(details.chart_data);
          if (symbols.length > 0) {
            setSelectedChartSymbol(symbols[0]);
          }
        }

        if (props.onLoad) {
          props.onLoad();
        }
      }
    } catch (err) {
      console.error("Failed to load backtest:", err);
      alert("Failed to load backtest details");
    }
  };

  const columns = createMemo<TableColumnDef<BacktestHistoryItem>[]>(() => [
    {
      id: "date",
      header: "Date",
      accessorKey: "created_at",
      meta: { align: "center" },
      cell: ({ row }) => (
        <div class="flex items-center justify-center"><Text size="sm" ta="center">{new Date(row.original.created_at).toLocaleString()}</Text></div>
      ),
    },
    {
      id: "strategy",
      header: "Strategy",
      accessorKey: "strategy_name",
      meta: { align: "center" },
      cell: ({ row }) => (
        <div class="flex items-center justify-center"><Badge variant="light" color="primary">
          {row.original.strategy_name}
        </Badge></div>
      ),
    },
    {
      id: "symbols",
      header: "Symbols",
      accessorKey: "symbols",
      meta: { align: "center" },
      cell: ({ row }) => {
        const symbols = row.original.symbols ?? [];
        return (
          <div class="flex items-center justify-center">
          <Tooltip label={symbols.join(", ")}>
            <Text size="sm" truncate maw={150} ta="center">
              {symbols.length} stocks: {symbols.slice(0, 3).join(", ")}
              {symbols.length > 3 ? "..." : ""}
            </Text>
          </Tooltip>
          </div>
        );
      },
    },
    {
      id: "trades",
      header: "Trades",
      accessorFn: (row) => row.metrics.total_trades,
      meta: { align: "center" },
      cell: ({ row }) => <div class="flex items-center justify-center"><Text size="sm" ta="center">{row.original.metrics.total_trades}</Text></div>,
    },
    {
      id: "win_rate",
      header: "Win Rate",
      accessorFn: (row) => row.metrics.win_rate,
      meta: { align: "center" },
      cell: ({ row }) => {
        const val = row.original.metrics.win_rate;
        return (
          <div class="flex items-center justify-center"><Text size="sm" fw={500} c={val >= 50 ? "success" : "warning"} ta="center">
            {val.toFixed(1)}%
          </Text></div>
        );
      },
    },
    {
      id: "pnl",
      header: "Net P&L",
      accessorFn: (row) => row.metrics.total_pnl,
      meta: { align: "center" },
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div class="flex items-center justify-center"><Text size="sm" fw={700} c={getPnLTextColor(item.metrics.total_pnl)} ta="center">
            ₹{item.metrics.total_pnl.toLocaleString()} (
            {item.metrics.total_pnl_pct.toFixed(2)}%)
          </Text></div>
        );
      },
    },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      meta: { align: "center" },
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div class="flex items-center justify-center">
          <Group gap={8} className="flex items-center justify-center gap-2">
            <Button
              size="compact-xs"
              variant="light"
              leftSection={<IconExternalLink size={14} />}
              onClick={() => handleLoad(item.id)}
              data-testid={`history-load-btn-${item.id}`}
            >
              Load
            </Button>
            <ActionIcon
              variant="subtle"
              color="error"
              onClick={() => handleDelete(item.id)}
              data-testid={`history-delete-btn-${item.id}`}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
          </div>
        );
      },
    },
  ]);

  return (
    <Switch>
      <Match when={loading()}>
        <InlineLoader
          data-testid="backtest-history-loading"
          className="backtest-history-loading"
          size="md"
        />
      </Match>
      <Match when={error()}>
        {(err) => (
          <Alert
            icon={<IconAlertCircle size="1rem" />}
            title="Error"
            color="error"
            className="backtest-history-error"
            data-testid="backtest-history-error"
          >
            {err()}
          </Alert>
        )}
      </Match>
      <Match when={history().length === 0}>
        <Card
          padding="xl"
          radius="md"
          shadow="none"
          className="backtest-history-empty"
          data-testid="backtest-history-empty"
          p={1}
          style={{ "box-shadow": "none" }}
        >
          <div class="flex items-center justify-center flex-col gap-2 p-2">
            <EmptyState
              icon={<IconDatabase size={40} color={palette.TEXT_MUTED} />}
              title="No backtest history"
              description="Run a backtest and save it to see it here."
            />
          </div>
        </Card>
      </Match>
      <Match when={true}>
        <Stack
          id="backtest-history"
          className="backtest-history"
          spacing={1}
          gap="md"
          p={1}
          data-testid="backtest-history"
        >
          <div class="flex items-center justify-between gap-2 p-2">
            <Text size="sm" c="dimmed" style={{ "min-width": "80px", display: "flex", "align-items": "center" }}>
              {history().length} backtest{history().length !== 1 ? "s" : ""} saved
            </Text>
            <Group gap={1} align="center" className="history-actions flex items-center justify-center gap-2">
              <Button
                size="sm"
                variant="light"
                color="error"
                leftSection={<IconTrash size={14} />}
                onClick={handleClearAll}
                disabled={history().length === 0}
                data-testid="history-clear-all-btn"
              >
                Clear All
              </Button>
              <Button
                size="sm"
                variant="light"
                leftSection={<IconRefresh size={14} />}
                onClick={loadHistory}
                loading={loading()}
                data-testid="history-refresh-btn"
              >
                Refresh
              </Button>
            </Group>
          </div>
          <TanStackTable<BacktestHistoryItem>
            data={history()}
            columns={columns()}
            dataTestId="history-table"
            enableSorting={false}
          />
        </Stack>
      </Match>
    </Switch>
  );
}
