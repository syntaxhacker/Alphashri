import { useEffect, useState, useCallback } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { Divider, Switch, Text, ToolbarRow, SegmentedControl, useDensity, type Density } from "@/ui";
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
import { CompactPanel } from "../../components/common/compact";
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
    const interval = setInterval(() => {
      if (isMarketClosedToday()) return;
      fetchStatus();
    }, 60000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

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

  return (
    <Box
      id="settings-page"
      className="settings-page"
      data-testid="settings-page"
      sx={{
        height: "100%",
        minHeight: 0,
        overflow: "auto",
        p: 2,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        alignItems: "stretch",
      }}
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
        <Typography variant="h5" fontWeight={700} sx={{ lineHeight: 1.2 }}>
          Settings
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Broker connection and account integration controls.
        </Typography>
      </Box>

      <Stack spacing={2} sx={{ alignItems: "stretch" }}>
        <CompactPanel title="Broker connections">
          <Stack spacing={1}>
            <BrokerConnectionCard
              status={status}
              loading={loading}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              onRefresh={fetchStatus}
            />
            <Divider />
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
        </CompactPanel>

        <CompactPanel title="Display">
          <ToolbarRow justify="space-between" gap={8}>
            <Box sx={{ minWidth: 0 }}>
              <Text size="sm" fw={600}>
                Market Ticker
              </Text>
              <Text size="xs" c="dimmed">
                Show live indices and commodities in the header (Nifty, Gold, USD/INR, etc.)
              </Text>
            </Box>
            <Switch
              size="sm"
              checked={showMarketTicker}
              onChange={(event) => setShowMarketTicker(event.currentTarget.checked)}
            />
          </ToolbarRow>
          <Divider />
          <ToolbarRow justify="space-between" gap={8}>
            <Box sx={{ minWidth: 0 }}>
              <Text size="sm" fw={600}>
                Table density
              </Text>
              <Text size="xs" c="dimmed">
                Compact is the default dense layout; Comfortable adds row and card padding.
              </Text>
            </Box>
            <SegmentedControl
              size="xs"
              value={density}
              onChange={(value) => setDensity(value as Density)}
              data={[
                { value: "compact", label: "Compact" },
                { value: "comfortable", label: "Comfortable" },
              ]}
              data-testid="density-control"
            />
          </ToolbarRow>
        </CompactPanel>
      </Stack>
    </Box>
  );
}
