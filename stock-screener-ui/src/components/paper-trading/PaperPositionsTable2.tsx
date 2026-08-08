import { useEffect, useMemo, useState, useCallback } from "react";
import { Badge, Text, Group, Flex, Tooltip, Button } from "@/ui";
import { getPaperTradingState, subscribe, setSelectedSymbol, setSelectedTradeId } from "../../state/paperTrading";
import type { PaperPosition } from "../../types/paperTrading";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { closeAllPositions, closePaperPosition, refreshBotLiveData, refreshLiveData, fetchPaperChart } from "../../api/paperTrading";
import dayjs from "dayjs";
import { StrategyCard } from "./StrategyCard";
import { groupPositionsByStrategy } from "./PositionsHelpers";

function usePositionsData(): PaperPosition[] {
  useStoreSubscription(subscribe);
  const state = getPaperTradingState();
  return useMemo(
    () =>
      [...state.positions].sort(
        (a, b) => new Date(b.entry_time).getTime() - new Date(a.entry_time).getTime(),
      ),
    [state.positions],
  );
}

function EmptyPositions() {
  return (
    <Flex
      py="sm"
      justify="center"
      align="center"
      direction="column"
      gap={4}
      data-testid="positions-empty"
    >
      <Text size="sm" fw={500} c="dimmed">
        No open positions
      </Text>
    </Flex>
  );
}

function LoadingState() {
  return (
    <Flex justify="center" py="sm" data-testid="positions-panel">
      <Text size="xs" c="dimmed">
        Loading positions...
      </Text>
    </Flex>
  );
}

function EmptyOrLoadingState() {
  return (
    <Flex justify="center" py="sm" data-testid="positions-panel">
      <EmptyPositions />
    </Flex>
  );
}

async function handleCloseGroup(group: PaperPosition[]) {
  const prices: Record<string, number> = {};
  for (const p of group) {
    if (p.current_price > 0) prices[p.symbol] = p.current_price;
  }
  const state = getPaperTradingState();
  const botId = state.availableBots.length > 0 ? state.availableBots[0].id : null;
  if (!botId) throw new Error("No active bot found");
  await closeAllPositions(botId, prices);
  await refreshBotLiveData(botId);
}

function CloseAllButton({ positions }: { positions: PaperPosition[] }) {
  const [closing, setClosing] = useState(false);

  const handleCloseAll = async () => {
    if (!window.confirm(`Close all ${positions.length} positions at current prices?`)) return;
    setClosing(true);
    try {
      const prices: Record<string, number> = {};
      for (const p of positions) {
        if (p.current_price > 0) prices[p.symbol] = p.current_price;
      }
      const state = getPaperTradingState();
      const botId = state.availableBots.length > 0 ? state.availableBots[0].id : null;
      if (!botId) throw new Error("No active bot found");
      await closeAllPositions(botId, prices);
      await refreshBotLiveData(botId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to close all positions";
      alert(msg);
    } finally {
      setClosing(false);
    }
  };

  return (
    <Tooltip label="Close all positions at current prices">
      <Button
        size="compact-xs"
        variant="light"
        color="red"
        loading={closing}
        onClick={handleCloseAll}
        data-testid="close-all-positions"
      >
        {closing ? "Closing..." : "Close All"}
      </Button>
    </Tooltip>
  );
}

export function PaperPositionsTable() {
  const state = getPaperTradingState();
  const { isLoading, botSnapshot } = state;
  const sortedPositions = usePositionsData();
  const strategyGroups = useMemo(() => groupPositionsByStrategy(sortedPositions), [sortedPositions]);

  const handleSelectSymbol = useCallback(async (
    symbol: string,
    _tradeId?: string,
    _strategyName?: string,
    _strategyType?: string,
    strategyId?: number,
    entryTime?: string,
  ) => {
    try {
      setSelectedSymbol(symbol);
      setSelectedTradeId("-1");
      const entryDate = entryTime ? entryTime.split("T")[0] : undefined;
      const fromDate = entryDate
        ? dayjs(entryDate).subtract(7, "day").format("YYYY-MM-DD")
        : undefined;
      const currentState = getPaperTradingState();
      await fetchPaperChart(
        symbol,
        entryDate,
        currentState.chartTimeframe,
        strategyId ?? currentState.selectedStrategyId,
        fromDate,
      );
    } catch (err) {
      console.error("handleSelectSymbol failed:", err);
    }
  }, []);

  const handleClosePosition = useCallback(async (symbol: string, currentPrice: number) => {
    if (confirm(`Close position for ${symbol} at ₹${currentPrice.toFixed(2)}?`)) {
      try {
        await closePaperPosition(symbol, currentPrice, "MANUAL");
        await refreshLiveData();
      } catch (error) {
        console.error("Failed to close position:", error);
        alert("Failed to close position. Check console for details.");
      }
    }
  }, []);

  if (isLoading && sortedPositions.length === 0) {
    return <LoadingState />;
  }

  console.log("[PositionsView] sortedPositions:", sortedPositions.length, "sample:", sortedPositions[0]?.symbol, "order_id:", sortedPositions[0]?.order_id);
  if (sortedPositions.length === 0 && !botSnapshot) {
    return <EmptyOrLoadingState />;
  }

  const isLive = state.availableBots.find(b => b.id === state.filterBot)?.live_trading ?? false;

  return (
    <Flex direction="column" gap="xs" data-testid="positions-table-container">
      <Group justify="space-between" py={2}>
        <Group gap="xs">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Positions ({sortedPositions.length})
          </Text>
          <Badge color={isLive ? "red" : "green"} variant="light" size="xs">
            {isLive ? "LIVE" : "PAPER"}
          </Badge>
        </Group>
        <Group gap={4}>
          <CloseAllButton positions={sortedPositions} />
        </Group>
      </Group>

      {sortedPositions.length > 0 && (
        <Flex direction="column" gap="xs">
          {Array.from(strategyGroups.entries()).map(([strategyId, group]) => {
            const displayName = group[0]?.strategy_name || `Strategy ${strategyId}`;
            return (
              <StrategyCard
                key={strategyId}
                strategyName={displayName}
                positions={group}
                maxCapacity={5}
                onSelectSymbol={handleSelectSymbol}
                onClosePosition={handleClosePosition}
                onCloseAll={handleCloseGroup}
              />
            );
          })}
        </Flex>
      )}

      {sortedPositions.length === 0 && <EmptyPositions />}
    </Flex>
  );
}
