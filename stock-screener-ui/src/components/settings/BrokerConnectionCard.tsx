import { mergeProps, Show } from "solid-js";
import { Text, Badge, Button, ToolbarRow, Box, Stack } from "@/ui";
import { IconPlugConnected, IconPlugX, IconRefresh } from "@/components/common/Icons";
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

export function BrokerConnectionCard(props: BrokerConnectionCardProps) {
  // Defaults land on mergeProps so props stay getters (no destructuring).
  const p = mergeProps(
    {
      broker: "upstox",
      title: "Upstox Connection",
      hint: "Connect your Upstox account to enable live trading",
    },
    props,
  );

  const isConnected = () =>
    !!p.status?.connected &&
    (p.status.expires_in_hours === null || p.status.expires_in_hours >= 0);
  // Keep the original testids for the default (upstox) card.
  const suffix = () => (p.broker === "upstox" ? "upstox" : p.broker);
  const refreshTestId = () =>
    p.broker === "upstox" ? "refresh-broker-status-btn" : `refresh-${p.broker}-status-btn`;
  const statusTestId = () =>
    p.broker === "upstox" ? "broker-status-badge" : `${p.broker}-status-badge`;
  const cardTestId = () =>
    p.broker === "upstox" ? "broker-connection-card" : `${p.broker}-connection-card`;
  const expiresTestId = () =>
    p.broker === "upstox" ? "broker-expires-text" : `${p.broker}-expires-text`;

  return (
    <Box id={cardTestId()} data-testid={cardTestId()} className="w-full">
      <Stack gap={4}>
        <ToolbarRow justify="space-between" gap={8} style={{ flexWrap: "wrap", rowGap: 8 }}>
          <Box className="flex min-w-0 flex-wrap items-center gap-2">
            <Text fw={600} size="sm">
              {p.title}
            </Text>
            <span data-testid={statusTestId()}>{getStatusBadge(p.status)}</span>
            <Show when={isConnected() && p.status?.expires_in_hours != null}>
              <Text size="xs" c="dimmed" data-testid={expiresTestId()}>
                Expires in {formatExpiresIn(p.status?.expires_in_hours ?? null)}
              </Text>
            </Show>
          </Box>
          <Box className="flex items-center gap-2">
            <Show
              when={isConnected()}
              fallback={
                <Button
                  size="sm"
                  leftSection={<IconPlugConnected size={16} />}
                  variant="filled"
                  color="success"
                  onClick={() => p.onConnect()}
                  loading={p.loading}
                  data-testid={`connect-${suffix()}-btn`}
                >
                  Connect
                </Button>
              }
            >
              <Button
                size="sm"
                leftSection={<IconPlugX size={16} />}
                variant="filled"
                color="error"
                onClick={() => p.onDisconnect()}
                loading={p.loading}
                data-testid={`disconnect-${suffix()}-btn`}
              >
                Disconnect
              </Button>
            </Show>
            <Button
              size="sm"
              leftSection={<IconRefresh size={16} />}
              variant="subtle"
              onClick={() => p.onRefresh()}
              loading={p.loading}
              data-testid={refreshTestId()}
            >
              Refresh
            </Button>
          </Box>
        </ToolbarRow>
        <Show when={!isConnected()}>
          <Text size="xs" c="dimmed">
            {p.hint}
          </Text>
        </Show>
      </Stack>
    </Box>
  );
}
