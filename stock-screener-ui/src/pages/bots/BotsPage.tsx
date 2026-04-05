import { useEffect, useCallback, useState } from "react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { Box, Tabs, Button, Group, Stack, Text, Badge, ActionIcon, Table } from "@mantine/core";
import {
  IconRobot,
  IconChartLine,
  IconPlus,
  IconPlayerPlay,
  IconPlayerStop,
  IconEdit,
  IconTrash,
  IconEye,
} from "@tabler/icons-react";
import {
  getBotsState,
  subscribe,
  loadBotStatus,
  loadBotTrades,
  selectBot,
  startBotAction,
  stopBotAction,
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
import type { BotConfig } from "../../types/bots";

type BotsView = "list" | "status";
import { BotConfigModal } from "../../components/bots/BotConfigModal2";
import { BotStatusPanel } from "../../components/bots/BotStatusPanel2";
import { CompactPage, CompactPanel } from "../../components/common/compact";
import { LoadingState, ErrorAlert, EmptyCompact } from "../../components/common/states";
import { StatusBadge } from "../../components/common/BadgeComponents";

function useBotsPageState() {
  const [currentView, setCurrentViewState] = useState<BotsView>("list");
  useStoreSubscription(subscribe);
  const state = getBotsState();

  useEffect(() => {
    initBotsState();
    return () => {
      stopAutoRefresh();
    };
  }, []);

  const handleViewChange = useCallback((view: string | null) => {
    if (!view) return;
    setCurrentViewState(view as BotsView);
    setCurrentView(view as BotsView);
    stopAutoRefresh();
  }, []);

  const handleStartBot = useCallback(async (botId: string) => {
    await startBotAction(botId, false);
  }, []);

  const handleStopBot = useCallback(async (botId: string) => {
    await stopBotAction(botId);
    stopAutoRefresh();
  }, []);

  const handleDeleteBot = useCallback(async (botId: string) => {
    if (window.confirm("Are you sure you want to delete this bot?")) {
      await deleteBotAction(botId);
    }
  }, []);

  const handleViewStatus = useCallback((bot: BotConfig) => {
    selectBot(bot);
    setCurrentViewState("status");
    setCurrentView("status");
    loadBotTrades(bot.id);
    if (bot.running) {
      loadBotStatus(bot.id);
      startAutoRefresh(bot.id, 5000);
    }
  }, []);

  const handleClearError = useCallback(() => {
    clearError();
  }, []);

  return {
    state,
    currentView,
    handleViewChange,
    handleStartBot,
    handleStopBot,
    handleDeleteBot,
    handleViewStatus,
    handleClearError,
  };
}

interface BotActionsProps {
  bot: BotConfig;
  onViewStatus: (bot: BotConfig) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
}

function BotActions({ bot, onViewStatus, onStart, onStop, onDelete }: BotActionsProps) {
  return (
    <Group gap="xs">
      <ActionIcon
        variant="subtle"
        color="blue"
        onClick={() => onViewStatus(bot)}
        title="View Status"
        data-testid={`view-bot-status-btn-${bot.id}`}
      >
        <IconEye size={16} />
      </ActionIcon>
      {bot.running ? (
        <ActionIcon
          variant="subtle"
          color="orange"
          onClick={() => onStop(bot.id)}
          title="Stop Bot"
          data-testid={`stop-bot-btn-${bot.id}`}
        >
          <IconPlayerStop size={16} />
        </ActionIcon>
      ) : (
        <ActionIcon
          variant="subtle"
          color="green"
          onClick={() => onStart(bot.id)}
          disabled={!bot.is_active}
          title="Start Bot"
          data-testid={`start-bot-btn-${bot.id}`}
        >
          <IconPlayerPlay size={16} />
        </ActionIcon>
      )}
      <ActionIcon
        variant="subtle"
        color="blue"
        onClick={() => openEditModal(bot)}
        title="Edit Bot"
        data-testid={`edit-bot-btn-${bot.id}`}
      >
        <IconEdit size={16} />
      </ActionIcon>
      <ActionIcon
        variant="subtle"
        color="red"
        onClick={() => onDelete(bot.id)}
        disabled={bot.running}
        title="Delete Bot"
        data-testid={`delete-bot-btn-${bot.id}`}
      >
        <IconTrash size={16} />
      </ActionIcon>
    </Group>
  );
}

interface BotRowProps {
  bot: BotConfig;
  isSelected: boolean;
  onViewStatus: (bot: BotConfig) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
}

function BotRow({ bot, isSelected, onViewStatus, onStart, onStop, onDelete }: BotRowProps) {
  return (
    <Table.Tr
      bg={isSelected ? "rgba(34, 139, 230, 0.1)" : undefined}
      data-testid={`bot-row-${bot.id}`}
      className="bot-row"
    >
      <Table.Td>
        <Group gap="xs">
          <Box
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: bot.running ? "#51cf66" : "#868e96",
            }}
          />
          <Text fw={500}>{bot.name}</Text>
          {!bot.is_active && (
            <Badge color="gray" size="sm" variant="light">
              Inactive
            </Badge>
          )}
        </Group>
      </Table.Td>
      <Table.Td>
        <StatusBadge
          running={bot.running}
          pid={bot.pid ?? undefined}
          data-testid={`bot-status-${bot.id}`}
        />
      </Table.Td>
      <Table.Td>
        <Stack gap={4}>
          <Text size="sm">{bot.strategies.length} strategies</Text>
          <Group gap="xs" wrap="wrap">
            {bot.strategies.map((s) => (
              <Badge key={s.id} size="sm" variant="light">
                {s.strategy_type}
              </Badge>
            ))}
          </Group>
          {bot.strategies.map((s) => (
            <Text key={`name-${s.id}`} size="xs" c="dimmed">
              {s.name}
            </Text>
          ))}
        </Stack>
      </Table.Td>
      <Table.Td>{bot.max_total_positions}</Table.Td>
      <Table.Td>{(bot.max_total_capital_pct * 100).toFixed(0)}%</Table.Td>
      <Table.Td>
        <BotActions
          bot={bot}
          onViewStatus={onViewStatus}
          onStart={onStart}
          onStop={onStop}
          onDelete={onDelete}
        />
      </Table.Td>
    </Table.Tr>
  );
}

