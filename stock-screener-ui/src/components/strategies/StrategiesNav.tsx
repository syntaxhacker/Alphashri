import type { ReactNode } from "react";
import { ToolbarRow, SegmentedControl } from "@/ui";
import type { StrategiesNavProps } from "./types";
import { CompactPanel } from "../common/compact";

const VIEW_OPTIONS = [
  { value: "tree", label: "Strategy Tree" },
  { value: "performance", label: "Performance" },
] as const;

export function StrategiesNav({
  activeView,
  onChange,
  children,
}: StrategiesNavProps & { children?: ReactNode }) {
  return (
    <CompactPanel
      className="strategies-nav"
      id="strategies-nav"
      testId="strategies-nav"
      title="Strategies"
      description="Manage templates, variations, and performance in one place"
      scrollable
      sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
    >
      <ToolbarRow gap={8} wrap={false}>
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
      </ToolbarRow>
      <div style={{ marginTop: 8, flex: 1, minHeight: 0 }}>{children}</div>
    </CompactPanel>
  );
}
