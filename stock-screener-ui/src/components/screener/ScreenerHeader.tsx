import { Show } from "solid-js";
import { Box, Text, ActionIcon, NumberInput, Select, Tooltip, SegmentedControl, ToolbarRow } from "@/ui";
import { IconRefresh } from "./icons";

type ScreenerViewMode = "table" | "heatmap";

interface ScreenerHeaderProps {
  status: string;
  isLoading: boolean;
  autoRefreshSeconds: number;
  provider: string;
  mode: string;
  onRefresh: () => void;
  onAutoRefreshChange: (value: number) => void;
  onProviderChange: (value: string) => void;
  onModeChange: (value: string) => void;
  viewMode: ScreenerViewMode;
  onViewModeChange: (value: ScreenerViewMode) => void;
  hideStatus?: boolean;
  disableControls?: boolean;
}

export function ScreenerHeader(props: ScreenerHeaderProps) {
  const disableControls = () => props.disableControls ?? props.isLoading;

  return (
    <Box
      id="screener-header"
      data-testid="screener-header"
      className="flex-shrink-0 flex items-center gap-4 overflow-hidden flex-nowrap"
    >
      <Show when={!props.hideStatus}>
        <Box className="flex-1 min-w-0 flex items-center overflow-hidden">
          <Text size="xs" c="dimmed" truncate className="flex-1 min-w-0" title={props.status} data-testid="status">
            {props.status}
          </Text>
        </Box>
      </Show>
      <ToolbarRow data-testid="header-controls" gap={8} wrap={false} style={{ flexShrink: 0 }}>
          <Tooltip label="Refresh">
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={props.onRefresh}
              loading={props.isLoading}
              data-testid="refresh-btn"
              id="refresh-btn"
            >
              <IconRefresh size={14} />
            </ActionIcon>
          </Tooltip>
          <NumberInput
            value={props.autoRefreshSeconds}
            onChange={(value) => props.onAutoRefreshChange(Number(value) || 0)}
            min={0}
            max={3600}
            step={10}
            w={64}
            size="xs"
            disabled={disableControls()}
            data-testid="auto-refresh-input"
            aria-label="Auto-refresh seconds"
          />
          <Select
            value={props.provider}
            onChange={(value) => value && props.onProviderChange(value)}
            data={[
              { value: "upstox", label: "Upstox" },
              { value: "indmoney", label: "IND" },
            ]}
            size="xs"
            w={96}
            disabled={disableControls()}
            data-testid="provider-select"
            comboboxProps={{ withinPortal: true }}
          />
          <Select
            value={props.mode}
            onChange={(value) => value && props.onModeChange(value)}
            data={[
              { value: "intraday", label: "Intra" },
              { value: "historical", label: "5D" },
            ]}
            size="xs"
            w={96}
            disabled={disableControls()}
            data-testid="mode-select"
            comboboxProps={{ withinPortal: true }}
          />
          <SegmentedControl
            size="xs"
            value={props.viewMode}
            onChange={(value) => props.onViewModeChange(value as ScreenerViewMode)}
            data={[
              { label: "Tbl", value: "table" },
              { label: "Map", value: "heatmap" },
            ]}
            data-testid="screener-view-toggle"
          />
      </ToolbarRow>
    </Box>
  );
}