interface BotsTableProps {
  bots: BotConfig[];
  selectedBotId?: string;
  onViewStatus: (bot: BotConfig) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
}

function BotsTable({
  bots,
  selectedBotId,
  onViewStatus,
  onStart,
  onStop,
  onDelete,
}: BotsTableProps) {
  if (bots.length === 0) {
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
        <Table.Tbody>
          {bots.map((bot) => (
            <BotRow
              key={bot.id}
              bot={bot}
              isSelected={selectedBotId === bot.id}
              onViewStatus={onViewStatus}
              onStart={onStart}
              onStop={onStop}
              onDelete={onDelete}
            />
          ))}
        </Table.Tbody>
      </Table>
    </CompactPanel>
  );
}

export function BotsPage() {
  const {
    state,
    currentView,
    handleViewChange,
    handleStartBot,
    handleStopBot,
    handleDeleteBot,
    handleViewStatus,
    handleClearError,
  } = useBotsPageState();
  const isLoading = Object.values(state.loading).some((v) => v);

  return (
    <CompactPage
      title="Bots"
      description="Manage bot configurations, live status, and execution controls."
      actions={
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={openCreateModal}
          data-testid="create-bot-btn"
        >
          New Bot
        </Button>
      }
    >
      <Box
        id="bots-page"
        className="bots-page"
        style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}
        data-testid="bots-view"
      >
        {state.error && (
          <ErrorAlert message={state.error} onClose={handleClearError} data-testid="bots-error" />
        )}
        <Box flex="0 0 auto" mb="md" className="bots-header">
          <Tabs
            value={currentView}
            onChange={handleViewChange}
            id="bots-tabs"
            data-testid="bots-tabs"
          >
            <Tabs.List>
              <Tabs.Tab
                value="list"
                leftSection={<IconRobot size={16} />}
                data-testid="bots-tab-list"
              >
                Bots
              </Tabs.Tab>
              <Tabs.Tab
                value="status"
                leftSection={<IconChartLine size={16} />}
                disabled={!state.selectedBot}
                data-testid="bots-tab-status"
              >
                Status
              </Tabs.Tab>
            </Tabs.List>
          </Tabs>
        </Box>
        <Box flex={1} style={{ minHeight: 0, overflowY: "auto" }}>
          {isLoading ? (
            <Stack align="center" justify="center" h="100%" data-testid="bots-loading">
              <LoadingState message="Loading..." size="lg" />
            </Stack>
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
              bots={state.bots}
              selectedBotId={state.selectedBot?.id}
              onViewStatus={handleViewStatus}
              onStart={handleStartBot}
              onStop={handleStopBot}
              onDelete={handleDeleteBot}
            />
          )}
        </Box>
      </Box>
      <BotConfigModal
        opened={state.showCreateModal || state.showEditModal}
        bot={state.editingBot}
        availableStrategies={state.availableStrategies}
        onClose={() => {
          if (state.showCreateModal) {
            closeCreateModal();
          } else {
            closeEditModal();
          }
        }}
      />
    </CompactPage>
  );
}
