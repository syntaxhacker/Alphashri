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
    <Group
      justify="space-between"
      align="center"
      mb="md"
      className="strategies-nav"
      id="strategies-nav"
      data-testid="strategies-nav"
    >
      <Group gap="xs" className="strategies-nav-tabs" data-testid="strategies-nav-tabs">
        {VIEW_OPTIONS.map((option) => (
          <Button
            key={option.value}
            variant={activeView === option.value ? "filled" : "light"}
            size="sm"
            onClick={() => onChange(option.value)}
            data-testid={`strategies-nav-${option.value}`}
            className={`strategies-nav-tab strategies-nav-tab-${option.value}`}
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
        className="strategies-nav-create-btn"
        id="create-strategy-btn"
      >
        New Strategy
      </Button>
    </Group>
  );
}
