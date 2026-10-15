import { Select, SegmentedControl, Text, ToolbarRow } from "@/ui";
import type { PositioningMode, PositioningView } from "@/utils/positioning";

interface PositioningHeaderProps {
  underlying: string;
  onUnderlyingChange: (u: string) => void;
  mode: PositioningMode;
  onModeChange: (m: PositioningMode) => void;
  view: PositioningView;
  onViewChange: (v: PositioningView) => void;
  timestamp?: string;
}

const UNDERLYINGS = ["NIFTY", "BANKNIFTY", "FINNIFTY"];

const MODE_OPTIONS = [
  { value: "since_open", label: "Since open" },
  { value: "prev_close", label: "Prev close" },
];

const VIEW_OPTIONS = [
  { value: "table", label: "Table" },
  { value: "chart", label: "Chart" },
];

export function PositioningHeader({
  underlying,
  onUnderlyingChange,
  mode,
  onModeChange,
  view,
  onViewChange,
  timestamp,
}: PositioningHeaderProps) {
  return (
    <ToolbarRow
      data-testid="positioning-header"
      gap={8}
      wrap={false}
      style={{ height: 48, minHeight: 48, maxHeight: 48 }}
    >
      <Select
        data-testid="positioning-underlying"
        data={UNDERLYINGS}
        value={underlying}
        onChange={(v) => {
          if (v) onUnderlyingChange(v);
        }}
        size="sm"
        w={160}
      />
      <SegmentedControl
        data-testid="positioning-mode"
        data={MODE_OPTIONS}
        value={mode}
        onChange={(v) => onModeChange(v as PositioningMode)}
        size="sm"
      />
      <SegmentedControl
        data-testid="positioning-view"
        data={VIEW_OPTIONS}
        value={view}
        onChange={(v) => onViewChange(v as PositioningView)}
        size="sm"
      />
      {timestamp && (
        <Text size="xs" c="dimmed" data-testid="positioning-timestamp">
          {timestamp}
        </Text>
      )}
    </ToolbarRow>
  );
}
