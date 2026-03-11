import { Group, Button } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import type { StrategiesNavProps } from "./types";

const VIEW_OPTIONS = [
  { value: "templates", label: "Templates" },
  { value: "list", label: "All Strategies" },
  { value: "performance", label: "Performance" },
] as const;

export function StrategiesNav({ activeView, onChange }: StrategiesNavProps) {
  return (
    <Group justify="space-between" align="center" mb="md">
      <Group gap="xs">
        {VIEW_OPTIONS.map((option) => (
          <Button
            key={option.value}
            variant={activeView === option.value ? "filled" : "light"}
            size="xs"
            onClick={() => onChange(option.value)}
            data-testid={`strategies-nav-${option.value}`}
          >
            {option.label}
          </Button>
        ))}
      </Group>

      <Button
        variant="filled"
        color="teal"
        size="sm"
        leftSection={<IconPlus size={16} />}
        onClick={() => onChange("templates")}
        data-testid="create-strategy-btn"
      >
        New Strategy
      </Button>
    </Group>
  );
}
