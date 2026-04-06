import { useMemo } from "react";
import { Tabs, Badge, Text, Group, Flex, ScrollArea, Loader, Box } from "@mantine/core";
import { getPaperTradingState, setSelectedStrategyTab, subscribe } from "../../state/paperTrading";
import type { PaperPosition } from "../../types/paperTrading";
import { formatNumber, getPnLTextColor } from "../../utils/ui-helpers";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import {
  PositionsTableBody,
  WatchlistScan,
  StrategySummaryFooter,
  groupPositionsByStrategy,
  calcStrategySummary,
} from "./PositionsHelpers";

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

function StrategyTabs({
  activeTab,
  strategyGroups,
  positions,
}: {
  activeTab: string;
  strategyGroups: Map<string, PaperPosition[]>;
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
      className="paper-strategy-tabs"
      id="strategy-tabs"
    >
      <Tabs.List>
        <Tabs.Tab value="all" data-testid="strategy-tab-all">
          <Group gap="xs">
            <span>All</span>
            <Badge size="xs" variant="filled" color="blue">
              {positions.length}
            </Badge>
            <Text size="xs" c={getPnLTextColor(allSummary.totalPnl)}>
              {allSummary.totalPnl >= 0 ? "+" : ""}₹{formatNumber(allSummary.totalPnl)}
            </Text>
          </Group>
        </Tabs.Tab>
        {strategies.map((strategy) => {
          const summary = calcStrategySummary(strategyGroups.get(strategy) || []);
          return (
            <Tabs.Tab
              key={strategy}
              value={strategy}
              data-testid={`strategy-tab-${strategy.replace(/\s+/g, "-").toLowerCase()}`}
            >
              <Group gap="xs">
                <span>{strategy}</span>
                <Badge size="xs" variant="filled" color="blue">
                  {summary.count}
                </Badge>
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

export function PaperPositionsTable() {
  useStoreSubscription(subscribe);

  const state = getPaperTradingState();
  const { positions, selectedSymbol, selectedStrategyTab, botSnapshot, isLoading } = state;

  const strategyGroups = useMemo(() => groupPositionsByStrategy(positions), [positions]);
  const isMultiStrategy = strategyGroups.size > 1;
  const activeTab = selectedStrategyTab || "all";

  if (isLoading && positions.length === 0) {
    return (
      <Flex
        justify="center"
        align="center"
        py="lg"
        data-testid="positions-panel"
        className="paper-positions-panel"
        id="positions-panel"
      >
        <Loader size="sm" />
      </Flex>
    );
  }

  if (positions.length === 0 && !botSnapshot) {
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

  const filteredPositions = activeTab === "all" ? positions : strategyGroups.get(activeTab) || [];

  return (
    <Flex
      direction="column"
      h="100%"
      gap="sm"
      className="paper-positions-panel"
      id="positions-panel"
      data-testid="positions-panel"
    >
      <WatchlistScan snapshot={botSnapshot} />

      {positions.length > 0 && (
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
            <Badge color="red" variant="light" size="xs">
              LIVE
            </Badge>
          </Group>

          {isMultiStrategy && (
            <StrategyTabs
              activeTab={activeTab}
              strategyGroups={strategyGroups}
              positions={positions}
            />
          )}

          <ScrollArea flex={1} style={{ minHeight: 0 }}>
            <Box style={{ overflowX: "auto" }} data-testid="positions-table-container">
              <PositionsTableBody positions={filteredPositions} selectedSymbol={selectedSymbol} />
            </Box>
          </ScrollArea>

          {isMultiStrategy && activeTab === "all" && (
            <StrategySummaryFooter strategyGroups={strategyGroups} />
          )}
        </Flex>
      )}

      {positions.length === 0 && <EmptyPositions />}
    </Flex>
  );
}
