import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Tabs,
  Button,
  Group,
  Alert,
  Stack,
  Text,
  Badge,
  ActionIcon,
  Table,
  Card,
  Modal,
  Loader,
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
  loadBots,
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
import { BotConfigModal } from "./BotConfigModal";
import { BotStatusPanel } from "./BotStatusPanel";

export function BotsPage() {
  const [state, setState] = useState(getBotsState());
  const [currentView, setCurrentViewState] = useState<BotsView>("list");

  useEffect(() => {
    const unsubscribe = subscribe(() => {
      setState(getBotsState());
    });

    initBotsState();

    return () => {
      unsubscribe();
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
        <Card shadow="sm" padding="lg" radius="md" withBorder>
          <Stack align="center" gap="xs">
            <Text size="xl">🤖</Text>
            <Text fw={600}>No bots configured</Text>
            <Text size="sm" c="dimmed">
              Click "New Bot" to create one
            </Text>
          </Stack>
        </Card>
      );
    }

    return (
      <Card shadow="sm" padding="md" radius="md" withBorder>
        <Table striped highlightOnHover>
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
                  <Badge
                    color={bot.running ? "green" : "gray"}
                    variant="light"
                    size="sm"
                  >
                    {bot.running ? `Running (PID ${bot.pid})` : "Stopped"}
                  </Badge>
                </Table.Td>
                <Table.Td>{bot.strategies.length} strategies</Table.Td>
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
      </Card>
    );
  };

  const isLoading = Object.values(state.loading).some((v) => v);

  return (
    <Box
      h="100%"
      style={{ display: "flex", flexDirection: "column", padding: "var(--mantine-spacing-md)" }}
      data-testid="bots-view"
    >
      {state.error && (
        <Alert
          title="Error"
          color="red"
          variant="filled"
          mb="md"
          withCloseButton
          onClose={handleClearError}
          data-testid="bots-error"
        >
          {state.error}
        </Alert>
      )}

      <Box flex="0 0 auto" mb="md">
        <Group justify="space-between" align="center">
          <Tabs value={currentView} onChange={handleViewChange}>
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

          <Button
            leftSection={<IconPlus size={16} />}
            onClick={openCreateModal}
            data-testid="create-bot-btn"
          >
            New Bot
          </Button>
        </Group>
      </Box>

      <Box flex={1} style={{ minHeight: 0, overflowY: "auto" }}>
        {isLoading ? (
          <Stack align="center" justify="center" h="100%">
            <Loader size="lg" />
            <Text c="dimmed">Loading...</Text>
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
    </Box>
  );
}
