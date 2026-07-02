import { useState, useEffect } from "react";
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
  Card,
  ActionIcon,
  Divider,
  Alert,
  ThemeIcon,
  Switch,
} from "@/ui";
import { IconPlus, IconTrash, IconInfoCircle } from "@tabler/icons-react";
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

function StrategyParams({ strategy }: { strategy: AvailableStrategy }) {
  const t = strategy.strategy_type;
  const fmt = (v: number | null | undefined, suffix = "", decimals = 1) =>
    v != null ? `${Number(v).toFixed(decimals)}${suffix}` : "—";
  const time = (h: number, m: number) =>
    `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const bool = (v: boolean | null | undefined) => (v ? "Yes" : "No");

  const items: string[] = [];

  if (t === "ORB") {
    items.push(`OR Window: ${strategy.or_minutes}m`);
    items.push(`SL: ${fmt(strategy.sl_pct, "%")}`);
    items.push(`TP: ${fmt(strategy.tp_pct, "%")}`);
    items.push(
      `OR Range: ${fmt(strategy.min_or_range_pct, "%")}-${fmt(strategy.max_or_range_pct, "%")}`,
    );
    if (strategy.max_distance_from_or_pct)
      items.push(`Max Dist: ${fmt(strategy.max_distance_from_or_pct, "%")}`);
    items.push(`Cooldown: ${strategy.cooldown_minutes}m`);
    items.push(`Shorts: ${bool(strategy.enable_shorts)}`);
    items.push(`EOD: ${time(strategy.eod_exit_hour, strategy.eod_exit_minute)}`);
  } else if (t === "SR_BREAKOUT") {
    items.push(`Pivot: ${strategy.pivot_type}`);
    items.push(`Buffer: ${fmt(strategy.breakout_buffer_pct, "%")}`);
    items.push(`SL: ${fmt(strategy.sl_pct, "%")}`);
    items.push(`TP: ${fmt(strategy.tp_pct, "%")}`);
    items.push(`Cooldown: ${strategy.cooldown_minutes}m`);
    items.push(`Shorts: ${bool(strategy.enable_shorts)}`);
    items.push(`EOD: ${time(strategy.eod_exit_hour, strategy.eod_exit_minute)}`);
  } else if (t === "52W_CHASER" || t === "52W_TARGET") {
    items.push(`Entry Threshold: ${fmt(strategy.entry_threshold_pct, "%")}`);
    items.push(`SL: ${fmt(strategy.sl_pct, "%")}`);
    items.push(`TP: ${fmt(strategy.tp_pct, "%")}`);
    items.push(`Trailing: ${bool(strategy.enable_trailing_stop)}`);
    if (strategy.enable_trailing_stop)
      items.push(`Trail %: ${fmt(strategy.trailing_stop_pct, "%")}`);
    items.push(`Max Holding: ${strategy.max_holding_days}d`);
    items.push(`Cooldown: ${strategy.cooldown_days}d`);
    items.push(`Shorts: ${bool(strategy.enable_shorts)}`);
    items.push(`EOD: ${time(strategy.eod_exit_hour, strategy.eod_exit_minute)}`);
  } else if (t === "EMA_CROSS") {
    items.push(`EMA Fast: ${strategy.ema_fast_period}`);
    items.push(`EMA Slow: ${strategy.ema_slow_period}`);
    items.push(`SL: ${fmt(strategy.sl_pct, "%")}`);
    items.push(`TP: ${fmt(strategy.tp_pct, "%")}`);
    items.push(`Shorts: ${bool(strategy.enable_shorts)}`);
    items.push(`EOD: ${time(strategy.eod_exit_hour, strategy.eod_exit_minute)}`);
  }

  if (items.length === 0) return null;

  return (
    <Group gap="xs" mt={4} wrap="wrap">
      <ThemeIcon size="xs" variant="transparent" color="gray" style={{ flex: "0 0 auto" }}>
        <IconInfoCircle size={12} />
      </ThemeIcon>
      {items.map((item, i) => (
        <Text key={i} size="xs" c="dimmed" fs="italic">
          {item}
        </Text>
      ))}
    </Group>
  );
}

export function BotConfigModal({ opened, bot, availableStrategies, onClose }: BotConfigModalProps) {
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [maxPositions, setMaxPositions] = useState(10);
  const [maxCapital, setMaxCapital] = useState(80);
  const [maxDailyLoss, setMaxDailyLoss] = useState(3);
  const [liveTrading, setLiveTrading] = useState(false);
  const [strategies, setStrategies] = useState<StrategyAllocationRow[]>([]);
  const [nextId, setNextId] = useState(1);

  const isEdit = bot !== null;
  const selectableStrategies = availableStrategies.filter((s) => !s.is_template);

  useEffect(() => {
    if (opened && bot) {
      setName(bot.name);
      setIsActive(bot.is_active);
      setMaxPositions(bot.max_total_positions);
      setMaxCapital(bot.max_total_capital_pct * 100);
      setMaxDailyLoss(bot.max_daily_loss_pct ?? 3);
      setLiveTrading((bot as any).live_trading ?? false);
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
  }, [opened, bot]);

  const handleAddStrategy = () => {
    setStrategies([
      ...strategies,
      {
        id: `new-${nextId}`,
        strategy_id: "",
        capital_allocation_pct: 20,
        max_positions: 3,
      },
    ]);
    setNextId(nextId + 1);
  };

  const handleRemoveStrategy = (id: string) => {
    setStrategies(strategies.filter((s) => s.id !== id));
  };

  const handleUpdateStrategy = (
    id: string,
    field: keyof StrategyAllocationRow,
    value: string | number,
  ) => {
    setStrategies(strategies.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  const totalAllocation = strategies.reduce((sum, s) => sum + s.capital_allocation_pct, 0);
  const isOverAllocated = totalAllocation > 100;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const strategyAllocations: StrategyAllocation[] = strategies
      .filter((s) => s.strategy_id)
      .map((s) => ({
        strategy_id: s.strategy_id,
        capital_allocation_pct: s.capital_allocation_pct / 100,
        max_positions: s.max_positions,
      }));

    const data = {
      name,
      is_active: isActive,
      max_total_positions: maxPositions,
      max_total_capital_pct: maxCapital / 100,
      max_daily_loss_pct: maxDailyLoss / 100,
      live_trading: liveTrading,
      strategies: strategyAllocations,
    };

    if (isEdit && bot) {
      await updateBotAction(bot.id, data);
    } else {
      await createBotAction(data);
    }

    onClose();
  };

  const handleClose = () => {
    if (isEdit) {
      closeEditModal();
    } else {
      closeCreateModal();
    }
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={isEdit ? "Edit Bot" : "Create New Bot"}
      size="lg"
      data-testid="bot-config-modal"
      id="bot-config-modal"
    >
      <form onSubmit={handleSubmit} data-testid="bot-config-form">
        <Stack gap="sm">
          <Stack gap="xs" data-testid="bot-config-basic-info">
            <Text fw={600}>Basic Information</Text>
            <Group grow>
              <TextInput
                label="Bot Name"
                placeholder="e.g., Multi-ORB Test"
                required
                value={name}
                onChange={(val) => setName(val)}
                data-testid="bot-name-input"
              />
              <Checkbox
                label="Active"
                checked={isActive}
                onChange={(checked) => setIsActive(checked)}
                mt="xl"
                data-testid="bot-active-checkbox"
              />
            </Group>
          </Stack>

          <Divider />

          <Stack gap="xs" data-testid="bot-config-global-limits">
            <Text fw={600}>Global Limits</Text>
            <Group grow>
              <NumberInput
                label="Max Total Positions"
                min={1}
                max={20}
                value={maxPositions}
                onChange={(val) => setMaxPositions(Number(val) || 10)}
                data-testid="max-positions-input"
              />
              <NumberInput
                label="Max Total Capital (%)"
                min={10}
                max={100}
                step={5}
                value={maxCapital}
                onChange={(val) => setMaxCapital(Number(val) || 80)}
                data-testid="max-capital-input"
              />
            </Group>
            <Group grow>
              <NumberInput
                label="Max Daily Loss (%)"
                description="Stops ALL strategies when hit. Default: 3%"
                min={1}
                max={20}
                step={1}
                value={maxDailyLoss}
                onChange={(val) => setMaxDailyLoss(Number(val) || 3)}
                data-testid="max-daily-loss-input"
              />
            </Group>
            <Group>
              <Switch
                label="Live Trading"
                description="Places real orders via Upstox API. Use with caution!"
                checked={liveTrading}
                onChange={(checked) => setLiveTrading(checked)}
                color="red"
                data-testid="bot-live-trading-switch"
              />
            </Group>
          </Stack>

          <Divider />

          <Stack gap="xs" data-testid="bot-config-strategies">
            <Text fw={600}>Strategy Allocations</Text>
            <Text size="sm" c="dimmed">
              Configure which strategies to run and their capital allocations. Total allocation
              should not exceed 100%.
            </Text>

            <Stack gap="sm" data-testid="strategy-allocations">
              {strategies.map((strategy) => (
                <Card
                  key={strategy.id}
                  padding="sm"
                  withBorder
                  data-testid="strategy-allocation-row"
                >
                  <Group align="flex-end" grow>
                    <Select
                      label="Strategy"
                      placeholder="Select a strategy..."
                      data={selectableStrategies.map((s) => ({
                        value: s.id,
                        label: `${s.name} (${s.strategy_type})`,
                      }))}
                      value={strategy.strategy_id}
                      onChange={(val) =>
                        handleUpdateStrategy(strategy.id, "strategy_id", val || "")
                      }
                      data-testid={`strategy-allocation-select-${strategy.id}`}
                    />
                    <NumberInput
                      label="Allocation %"
                      min={5}
                      max={100}
                      step={5}
                      value={strategy.capital_allocation_pct}
                      onChange={(val) =>
                        handleUpdateStrategy(
                          strategy.id,
                          "capital_allocation_pct",
                          Number(val) || 20,
                        )
                      }
                      data-testid={`strategy-allocation-pct-${strategy.id}`}
                    />
                    <NumberInput
                      label="Max Positions"
                      min={1}
                      max={10}
                      value={strategy.max_positions}
                      onChange={(val) =>
                        handleUpdateStrategy(strategy.id, "max_positions", Number(val) || 3)
                      }
                      data-testid={`strategy-allocation-positions-${strategy.id}`}
                    />
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      onClick={() => handleRemoveStrategy(strategy.id)}
                      title="Remove"
                      data-testid={`remove-strategy-btn-${strategy.id}`}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                  <StrategyParams
                    strategy={
                      selectableStrategies.find((s) => s.id === strategy.strategy_id) || {
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
              ))}
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

            <Group justify="space-between" mt="md">
              <Text size="sm">
                Total Allocation:{" "}
                <Text span fw={700} c={isOverAllocated ? "red" : undefined}>
                  {totalAllocation.toFixed(0)}%
                </Text>
              </Text>
              {isOverAllocated && (
                <Alert color="red" variant="light" p="xs">
                  Over 100%
                </Alert>
              )}
            </Group>
          </Stack>

          <Divider />

          <Group justify="flex-end">
            <Button variant="subtle" onClick={handleClose} data-testid="cancel-bot-config-btn">
              Cancel
            </Button>
            <Button type="submit" data-testid="save-bot-config-btn">
              {isEdit ? "Update Bot" : "Create Bot"}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
