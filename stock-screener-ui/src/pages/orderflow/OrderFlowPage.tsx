import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Center, Group, Loader, Text, TextInput, ToolbarRow } from "@/ui";
import { connectUpstox, getBrokerStatus } from "@/api/brokers";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

/**
 * Derive the Order Flow bridge WebSocket URL from the API base, so the iframe
 * streams from the same backend the rest of the app talks to.
 */
function resolveBridgeWsUrl(): string {
  try {
    const url = new URL(API_BASE);
    const proto = url.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${url.host}/ws/orderflow`;
  } catch {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws/orderflow`;
  }
}

export function OrderFlowPage() {
  const [symbolInput, setSymbolInput] = useState("RELIANCE");
  const [activeSymbol, setActiveSymbol] = useState("RELIANCE");
  const [tickInput, setTickInput] = useState("0.05");
  const [activeTick, setActiveTick] = useState("0.05");
  const [reloadKey, setReloadKey] = useState(0);
  const [brokerConnected, setBrokerConnected] = useState<boolean | null>(null);

  const bridgeUrl = useMemo(resolveBridgeWsUrl, []);

  useEffect(() => {
    let alive = true;
    getBrokerStatus()
      .then((status) => {
        if (alive) setBrokerConnected(status.connected);
      })
      .catch(() => {
        if (alive) setBrokerConnected(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const refreshBrokerStatus = useCallback(() => {
    setBrokerConnected(null);
    getBrokerStatus()
      .then((status) => setBrokerConnected(status.connected))
      .catch(() => setBrokerConnected(false));
  }, []);

  const src = useMemo(() => {
    const params = new URLSearchParams({
      ws: bridgeUrl,
      symbol: activeSymbol,
      tick: activeTick,
      autoconnect: brokerConnected ? "1" : "0",
    });
    return `/orderflow/index.html?${params.toString()}`;
    // reloadKey forces the iframe to remount on reconnect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeUrl, activeSymbol, activeTick, brokerConnected, reloadKey]);

  const connect = useCallback(() => {
    const next = symbolInput.trim().toUpperCase();
    if (!next) return;
    setActiveSymbol(next);
    setActiveTick(tickInput.trim() || "0.05");
    setReloadKey((k) => k + 1);
  }, [symbolInput, tickInput]);

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }} data-testid="orderflow-page">
      <ToolbarRow
        gap={8}
        style={{ padding: "8px 16px", borderBottom: "1px solid var(--mui-palette-divider)" }}
        data-testid="orderflow-toolbar"
      >
        <Text size="sm" fw={600}>
          Order Flow
        </Text>
        <TextInput
          size="sm"
          w={180}
          placeholder="Symbol (e.g. RELIANCE)"
          value={symbolInput}
          onChange={setSymbolInput}
          onKeyDown={(e) => {
            if ((e as React.KeyboardEvent).key === "Enter") connect();
          }}
          data-testid="orderflow-symbol"
        />
        <TextInput
          size="sm"
          w={110}
          placeholder="Tick"
          value={tickInput}
          onChange={setTickInput}
          data-testid="orderflow-tick"
        />
        <Button size="sm" variant="filled" onClick={connect} data-testid="orderflow-connect">
          Connect
        </Button>
        <Text size="xs" c="dimmed">
          Live via Upstox · 5-level depth · order counts unavailable
        </Text>
      </ToolbarRow>

      {brokerConnected === false && (
        <Box sx={{ px: 2, pt: 1 }} data-testid="orderflow-broker-warning">
          <Alert color="warning" variant="light">
            <Group gap={8} align="center" wrap>
              <Text size="sm">Upstox is not connected. Connect the broker to stream live order flow.</Text>
              <Button size="sm" variant="filled" color="success" onClick={connectUpstox} data-testid="orderflow-connect-broker">
                Connect Upstox
              </Button>
              <Button size="sm" variant="outline" onClick={refreshBrokerStatus} data-testid="orderflow-refresh-broker">
                I&apos;ve connected — refresh
              </Button>
            </Group>
          </Alert>
        </Box>
      )}

      <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
        {brokerConnected === null ? (
          <Center>
            <Loader size="sm" />
          </Center>
        ) : (
          <iframe
            key={reloadKey}
            title="Order Flow Map"
            src={src}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
            data-testid="orderflow-iframe"
          />
        )}
      </Box>
    </Box>
  );
}
