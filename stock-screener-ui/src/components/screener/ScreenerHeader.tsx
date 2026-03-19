import { Group, Stack, Text, ActionIcon, NumberInput, Select, Tooltip, SegmentedControl } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { CompactPanel } from "../common/compact";

export type ScreenerViewMode = "table" | "heatmap";

interface ScreenerHeaderProps {
  title: string;
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
  title,
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
    <CompactPanel
      id="screener-header"
      className="screener-header"
      testId="screener-header"
      title={title}
      description={status}
    >
      <Group justify="space-between" align="flex-start" gap="sm" wrap="wrap">
        <Group gap="xs" align="center" className="header-controls" data-testid="header-controls">
          <Tooltip label="Refresh">
            <ActionIcon
              variant="subtle"
              onClick={onRefresh}
              loading={isLoading}
              data-testid="refresh-btn"
              id="refresh-btn"
              className="refresh-btn"
            >
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
          <Group
            gap={6}
            align="center"
            className="auto-refresh-group"
            data-testid="auto-refresh-group"
          >
            <Text size="xs" c="dimmed" className="auto-refresh-label">
              Auto-refresh
            </Text>
            <NumberInput
              value={autoRefreshSeconds}
              onChange={(value) => onAutoRefreshChange(Number(value) || 0)}
              min={0}
              max={3600}
              step={10}
              w={76}
              size="xs"
              disabled={isLoading}
              data-testid="auto-refresh-input"
            />
            <Text size="xs" c="dimmed" className="auto-refresh-unit">
              sec
            </Text>
          </Group>
          <Group gap={6} align="center" className="provider-group" data-testid="provider-group">
            <Text size="xs" c="dimmed" className="provider-label">
              Provider
            </Text>
            <Select
              value={provider}
              onChange={(value) => value && onProviderChange(value)}
              data={[
                { value: "upstox", label: "Upstox" },
                { value: "indmoney", label: "INDMONEY" },
              ]}
              size="xs"
              w={118}
              disabled={isLoading}
              data-testid="provider-select"
              id="provider-select"
              className="provider-select"
            />
          </Group>
          <Group gap={6} align="center" className="mode-group" data-testid="mode-group">
            <Text size="xs" c="dimmed" className="mode-label">
              Mode
            </Text>
            <Select
              value={mode}
              onChange={(value) => value && onModeChange(value)}
              data={[
                { value: "intraday", label: "Intraday" },
                { value: "historical", label: "5D" },
              ]}
              size="xs"
              w={96}
              disabled={isLoading}
              data-testid="mode-select"
              id="mode-select"
              className="mode-select"
            />
          </Group>
          <Group gap={6} align="center" className="view-group" data-testid="view-group">
            <Text size="xs" c="dimmed">
              View as
            </Text>
            <SegmentedControl
              size="xs"
              value={viewMode}
              onChange={(value) => onViewModeChange(value as ScreenerViewMode)}
              data={[
                { label: "Table", value: "table" },
                { label: "Heatmap", value: "heatmap" },
              ]}
              data-testid="screener-view-toggle"
            />
          </Group>
        </Group>
      </Group>
    </CompactPanel>
  );
}
