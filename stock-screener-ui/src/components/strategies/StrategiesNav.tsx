import type { JSX } from "solid-js";
import { ToolbarRow, SegmentedControl } from "@/ui";
import type { StrategiesNavProps, StrategyView } from "./types";
import { CompactPanel } from "../common/compact";

const VIEW_OPTIONS = [
  { value: "tree", label: "Strategy Tree" },
  { value: "performance", label: "Performance" },
] as const;

export function StrategiesNav(props: StrategiesNavProps & { children?: JSX.Element }) {
  return (
    <CompactPanel
      className="strategies-nav flex-1 min-h-0 flex flex-col"
      id="strategies-nav"
      testId="strategies-nav"
      title="Strategies"
      description="Manage templates, variations, and performance in one place"
      scrollable
    >
      <ToolbarRow gap={8} wrap={false}>
        <SegmentedControl
          value={props.activeView}
          onChange={(value) => props.onChange(value as StrategyView)}
          size="sm"
          data-testid="strategies-nav-tabs"
          className="strategies-nav-tabs"
          data={VIEW_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
        />
      </ToolbarRow>
      <div style={{ "margin-top": "8px", flex: 1, "min-height": 0 }}>{props.children}</div>
    </CompactPanel>
  );
}
