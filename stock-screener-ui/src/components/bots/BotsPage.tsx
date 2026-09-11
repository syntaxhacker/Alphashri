import { useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import * as palette from "@/ui/palette";
import { Box, Tabs, Button, Stack, Group, Text, Badge } from "@/ui";
import Container from "@mui/material/Container";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import TableContainer from "@mui/material/TableContainer";
import Paper from "@mui/material/Paper";

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
import { StrategyPerformance } from "./StrategyPerformance";

function useViewChangeHandler() {
  return useCallback((view: string | null) => {
    if (!view) return;
    setCurrentView(view as BotsView);
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
  const TAB_META: Record<BotsView, { color: string }> = {
    list: { color: palette.PRIMARY },
    status: { color: palette.POSITIVE },
    performance: { color: palette.NT_TREND },
  };
  return (
    <Box sx={{ flex: "0 0 auto", mb: 2, display: "flex", alignItems: "center", justifyContent: "center", p: 1 }} id="bots-tabs" data-testid="bots-tabs">
      <Tabs
        value={currentView}
        onChange={(v) => v && onViewChange(v)}
        id="bots-tabs"
        data-testid="bots-tabs"
        sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <Tabs.List sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
          <Tabs.Tab value="list" icon={<IconRobot size={16} color={TAB_META.list.color} />} data-testid="bots-tab-list" id="bots-tab-list">
            Bots
          </Tabs.Tab>
          <Tabs.Tab
            value="status"
            icon={<IconChartLine size={16} color={TAB_META.status.color} />}
            disabled={!getBotsState().selectedBot}
            data-testid="bots-tab-status"
            id="bots-tab-status"
          >
            Status
          </Tabs.Tab>
          <Tabs.Tab
            value="performance"
            icon={<IconChartBar size={16} color={TAB_META.performance.color} />}
            data-testid="bots-tab-performance"
            id="bots-tab-performance"
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
      meta: { align: "left" } as any,
      cell: ({ row }) => (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
          <Group gap={4} sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 1 }}>
            <Box
              w={8}
              h={8}
              sx={{ borderRadius: "50%", backgroundColor: getBotIndicatorColor(row.original.running) }}
            />
            <Text fw={500} ta="left">{row.original.name}</Text>
            {row.original.live_trading && (
              <Badge color="error" size="sm" variant="filled">LIVE</Badge>
            )}
            {!row.original.is_active && (
              <Badge color="secondary" size="sm" variant="filled">
                Inactive
              </Badge>
            )}
          </Group>
        </Box>
      ),
    },
    {
      id: "status",
      header: "Status",
      meta: { align: "center" } as any,
      cell: ({ row }) => (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <StatusBadge
            running={row.original.running}
            pid={row.original.pid ?? undefined}
            statusUnknown={row.original.status === "UNKNOWN"}
            data-testid={`bot-status-${row.original.id}`}
          />
        </Box>
      ),
      enableSorting: false,
    },
    {
      id: "strategies",
      header: "Strategies",
      meta: { align: "left" } as any,
      cell: ({ row }) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start" }}><BotSummaryCell bot={row.original} /></Box>,
      enableSorting: false,
    },
    {
      id: "max_total_positions",
      header: "Max Positions",
      accessorKey: "max_total_positions",
      meta: { align: "right" } as any,
      cell: ({ getValue }) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}><Text ta="right">{String(getValue() as number)}</Text></Box>,
    },
    {
      id: "max_total_capital_pct",
      header: "Max Capital",
      accessorKey: "max_total_capital_pct",
      meta: { align: "right" } as any,
      cell: ({ getValue }) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}><Text ta="right">{`${((getValue() as number) * 100).toFixed(0)}%`}</Text></Box>,
    },
    {
      id: "actions",
      header: "Actions",
      meta: { align: "center" } as any,
      cell: ({ row }) => (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <BotActionButtons
            bot={row.original}
            onView={onViewStatus}
            onStart={onStart}
            onStop={onStop}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </Box>
      ),
      enableSorting: false,
    },
  ], [onViewStatus, onStart, onStop, onEdit, onDelete]);

  return (
    <Card elevation={1} id="bots-list-card" data-testid="bots-list-card" sx={{ p: 1 }}>
      <CardContent sx={{ p: 1, "&:last-child": { pb: 1 } }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1 }} mb="xs">
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
            <Box w={4} h={20} sx={(theme) => ({ borderRadius: 2, backgroundColor: theme.palette.success.main })} />
            <Text size="sm" fw={600} ta="center">Configured Bots</Text>
            <Badge size="sm" variant="light" color="info">{state.bots.length}</Badge>
            <Badge size="sm" variant="dot" color="success">{state.bots.filter(b => b.running).length} running</Badge>
          </Box>
        </Box>
        <TableContainer component={Paper} elevation={1}>
          <TanStackTable
            data={state.bots}
            columns={columns}
            dataTestId="bots-table"
            getRowTestId={(row) => `bot-row-${row.id}`}
            getRowClassName={() => "bot-row"}
            getRowStyle={(row) => ({
              backgroundColor: state.selectedBot?.id === row.id ? "rgba(var(--mui-palette-primary-mainChannel) / 0.15)" : undefined,
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
          <Box sx={{ width: "100%", maxWidth: 1120, mx: "auto" }}>
            <StrategyPerformance />
          </Box>
        ) : currentView === "status" && state.selectedBot ? (
          <Box sx={{ width: "100%", maxWidth: 1120, mx: "auto" }}>
            <BotStatusPanel
              bot={state.selectedBot}
              status={state.botStatus}
              trades={state.botTrades}
              onStart={handleStartBot}
              onStop={handleStopBot}
            />
          </Box>
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
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    initBotsState();
  }, []);

  // Sync URL ?tab= -> state on mount and on browser nav (mirrors /paper?view=)
  useEffect(() => {
    const tabParam = searchParams.get("tab") as BotsView | null;
    const valid: BotsView[] = ["list", "status", "performance"];
    if (tabParam && valid.includes(tabParam) && tabParam !== getCurrentView()) {
      if (tabParam === "status" && !getBotsState().selectedBot) {
        setCurrentView("list");
      } else {
        setCurrentView(tabParam);
      }
    } else if (!tabParam) {
      // No param -> push current view to URL for deep-link consistency
      const next = new URLSearchParams(searchParams);
      next.set("tab", getCurrentView());
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync state -> URL when tab changes (via actions)
  useEffect(() => {
    const currentParam = searchParams.get("tab");
    if (currentParam !== currentView) {
      const next = new URLSearchParams(searchParams);
      next.set("tab", currentView);
      setSearchParams(next, { replace: false });
    }
  }, [currentView, searchParams, setSearchParams]);

  const handleViewChange = useViewChangeHandler();
  const handleStartBot = useStartBotHandler();
  const handleStopBot = useStopBotHandler();
  const handleViewStatus = useViewStatusHandler();
  const handleClearError = useClearErrorHandler();
  const handleEditBot = useEditBotHandler();
  const handleDeleteBot = useDeleteBotHandler();

  return (
    <Container maxWidth="xl" sx={{ py: 2, height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }} data-testid="bots-view">
      <Stack spacing={1} sx={{ mb: 2, gap: 1, p: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1 }}>
          <Stack spacing={1} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Text size="lg" fw={600} ta="center">Bots</Text></Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Text size="sm" c="dimmed" ta="center">Manage bot configurations, live status, and execution controls.</Text></Box>
          </Stack>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
            <Button
              variant="filled"
              color="success"
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
              variant="filled"
              color="error"
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
          </Box>
        </Box>
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
