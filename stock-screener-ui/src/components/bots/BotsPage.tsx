import { useEffect, useCallback, useState } from "react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import {
  Box,
  Tabs,
  Button,
  Group,
  Stack,
  Text,
  Badge,
  ActionIcon,
  Table,
} from "@mantine/core";
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
import type { BotConfig, BotsView } from "../../types/bots";
import { BotConfigModal } from "./BotConfigModal2";
import { BotStatusPanel } from "./BotStatusPanel2";
import { CompactPage, CompactPanel } from "../common/compact";
import { LoadingState, ErrorAlert, EmptyCompact } from "../common/states";
import { StatusBadge } from "../common/BadgeComponents";

export function BotsPage() {
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

  const renderBotsList = () => {
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
            {state.bots.map((bot) => (
              <Table.Tr
                key={bot.id}
                bg={state.selectedBot?.id === bot.id ? "rgba(34, 139, 230, 0.1)" : undefined}
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
                    pid={bot.pid}
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
                  <Group gap="xs">
                    <ActionIcon
                      variant="subtle"
                      color="blue"
                      onClick={() => handleViewStatus(bot)}
                      title="View Status"
                      data-testid={`view-bot-status-btn-${bot.id}`}
                    >
                      <IconEye size={16} />
                    </ActionIcon>
                    {bot.running ? (
                      <ActionIcon
                        variant="subtle"
                        color="orange"
                        onClick={() => handleStopBot(bot.id)}
                        title="Stop Bot"
                        data-testid={`stop-bot-btn-${bot.id}`}
                      >
                        <IconPlayerStop size={16} />
                      </ActionIcon>
                    ) : (
                      <ActionIcon
                        variant="subtle"
                        color="green"
                        onClick={() => handleStartBot(bot.id)}
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
                      onClick={() => {
                        openEditModal(bot);
                      }}
                      title="Edit Bot"
                      data-testid={`edit-bot-btn-${bot.id}`}
                    >
                      <IconEdit size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={() => handleDeleteBot(bot.id)}
                      disabled={bot.running}
                      title="Delete Bot"
                      data-testid={`delete-bot-btn-${bot.id}`}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </CompactPanel>
    );
  };

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
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          overflow: "hidden",
        }}
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
            renderBotsList()
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
