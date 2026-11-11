import { useEffect, useState, useCallback } from "react";
import { usePolling } from "@/hooks/usePolling";
import { Box, Stack, Text, ToolbarRow, Divider, Paper, Button, useDensity, type Density } from "@/ui";
import { cn } from "@/ui/cn";
import { useSearchParams } from "react-router-dom";
import { BrokerConnectionCard } from "../../components/settings/BrokerConnectionCard";
import {
  getBrokerStatus,
  connectUpstox,
  disconnectUpstox,
  connectFyers,
  disconnectFyers,
  type BrokerStatus,
} from "../../api/brokers";
import { useAppDispatch } from "../../state/store/hooks";
import { addNotification } from "../../state/store/notificationsSlice";
import { useMarketTickerEnabled } from "../../hooks/useMarketTickerEnabled";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { subscribeToHolidays, isMarketClosedToday } from "../../state/holidays";

export function SettingsPage() {
  useStoreSubscription(subscribeToHolidays);
  const [status, setStatus] = useState<BrokerStatus | null>(null);
  const [fyersStatus, setFyersStatus] = useState<BrokerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const dispatch = useAppDispatch();
  const [showMarketTicker, setShowMarketTicker] = useMarketTickerEnabled();
  const { density, setDensity } = useDensity();

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const [upstox, fyers] = await Promise.allSettled([
        getBrokerStatus("upstox"),
        getBrokerStatus("fyers"),
      ]);
      if (upstox.status === "fulfilled") setStatus(upstox.value);
      if (fyers.status === "fulfilled") setFyersStatus(fyers.value);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);
  usePolling(
    () => {
      if (isMarketClosedToday()) return;
      fetchStatus();
    },
    60000,
    { skipIfRunning: false },
  );

  useEffect(() => {
    const connected = searchParams.get("upstox") === "connected";
    const fyersConnected = searchParams.get("fyers") === "connected";
    if (connected) {
      dispatch(
        addNotification({
          type: "success",
          message: "Upstox connected successfully!",
          duration: 5000,
        }),
      );
    }
    if (fyersConnected) {
      dispatch(
        addNotification({
          type: "success",
          message: "Fyers connected successfully!",
          duration: 5000,
        }),
      );
    }
    if (connected || fyersConnected) {
      setSearchParams({});
      fetchStatus();
    }
  }, [searchParams, dispatch, setSearchParams, fetchStatus]);

  const handleConnect = () => {
    connectUpstox();
  };

  const handleFyersConnect = () => {
    connectFyers();
  };

  const handleFyersDisconnect = async () => {
    setLoading(true);
    try {
      await disconnectFyers();
      dispatch(
        addNotification({
          type: "success",
          message: "Fyers disconnected successfully",
          duration: 5000,
        }),
      );
      await fetchStatus();
    } catch {
      dispatch(
        addNotification({
          type: "error",
          message: "Failed to disconnect Fyers",
          duration: 5000,
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      await disconnectUpstox();
      dispatch(
        addNotification({
          type: "success",
          message: "Upstox disconnected successfully",
          duration: 5000,
        }),
      );
      await fetchStatus();
    } catch {
      dispatch(
        addNotification({
          type: "error",
          message: "Failed to disconnect Upstox",
          duration: 5000,
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  const densityItems = [
    { value: "compact", label: "Compact" },
    { value: "comfortable", label: "Comfortable" },
  ];

  return (
    <Box
      id="settings-page"
      className="settings-page h-full min-h-0 overflow-auto p-4 flex flex-col gap-4 items-stretch"
      data-testid="settings-page"
    >
      <Box className="flex flex-col gap-1">
        <Text size="lg" fw={700} lh={1.2}>
          Settings
        </Text>
        <Text size="sm" c="secondary">
          Broker connection and account integration controls.
        </Text>
      </Box>

      <Stack className="gap-4 items-stretch">
        <Paper className="border border-fin-border rounded-fin bg-fin-surface p-2">
          <div className="flex items-center justify-between px-2 py-1 border-b border-fin-border mb-2">
            <Text size="sm" fw={700}>
              Broker connections
            </Text>
          </div>
          <Stack className="gap-2">
            <BrokerConnectionCard
              status={status}
              loading={loading}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              onRefresh={fetchStatus}
            />
            <Divider className="my-2" />
            <BrokerConnectionCard
              broker="fyers"
              title="Fyers Connection"
              hint="Connect your Fyers account to enable Fyers order flow (5-level depth)"
              status={fyersStatus}
              loading={loading}
              onConnect={handleFyersConnect}
              onDisconnect={handleFyersDisconnect}
              onRefresh={fetchStatus}
            />
          </Stack>
        </Paper>

        <Paper className="border border-fin-border rounded-fin bg-fin-surface p-2">
          <div className="flex items-center justify-between px-2 py-1 border-b border-fin-border mb-2">
            <Text size="sm" fw={700}>
              Display
            </Text>
          </div>
          <ToolbarRow justify="space-between" gap={8}>
            <Box className="min-w-0">
              <Text size="sm" fw={600}>
                Market Ticker
              </Text>
              <Text size="xs" c="dimmed">
                Show live indices and commodities in the header (Nifty, Gold, USD/INR, etc.)
              </Text>
            </Box>
            <span className="relative inline-flex items-center gap-3 text-sm leading-none cursor-pointer select-none" onClick={(e) => { if (!(e.target instanceof HTMLInputElement)) setShowMarketTicker((v) => !v); }}>
              <input
                type="checkbox"
                role="switch"
                checked={showMarketTicker}
                onChange={(event) => setShowMarketTicker(event.currentTarget.checked)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  "relative inline-block shrink-0 flex items-center h-full rounded-full border border-fin-border bg-fin-surface transition-colors duration-200 h-5 w-9",
                  showMarketTicker ? "bg-fin-positive" : "",
                  "peer-checked:bg-fin-positive peer-focus-visible:ring-1 peer-focus-visible:ring-fin-primary"
                )}
                aria-hidden="true"
              >
                <span
                  className={cn(
                    "my-auto block rounded-full bg-fin-bg shadow-sm transition-transform duration-200 h-4 w-4",
                    showMarketTicker ? "ml-auto mr-1" : "ml-1 mr-1"
                  )}
                  aria-hidden="true"
                />
              </span>
            </span>
          </ToolbarRow>
          <Divider className="my-2" />
          <ToolbarRow justify="space-between" gap={8}>
            <Box className="min-w-0">
              <Text size="sm" fw={600}>
                Table density
              </Text>
              <Text size="xs" c="dimmed">
                Compact is the default dense layout; Comfortable adds row and card padding.
              </Text>
            </Box>
            <div
              role="radiogroup"
              aria-label="Table density"
              className="inline-flex rounded-fin border border-fin-border bg-fin-surface"
              data-testid="density-control"
            >
              {densityItems.map((item) => (
                <Button
                  key={item.value}
                  size="xs"
                  variant={density === item.value ? "filled" : "outline"}
                  color="primary"
                  onClick={() => setDensity(item.value as Density)}
                  aria-pressed={density === item.value}
                  aria-checked={density === item.value}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </ToolbarRow>
        </Paper>
      </Stack>
    </Box>
  );
}
