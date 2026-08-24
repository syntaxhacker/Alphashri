import { Text, Badge, Button } from "@/ui";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { IconPlugConnected, IconPlugX, IconRefresh } from "@tabler/icons-react";
import type { BrokerStatus } from "../../api/brokers";

interface BrokerConnectionCardProps {
  status: BrokerStatus | null;
  loading: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
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
}: BrokerConnectionCardProps) {
  const isConnected =
    status?.connected && (status.expires_in_hours === null || status.expires_in_hours >= 0);

  return (
    <Card elevation={1} id="broker-connection-card" data-testid="broker-connection-card" sx={{ width: "100%", maxWidth: 560 }}>
      <CardContent sx={{ p: 1, "&:last-child": { pb: 1 } }}>
        <Stack spacing={1} sx={{ alignItems: "center", width: "100%" }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
            <Text fw={600} size="lg" sx={{ textAlign: "center" }}>
              Upstox Connection
            </Text>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
            <span data-testid="broker-status-badge">{getStatusBadge(status)}</span>
          </Box>

          {isConnected && status?.expires_in_hours !== null && (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
              <Text size="sm" c="dimmed" data-testid="broker-expires-text" sx={{ textAlign: "center" }}>
                Expires in {formatExpiresIn(status.expires_in_hours)}
              </Text>
            </Box>
          )}

          {!isConnected && (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
              <Text size="sm" c="dimmed" sx={{ textAlign: "center" }}>
                Connect your Upstox account to enable live trading
              </Text>
            </Box>
          )}

          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, flexWrap: "wrap", width: "100%" }}>
            {isConnected ? (
              <Button leftSection={<IconPlugX size={16} />} variant="light" color="error" onClick={onDisconnect} loading={loading} data-testid="disconnect-upstox-btn">
                Disconnect
              </Button>
            ) : (
              <Button leftSection={<IconPlugConnected size={16} />} variant="light" color="success" onClick={onConnect} loading={loading} data-testid="connect-upstox-btn">
                Connect
              </Button>
            )}
            <Button leftSection={<IconRefresh size={16} />} variant="subtle" onClick={onRefresh} loading={loading} data-testid="refresh-broker-status-btn">
              Refresh
            </Button>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
