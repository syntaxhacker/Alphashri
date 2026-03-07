import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Grid,
  Tabs,
  SegmentedControl,
  Card,
  Text,
  Group,
  Stack,
  Loader,
  Alert,
} from "@mantine/core";
import { IconActivity, IconHistory, IconSettings } from "@tabler/icons-react";
import {
  getPaperTradingState,
  subscribe,
  setPaperTradingView,
  setFilterFromDate,
  setFilterToDate,
  setFilterSymbol,
  setFilterStrategy,
  setError,
  setAvailableBots,
} from "../../state/paperTrading";
import type {
  PaperTradingState,
  PaperTradingView,
  PaperPosition,
  PaperTrade,
  PaperChartData,
  PortfolioStatus,
  PaperBotSnapshot,
  StrategyConfig,
  BotInfo,
} from "../../types/paperTrading";

import { PaperPositionsTable } from "./PaperPositionsTable";
import { PaperPortfolioCard } from "./PaperPortfolioCard";
import { PaperChart } from "./PaperChart";
import { PaperHistoryTable } from "./PaperHistoryTable";
import { PaperSettings } from "./PaperSettings";

import {
  refreshLiveData,
  refreshHistoryData,
  initLiveAutoRefresh,
  stopLiveAutoRefresh,
  startPaperBot,
  stopPaperBot,
  fetchPaperBotStatus,
  fetchStrategyConfig,
  refreshBotLiveData,
  listBots,
  startBot,
  stopBot,
  fetchBotPortfolio,
  fetchBotPositions,
  fetchBotScanItems,
} from "../../api/paperTrading";

let activeBotId: string | null = null;

