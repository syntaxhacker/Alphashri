import { Group, Stack, Text, ActionIcon, NumberInput, Select, Tooltip } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";

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
}: ScreenerHeaderProps) {
  return (
    <Stack gap="xs" id="screener-header" className="screener-header" data-testid="screener-header">
      <Group justify="space-between" align="center" className="header-main-row" data-testid="header-main-row">
        <Text size="lg" fw={600} data-testid="screener-title" id="screener-title" className="screener-title">
          {title}
        </Text>
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
              <IconRefresh size={18} />
            </ActionIcon>
          </Tooltip>
          <Group gap="xs" align="center" className="auto-refresh-group" data-testid="auto-refresh-group">
            <Text size="sm" c="dimmed" className="auto-refresh-label">
              Auto-refresh:
            </Text>
            <NumberInput
              value={autoRefreshSeconds}
              onChange={(value) => onAutoRefreshChange(Number(value) || 0)}
              min={0}
              max={3600}
              step={10}
              w={80}
              size="sm"
              disabled={isLoading}
              data-testid="auto-refresh-input"
            />
            <Text size="sm" c="dimmed" className="auto-refresh-unit">
              sec
            </Text>
          </Group>
          <Group gap="xs" align="center" className="provider-group" data-testid="provider-group">
            <Text size="sm" c="dimmed" className="provider-label">
              Provider:
            </Text>
            <Select
              value={provider}
              onChange={(value) => value && onProviderChange(value)}
              data={[
                { value: "upstox", label: "Upstox" },
                { value: "indmoney", label: "INDMONEY" },
              ]}
              size="sm"
              w={120}
              disabled={isLoading}
              data-testid="provider-select"
              id="provider-select"
              className="provider-select"
            />
          </Group>
          <Group gap="xs" align="center" className="mode-group" data-testid="mode-group">
            <Text size="sm" c="dimmed" className="mode-label">
              Mode:
            </Text>
            <Select
              value={mode}
              onChange={(value) => value && onModeChange(value)}
              data={[
                { value: "intraday", label: "Intraday" },
                { value: "historical", label: "5D" },
              ]}
              size="sm"
              w={100}
              disabled={isLoading}
              data-testid="mode-select"
              id="mode-select"
              className="mode-select"
            />
          </Group>
        </Group>
      </Group>
      <Text size="sm" c="dimmed" data-testid="status" id="screener-status" className="screener-status">
        {status}
      </Text>
    </Stack>
  );
}
