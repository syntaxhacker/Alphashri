import { useMemo, useState } from "react";
import { Badge, Text, Group, Flex, ScrollArea, Button, Tooltip, Collapse } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { getPaperTradingState, subscribe } from "../../state/paperTrading";
import type { PaperPosition } from "../../types/paperTrading";
import { formatNumber, getPnLTextColor } from "../../utils/ui-helpers";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { closeAllPositions, refreshBotLiveData } from "../../api/paperTrading";
import { CompactPanel } from "../common/compact";
import { PositionsTableBody, groupPositionsByStrategy, calcStrategySummary } from "./PositionsHelpers";
import { WatchlistScan2 } from "./WatchlistScan2";

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
  strategyGroups,
  selectedSymbol,
}: {
  positions: PaperPosition[];
  strategyGroups: Map<number, PaperPosition[]>;
  selectedSymbol: string | null;
}) {
  const state = getPaperTradingState();
  const selectedBot = state.availableBots.find(b => b.id === state.filterBot);
  const isLive = selectedBot?.live_trading ?? false;
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set(
    Array.from(strategyGroups.keys()),
  ));

  const toggleGroup = (id: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Flex direction="column" flex={1} gap="xs" style={{ minHeight: 0 }}>
      <Group justify="space-between" py={2}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          Positions ({positions.length})
        </Text>
        <Group gap="xs">
          <Badge color={isLive ? "red" : "green"} variant="light" size="xs">
            {isLive ? "LIVE" : "PAPER"}
          </Badge>
          <CloseAllButton positions={positions} />
        </Group>
      </Group>

      <ScrollArea flex={1} style={{ minHeight: 0 }}>
        <Flex direction="column" gap="sm" data-testid="positions-table-container">
          {Array.from(strategyGroups.entries()).map(([strategyId, group]) => {
            const summary = calcStrategySummary(group);
            const displayName = group[0]?.strategy_name || `Strategy ${strategyId}`;
            const expanded = expandedGroups.has(strategyId);
            return (
              <CompactPanel
                key={strategyId}
                testId={`strategy-panel-${strategyId}`}
                scrollable={false}
              >
                <Group
                  justify="space-between"
                  mb="xs"
                  onClick={() => toggleGroup(strategyId)}
                  style={{ cursor: "pointer" }}
                >
                  <Group gap="xs">
                    <Text size="xs" c="dimmed">{expanded ? "▼" : "▶"}</Text>
                    <Text size="sm" fw={600}>{displayName}</Text>
                    <Badge size="xs">{summary.count}</Badge>
                    <Text size="xs" c={getPnLTextColor(summary.totalPnl)} fw={600}>
                      {summary.totalPnl >= 0 ? "+" : ""}₹{formatNumber(summary.totalPnl)}
                    </Text>
                  </Group>
                  <Tooltip label="Close all in this strategy">
                    <Button
                      size="compact-xs"
                      variant="light"
                      color="red"
                      leftSection={<IconX size={12} />}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCloseGroup(group);
                      }}
                      data-testid={`close-strategy-${strategyId}`}
                    >
                      Close All
                    </Button>
                  </Tooltip>
                </Group>
                <Collapse in={expanded}>
                  <PositionsTableBody positions={group} selectedSymbol={selectedSymbol} />
                </Collapse>
              </CompactPanel>
            );
          })}
        </Flex>
      </ScrollArea>
    </Flex>
  );
}

function CloseAllButton({ positions, onClose }: {
  positions: PaperPosition[];
  onClose?: () => void;
}) {
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
      onClose?.();
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

export function PaperPositionsTable() {
  const state = getPaperTradingState();
  const { positions, selectedSymbol, botSnapshot, isLoading } = state;
  const sortedPositions = usePositionsData();
  const strategyGroups = useMemo(() => groupPositionsByStrategy(sortedPositions), [sortedPositions]);

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
      <WatchlistScan2 snapshot={botSnapshot} selectedSymbol={selectedSymbol} />

      {positions.length > 0 && (
        <PositionsContent
          positions={sortedPositions}
          strategyGroups={strategyGroups}
          selectedSymbol={selectedSymbol}
        />
      )}

      {positions.length === 0 && <EmptyPositions />}
    </Flex>
  );
}
