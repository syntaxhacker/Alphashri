import { useEffect, useState, useCallback } from "react";
import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import TableContainer from "@mui/material/TableContainer";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { Switch, Text } from "@/ui";
import { useSearchParams } from "react-router-dom";
import { BrokerConnectionCard } from "../../components/settings/BrokerConnectionCard";
import {
  getBrokerStatus,
  connectUpstox,
  disconnectUpstox,
  type BrokerStatus,
} from "../../api/brokers";
import { useAppDispatch } from "../../state/store/hooks";
import { addNotification } from "../../state/store/notificationsSlice";
import { CompactPage } from "../../components/common/compact";
import { useMarketTickerEnabled } from "../../hooks/useMarketTickerEnabled";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { subscribeToHolidays, isMarketClosedToday } from "../../state/holidays";

export function SettingsPage() {
  useStoreSubscription(subscribeToHolidays);
  const [status, setStatus] = useState<BrokerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const dispatch = useAppDispatch();
  const [showMarketTicker, setShowMarketTicker] = useMarketTickerEnabled();

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getBrokerStatus();
      setStatus(data);
    } catch (error) {
      console.error("Failed to fetch broker status:", error);
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
    if (searchParams.get("upstox") === "connected") {
      dispatch(
        addNotification({
          type: "success",
          message: "Upstox connected successfully!",
          duration: 5000,
        }),
      );
      setSearchParams({});
      fetchStatus();
    }
  }, [searchParams, dispatch, setSearchParams, fetchStatus]);

  const handleConnect = () => {
    connectUpstox();
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
      sx={{ py: 1, height: "100%", overflow: "auto", display: "flex", justifyContent: "center", width: "100%" }}
    >
      <Grid container spacing={1} sx={{ justifyContent: "center", alignItems: "flex-start", width: "100%", maxWidth: 900, mx: "auto" }}>
        <Grid size={{ xs: 12 }} sx={{ display: "flex", justifyContent: "center" }}>
          <Card elevation={1} sx={{ width: "100%" }}>
            <CardContent sx={{ p: 1, "&:last-child": { pb: 1 } }}>
              <TableContainer component={Paper} elevation={1}>
                <CompactPage title="Settings" description="Broker connection and account integration controls.">
                  <Stack spacing={1} sx={{ alignItems: "center", width: "100%" }}>
                    <Box sx={{ width: "100%", display: "flex", justifyContent: "center" }}>
                      <BrokerConnectionCard
                        status={status}
                        loading={loading}
                        onConnect={handleConnect}
                        onDisconnect={handleDisconnect}
                        onRefresh={fetchStatus}
                      />
                    </Box>

                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
                      <Box component="span" sx={{ minWidth: 80, fontSize: "0.75rem", color: "text.secondary", textAlign: "center", flexShrink: 0 }}>
                        Market Ticker
                      </Box>
                      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1 }}>
                        <Text size="xs" c="dimmed" sx={{ textAlign: "center" }}>
                          Show live indices and commodities in the header (Nifty, Gold, USD/INR, etc.)
                        </Text>
                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
                          <Switch
                            size="sm"
                            checked={showMarketTicker}
                            onChange={(event) => setShowMarketTicker(event.currentTarget.checked)}
                          />
                        </Box>
                      </Box>
                    </Box>
                  </Stack>
                </CompactPage>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
