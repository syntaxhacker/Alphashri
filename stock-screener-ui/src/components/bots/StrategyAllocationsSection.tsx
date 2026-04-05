import {
  Select,
  NumberInput,
  Button,
  Stack,
  Group,
  Text,
  Card,
  ActionIcon,
  Alert,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import type { AvailableStrategy } from "../../types/bots";
import type { StrategyAllocationRow } from "../../hooks/useStrategyAllocationRows";

interface StrategyAllocationsSectionProps {
  strategies: StrategyAllocationRow[];
  selectableStrategies: AvailableStrategy[];
  totalAllocation: number;
  isOverAllocated: boolean;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, field: keyof StrategyAllocationRow, value: string | number) => void;
}

export function StrategyAllocationsSection({
  strategies,
  selectableStrategies,
  totalAllocation,
  isOverAllocated,
  onAdd,
  onRemove,
  onUpdate,
}: StrategyAllocationsSectionProps) {
  return (
    <Stack gap="xs" data-testid="bot-config-strategies">
      <Text fw={600}>Strategy Allocations</Text>
      <Text size="sm" c="dimmed">
        Configure which strategies to run and their capital allocations. Total allocation should not
        exceed 100%.
      </Text>

      <Stack gap="sm" data-testid="strategy-allocations">
        {strategies.map((strategy) => (
          <Card key={strategy.id} padding="sm" withBorder data-testid="strategy-allocation-row">
            <Group align="flex-end" grow>
              <Select
                label="Strategy"
                placeholder="Select a strategy..."
                data={selectableStrategies.map((s) => ({
                  value: s.id,
                  label: `${s.name} (${s.strategy_type})`,
                }))}
                value={strategy.strategy_id}
                onChange={(val) => onUpdate(strategy.id, "strategy_id", val || "")}
              />
              <NumberInput
                label="Allocation %"
                min={5}
                max={100}
                step={5}
                value={strategy.capital_allocation_pct}
                onChange={(val) =>
                  onUpdate(strategy.id, "capital_allocation_pct", Number(val) || 20)
                }
              />
              <NumberInput
                label="Max Positions"
                min={1}
                max={10}
                value={strategy.max_positions}
                onChange={(val) => onUpdate(strategy.id, "max_positions", Number(val) || 3)}
              />
              <ActionIcon
                color="red"
                variant="subtle"
                onClick={() => onRemove(strategy.id)}
                title="Remove"
                data-testid={`remove-strategy-btn-${strategy.id}`}
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
        onClick={onAdd}
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
  );
}
