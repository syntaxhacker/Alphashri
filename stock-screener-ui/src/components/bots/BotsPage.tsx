import { Show, Switch, Match, createEffect, createMemo, onMount } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import * as palette from "@/ui/palette";
import { Box, Tabs, Button, Stack, Group, Text, Badge, ToolbarRow } from "@/ui";
import { useBotsState, useCurrentView } from "./useBotsState";

import { IconRobot, IconChartLine, IconPlus, IconPlayerPlay, IconPlayerStop, IconChartBar } from "../common/Icons";
import {
  getBotsState,
  getCurrentView,
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
import type { TableColumnDef as ColumnDef } from "../common/TanStackTable";
import { BotSummaryCell, BotActionButtons, getBotIndicatorColor } from "./BotHelpers";
import { StatusBadge } from "../common/BadgeComponents";
import { StrategyPerformance } from "./StrategyPerformance";

function useViewChangeHandler() {
  return (view: string | null) => {
    if (!view) return;
    setCurrentView(view as BotsView);
  };
}

function useStartBotHandler() {
  return async (botId: string) => {
    await startBotAction(botId, false);
  };
}

function useStopBotHandler() {
  return async (botId: string) => {
    await stopBotAction(botId);
  };
}

function useDeleteBotHandler() {
  return async (botId: string) => {
    if (window.confirm("Are you sure you want to delete this bot?")) {
      await deleteBotAction(botId);
    }
  };
}

function useViewStatusHandler() {
  return (bot: BotConfig) => {
    selectBot(bot);
    setCurrentView("status");
    loadBotTrades(bot.id);
    if (bot.running) {
      loadBotStatus(bot.id);
    }
  };
}

function useClearErrorHandler() {
  return () => {
    clearError();
  };
}

function useEditBotHandler() {
  return (bot: BotConfig) => {
    openEditModal(bot);
  };
}

function BotsPageTabs(props: {
  currentView: BotsView;
  onViewChange: (view: BotsView) => void;
}) {
  const TAB_META: Record<BotsView, { color: string }> = {
    list: { color: palette.PRIMARY },
    status: { color: palette.POSITIVE },
    performance: { color: palette.NT_TREND },
  };
  const state = useBotsState();
  return (
    <ToolbarRow gap={8} wrap={false} id="bots-tabs" data-testid="bots-tabs" style={{ flex: "0 0 auto", height: 40, padding: "0 16px", borderBottom: "1px solid var(--color-fin-border)" }}>
      <Tabs
        value={props.currentView}
        onChange={(v) => v && props.onViewChange(v as BotsView)}
        id="bots-tabs"
        data-testid="bots-tabs"
      >
        <Tabs.List className="flex items-center gap-2">
          <Tabs.Tab value="list" icon={<IconRobot size={16} color={TAB_META.list.color} />} data-testid="bots-tab-list" id="bots-tab-list">
            Bots
          </Tabs.Tab>
          <Tabs.Tab
            value="status"
            icon={<IconChartLine size={16} color={TAB_META.status.color} />}
            disabled={!state().selectedBot}
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
    </ToolbarRow>
  );
}

function BotsTable(props: {
  onViewStatus: (bot: BotConfig) => void;
  onStart: (botId: string) => Promise<void>;
  onStop: (botId: string) => Promise<void>;
  onEdit: (bot: BotConfig) => void;
  onDelete: (botId: string) => Promise<void>;
}) {
  const state = useBotsState();

  const columns = createMemo<ColumnDef<BotConfig>[]>(() => [
    {
      id: "name",
      header: "Name",
      accessorKey: "name",
      meta: { align: "left" },
      cell: ({ row }) => (
        <Box className="flex items-center justify-start">
          <Group gap={4} className="flex items-center justify-start gap-2">
            <Box
              w={8}
              h={8}
              className="rounded-full"
              style={{ backgroundColor: getBotIndicatorColor(row.original.running) }}
            />
            <Text fw={500} ta="left">{row.original.name}</Text>
            <Show when={row.original.live_trading}>
              <Badge color="error" size="sm" variant="filled">LIVE</Badge>
            </Show>
            <Show when={!row.original.is_active}>
              <Badge color="secondary" size="sm" variant="filled">
                Inactive
              </Badge>
            </Show>
          </Group>
        </Box>
      ),
    },
    {
      id: "status",
      header: "Status",
      meta: { align: "center" },
      cell: ({ row }) => (
        <Box className="flex items-center justify-center">
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
      meta: { align: "left" },
      cell: ({ row }) => <Box className="flex items-center justify-start"><BotSummaryCell bot={row.original} /></Box>,
      enableSorting: false,
    },
    {
      id: "max_total_positions",
      header: "Max Positions",
      accessorKey: "max_total_positions",
      meta: { align: "right" },
      cell: (info) => <Box className="flex items-center justify-end"><Text ta="right">{String(info.row.original.max_total_positions)}</Text></Box>,
    },
    {
      id: "max_total_capital_pct",
      header: "Max Capital",
      accessorKey: "max_total_capital_pct",
      meta: { align: "right" },
      cell: (info) => <Box className="flex items-center justify-end"><Text ta="right">{`${(info.row.original.max_total_capital_pct * 100).toFixed(0)}%`}</Text></Box>,
    },
    {
      id: "actions",
      header: "Actions",
      meta: { align: "center" },
      cell: ({ row }) => (
        <Box className="flex items-center justify-center">
          <BotActionButtons
            bot={row.original}
            onView={props.onViewStatus}
            onStart={props.onStart}
            onStop={props.onStop}
            onEdit={props.onEdit}
            onDelete={props.onDelete}
          />
        </Box>
      ),
      enableSorting: false,
    },
  ]);

  return (
    <Show
      when={state().bots.length > 0}
      fallback={
        <EmptyCompact
          emoji="🤖"
          title="No bots configured"
          description='Click "New Bot" to create one'
          data-testid="bots-empty-state"
          id="bots-empty-state"
        />
      }
    >
      <Box id="bots-list-card" data-testid="bots-list-card" className="overflow-hidden rounded border border-fin-border bg-fin-surface">
        <ToolbarRow gap={8} wrap={false} style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-fin-border)" }}>
          <Box w={4} h={20} className="rounded-sm bg-fin-positive" />
          <Text size="sm" fw={600}>Configured Bots</Text>
          <Badge size="sm" variant="light" color="info">{state().bots.length}</Badge>
          <Badge size="sm" variant="dot" color="success">{state().bots.filter((b) => b.running).length} running</Badge>
        </ToolbarRow>
        <TanStackTable
          data={state().bots}
          columns={columns()}
          dataTestId="bots-table"
          getRowTestId={(row) => `bot-row-${row.id}`}
          getRowClassName={() => "bot-row"}
          getRowStyle={(row) => ({
            backgroundColor: state().selectedBot?.id === row.id ? "rgba(88 166 255 / 0.15)" : undefined,
          })}
        />
      </Box>
    </Show>
  );
}

function PageContent(props: {
  currentView: BotsView;
  handleViewChange: (view: BotsView) => void;
  handleStartBot: (botId: string) => Promise<void>;
  handleStopBot: (botId: string) => Promise<void>;
  handleViewStatus: (bot: BotConfig) => void;
  handleClearError: () => void;
  handleEditBot: (bot: BotConfig) => void;
  handleDeleteBot: (botId: string) => Promise<void>;
}) {
  const state = useBotsState();
  const isLoading = () => Object.values(state().loading).some((v) => v);

  return (
    <Show
      when={!state().error}
      fallback={<ErrorAlert message={state().error ?? ""} onClose={props.handleClearError} data-testid="bots-error" />}
    >
      <Stack className="flex flex-1 min-h-0 min-w-0 flex-col gap-2 px-4 py-2" id="bots-page">
        <BotsPageTabs currentView={props.currentView} onViewChange={props.handleViewChange} />
        <Box className="flex-1 min-h-0 min-w-0 overflow-auto">
          <Switch>
            <Match when={isLoading()}>
              <Stack align="center" justify="center" className="h-full" data-testid="bots-loading">
                <InlineLoader size="lg" />
              </Stack>
            </Match>
            <Match when={props.currentView === "performance"}>
              <StrategyPerformance />
            </Match>
            <Match when={props.currentView === "status" && state().selectedBot}>
              {(selected) => (
                <BotStatusPanel
                  bot={selected()}
                  status={state().botStatus}
                  trades={state().botTrades}
                  onStart={props.handleStartBot}
                  onStop={props.handleStopBot}
                />
              )}
            </Match>
            <Match when={true}>
              <BotsTable
                onViewStatus={props.handleViewStatus}
                onStart={props.handleStartBot}
                onStop={props.handleStopBot}
                onEdit={props.handleEditBot}
                onDelete={props.handleDeleteBot}
              />
            </Match>
          </Switch>
        </Box>
      </Stack>
    </Show>
  );
}

function BotsConfigModal() {
  const state = useBotsState();
  const handleClose = () => {
    if (state().showCreateModal) {
      closeCreateModal();
    } else {
      closeEditModal();
    }
  };
  return (
    <BotConfigModal
      opened={state().showCreateModal || state().showEditModal}
      bot={state().editingBot}
      availableStrategies={state().availableStrategies}
      onClose={handleClose}
    />
  );
}

export function BotsPage() {
  const state = useBotsState();
  const currentView = useCurrentView();
  const [searchParams, setSearchParams] = useSearchParams<{ tab?: string }>();

  onMount(() => {
    initBotsState();

    const tabParam = searchParams.tab as BotsView | undefined;
    const valid: BotsView[] = ["list", "status", "performance"];
    if (tabParam && valid.includes(tabParam) && tabParam !== getCurrentView()) {
      if (tabParam === "status" && !getBotsState().selectedBot) {
        setCurrentView("list");
      } else {
        setCurrentView(tabParam);
      }
    } else if (!tabParam) {
      // No param -> push current view to URL for deep-link consistency
      setSearchParams({ tab: getCurrentView() }, { replace: true });
    }
  });

  // Sync state -> URL when tab changes (via actions)
  createEffect(() => {
    const currentParam = searchParams.tab;
    if (currentParam !== currentView()) {
      setSearchParams({ tab: currentView() }, { replace: false });
    }
  });

  const handleViewChange = useViewChangeHandler();
  const handleStartBot = useStartBotHandler();
  const handleStopBot = useStopBotHandler();
  const handleViewStatus = useViewStatusHandler();
  const handleClearError = useClearErrorHandler();
  const handleEditBot = useEditBotHandler();
  const handleDeleteBot = useDeleteBotHandler();

  return (
    <Box className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-fin-bg" data-testid="bots-view">
      <ToolbarRow gap={8} wrap={false} style={{ flex: "0 0 auto", height: palette.FIN_HEADER_H, padding: `0 ${palette.FIN_OUTER_PAD}px`, borderBottom: "1px solid var(--color-fin-border)" }}>
        <Text size="lg" fw={600}>Bots</Text>
        <Text size="sm" c="dimmed" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          Manage bot configurations, live status, and execution controls.
        </Text>
        <Box className="flex-1" />
            <Button
              variant="filled"
              color="success"
              size="sm"
              leftSection={<IconPlayerPlay size={16} />}
              onClick={async () => {
                const bots = state().bots;
                const stoppedCount = bots.filter((b) => !b.running).length;
                if (stoppedCount === 0) return;
                if (window.confirm(`Start all ${stoppedCount} stopped bots?`)) {
                  await startAllBotsAction();
                }
              }}
              disabled={!state().bots.some((b) => !b.running)}
            >
              Start All ({state().bots.filter((b) => !b.running).length})
            </Button>
            <Button
              variant="filled"
              color="error"
              size="sm"
              leftSection={<IconPlayerStop size={16} />}
              onClick={async () => {
                const bots = state().bots;
                const runningCount = bots.filter((b) => b.running).length;
                if (window.confirm(`Stop all ${runningCount} running bots?`)) {
                  await stopAllBotsAction();
                }
              }}
              disabled={!state().bots.some((b) => b.running)}
            >
              Stop All ({state().bots.filter((b) => b.running).length})
            </Button>
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={openCreateModal}
              data-testid="create-bot-btn"
            >
              New Bot
          </Button>
      </ToolbarRow>
      <PageContent
        currentView={currentView()}
        handleViewChange={handleViewChange}
        handleStartBot={handleStartBot}
        handleStopBot={handleStopBot}
        handleViewStatus={handleViewStatus}
        handleClearError={handleClearError}
        handleEditBot={handleEditBot}
        handleDeleteBot={handleDeleteBot}
      />
      <BotsConfigModal />
    </Box>
  );
}
