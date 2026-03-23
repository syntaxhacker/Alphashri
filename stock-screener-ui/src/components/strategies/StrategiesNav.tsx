import { Group, Button, SegmentedControl } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import type { StrategiesNavProps } from "./types";
import { CompactPanel } from "../common/compact";

const VIEW_OPTIONS = [
  { value: "templates", label: "Templates" },
  { value: "list", label: "All Strategies" },
  { value: "performance", label: "Performance" },
] as const;

export function StrategiesNav({ activeView, onChange }: StrategiesNavProps) {
  return (
    <CompactPanel
      className="strategies-nav"
      id="strategies-nav"
      testId="strategies-nav"
      title="Strategies"
      description="Manage templates, variations, and performance in one place"
    >
      <Group justify="space-between" align="center" gap="sm" wrap="wrap">
        <SegmentedControl
          value={activeView}
          onChange={onChange}
          size="sm"
          data-testid="strategies-nav-tabs"
          className="strategies-nav-tabs"
          data={VIEW_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
        />

        <Button
          variant="filled"
          color="teal"
          size="sm"
          leftSection={<IconPlus size={14} />}
          onClick={() => onChange("templates")}
          data-testid="create-strategy-btn"
          className="strategies-nav-create-btn"
          id="create-strategy-btn"
        >
          New Strategy
        </Button>
      </Group>
    </CompactPanel>
  );
}
