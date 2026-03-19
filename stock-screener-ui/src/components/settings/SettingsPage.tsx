import { useEffect, useState, useCallback } from "react";
import { Box, Stack } from "@mantine/core";
import { useSearchParams } from "react-router-dom";
import { BrokerConnectionCard } from "./BrokerConnectionCard";
import {
  getBrokerStatus,
  connectUpstox,
  disconnectUpstox,
  type BrokerStatus,
} from "../../api/brokers";
import { useAppDispatch } from "../../store/hooks";
import { addNotification } from "../../store/notificationsSlice";
import { CompactPage } from "../common/compact";

export function SettingsPage() {
  const [status, setStatus] = useState<BrokerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const dispatch = useAppDispatch();

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
    const interval = setInterval(fetchStatus, 60000);
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
    } catch (error) {
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
      style={{ height: "100%", overflow: "hidden" }}
    >
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
        </Stack>
      </CompactPage>
    </Box>
  );
}