export function PaperTradingView() {
  const [state, setState] = useState<PaperTradingState>(getPaperTradingState);

  useEffect(() => {
    const unsubscribe = subscribe(() => {
      setState(getPaperTradingState());
    });

    loadInitialData();

    return () => {
      unsubscribe();
      stopLiveAutoRefresh();
    };
  }, []);

  const loadInitialData = async () => {
    try {
      const bots = await listBots();
      setAvailableBots(bots);

      if (activeBotId) {
        await refreshBotLiveData(activeBotId);
      } else {
        refreshLiveData();
      }
    } catch (error) {
      console.error("Failed to load initial data:", error);
    }
  };

  const handleViewChange = useCallback(async (view: string | null) => {
    if (!view) return;
    setPaperTradingView(view as PaperTradingView);

    if (view === "live") {
      if (activeBotId) {
        refreshBotLiveData(activeBotId);
      } else {
        refreshLiveData();
      }
    } else if (view === "history") {
      stopLiveAutoRefresh();
      refreshHistoryData();
    } else if (view === "settings") {
      stopLiveAutoRefresh();
      fetchStrategyConfig();
    }
  }, []);

  const handleClearError = useCallback(() => {
    setError(null);
  }, []);

  const handleToggleBot = useCallback(async () => {
    if (activeBotId) {
      const currentState = getPaperTradingState();
      const botId = activeBotId;
      if (currentState.botRunning) {
        await stopBot(botId);
      } else {
        await startBot(botId);
      }
      setTimeout(() => refreshBotLiveData(botId), 1000);
    } else {
      const currentState = getPaperTradingState();
      if (currentState.botRunning) {
        await stopPaperBot();
      } else {
        await startPaperBot();
      }
      setTimeout(() => refreshLiveData(), 1000);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    if (activeBotId) {
      await refreshBotLiveData(activeBotId);
    } else {
      await refreshLiveData();
    }
  }, []);

  const handleBotSelect = useCallback(async (botId: string) => {
    if (!botId) {
      activeBotId = null;
      stopLiveAutoRefresh();
      initLiveAutoRefresh();
      refreshLiveData();
    } else {
      activeBotId = botId;
      stopLiveAutoRefresh();
      await refreshBotLiveData(botId);
    }
  }, []);

  const handleFilterFromDate = useCallback((value: string) => {
    setFilterFromDate(value || null);
    refreshHistoryData();
  }, []);

  const handleFilterToDate = useCallback((value: string) => {
    setFilterToDate(value || null);
    refreshHistoryData();
  }, []);

  const handleFilterSymbol = useCallback((value: string | null) => {
    setFilterSymbol(value);
  }, []);

  const renderLiveView = () => {
    return (
      <Grid h="100%" gutter="md">
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Stack gap="xs" h="100%" data-testid="paper-left-panel">
            <PaperPortfolioCard
              portfolio={state.portfolio as any}
              isMultiStrategy={state.availableBots.length > 0}
              strategySummaries={[]}
            />
            <Box flex={1} style={{ minHeight: 0, overflow: "auto" }}>
              <PaperPositionsTable />
            </Box>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Box h="100%" style={{ overflow: "hidden" }} data-testid="paper-right-panel">
            <PaperChart />
          </Box>
        </Grid.Col>
      </Grid>
    );
  };

  const renderHistoryView = () => {
    return (
      <Box
        style={{ display: "flex", gap: "var(--mantine-spacing-md)", height: "100%" }}
        data-testid="paper-history-panel"
      >
        <Box
          style={{
            flex: "1 1 50%",
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          <PaperHistoryTable />
        </Box>
        <Box
          style={{
            flex: "1 1 50%",
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          <PaperChart />
        </Box>
      </Box>
    );
  };

  const renderSettingsView = () => {
    return (
      <Box h="100%" data-testid="paper-settings-panel">
        <PaperSettings />
      </Box>
    );
  };

  const renderFilters = () => {
    if (state.currentView === "live") {
      return (
        <Group gap="md">
          <Group gap="xs">
            <Text size="sm" c="dimmed">
              Bot:
            </Text>
            <SegmentedControl
              size="xs"
              value={activeBotId || "default"}
              onChange={handleBotSelect}
              data={[
                { value: "default", label: "Default" },
                ...state.availableBots.map((bot: BotInfo) => ({
                  value: bot.id,
                  label: bot.name,
                })),
              ]}
              data-testid="bot-selector-dropdown"
              className="bot-selector-dropdown"
            />
          </Group>
          <Group gap="xs">
            <Text size="sm" c="dimmed">
              Status:
            </Text>
            <Text
              size="sm"
              fw={500}
              c={state.botRunning ? "green" : "red"}
              data-testid="bot-status"
            >
              {state.botRunning ? `Running${state.botPid ? ` (${state.botPid})` : ""}` : "Stopped"}
            </Text>
          </Group>
          <Group gap="xs">
            <Text
              component="button"
              style={{ cursor: "pointer", textDecoration: "underline" }}
              size="sm"
              onClick={handleRefresh}
              data-testid="refresh-btn"
            >
              Refresh
            </Text>
            <Text
              component="button"
              style={{ cursor: "pointer", textDecoration: "underline" }}
              size="sm"
              c={state.botRunning ? "red" : "blue"}
              onClick={handleToggleBot}
              data-testid={state.botRunning ? "stop-bot-btn" : "start-bot-btn"}
            >
              {state.botRunning ? "Stop Bot" : "Start Bot"}
            </Text>
          </Group>
        </Group>
      );
    }

    if (state.currentView === "history") {
      const symbols = [...new Set(state.trades.map((t: PaperTrade) => t.symbol))].sort();
      return (
        <Group gap="md">
          <Group gap="xs">
            <Text size="sm" c="dimmed">
              From:
            </Text>
            <input
              type="date"
              value={state.filterFromDate || ""}
              onChange={(e) => handleFilterFromDate(e.target.value)}
              data-testid="filter-from-date"
            />
          </Group>
          <Group gap="xs">
            <Text size="sm" c="dimmed">
              To:
            </Text>
            <input
              type="date"
              value={state.filterToDate || ""}
              onChange={(e) => handleFilterToDate(e.target.value)}
              data-testid="filter-to-date"
            />
          </Group>
          <Group gap="xs">
            <Text size="sm" c="dimmed">
              Symbol:
            </Text>
            <select
              value={state.filterSymbol || ""}
              onChange={(e) => handleFilterSymbol(e.target.value)}
              data-testid="filter-symbol"
            >
              <option value="">All</option>
              {symbols.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Group>
        </Group>
      );
    }

    return null;
  };

  return (
    <Box
      h="100%"
      style={{ display: "flex", flexDirection: "column", padding: "var(--mantine-spacing-md)" }}
      data-testid="paper-trading-view"
    >
      {state.error && (
        <Alert
          title="Error"
          color="red"
          variant="filled"
          mb="md"
          data-testid="paper-error"
          withCloseButton
          onClose={handleClearError}
        >
          {state.error}
        </Alert>
      )}

      <Box flex="0 0 auto" mb="md">
        <Stack gap="sm">
          <Group justify="space-between" align="center">
            <Tabs
              value={state.currentView}
              onChange={handleViewChange}
              data-testid="paper-trading-tabs"
            >
              <Tabs.List>
                <Tabs.Tab
                  value="live"
                  leftSection={<IconActivity size={16} />}
                  data-testid="tab-live"
                >
                  Live Positions
                  {state.positions.length > 0 && (
                    <Text span ml={4} size="xs" c="blue">
                      ({state.positions.length})
                    </Text>
                  )}
                </Tabs.Tab>
                <Tabs.Tab
                  value="history"
                  leftSection={<IconHistory size={16} />}
                  data-testid="trade-history-tab"
                >
                  Trade History
                  {state.trades.length > 0 && (
                    <Text span ml={4} size="xs" c="blue">
                      ({state.trades.length})
                    </Text>
                  )}
                </Tabs.Tab>
                <Tabs.Tab
                  value="settings"
                  leftSection={<IconSettings size={16} />}
                  data-testid="tab-settings"
                >
                  Settings
                </Tabs.Tab>
              </Tabs.List>
            </Tabs>
          </Group>

          <Box data-testid="paper-filters">{renderFilters()}</Box>
        </Stack>
      </Box>

      <Box flex={1} style={{ minHeight: 0 }}>
        {state.currentView === "live" && renderLiveView()}
        {state.currentView === "history" && renderHistoryView()}
        {state.currentView === "settings" && renderSettingsView()}
      </Box>
    </Box>
  );
}
