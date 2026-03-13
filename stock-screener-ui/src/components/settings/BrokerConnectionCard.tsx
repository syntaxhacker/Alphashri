import { Card, Text, Badge, Button, Group, Stack } from "@mantine/core";
import { IconPlugConnected, IconPlugX, IconRefresh } from "@tabler/icons-react";
import type { BrokerStatus } from "../../api/brokers";

interface BrokerConnectionCardProps {
  status: BrokerStatus | null;
  loading: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
}

function formatExpiresIn(hours: number | null): string {
  if (hours === null) return "";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  return `${m}m`;
}

function getStatusBadge(status: BrokerStatus | null) {
  if (!status) {
    return <Badge color="gray">Unknown</Badge>;
  }
  if (!status.connected) {
    return <Badge color="red">Disconnected</Badge>;
  }
  if (status.expires_in_hours !== null && status.expires_in_hours < 0) {
    return <Badge color="yellow">Expired</Badge>;
  }
  return <Badge color="green">Connected</Badge>;
}

export function BrokerConnectionCard({
  status,
  loading,
  onConnect,
  onDisconnect,
  onRefresh,
}: BrokerConnectionCardProps) {
  const isConnected =
    status?.connected && (status.expires_in_hours === null || status.expires_in_hours >= 0);

  return (
    <Card shadow="sm" padding="lg" radius="md" withBorder id="broker-connection-card" data-testid="broker-connection-card">
      <Stack gap="md">
        <Group justify="space-between">
          <Text fw={600} size="lg">
            Upstox Connection
          </Text>
          <span data-testid="broker-status-badge">{getStatusBadge(status)}</span>
        </Group>

        {isConnected && status?.expires_in_hours !== null && (
          <Text size="sm" c="dimmed" data-testid="broker-expires-text">
            Expires in {formatExpiresIn(status.expires_in_hours)}
          </Text>
        )}

        {!isConnected && (
          <Text size="sm" c="dimmed">
            Connect your Upstox account to enable live trading
          </Text>
        )}

        <Group gap="xs">
          {isConnected ? (
            <Button
              leftSection={<IconPlugX size={16} />}
              variant="light"
              color="red"
              onClick={onDisconnect}
              loading={loading}
              data-testid="disconnect-upstox-btn"
            >
              Disconnect
            </Button>
          ) : (
            <Button
              leftSection={<IconPlugConnected size={16} />}
              variant="light"
              color="green"
              onClick={onConnect}
              loading={loading}
              data-testid="connect-upstox-btn"
            >
              Connect
            </Button>
          )}
          <Button
            leftSection={<IconRefresh size={16} />}
            variant="subtle"
            onClick={onRefresh}
            loading={loading}
            data-testid="refresh-broker-status-btn"
          >
            Refresh
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
