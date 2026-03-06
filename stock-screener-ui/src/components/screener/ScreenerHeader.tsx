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
    <Stack gap="xs" data-testid="screener-header">
      <Group justify="space-between" align="center">
        <Text size="lg" fw={600} data-testid="screener-title">
          {title}
        </Text>
        <Group gap="xs" align="center">
          <Tooltip label="Refresh">
            <ActionIcon
              variant="subtle"
              onClick={onRefresh}
              loading={isLoading}
              data-testid="refresh-btn"
            >
              <IconRefresh size={18} />
            </ActionIcon>
          </Tooltip>
          <Group gap="xs" align="center">
            <Text size="xs" c="dimmed">
              Auto-refresh:
            </Text>
            <NumberInput
              value={autoRefreshSeconds}
              onChange={(value) => onAutoRefreshChange(Number(value) || 0)}
              min={0}
              max={3600}
              step={10}
              w={80}
              size="xs"
              disabled={isLoading}
              data-testid="auto-refresh-input"
            />
            <Text size="xs" c="dimmed">
              sec
            </Text>
          </Group>
          <Group gap="xs" align="center">
            <Text size="xs" c="dimmed">
              Provider:
            </Text>
            <Select
              value={provider}
              onChange={(value) => value && onProviderChange(value)}
              data={[
                { value: "upstox", label: "Upstox" },
                { value: "indmoney", label: "INDMONEY" },
              ]}
              size="xs"
              w={120}
              disabled={isLoading}
              data-testid="provider-select"
            />
          </Group>
          <Group gap="xs" align="center">
            <Text size="xs" c="dimmed">
              Mode:
            </Text>
            <Select
              value={mode}
              onChange={(value) => value && onModeChange(value)}
              data={[
                { value: "intraday", label: "Intraday" },
                { value: "historical", label: "5D" },
              ]}
              size="xs"
              w={100}
              disabled={isLoading}
              data-testid="mode-select"
            />
          </Group>
        </Group>
      </Group>
      <Text size="xs" c="dimmed" data-testid="status">
        {status}
      </Text>
    </Stack>
  );
}
