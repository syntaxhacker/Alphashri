import type { JSX } from "solid-js";
import { SegmentedControl, Text } from "@/ui";
import type { StrategiesNavProps, StrategyView } from "./types";

const VIEW_OPTIONS = [
  { value: "tree", label: "Strategy Tree" },
  { value: "performance", label: "Performance" },
] as const;

export function StrategiesNav(props: StrategiesNavProps & { children?: JSX.Element }) {
  return (
    <div
      className="strategies-nav flex-1 min-h-0 flex flex-col"
      id="strategies-nav"
      data-testid="strategies-nav"
    >
      {/* Identity band: title and view switch on one line. The panel border is gone —
          a bordered card around a bordered control was the card-in-card look. */}
      <div
        className="flex items-center flex-none overflow-hidden px-2"
        style={{
          height: "32px",
          "min-height": "32px",
          gap: "8px",
          "padding-left": "8px",
          "padding-right": "8px",
          "border-bottom": "1px solid var(--color-fin-border)",
        }}
      >
        <Text size="sm" fw={700} className="flex-none">
          Strategies
        </Text>
        <SegmentedControl
          value={props.activeView}
          onChange={(value) => props.onChange(value as StrategyView)}
          size="sm"
          data-testid="strategies-nav-tabs"
          className="strategies-nav-tabs flex-none"
          data={VIEW_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
        />
        <Text size="xs" c="dimmed" truncate className="ml-auto hidden lg:block">
          Manage templates, variations, and performance in one place
        </Text>
      </div>
      <div className="flex-1 min-h-0 overflow-auto py-1">{props.children}</div>
    </div>
  );
}
