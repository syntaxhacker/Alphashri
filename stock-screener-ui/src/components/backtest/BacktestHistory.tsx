import React, { useEffect, useState } from "react";
import {
  Group,
  Text,
  Button,
  Badge,
  ActionIcon,
  Tooltip,
  Card,
  Stack,
  Alert,
} from "@/ui";
import type { ColumnDef } from "@tanstack/react-table";
import {
  IconTrash,
  IconExternalLink,
  IconDatabase,
  IconAlertCircle,
  IconRefresh,
} from "@tabler/icons-react";
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
import { TanStackTable } from "../common/TanStackTable";
import { InlineLoader, EmptyState } from "../common/states";
import { getPnLTextColor } from "../../utils/ui-helpers";

interface BacktestHistoryProps {
  onLoad?: () => void;
  active?: boolean;
}

export function BacktestHistory({ onLoad, active }: BacktestHistoryProps) {
  const [history, setHistory] = useState<BacktestHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    if (active) {
      loadHistory();
    }
  }, [active]);

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
      const deletePromises = history.map((item) => deleteBacktest(item.id));
      await Promise.all(deletePromises);
      setHistory([]);
    }
  };

  const handleLoad = async (id: string) => {
    try {
      const details = await fetchBacktestDetails(id);
      console.log("Loading backtest details:", details);
      if (details) {
        console.log("Strategy ID:", details.strategy_id);
        console.log("Parameters from DB:", details.parameters);
        console.log("Variation ID:", details.variation_id);
        console.log("Symbols:", details.symbols);
        console.log("Days:", details.parameters.days);

        setSelectedStrategy(details.strategy_id);
        setParams(details.parameters);
        setDays(details.parameters.days || 90);

        if (details.variation_id) {
          const currentState = getBacktestState();
          const variationExists = currentState.variations.some(
            (v) => v.id === details.variation_id,
          );
          console.log(
            "Variation exists in state:",
            variationExists,
            "Total variations:",
            currentState.variations.length,
          );

          if (variationExists) {
            console.log("Setting variation ID for display:", details.variation_id);
            setSelectedVariationId(details.variation_id);
          } else {
            console.warn("Variation not found in loaded variations, skipping");
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

        if (onLoad) {
          onLoad();
        }
      }
    } catch (err) {
      console.error("Failed to load backtest:", err);
      alert("Failed to load backtest details");
    }
  };

  const columns: ColumnDef<BacktestHistoryItem>[] = [
      {
        id: "date",
        header: "Date",
        accessorKey: "created_at",
        cell: (info) => (
          <Text size="sm">{new Date(info.getValue<string>()).toLocaleString()}</Text>
        ),
      },
      {
        id: "strategy",
        header: "Strategy",
        accessorKey: "strategy_name",
        cell: (info) => (
          <Badge variant="light" color="blue">
            {info.getValue<string>()}
          </Badge>
        ),
      },
      {
        id: "symbols",
        header: "Symbols",
        accessorKey: "symbols",
        cell: (info) => {
          const symbols = info.getValue<string[]>();
          return (
            <Tooltip label={symbols.join(", ")}>
              <Text size="sm" truncate maw={150}>
                {symbols.length} stocks: {symbols.slice(0, 3).join(", ")}
                {symbols.length > 3 ? "..." : ""}
              </Text>
            </Tooltip>
          );
        },
      },
      {
        id: "trades",
        header: "Trades",
        accessorFn: (row) => row.metrics.total_trades,
        cell: (info) => <Text size="sm">{info.getValue<number>()}</Text>,
      },
      {
        id: "win_rate",
        header: "Win Rate",
        accessorFn: (row) => row.metrics.win_rate,
        cell: (info) => {
          const val = info.getValue<number>();
          return (
            <Text size="sm" fw={500} c={val >= 50 ? "green" : "orange"}>
              {val.toFixed(1)}%
            </Text>
          );
        },
      },
      {
        id: "pnl",
        header: "Net P&L",
        accessorFn: (row) => row.metrics.total_pnl,
        cell: (info) => {
          const row = info.row.original;
          return (
            <Text size="sm" fw={700} c={getPnLTextColor(row.metrics.total_pnl)}>
              ₹{row.metrics.total_pnl.toLocaleString()} (
              {row.metrics.total_pnl_pct.toFixed(2)}%)
            </Text>
          );
        },
      },
      {
        id: "actions",
        header: "Actions",
        enableSorting: false,
        cell: (info) => {
          const row = info.row.original;
          return (
            <Group gap={8}>
              <Button
                size="compact-xs"
                variant="light"
                leftSection={<IconExternalLink size={14} />}
                onClick={() => handleLoad(row.id)}
                data-testid={`history-load-btn-${row.id}`}
              >
                Load
              </Button>
              <ActionIcon
                variant="subtle"
                color="red"
                onClick={() => handleDelete(row.id)}
                data-testid={`history-delete-btn-${row.id}`}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
          );
        },
      },
  ];

  if (loading) {
    return (
      <InlineLoader
        data-testid="backtest-history-loading"
        className="backtest-history-loading"
        size="md"
      />
    );
  }

  if (error) {
    return (
      <Alert
        icon={<IconAlertCircle size="1rem" />}
        title="Error"
        color="red"
        className="backtest-history-error"
        data-testid="backtest-history-error"
      >
        {error}
      </Alert>
    );
  }

  if (history.length === 0) {
    return (
      <Card
        withBorder
        padding="xl"
        radius="md"
        className="backtest-history-empty"
        data-testid="backtest-history-empty"
      >
        <EmptyState
          icon={<IconDatabase size={40} color="gray" />}
          title="No backtest history"
          description="Run a backtest and save it to see it here."
        />
      </Card>
    );
  }

  return (
    <Stack
      id="backtest-history"
      className="backtest-history"
      gap="md"
      data-testid="backtest-history"
    >
      <Group justify="space-between" className="history-header">
        <Text size="sm" c="dimmed">
          {history.length} backtest{history.length !== 1 ? "s" : ""} saved
        </Text>
        <Group gap="xs" className="history-actions">
          <Button
            size="sm"
            variant="light"
            color="red"
            leftSection={<IconTrash size={14} />}
            onClick={handleClearAll}
            disabled={history.length === 0}
            data-testid="history-clear-all-btn"
          >
            Clear All
          </Button>
          <Button
            size="sm"
            variant="light"
            leftSection={<IconRefresh size={14} />}
            onClick={loadHistory}
            loading={loading}
            data-testid="history-refresh-btn"
          >
            Refresh
          </Button>
        </Group>
      </Group>
      <TanStackTable<BacktestHistoryItem>
        data={history}
        columns={columns}
        dataTestId="history-table"
        enableSorting={false}
      />
    </Stack>
  );
}
