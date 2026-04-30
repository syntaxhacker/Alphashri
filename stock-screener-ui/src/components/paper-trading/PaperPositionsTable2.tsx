import { useMemo, useState } from "react";
import { Tabs, Badge, Text, Group, Flex, ScrollArea, Button, Tooltip } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { getPaperTradingState, setSelectedStrategyTab, subscribe } from "../../state/paperTrading";
import type { PaperPosition } from "../../types/paperTrading";
import { formatNumber, getPnLTextColor } from "../../utils/ui-helpers";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { closeAllPositions, refreshBotLiveData } from "../../api/paperTrading";
import {
  PositionsTableBody,
  StrategySummaryFooter,
  groupPositionsByStrategy,
  calcStrategySummary,
} from "./PositionsHelpers";
import { WatchlistScan } from "./WatchlistScan";

interface UsePositionsDerivedDataReturn {
  sortedPositions: PaperPosition[];
  strategyGroups: Map<number, PaperPosition[]>;
  isMultiStrategy: boolean;
  activeTab: string;
  filteredPositions: PaperPosition[];
}

function usePositionsDerivedData(): UsePositionsDerivedDataReturn {
  useStoreSubscription(subscribe);

  const state = getPaperTradingState();
  const { positions, selectedStrategyTab } = state;

  const sortedPositions = useMemo(
    () =>
      [...positions].sort(
        (a, b) => new Date(b.entry_time).getTime() - new Date(a.entry_time).getTime(),
      ),
    [positions],
  );

  const strategyGroups = useMemo(
    () => groupPositionsByStrategy(sortedPositions),
    [sortedPositions],
  );

  const isMultiStrategy = useMemo(() => strategyGroups.size > 1, [strategyGroups]);

  const activeTab = useMemo(() => selectedStrategyTab || "all", [selectedStrategyTab]);

  const filteredPositions = useMemo(
    () =>
      activeTab === "all"
        ? sortedPositions
        : (strategyGroups.get(Number(activeTab)) || []).sort(
            (a, b) => new Date(b.entry_time).getTime() - new Date(a.entry_time).getTime(),
          ),
    [activeTab, sortedPositions, strategyGroups],
  );

  return { sortedPositions, strategyGroups, isMultiStrategy, activeTab, filteredPositions };
}

function EmptyPositions() {
  return (
    <Flex
      py="lg"
      justify="center"
      align="center"
      direction="column"
      gap={4}
      data-testid="positions-empty"
      className="paper-positions-empty"
      id="positions-empty"
    >
      <Text size="sm" fw={500} c="dimmed">
        No open positions
      </Text>
    </Flex>
  );
}

function LoadingState() {
  return (
    <Flex
      justify="center"
      py="lg"
      data-testid="positions-panel"
      className="paper-positions-panel"
      id="positions-panel"
    >
      <Text size="xs" c="dimmed">
        Loading positions...
      </Text>
    </Flex>
  );
}

function EmptyOrLoadingState() {
  return (
    <Flex
      justify="center"
      py="lg"
      data-testid="positions-panel"
      className="paper-positions-panel"
      id="positions-panel"
    >
      <EmptyPositions />
    </Flex>
  );
}

function PositionsContent({
  positions,
  selectedSymbol,
  strategyGroups,
  isMultiStrategy,
  activeTab,
  filteredPositions,
}: {
  positions: PaperPosition[];
  selectedSymbol: string | null;
  strategyGroups: Map<number, PaperPosition[]>;
  isMultiStrategy: boolean;
  activeTab: string;
  filteredPositions: PaperPosition[];
}) {
  return (
    <Flex direction="column" flex={1} style={{ minHeight: 0 }}>
      <Group
        justify="space-between"
        py={2}
        className="paper-positions-header"
        id="positions-header"
      >
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          Positions ({positions.length})
        </Text>
        <Group gap="xs">
          <CloseAllButton positions={positions} />
          <Badge color="red" variant="light" size="xs">
            LIVE
          </Badge>
        </Group>
      </Group>

      {isMultiStrategy && (
        <StrategyTabs activeTab={activeTab} strategyGroups={strategyGroups} positions={positions} />
      )}

      <ScrollArea flex={1} style={{ minHeight: 0 }}>
        <div style={{ overflowX: "auto" }} data-testid="positions-table-container">
          <PositionsTableBody positions={filteredPositions} selectedSymbol={selectedSymbol} />
        </div>
      </ScrollArea>

      {isMultiStrategy && activeTab === "all" && (
        <StrategySummaryFooter strategyGroups={strategyGroups} />
      )}
    </Flex>
  );
}

function StrategyTabs({
  activeTab,
  strategyGroups,
  positions,
}: {
  activeTab: string;
  strategyGroups: Map<number, PaperPosition[]>;
  positions: PaperPosition[];
}) {
  const allSummary = calcStrategySummary(positions);
  const strategies = Array.from(strategyGroups.keys());

  return (
    <Tabs
      value={activeTab}
      onChange={(v) => {
        if (v) setSelectedStrategyTab(v);
      }}
      data-testid="strategy-tabs"
      variant="default"
    >
      <Tabs.List>
        <Tabs.Tab value="all" data-testid="strategy-tab-all">
          <Group gap="xs">
            <span>All</span>
            <Badge size="xs">{positions.length}</Badge>
            <Text size="xs" c={getPnLTextColor(allSummary.totalPnl)}>
              {allSummary.totalPnl >= 0 ? "+" : ""}₹{formatNumber(allSummary.totalPnl)}
            </Text>
          </Group>
        </Tabs.Tab>
        {strategies.map((strategyId) => {
          const group = strategyGroups.get(strategyId) || [];
          const summary = calcStrategySummary(group);
          const tabValue = String(strategyId);
          const displayName = group[0]?.strategy_name || `Strategy ${strategyId}`;
          return (
            <Tabs.Tab
              key={strategyId}
              value={tabValue}
              data-testid={`strategy-tab-${displayName.replace(/\s+/g, "-").toLowerCase()}`}
            >
              <Group gap="xs">
                <span>{displayName}</span>
                <Badge size="xs">{summary.count}</Badge>
                <Text size="xs" c={getPnLTextColor(summary.totalPnl)}>
                  {summary.totalPnl >= 0 ? "+" : ""}₹{formatNumber(summary.totalPnl)}
                </Text>
              </Group>
            </Tabs.Tab>
          );
        })}
      </Tabs.List>
    </Tabs>
  );
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
        leftSection={closing ? undefined : <IconX size={12} />}
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
  const { positions, selectedSymbol, botSnapshot, isLoading } = state;

  const { strategyGroups, isMultiStrategy, activeTab, filteredPositions } =
    usePositionsDerivedData();

  if (isLoading && positions.length === 0) {
    return <LoadingState />;
  }

  if (positions.length === 0 && !botSnapshot) {
    return <EmptyOrLoadingState />;
  }

  return (
    <Flex
      direction="column"
      h="100%"
      gap="sm"
      className="paper-positions-panel"
      id="positions-panel"
      data-testid="positions-panel"
    >
      <WatchlistScan snapshot={botSnapshot} selectedSymbol={selectedSymbol} />

      {positions.length > 0 && (
        <PositionsContent
          positions={positions}
          selectedSymbol={selectedSymbol}
          strategyGroups={strategyGroups}
          isMultiStrategy={isMultiStrategy}
          activeTab={activeTab}
          filteredPositions={filteredPositions}
        />
      )}

      {positions.length === 0 && <EmptyPositions />}
    </Flex>
  );
}
