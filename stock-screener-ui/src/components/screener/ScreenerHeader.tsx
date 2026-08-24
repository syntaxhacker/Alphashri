import {
  Group,
  Stack,
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
      data-testid="screener-header"
      py="sm"
      px="md"
      sx={{ flexShrink: 0, minHeight: 48, display: "flex", alignItems: "center" }}
    >
      <Stack direction="row" align="center" justify="space-between" gap="sm" sx={{ width: "100%", flexWrap: "nowrap" }}>
        <Text
          size="xs"
          c="dimmed"
          truncate
          sx={{ flex: 1, minWidth: 0 }}
          title={status}
          data-testid="status"
        >
          {status}
        </Text>
        <Stack direction="row" align="center" gap="sm" data-testid="header-controls" sx={{ flexWrap: "nowrap" }}>
          <Tooltip label="Refresh">
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={onRefresh}
              loading={isLoading}
              data-testid="refresh-btn"
              id="refresh-btn"
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
            w={64}
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
            w={96}
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
            w={96}
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
        </Stack>
      </Stack>
    </Box>
  );
}