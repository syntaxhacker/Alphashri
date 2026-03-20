import React, { useEffect, useState } from "react";
import {
  Table,
  Group,
  Text,
  Button,
  Badge,
  ActionIcon,
  Tooltip,
  Card,
  Stack,
  Loader,
  Alert,
} from "@mantine/core";
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
    } catch (err) {
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
        setHistory(history.filter((item) => item.id !== id));
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

        // 1. Set strategy first (this clears variation)
        setSelectedStrategy(details.strategy_id);

        // 2. Set the saved parameters
        setParams(details.parameters);
        setDays(details.parameters.days || 90);

        // 3. Restore the variation ID for display (don't reload params)
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

        // 4. Set symbols and results
        setSelectedSymbols(details.symbols);
        setResults(details.results, details.totals);

        // Restore charts if available
        if (details.chart_data) {
          setChartDataBatch(details.chart_data);

          // Select first symbol to show chart immediately
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

  if (loading) {
    return (
      <Group
        justify="center"
        py="xl"
        className="backtest-history-loading"
        data-testid="backtest-history-loading"
      >
        <Loader size="md" />
        <Text>Loading history...</Text>
      </Group>
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
        <Stack align="center" gap="xs">
          <IconDatabase size={40} color="gray" />
          <Text size="lg" fw={500}>
            No backtest history
          </Text>
          <Text c="dimmed" size="sm">
            Run a backtest and save it to see it here.
          </Text>
        </Stack>
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
      <Table
        highlightOnHover
        verticalSpacing="sm"
        className="history-table"
        data-testid="history-table"
      >
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Date</Table.Th>
            <Table.Th>Strategy</Table.Th>
            <Table.Th>Symbols</Table.Th>
            <Table.Th>Trades</Table.Th>
            <Table.Th>Win Rate</Table.Th>
            <Table.Th>Net P&L</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody data-testid="history-tbody">
          {history.map((item) => (
            <Table.Tr key={item.id} className="history-row" data-testid={`history-row-${item.id}`}>
              <Table.Td>
                <Text size="sm">{new Date(item.created_at).toLocaleString()}</Text>
              </Table.Td>
              <Table.Td>
                <Badge variant="light" color="blue">
                  {item.strategy_name}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Tooltip label={item.symbols.join(", ")}>
                  <Text size="sm" truncate style={{ maxWidth: 150 }}>
                    {item.symbols.length} stocks: {item.symbols.slice(0, 3).join(", ")}
                    {item.symbols.length > 3 ? "..." : ""}
                  </Text>
                </Tooltip>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{item.metrics.total_trades}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm" fw={500} c={item.metrics.win_rate >= 50 ? "green" : "orange"}>
                  {item.metrics.win_rate.toFixed(1)}%
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm" fw={700} c={item.metrics.total_pnl >= 0 ? "green" : "red"}>
                  ₹{item.metrics.total_pnl.toLocaleString()} (
                  {item.metrics.total_pnl_pct.toFixed(2)}%)
                </Text>
              </Table.Td>
              <Table.Td>
                <Group gap={8}>
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
                    color="red"
                    onClick={() => handleDelete(item.id)}
                    data-testid={`history-delete-btn-${item.id}`}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
