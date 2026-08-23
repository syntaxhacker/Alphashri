import {
  Group,
  Text,
  ActionIcon,
  NumberInput,
  Select,
  Tooltip,
  SegmentedControl,
  Box,
} from "@/ui";
import { IconRefresh } from "@tabler/icons-react";

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
}

export function ScreenerHeader({
  status,
  isLoading,
  autoRefreshSeconds,
  provider,
  mode,
  onRefresh,
  onAutoRefreshChange,
  onProviderChange,
  onModeChange,
  viewMode,
  onViewModeChange,
}: ScreenerHeaderProps) {
  return (
    <Box
      id="screener-header"
      className="screener-header"
      data-testid="screener-header"
      py={4}
      px={8}
      sx={(theme) => ({ borderBottom: `1px solid ${theme.palette.divider}`, flexShrink: 0 })}
    >
      <Group justify="space-between" align="center" gap={6} wrap="nowrap">
        <Text
          size="xs"
          c="dimmed"
          truncate
          style={{ flex: 1, minWidth: 0 }}
          title={status}
          data-testid="status"
        >
          {status}
        </Text>
        <Group gap={6} align="center" wrap="nowrap" className="header-controls" data-testid="header-controls">
          <Tooltip label="Refresh">
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={onRefresh}
              loading={isLoading}
              data-testid="refresh-btn"
              id="refresh-btn"
              className="refresh-btn"
            >
              <IconRefresh size={14} />
            </ActionIcon>
          </Tooltip>
          <NumberInput
            value={autoRefreshSeconds}
            onChange={(value) => onAutoRefreshChange(Number(value) || 0)}
            min={0}
            max={3600}
            step={10}
            w={52}
            size="xs"
            disabled={isLoading}
            data-testid="auto-refresh-input"
            aria-label="Auto-refresh seconds"
          />
          <Select
            value={provider}
            onChange={(value) => value && onProviderChange(value)}
            data={[
              { value: "upstox", label: "Upstox" },
              { value: "indmoney", label: "IND" },
            ]}
            size="xs"
            w={88}
            disabled={isLoading}
            data-testid="provider-select"
            comboboxProps={{ withinPortal: true }}
          />
          <Select
            value={mode}
            onChange={(value) => value && onModeChange(value)}
            data={[
              { value: "intraday", label: "Intra" },
              { value: "historical", label: "5D" },
            ]}
            size="xs"
            w={72}
            disabled={isLoading}
            data-testid="mode-select"
            comboboxProps={{ withinPortal: true }}
          />
          <SegmentedControl
            size="xs"
            value={viewMode}
            onChange={(value) => onViewModeChange(value as ScreenerViewMode)}
            data={[
              { label: "Tbl", value: "table" },
              { label: "Map", value: "heatmap" },
            ]}
            data-testid="screener-view-toggle"
          />
        </Group>
      </Group>
    </Box>
  );
}