import { useEffect, useCallback } from "react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { Box, Tabs, Button, Stack, Table, Group } from "@mantine/core";
import { IconRobot, IconChartLine, IconPlus, IconPlayerStop, IconChartBar } from "@tabler/icons-react";
import {
  getBotsState,
  getCurrentView,
  subscribe,
  loadBotStatus,
  loadBotTrades,
  selectBot,
  startBotAction,
  stopBotAction,
  stopAllBotsAction,
  deleteBotAction,
  clearError,
  startAutoRefresh,
  stopAutoRefresh,
  initBotsState,
  setCurrentView,
  openCreateModal,
  openEditModal,
  closeCreateModal,
  closeEditModal,
} from "../../state/bots";
import type { BotConfig, BotsView } from "../../types/bots";
import { BotConfigModal } from "./BotConfigModal2";
import { BotStatusPanel } from "./BotStatusPanel2";
import { CompactPage, CompactPanel } from "../common/compact";
import { InlineLoader, ErrorAlert, EmptyCompact } from "../common/states";
import { BotRow } from "./BotHelpers";
import { StrategyPerformance } from "./StrategyPerformance";

function useViewChangeHandler() {
  return useCallback((view: string | null) => {
    if (!view) return;
    setCurrentView(view as BotsView);
    stopAutoRefresh();
  }, []);
}

function useStartBotHandler() {
  return useCallback(async (botId: string) => {
    await startBotAction(botId, false);
  }, []);
}

function useStopBotHandler() {
  return useCallback(async (botId: string) => {
    await stopBotAction(botId);
    stopAutoRefresh();
  }, []);
}

function useDeleteBotHandler() {
  return useCallback(async (botId: string) => {
    if (window.confirm("Are you sure you want to delete this bot?")) {
      await deleteBotAction(botId);
    }
  }, []);
}

function useViewStatusHandler() {
  return useCallback((bot: BotConfig) => {
    selectBot(bot);
    setCurrentView("status");
    loadBotTrades(bot.id);
    if (bot.running) {
      loadBotStatus(bot.id);
      startAutoRefresh(bot.id, 5000);
    }
  }, []);
}

function useClearErrorHandler() {
  return useCallback(() => {
    clearError();
  }, []);
}

function useEditBotHandler() {
  return useCallback((bot: BotConfig) => {
    openEditModal(bot);
  }, []);
}

function BotsPageTabs({
  currentView,
  onViewChange,
}: {
  currentView: BotsView;
  onViewChange: (view: BotsView) => void;
}) {
  return (
    <Box flex="0 0 auto" mb="md" className="bots-header">
      <Tabs
        value={currentView}
        onChange={(v) => v && onViewChange(v)}
        id="bots-tabs"
        data-testid="bots-tabs"
      >
        <Tabs.List>
          <Tabs.Tab value="list" leftSection={<IconRobot size={16} />} data-testid="bots-tab-list">
            Bots
          </Tabs.Tab>
          <Tabs.Tab
            value="status"
            leftSection={<IconChartLine size={16} />}
            disabled={!getBotsState().selectedBot}
            data-testid="bots-tab-status"
          >
            Status
          </Tabs.Tab>
          <Tabs.Tab
            value="performance"
            leftSection={<IconChartBar size={16} />}
            data-testid="bots-tab-performance"
          >
            Performance
          </Tabs.Tab>
        </Tabs.List>
      </Tabs>
    </Box>
  );
}

function BotsTableHeader() {
  return (
    <Table.Thead>
      <Table.Tr>
        <Table.Th>Name</Table.Th>
        <Table.Th>Status</Table.Th>
        <Table.Th>Strategies</Table.Th>
        <Table.Th>Max Positions</Table.Th>
        <Table.Th>Max Capital</Table.Th>
        <Table.Th>Actions</Table.Th>
      </Table.Tr>
    </Table.Thead>
  );
}

