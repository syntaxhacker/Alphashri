import { useState, useEffect } from "react";
import {
  Modal,
  TextInput,
  NumberInput,
  Checkbox,
  Button,
  Stack,
  Group,
  Text,
  Divider,
} from "@mantine/core";
import type { BotConfig, AvailableStrategy, StrategyAllocation } from "../../types/bots";
import {
  createBotAction,
  updateBotAction,
  closeCreateModal,
  closeEditModal,
} from "../../state/bots";
import { useStrategyAllocationRows } from "../../hooks/useStrategyAllocationRows";
import { StrategyAllocationsSection } from "./StrategyAllocationsSection";

interface BotConfigModalProps {
  opened: boolean;
  bot: BotConfig | null;
  availableStrategies: AvailableStrategy[];
  onClose: () => void;
}

export function BotConfigModal({ opened, bot, availableStrategies, onClose }: BotConfigModalProps) {
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [maxPositions, setMaxPositions] = useState(10);
  const [maxCapital, setMaxCapital] = useState(80);

  const { strategies, handleAddStrategy, handleRemoveStrategy, handleUpdateStrategy } =
    useStrategyAllocationRows(bot, opened);

  const isEdit = bot !== null;
  const selectableStrategies = availableStrategies.filter((s) => !s.is_template);

  useEffect(() => {
    if (opened && bot) {
      setName(bot.name);
      setIsActive(bot.is_active);
      setMaxPositions(bot.max_total_positions);
      setMaxCapital(bot.max_total_capital_pct * 100);
    } else if (opened) {
      setName("");
      setIsActive(true);
      setMaxPositions(10);
      setMaxCapital(80);
    }
  }, [opened, bot]);

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
        <Stack gap="sm">
          <Stack gap="xs" data-testid="bot-config-basic-info">
            <Text fw={600}>Basic Information</Text>
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
          </Stack>

          <Divider />

          <StrategyAllocationsSection
            strategies={strategies}
            selectableStrategies={selectableStrategies}
            totalAllocation={totalAllocation}
            isOverAllocated={isOverAllocated}
            onAdd={handleAddStrategy}
            onRemove={handleRemoveStrategy}
            onUpdate={handleUpdateStrategy}
          />

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
