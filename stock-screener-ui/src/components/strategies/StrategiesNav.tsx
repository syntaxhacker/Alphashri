import { Group, SegmentedControl } from "@/ui";
import type { StrategiesNavProps } from "./types";
import { CompactPanel } from "../common/compact";

const VIEW_OPTIONS = [
  { value: "tree", label: "Strategy Tree" },
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
      <Group justify="center" align="center" gap={1} wrap="wrap" sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
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
      </Group>
    </CompactPanel>
  );
}
