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
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
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

export function BotConfigModal({ opened, bot, availableStrategies, onClose }: BotConfigModalProps) {
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [maxPositions, setMaxPositions] = useState(10);
  const [maxCapital, setMaxCapital] = useState(80);
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
        <Stack gap="md">
           {/* Basic Info */}
          <div className="bot-config-section" data-testid="bot-config-basic-info">
            <Text fw={600} mb="xs">
              Basic Information
            </Text>
            <Group grow>
              <TextInput
                label="Bot Name"
                placeholder="e.g., Multi-ORB Test"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="bot-name-input"
              />
              <Checkbox
                label="Active"
                checked={isActive}
                onChange={(e) => setIsActive(e.currentTarget.checked)}
                mt="xl"
                data-testid="bot-active-checkbox"
              />
            </Group>
          </div>

          <Divider />

           {/* Global Limits */}
          <div className="bot-config-section" data-testid="bot-config-global-limits">
            <Text fw={600} mb="xs">
              Global Limits
            </Text>
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
          </div>

          <Divider />

           {/* Strategy Allocations */}
          <div className="bot-config-section" data-testid="bot-config-strategies">
            <Text fw={600} mb="xs">
              Strategy Allocations
            </Text>
            <Text size="sm" c="dimmed" mb="sm">
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
                    />
                    <NumberInput
                      label="Max Positions"
                      min={1}
                      max={10}
                      value={strategy.max_positions}
                      onChange={(val) =>
                        handleUpdateStrategy(strategy.id, "max_positions", Number(val) || 3)
                      }
                    />
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      onClick={() => handleRemoveStrategy(strategy.id)}
                      title="Remove"
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                </Card>
              ))}
            </Stack>

            <Button
              leftSection={<IconPlus size={16} />}
              variant="light"
              size="sm"
              mt="sm"
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
                  ⚠️ Over 100%
                </Alert>
              )}
            </Group>
          </div>

          <Divider />

          {/* Actions */}
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
