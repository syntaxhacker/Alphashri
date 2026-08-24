import { useEffect, useState, useCallback } from "react";
import Container from "@mui/material/Container";
import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import TableContainer from "@mui/material/TableContainer";
import { Box, Stack, Switch, Text } from "@/ui";
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
    <Container
      maxWidth="xl"
      id="settings-page"
      className="settings-page"
      data-testid="settings-page"
      sx={{ py: 2, height: "100%", overflow: "auto" }}
    >
      <Grid container spacing={2}>
        <Grid size={{ xs: 12 }}>
          <Card elevation={1}>
            <CardContent>
              <TableContainer>
                <CompactPage
                  title="Settings"
                  description="Broker connection and account integration controls."
                >
                  <Stack gap="md">
                    <BrokerConnectionCard
                      status={status}
                      loading={loading}
                      onConnect={handleConnect}
                      onDisconnect={handleDisconnect}
                      onRefresh={fetchStatus}
                    />

                    <Box>
                      <Text size="sm" fw={500}>
                        Market Ticker
                      </Text>
                      <Text size="xs" c="dimmed" mb="xs">
                        Show live indices and commodities in the header (Nifty, Gold, USD/INR, etc.)
                      </Text>
                      <Switch
                        size="sm"
                        checked={showMarketTicker}
                        onChange={(event) => setShowMarketTicker(event.currentTarget.checked)}
                      />
                    </Box>
                  </Stack>
                </CompactPage>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}
