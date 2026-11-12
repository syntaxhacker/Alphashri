import { createMemo, createSignal, Index, Show, onCleanup } from "solid-js";
import { Badge, Text, Tooltip, Button } from "@/ui";
import { getPaperTradingState, subscribe, setSelectedSymbol, setSelectedTradeId } from "../../state/paperTrading";
import type { PaperPosition } from "../../types/paperTrading";
import { useStoreSnapshot } from "./storeSnapshot";
import { closeAllPositions, closePaperPosition, refreshBotLiveData, refreshLiveData, fetchPaperChart } from "../../api/paperTrading";
import dayjs from "dayjs";
import { StrategyCard } from "./StrategyCard";
import { groupPositionsByStrategy } from "./PositionsHelpers";
import { Stack } from "./primitives";

function EmptyPositions() {
  return (
    <div class="paper-positions-empty flex flex-col items-center justify-center gap-2 py-8 flex-1 min-h-40 text-center" id="paper-positions-empty" data-testid="positions-empty">
      <Text className="paper-positions-empty-text" size="sm" fw={500} c="dimmed">
        No open positions
      </Text>
    </div>
  );
}

function LoadingState() {
  return (
    <div class="paper-positions-loading flex items-center justify-center py-8 flex-1 min-h-40" id="paper-positions-loading" data-testid="positions-panel">
      <Text className="paper-positions-loading-text" size="xs" c="dimmed">
        Loading positions...
      </Text>
    </div>
  );
}

function EmptyOrLoadingState() {
  return (
    <div class="paper-positions-empty-loading flex items-center justify-center py-8 flex-1 min-h-40" id="paper-positions-empty-loading" data-testid="positions-panel">
      <EmptyPositions />
    </div>
  );
}

async function handleCloseGroup(group: PaperPosition[]) {
  const prices: Record<string, number> = {};
  for (const p of group) {
    if (Number.isFinite(p.current_price) && p.current_price > 0) prices[p.symbol] = p.current_price;
  }
  const state = getPaperTradingState();
  const botId = state.availableBots.length > 0 ? state.availableBots[0].id : null;
  if (!botId) throw new Error("No active bot found");
  await closeAllPositions(botId, prices);
  await refreshBotLiveData(botId);
}

function CloseAllButton(props: { positions: PaperPosition[] }) {
  const [closing, setClosing] = createSignal(false);

  const handleCloseAll = async () => {
    if (closing()) return;
    if (!window.confirm(`Close all ${props.positions.length} positions at current prices?`)) return;
    setClosing(true);
    try {
      const prices: Record<string, number> = {};
      for (const p of props.positions) {
        if (Number.isFinite(p.current_price) && p.current_price > 0) prices[p.symbol] = p.current_price;
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
        color="error"
        loading={closing()}
        onClick={handleCloseAll}
        data-testid="close-all-positions"
      >
        {closing() ? "Closing..." : "Close All"}
      </Button>
    </Tooltip>
  );
}

export function PaperPositionsTable(props: { activeBotId?: string | null }) {
  const state = useStoreSnapshot(subscribe, getPaperTradingState);
  const sortedPositions = createMemo(() =>
    [...state().positions].sort(
      (a, b) => new Date(b.entry_time).getTime() - new Date(a.entry_time).getTime(),
    ),
  );
  const strategyGroups = createMemo(() => Array.from(groupPositionsByStrategy(sortedPositions()).entries()));
  const isLive = createMemo(
    () => state().availableBots.find((b) => b.id === (props.activeBotId ?? state().filterBot))?.live_trading ?? false,
  );
  const loading = () => state().isLoading && sortedPositions().length === 0;
  const empty = () => sortedPositions().length === 0 && !state().botSnapshot;

  const handleSelectSymbol = async (
    symbol: string,
    _tradeId?: string,
    _strategyName?: string,
    _strategyType?: string,
    strategyId?: number,
    entryTime?: string,
  ) => {
    try {
      setSelectedSymbol(symbol);
      setSelectedTradeId("-1", _strategyType, strategyId);
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
  };

  const handleClosePosition = async (symbol: string, currentPrice: number) => {
    if (confirm(`Close position for ${symbol} at ₹${currentPrice.toFixed(2)}?`)) {
      try {
        await closePaperPosition(symbol, currentPrice, "MANUAL");
        await refreshLiveData();
      } catch (error) {
        console.error("Failed to close position:", error);
        alert("Failed to close position. Check console for details.");
      }
    }
  };

  return (
    <Show when={!loading()} fallback={<LoadingState />}>
      <Show when={!empty()} fallback={<EmptyOrLoadingState />}>
        <Stack className="paper-positions-table-container" id="paper-positions-table-container" spacing={0.25} data-testid="positions-table-container">
          <div class="paper-positions-header flex items-center justify-between gap-1 px-1 py-0.5" id="paper-positions-header">
            <div class="paper-positions-header-left flex items-center gap-1">
              <Text className="paper-positions-title" size="xs" c="dimmed" tt="uppercase" fw={600}>
                Positions ({sortedPositions().length})
              </Text>
              <Badge className="paper-positions-mode-badge" color={isLive() ? "error" : "success"} variant="filled" size="xs">
                {isLive() ? "LIVE" : "PAPER"}
              </Badge>
            </div>
            <div class="paper-positions-header-right flex items-center gap-1">
              <CloseAllButton positions={sortedPositions()} />
            </div>
          </div>

          <Show when={sortedPositions().length > 0}>
            <Stack className="paper-positions-groups" id="paper-positions-groups" spacing={0}>
              <Index each={strategyGroups()}>
                {(entry) => {
                  const displayName = () => entry()[1][0]?.strategy_name || `Strategy ${entry()[0]}`;
                  return (
                    <StrategyCard
                      strategyName={displayName()}
                      positions={entry()[1]}
                      maxCapacity={5}
                      onSelectSymbol={handleSelectSymbol}
                      onClosePosition={handleClosePosition}
                      onCloseAll={handleCloseGroup}
                    />
                  );
                }}
              </Index>
            </Stack>
          </Show>

          <Show when={sortedPositions().length === 0}>
            <EmptyPositions />
          </Show>
        </Stack>
      </Show>
    </Show>
  );
}
