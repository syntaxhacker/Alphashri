import { Text, Badge, Button, ToolbarRow, Box, Stack } from "@/ui";
import { IconPlugConnected, IconPlugX, IconRefresh } from "@tabler/icons-react";
import type { BrokerStatus } from "../../api/brokers";

interface BrokerConnectionCardProps {
  status: BrokerStatus | null;
  loading: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
  /** Broker id used for testids (defaults to "upstox"). */
  broker?: string;
  /** Card heading (defaults to "Upstox Connection"). */
  title?: string;
  /** Hint shown when disconnected. */
  hint?: string;
}

export function formatExpiresIn(hours: number | null): string {
  if (hours === null) return "";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  return `${m}m`;
}

export function getStatusBadge(status: BrokerStatus | null) {
  if (!status) {
    return <Badge color="secondary">Unknown</Badge>;
  }
  if (!status.connected) {
    return <Badge color="error">Disconnected</Badge>;
  }
  if (status.expires_in_hours !== null && status.expires_in_hours < 0) {
    return <Badge color="warning">Expired</Badge>;
  }
  return <Badge color="success">Connected</Badge>;
}

export function BrokerConnectionCard({
  status,
  loading,
  onConnect,
  onDisconnect,
  onRefresh,
  broker = "upstox",
  title = "Upstox Connection",
  hint = "Connect your Upstox account to enable live trading",
}: BrokerConnectionCardProps) {
  const isConnected =
    status?.connected && (status.expires_in_hours === null || status.expires_in_hours >= 0);
  // Keep the original testids for the default (upstox) card.
  const suffix = broker === "upstox" ? "upstox" : broker;
  const refreshTestId =
    broker === "upstox" ? "refresh-broker-status-btn" : `refresh-${broker}-status-btn`;
  const statusTestId =
    broker === "upstox" ? "broker-status-badge" : `${broker}-status-badge`;
  const cardTestId =
    broker === "upstox" ? "broker-connection-card" : `${broker}-connection-card`;
  const expiresTestId =
    broker === "upstox" ? "broker-expires-text" : `${broker}-expires-text`;

  return (
    <Box id={cardTestId} data-testid={cardTestId} sx={{ width: "100%" }}>
      <Stack gap={4}>
        <ToolbarRow justify="space-between" gap={8} style={{ flexWrap: "wrap", rowGap: 8 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0, flexWrap: "wrap" }}>
            <Text fw={600} size="sm">
              {title}
            </Text>
            <span data-testid={statusTestId}>{getStatusBadge(status)}</span>
            {isConnected && status?.expires_in_hours !== null && (
              <Text size="xs" c="dimmed" data-testid={expiresTestId}>
                Expires in {formatExpiresIn(status.expires_in_hours)}
              </Text>
            )}
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {isConnected ? (
              <Button size="sm" leftSection={<IconPlugX size={16} />} variant="filled" color="error" onClick={onDisconnect} loading={loading} data-testid={`disconnect-${suffix}-btn`}>
                Disconnect
              </Button>
            ) : (
              <Button size="sm" leftSection={<IconPlugConnected size={16} />} variant="filled" color="success" onClick={onConnect} loading={loading} data-testid={`connect-${suffix}-btn`}>
                Connect
              </Button>
            )}
            <Button size="sm" leftSection={<IconRefresh size={16} />} variant="subtle" onClick={onRefresh} loading={loading} data-testid={refreshTestId}>
              Refresh
            </Button>
          </Box>
        </ToolbarRow>
        {!isConnected && (
          <Text size="xs" c="dimmed">
            {hint}
          </Text>
        )}
      </Stack>
    </Box>
  );
}
