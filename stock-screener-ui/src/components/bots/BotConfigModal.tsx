import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import {
  Modal,
  TextInput,
  NumberInput,
  Checkbox,
  Select,
  Button,
  Stack,
  Group,
  Text,
  Box,
  Card,
  ActionIcon,
  Divider,
  Alert,
  ThemeIcon,
  Switch,
} from "@/ui";
import { IconPlus, IconTrash, IconInfoCircle } from "../common/Icons";
import type { BotConfig, AvailableStrategy, StrategyAllocation } from "../../types/bots";
import {
  createBotAction,
  updateBotAction,
  closeCreateModal,
  closeEditModal,
} from "../../state/bots";

interface BotConfigModalProps {
  opened: boolean;
  bot: BotConfig | null;
  availableStrategies: AvailableStrategy[];
  onClose: () => void;
}

interface StrategyAllocationRow {
  id: string;
  strategy_id: string;
  capital_allocation_pct: number;
  max_positions: number;
}

function StrategyParams(props: { strategy: AvailableStrategy }) {
  const strategy = () => props.strategy;
  const t = () => strategy().strategy_type;
  const fmt = (v: number | null | undefined, suffix = "", decimals = 1) =>
    v != null ? `${Number(v).toFixed(decimals)}${suffix}` : "—";
  const time = (h: number, m: number) =>
    `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const bool = (v: boolean | null | undefined) => (v ? "Yes" : "No");

  const items: string[] = [];

  if (t() === "ORB") {
    items.push(`OR Window: ${strategy().or_minutes}m`);
    items.push(`SL: ${fmt(strategy().sl_pct, "%")}`);
    items.push(`TP: ${fmt(strategy().tp_pct, "%")}`);
    items.push(
      `OR Range: ${fmt(strategy().min_or_range_pct, "%")}-${fmt(strategy().max_or_range_pct, "%")}`,
    );
    if (strategy().max_distance_from_or_pct)
      items.push(`Max Dist: ${fmt(strategy().max_distance_from_or_pct, "%")}`);
    items.push(`Cooldown: ${strategy().cooldown_minutes}m`);
    items.push(`Shorts: ${bool(strategy().enable_shorts)}`);
    items.push(`EOD: ${time(strategy().eod_exit_hour, strategy().eod_exit_minute)}`);
  } else if (t() === "SR_BREAKOUT") {
    items.push(`Pivot: ${strategy().pivot_type}`);
    items.push(`Buffer: ${fmt(strategy().breakout_buffer_pct, "%")}`);
    items.push(`SL: ${fmt(strategy().sl_pct, "%")}`);
    items.push(`TP: ${fmt(strategy().tp_pct, "%")}`);
    items.push(`Cooldown: ${strategy().cooldown_minutes}m`);
    items.push(`Shorts: ${bool(strategy().enable_shorts)}`);
    items.push(`EOD: ${time(strategy().eod_exit_hour, strategy().eod_exit_minute)}`);
  } else if (t() === "52W_CHASER" || t() === "52W_TARGET") {
    items.push(`Entry Threshold: ${fmt(strategy().entry_threshold_pct, "%")}`);
    items.push(`SL: ${fmt(strategy().sl_pct, "%")}`);
    items.push(`TP: ${fmt(strategy().tp_pct, "%")}`);
    items.push(`Trailing: ${bool(strategy().enable_trailing_stop)}`);
    if (strategy().enable_trailing_stop)
      items.push(`Trail %: ${fmt(strategy().trailing_stop_pct, "%")}`);
    items.push(`Max Holding: ${strategy().max_holding_days}d`);
    items.push(`Cooldown: ${strategy().cooldown_days}d`);
    items.push(`Shorts: ${bool(strategy().enable_shorts)}`);
    items.push(`EOD: ${time(strategy().eod_exit_hour, strategy().eod_exit_minute)}`);
  } else if (t() === "EMA_CROSS") {
    items.push(`EMA Fast: ${strategy().ema_fast_period}`);
    items.push(`EMA Slow: ${strategy().ema_slow_period}`);
    items.push(`SL: ${fmt(strategy().sl_pct, "%")}`);
    items.push(`TP: ${fmt(strategy().tp_pct, "%")}`);
    items.push(`Shorts: ${bool(strategy().enable_shorts)}`);
    items.push(`EOD: ${time(strategy().eod_exit_hour, strategy().eod_exit_minute)}`);
  }

  return (
    <Show when={items.length > 0}>
    <Group gap="xs" mt={4} wrap="wrap" align="center">
      <ThemeIcon size="xs" variant="outline" color="secondary" style={{ flex: "0 0 auto" }}>
        <IconInfoCircle size={12} />
      </ThemeIcon>
      <For each={items}>{(item) => (
        <Text size="xs" c="dimmed" fs="italic">
          {item}
        </Text>
      )}</For>
    </Group>
    </Show>
  );
}

export function BotConfigModal(props: BotConfigModalProps) {
  const [name, setName] = createSignal("");
  const [isActive, setIsActive] = createSignal(true);
  const [maxPositions, setMaxPositions] = createSignal(10);
  const [maxCapital, setMaxCapital] = createSignal(80);
  const [maxDailyLoss, setMaxDailyLoss] = createSignal(3);
  const [liveTrading, setLiveTrading] = createSignal(false);
  const [strategies, setStrategies] = createSignal<StrategyAllocationRow[]>([]);
  const [nextId, setNextId] = createSignal(1);

  const isEdit = () => props.bot !== null;
  const selectableStrategies = () => props.availableStrategies.filter((s) => !s.is_template);

  createEffect(() => {
    const opened = props.opened;
    const bot = props.bot;
    if (opened && bot) {
      setName(bot.name);
      setIsActive(bot.is_active);
      setMaxPositions(bot.max_total_positions);
      setMaxCapital(bot.max_total_capital_pct * 100);
      setMaxDailyLoss((bot.max_daily_loss_pct ?? 0.03) * 100);
      setLiveTrading(bot.live_trading ?? false);
      setStrategies(
        bot.strategies.map((s, i) => ({
          id: `existing-${i}`,
          strategy_id: s.id,
          capital_allocation_pct: s.capital_allocation_pct * 100,
          max_positions: s.max_positions,
        })),
      );
    } else if (opened) {
      setName("");
      setIsActive(true);
      setMaxPositions(10);
      setMaxCapital(80);
      setLiveTrading(false);
      setStrategies([]);
    }
    setNextId(100);
  });

  const handleAddStrategy = () => {
    setStrategies((prev) => [
      ...prev,
      {
        id: `new-${nextId()}`,
        strategy_id: "",
        capital_allocation_pct: 20,
        max_positions: 3,
      },
    ]);
    setNextId((prev) => prev + 1);
  };

  const handleRemoveStrategy = (id: string) => {
    setStrategies((prev) => prev.filter((s) => s.id !== id));
  };

  const handleUpdateStrategy = (
    id: string,
    field: keyof StrategyAllocationRow,
    value: string | number,
  ) => {
    setStrategies((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  const totalAllocation = createMemo(() => strategies().reduce((sum, s) => sum + s.capital_allocation_pct, 0));
  const isOverAllocated = createMemo(() => totalAllocation() > 100);

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault();

    const strategyAllocations: StrategyAllocation[] = strategies()
      .filter((s) => s.strategy_id)
      .map((s) => ({
        strategy_id: s.strategy_id,
        capital_allocation_pct: s.capital_allocation_pct / 100,
        max_positions: s.max_positions,
      }));

    const data = {
      name: name(),
      is_active: isActive(),
      max_total_positions: maxPositions(),
      max_total_capital_pct: maxCapital() / 100,
      max_daily_loss_pct: maxDailyLoss() / 100,
      live_trading: liveTrading(),
      strategies: strategyAllocations,
    };

    if (isEdit() && props.bot) {
      const updated = await updateBotAction(props.bot.id, data);
      if (updated) props.onClose();
    } else {
      const created = await createBotAction(data);
      if (created) props.onClose();
    }
  };

  const handleClose = () => {
    if (isEdit()) {
      closeEditModal();
    } else {
      closeCreateModal();
    }
    props.onClose();
  };

  return (
    <Modal
      opened={props.opened}
      onClose={handleClose}
      title={isEdit() ? "Edit Bot" : "Create New Bot"}
      size="lg"
      data-testid="bot-config-modal"
      id="bot-config-modal"
    >
      <form onSubmit={handleSubmit} data-testid="bot-config-form">
        <Stack spacing={1} gap="sm" className="gap-2 p-2">
          <Stack spacing={1} gap="xs" data-testid="bot-config-basic-info" className="gap-2 p-2">
            <Box className="flex items-center justify-center p-2"><Text fw={600} size="sm" ta="center">Basic Information</Text></Box>
            <Box className="flex items-center gap-2 p-2">
              <Text size="sm" c="dimmed" className="flex items-center min-w-[80px]">Bot Name</Text>
              <Box className="flex flex-1 items-center">
                <TextInput
                  placeholder="e.g., Multi-ORB Test"
                  required
                  value={name()}
                  onChange={(val) => setName(val)}
                  data-testid="bot-name-input"
                />
              </Box>
            </Box>
            <Box className="flex items-center gap-2 p-2">
              <Text size="sm" c="dimmed" className="flex items-center min-w-[80px]">Active</Text>
              <Box className="flex flex-1 items-center">
                <Checkbox
                  label=""
                  checked={isActive()}
                  onChange={(e) => setIsActive((e.currentTarget as HTMLInputElement).checked)}
                  data-testid="bot-active-checkbox"
                />
              </Box>
            </Box>
          </Stack>

          <Divider />

          <Stack spacing={1} gap="xs" data-testid="bot-config-global-limits" className="gap-2 p-2">
            <Box className="flex items-center justify-center p-2"><Text fw={600} size="sm" ta="center">Global Limits</Text></Box>
            <Box className="flex items-center gap-2 p-2">
              <Text size="sm" c="dimmed" className="flex items-center min-w-[80px]">Max Total Positions</Text>
              <Box className="flex flex-1 items-center">
                <NumberInput
                  min={1}
                  max={20}
                  value={maxPositions()}
                  onChange={(val: number | string) => setMaxPositions(Number(val) || 10)}
                  data-testid="max-positions-input"
                />
              </Box>
            </Box>
            <Box className="flex items-center gap-2 p-2">
              <Text size="sm" c="dimmed" className="flex items-center min-w-[80px]">Max Total Capital (%)</Text>
              <Box className="flex flex-1 items-center">
                <NumberInput
                  min={10}
                  max={100}
                  step={5}
                  value={maxCapital()}
                  onChange={(val: number | string) => setMaxCapital(Number(val) || 80)}
                  data-testid="max-capital-input"
                />
              </Box>
            </Box>
            <Box className="flex items-center gap-2 p-2">
              <Text size="sm" c="dimmed" className="flex items-center min-w-[80px]">Max Daily Loss (%)</Text>
              <Box className="flex flex-1 items-center">
                <NumberInput
                  description="Stops ALL strategies when hit. Default: 3%"
                  min={1}
                  max={20}
                  step={1}
                  value={maxDailyLoss()}
                  onChange={(val: number | string) => setMaxDailyLoss(Number(val) || 3)}
                  data-testid="max-daily-loss-input"
                />
              </Box>
            </Box>
            <Box className="flex items-center gap-2 p-2">
              <Text size="sm" c="dimmed" className="flex items-center min-w-[80px]">Live Trading</Text>
              <Box className="flex flex-1 items-center">
                <Switch
                  label=""
                  description="Places real orders via Upstox API. Use with caution!"
                  checked={liveTrading()}
                  onChange={(e) => setLiveTrading((e.currentTarget as HTMLInputElement).checked)}
                  color="error"
                  data-testid="bot-live-trading-switch"
                />
              </Box>
            </Box>
          </Stack>

          <Divider />

          <Stack spacing={1} gap="xs" data-testid="bot-config-strategies" className="gap-2 p-2">
            <Box className="flex items-center justify-center p-2"><Text fw={600} size="sm" ta="center">Strategy Allocations</Text></Box>
            <Box className="flex items-center justify-center p-2"><Text size="sm" c="dimmed" ta="center">
              Configure which strategies to run and their capital allocations. Total allocation
              should not exceed 100%.
            </Text></Box>

            <Stack spacing={1} gap="sm" data-testid="strategy-allocations" className="gap-2">
              <For each={strategies()}>{(strategy) => (
                  <Card
                  padding="sm"
                  radius="sm"
                  elevation={1}
                  className="p-2"
                  data-testid="strategy-allocation-row"
                >
                  <Stack spacing={1} className="gap-2">
                    <Box className="flex items-center gap-2 p-2">
                      <Text size="sm" c="dimmed" className="flex items-center min-w-[80px]">Strategy</Text>
                      <Box className="flex flex-1 items-center">
                        <Select
                          placeholder="Select a strategy..."
                          data={selectableStrategies().map((s) => ({
                            value: s.id,
                            label: `${s.name} (${s.strategy_type})`,
                          }))}
                          value={strategy.strategy_id}
                          onChange={(val: string | null) =>
                            handleUpdateStrategy(strategy.id, "strategy_id", val || "")
                          }
                          data-testid={`strategy-allocation-select-${strategy.id}`}
                        />
                      </Box>
                    </Box>
                    <Box className="flex items-center gap-2 p-2">
                      <Text size="sm" c="dimmed" className="flex items-center min-w-[80px]">Allocation %</Text>
                      <Box className="flex flex-1 items-center">
                        <NumberInput
                          min={5}
                          max={100}
                          step={5}
                          value={strategy.capital_allocation_pct}
                          onChange={(val: number | string) =>
                            handleUpdateStrategy(
                              strategy.id,
                              "capital_allocation_pct",
                              Number(val) || 20,
                            )
                          }
                          data-testid={`strategy-allocation-pct-${strategy.id}`}
                        />
                      </Box>
                    </Box>
                    <Box className="flex items-center gap-2 p-2">
                      <Text size="sm" c="dimmed" className="flex items-center min-w-[80px]">Max Positions</Text>
                      <Box className="flex flex-1 items-center">
                        <NumberInput
                          min={1}
                          max={10}
                          value={strategy.max_positions}
                          onChange={(val: number | string) =>
                            handleUpdateStrategy(strategy.id, "max_positions", Number(val) || 3)
                          }
                          data-testid={`strategy-allocation-positions-${strategy.id}`}
                        />
                      </Box>
                      <ActionIcon
                        color="error"
                        variant="subtle"
                        onClick={() => handleRemoveStrategy(strategy.id)}
                        title="Remove"
                        data-testid={`remove-strategy-btn-${strategy.id}`}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Box>
                  </Stack>
                  <StrategyParams
                    strategy={
                      selectableStrategies().find((s) => s.id === strategy.strategy_id) || {
                        id: "",
                        name: "",
                        strategy_type: "",
                        is_template: false,
                        is_default: false,
                        sl_pct: 0,
                        tp_pct: 0,
                        max_positions: 0,
                        or_minutes: 0,
                        min_or_range_pct: 0,
                        max_or_range_pct: 0,
                        max_distance_from_or_pct: 0,
                        cooldown_minutes: 0,
                        enable_shorts: false,
                        eod_exit_hour: 14,
                        eod_exit_minute: 45,
                        pivot_type: "",
                        breakout_buffer_pct: 0,
                        entry_threshold_pct: 0,
                        min_breakout_pct: 0,
                        enable_trailing_stop: false,
                        trailing_stop_pct: 0,
                        max_holding_days: 0,
                        cooldown_days: 0,
                        ema_fast_period: 0,
                        ema_slow_period: 0,
                      }
                    }
                  />
                </Card>
              )}</For>
            </Stack>

            <Button
              leftSection={<IconPlus size={16} />}
              variant="light"
              size="sm"
              onClick={handleAddStrategy}
              data-testid="add-strategy-btn"
            >
              Add Strategy
            </Button>

            <Box className="flex items-center justify-between gap-2 p-2" mt="sm">
              <Box className="flex items-center gap-2">
                <Text size="sm" c="dimmed" className="flex items-center min-w-[80px]">Total Allocation</Text>
                <Text size="sm" fw={700} c={isOverAllocated() ? "error" : undefined} className="flex-1 text-right">
                  {totalAllocation().toFixed(0)}%
                </Text>
              </Box>
              <Show when={isOverAllocated()}>
                <Alert color="error" variant="light" className="px-2 py-1">
                  Over 100%
                </Alert>
              </Show>
            </Box>
          </Stack>

          <Divider />

          <Group justify="flex-end" gap={1} className="flex items-center justify-end gap-2 p-2">
            <Button variant="subtle" onClick={handleClose} data-testid="cancel-bot-config-btn">
              Cancel
            </Button>
            <Button type="submit" data-testid="save-bot-config-btn">
              {isEdit() ? "Update Bot" : "Create Bot"}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