function BotsTable({
  onViewStatus,
  onStart,
  onStop,
  onEdit,
  onDelete,
}: {
  onViewStatus: (bot: BotConfig) => void;
  onStart: (botId: string) => Promise<void>;
  onStop: (botId: string) => Promise<void>;
  onEdit: (bot: BotConfig) => void;
  onDelete: (botId: string) => Promise<void>;
}) {
  const state = getBotsState();

  if (state.bots.length === 0) {
    return (
      <EmptyCompact
        emoji="🤖"
        title="No bots configured"
        description='Click "New Bot" to create one'
        data-testid="bots-empty-state"
        id="bots-empty-state"
      />
    );
  }

  return (
    <CompactPanel id="bots-list-card" data-testid="bots-list-card">
      <Table striped highlightOnHover id="bots-table" data-testid="bots-table">
        <BotsTableHeader />
        <Table.Tbody>
          {state.bots.map((bot) => (
            <BotRow
              key={bot.id}
              bot={bot}
              isSelected={state.selectedBot?.id === bot.id}
              onView={onViewStatus}
              onStart={onStart}
              onStop={onStop}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </Table.Tbody>
      </Table>
    </CompactPanel>
  );
}

function renderPageContent({
  currentView,
  handleViewChange,
  handleStartBot,
  handleStopBot,
  handleViewStatus,
  handleClearError,
  handleEditBot,
  handleDeleteBot,
}: {
  currentView: BotsView;
  handleViewChange: (view: BotsView) => void;
  handleStartBot: (botId: string) => Promise<void>;
  handleStopBot: (botId: string) => Promise<void>;
  handleViewStatus: (bot: BotConfig) => void;
  handleClearError: () => void;
  handleEditBot: (bot: BotConfig) => void;
  handleDeleteBot: (botId: string) => Promise<void>;
}) {
  const state = getBotsState();
  const isLoading = Object.values(state.loading).some((v) => v);

  if (state.error) {
    return <ErrorAlert message={state.error} onClose={handleClearError} data-testid="bots-error" />;
  }

  return (
    <Stack id="bots-page" className="bots-page" h="100%" style={{ overflow: "hidden" }}>
      <BotsPageTabs currentView={currentView} onViewChange={handleViewChange} />
      <Box flex={1} style={{ minHeight: 0, overflowY: "auto" }}>
        {isLoading ? (
          <Stack align="center" justify="center" h="100%" data-testid="bots-loading">
            <InlineLoader size="lg" />
          </Stack>
        ) : currentView === "performance" ? (
          <StrategyPerformance />
        ) : currentView === "status" && state.selectedBot ? (
          <BotStatusPanel
            bot={state.selectedBot}
            status={state.botStatus}
            trades={state.botTrades}
            onStart={handleStartBot}
            onStop={handleStopBot}
          />
        ) : (
          <BotsTable
            onViewStatus={handleViewStatus}
            onStart={handleStartBot}
            onStop={handleStopBot}
            onEdit={handleEditBot}
            onDelete={handleDeleteBot}
          />
        )}
      </Box>
    </Stack>
  );
}

function BotsConfigModal() {
  const state = getBotsState();
  const handleClose = useCallback(() => {
    if (state.showCreateModal) {
      closeCreateModal();
    } else {
      closeEditModal();
    }
  }, [state.showCreateModal]);
  return (
    <BotConfigModal
      opened={state.showCreateModal || state.showEditModal}
      bot={state.editingBot}
      availableStrategies={state.availableStrategies}
      onClose={handleClose}
    />
  );
}

export function BotsPage() {
  useStoreSubscription(subscribe);
  const currentView = getCurrentView();

  useEffect(() => {
    initBotsState();
    return () => stopAutoRefresh();
  }, []);

  const handleViewChange = useViewChangeHandler();
  const handleStartBot = useStartBotHandler();
  const handleStopBot = useStopBotHandler();
  const handleViewStatus = useViewStatusHandler();
  const handleClearError = useClearErrorHandler();
  const handleEditBot = useEditBotHandler();
  const handleDeleteBot = useDeleteBotHandler();

  return (
    <div data-testid="bots-view">
      <CompactPage
        title="Bots"
        description="Manage bot configurations, live status, and execution controls."
        actions={
          <Group gap="sm">
            <Button
              variant="light"
              color="orange"
              size="sm"
              leftSection={<IconPlayerStop size={16} />}
              onClick={async () => {
                const bots = getBotsState().bots;
                const runningCount = bots.filter(b => b.running).length;
                if (window.confirm(`Stop all ${runningCount} running bots?`)) {
                  await stopAllBotsAction();
                }
              }}
              disabled={!getBotsState().bots.some(b => b.running)}
            >
              Stop All ({getBotsState().bots.filter(b => b.running).length})
            </Button>
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={openCreateModal}
              data-testid="create-bot-btn"
            >
              New Bot
            </Button>
          </Group>
        }
      >
        {renderPageContent({
          currentView,
          handleViewChange,
          handleStartBot,
          handleStopBot,
          handleViewStatus,
          handleClearError,
          handleEditBot,
          handleDeleteBot,
        })}
        <BotsConfigModal />
      </CompactPage>
    </div>
  );
}
