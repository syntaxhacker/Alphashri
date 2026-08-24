import { useEffect, useCallback, useMemo } from "react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { Box, Tabs, Button, Stack, Group, Text, Badge } from "@/ui";
import Container from "@mui/material/Container";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import TableContainer from "@mui/material/TableContainer";
import Paper from "@mui/material/Paper";
import { FIN_OUTER_PAD, FIN_INNER_PAD } from "@/ui/palette";
import { IconRobot, IconChartLine, IconPlus, IconPlayerPlay, IconPlayerStop, IconChartBar } from "@tabler/icons-react";
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
  startAllBotsAction,
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
import { InlineLoader, ErrorAlert, EmptyCompact } from "../common/states";
import { TanStackTable } from "../common/TanStackTable";
import type { ColumnDef } from "@tanstack/react-table";
import { BotSummaryCell, BotActionButtons, getBotIndicatorColor } from "./BotHelpers";
import { StatusBadge } from "../common/BadgeComponents";
import { BOT_SELECTED_BG } from "../../config/colors";
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
    <Box sx={{ flex: "0 0 auto", mb: 2 }} id="bots-tabs" data-testid="bots-tabs">
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

  const columns = useMemo<ColumnDef<BotConfig>[]>(() => [
    {
      id: "name",
      header: "Name",
      accessorKey: "name",
      cell: ({ row }) => (
        <Group gap="xs">
          <Box
            w={8}
            h={8}
            sx={{ borderRadius: "50%", backgroundColor: getBotIndicatorColor(row.original.running) }}
          />
          <Text fw={500}>{row.original.name}</Text>
          {row.original.live_trading && (
            <Badge color="red" size="sm" variant="filled">LIVE</Badge>
          )}
          {!row.original.is_active && (
            <Badge color="gray" size="sm" variant="light">
              Inactive
            </Badge>
          )}
        </Group>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge
          running={row.original.running}
          pid={row.original.pid ?? undefined}
          statusUnknown={row.original.status === "UNKNOWN"}
          data-testid={`bot-status-${row.original.id}`}
        />
      ),
      enableSorting: false,
    },
    {
      id: "strategies",
      header: "Strategies",
      cell: ({ row }) => <BotSummaryCell bot={row.original} />,
      enableSorting: false,
    },
    {
      id: "max_total_positions",
      header: "Max Positions",
      accessorKey: "max_total_positions",
    },
    {
      id: "max_total_capital_pct",
      header: "Max Capital",
      accessorKey: "max_total_capital_pct",
      cell: ({ getValue }) => `${((getValue() as number) * 100).toFixed(0)}%`,
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        <BotActionButtons
          bot={row.original}
          onView={onViewStatus}
          onStart={onStart}
          onStop={onStop}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ),
      enableSorting: false,
    },
  ], [onViewStatus, onStart, onStop, onEdit, onDelete]);

  return (
    <Card elevation={0} id="bots-list-card" data-testid="bots-list-card">
      <CardContent sx={{ p: FIN_INNER_PAD / 8 }}>
        <Group gap="xs" mb="xs">
          <Box w={4} h={20} sx={(theme) => ({ borderRadius: 2, backgroundColor: theme.palette.success.main })} />
          <Text size="sm" fw={600}>Configured Bots</Text>
          <Badge size="sm" variant="light" color="teal">{state.bots.length}</Badge>
          <Badge size="sm" variant="dot" color="green">{state.bots.filter(b => b.running).length} running</Badge>
        </Group>
        <TableContainer component={Paper} elevation={0}>
          <TanStackTable
            data={state.bots}
            columns={columns}
            dataTestId="bots-table"
            getRowTestId={(row) => `bot-row-${row.id}`}
            getRowClassName={() => "bot-row"}
            getRowStyle={(row) => ({
              backgroundColor: state.selectedBot?.id === row.id ? BOT_SELECTED_BG : undefined,
            })}
          />
        </TableContainer>
      </CardContent>
    </Card>
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
    <Stack spacing={1} sx={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }} id="bots-page">
      <BotsPageTabs currentView={currentView} onViewChange={handleViewChange} />
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {isLoading ? (
          <Stack align="center" justify="center" sx={{ height: "100%" }} data-testid="bots-loading">
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
    <Container maxWidth="xl" sx={{ py: `${FIN_OUTER_PAD}px`, height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }} data-testid="bots-view">
      <Stack spacing={1} sx={{ mb: 2 }}>
        <Group justify="space-between" align="flex-start">
          <Stack spacing={1}>
            <Text size="lg" fw={600}>Bots</Text>
            <Text size="sm" c="dimmed">Manage bot configurations, live status, and execution controls.</Text>
          </Stack>
          <Group gap="sm">
            <Button
              variant="light"
              color="green"
              size="sm"
              leftSection={<IconPlayerPlay size={16} />}
              onClick={async () => {
                const bots = getBotsState().bots;
                const stoppedCount = bots.filter(b => !b.running).length;
                if (stoppedCount === 0) return;
                if (window.confirm(`Start all ${stoppedCount} stopped bots?`)) {
                  await startAllBotsAction();
                }
              }}
              disabled={!getBotsState().bots.some(b => !b.running)}
            >
              Start All ({getBotsState().bots.filter(b => !b.running).length})
            </Button>
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
        </Group>
      </Stack>
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
    </Container>
  );
}
