import React, { useEffect, useState, useMemo } from "react";
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
  Box,
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

  const columns = useMemo<ColumnDef<BacktestHistoryItem>[]>(() => [
      {
        id: "date",
        header: "Date",
        accessorKey: "created_at",
        meta: { align: "center" } as any,
        cell: (info) => (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Text size="sm" ta="center">{new Date(info.getValue<string>()).toLocaleString()}</Text></Box>
        ),
      },
      {
        id: "strategy",
        header: "Strategy",
        accessorKey: "strategy_name",
        meta: { align: "center" } as any,
        cell: (info) => (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Badge variant="light" color="primary">
            {info.getValue<string>()}
          </Badge></Box>
        ),
      },
      {
        id: "symbols",
        header: "Symbols",
        accessorKey: "symbols",
        meta: { align: "center" } as any,
        cell: (info) => {
          const symbols = info.getValue<string[]>();
          return (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Tooltip label={symbols.join(", ")}>
              <Text size="sm" truncate maw={150} ta="center">
                {symbols.length} stocks: {symbols.slice(0, 3).join(", ")}
                {symbols.length > 3 ? "..." : ""}
              </Text>
            </Tooltip>
            </Box>
          );
        },
      },
      {
        id: "trades",
        header: "Trades",
        accessorFn: (row) => row.metrics.total_trades,
        meta: { align: "center" } as any,
        cell: (info) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Text size="sm" ta="center">{info.getValue<number>()}</Text></Box>,
      },
      {
        id: "win_rate",
        header: "Win Rate",
        accessorFn: (row) => row.metrics.win_rate,
        meta: { align: "center" } as any,
        cell: (info) => {
          const val = info.getValue<number>();
          return (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Text size="sm" fw={500} c={val >= 50 ? "success" : "warning"} ta="center">
              {val.toFixed(1)}%
            </Text></Box>
          );
        },
      },
      {
        id: "pnl",
        header: "Net P&L",
        accessorFn: (row) => row.metrics.total_pnl,
        meta: { align: "center" } as any,
        cell: (info) => {
          const row = info.row.original;
          return (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Text size="sm" fw={700} c={getPnLTextColor(row.metrics.total_pnl)} ta="center">
              ₹{row.metrics.total_pnl.toLocaleString()} (
              {row.metrics.total_pnl_pct.toFixed(2)}%)
            </Text></Box>
          );
        },
      },
      {
        id: "actions",
        header: "Actions",
        enableSorting: false,
        meta: { align: "center" } as any,
        cell: (info) => {
          const row = info.row.original;
          return (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Group gap={8} sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
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
                color="error"
                onClick={() => handleDelete(row.id)}
                data-testid={`history-delete-btn-${row.id}`}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
            </Box>
          );
        },
      },
  ]);

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
        color="error"
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
        padding="xl"
        radius="md"
        shadow="none"
        className="backtest-history-empty"
        data-testid="backtest-history-empty"
        sx={{ p: 1 }}
        style={{ boxShadow: "none" } as any}
      >
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 1, p: 1 }}>
          <EmptyState
            icon={<IconDatabase size={40} color="secondary" />}
            title="No backtest history"
            description="Run a backtest and save it to see it here."
          />
        </Box>
      </Card>
    );
  }

  return (
    <Stack
      id="backtest-history"
      className="backtest-history"
      spacing={1}
      gap="md"
      data-testid="backtest-history"
      sx={{ gap: 1, p: 1 }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1 }}>
        <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>
          {history.length} backtest{history.length !== 1 ? "s" : ""} saved
        </Text>
        <Group gap={1} align="center" className="history-actions" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Button
            size="sm"
            variant="light"
            color="error"
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
      </Box>
      <TanStackTable<BacktestHistoryItem>
        data={history}
        columns={columns}
        dataTestId="history-table"
        enableSorting={false}
      />
    </Stack>
  );
}
