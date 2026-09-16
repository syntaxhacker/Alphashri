import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Center,
  Group,
  Loader,
  SegmentedControl,
  Select,
  Text,
  TextInput,
  ToolbarRow,
} from "@/ui";
import { connectUpstox, getBrokerStatus } from "@/api/brokers";
import {
  getExpiries,
  getOptionChain,
  getUnderlyings,
  type Expiry,
  type OptionChainResponse,
  type Underlying,
} from "@/api/upstoxOptions";

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

type Mode = "manual" | "options";
type OptionType = "CE" | "PE";

function nearestStrike(strikes: number[], spot: number | null | undefined): number | null {
  if (strikes.length === 0) return null;
  const target = typeof spot === "number" && Number.isFinite(spot) ? spot : strikes[Math.floor(strikes.length / 2)];
  return strikes.reduce((best, value) => (Math.abs(value - target) < Math.abs(best - target) ? value : best));
}

export function OrderFlowPage() {
  const [symbolInput, setSymbolInput] = useState("RELIANCE");
  const [activeSymbol, setActiveSymbol] = useState("RELIANCE");
  const [tickInput, setTickInput] = useState("0.05");
  const [activeTick, setActiveTick] = useState("0.05");
  const [reloadKey, setReloadKey] = useState(0);
  const [brokerConnected, setBrokerConnected] = useState<boolean | null>(null);
  const [broker, setBroker] = useState<string>("auto");

  const [mode, setMode] = useState<Mode>("manual");
  const [underlyings, setUnderlyings] = useState<Underlying[]>([]);
  const [underlying, setUnderlying] = useState<string | null>(null);
  const [expiries, setExpiries] = useState<Expiry[]>([]);
  const [expiry, setExpiry] = useState<string | null>(null);
  const [chain, setChain] = useState<OptionChainResponse | null>(null);
  const [strike, setStrike] = useState<number | null>(null);
  const [optionType, setOptionType] = useState<OptionType>("CE");
  const [loadingCount, setLoadingCount] = useState(0);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const bridgeUrl = useMemo(resolveBridgeWsUrl, []);
  const optionsLoading = loadingCount > 0;

  const beginLoad = useCallback(() => {
    setLoadingCount((n) => n + 1);
    setOptionsError(null);
  }, []);

  const endLoad = useCallback(() => {
    setLoadingCount((n) => (n > 0 ? n - 1 : 0));
  }, []);

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

  useEffect(() => {
    if (mode !== "options" || underlyings.length > 0) return;
    let alive = true;
    beginLoad();
    getUnderlyings()
      .then((data) => {
        if (!alive) return;
        setUnderlyings(data);
        if (data.length > 0) setUnderlying((prev) => prev ?? data[0].symbol);
      })
      .catch(() => {
        if (alive) setOptionsError("Failed to load underlyings");
      })
      .finally(() => {
        if (alive) endLoad();
      });
    return () => {
      alive = false;
    };
  }, [mode, underlyings.length, beginLoad, endLoad]);

  const chooseUnderlying = useCallback((value: string | null) => {
    setUnderlying(value);
    setExpiries([]);
    setExpiry(null);
    setChain(null);
    setStrike(null);
  }, []);

  useEffect(() => {
    if (!underlying) return;
    let alive = true;
    beginLoad();
    getExpiries(underlying)
      .then((data) => {
        if (!alive) return;
        setExpiries(data);
        setExpiry(data.length > 0 ? data[0].date : null);
      })
      .catch(() => {
        if (alive) setOptionsError("Failed to load expiries");
      })
      .finally(() => {
        if (alive) endLoad();
      });
    return () => {
      alive = false;
    };
  }, [underlying, beginLoad, endLoad]);

  useEffect(() => {
    if (!underlying || !expiry) return;
    let alive = true;
    beginLoad();
    getOptionChain(underlying, expiry)
      .then((data) => {
        if (!alive) return;
        setChain(data);
        setStrike(nearestStrike(data.chain.map((row) => row.strike), data.spot));
      })
      .catch(() => {
        if (alive) setOptionsError("Failed to load option chain");
      })
      .finally(() => {
        if (alive) endLoad();
      });
    return () => {
      alive = false;
    };
  }, [underlying, expiry, beginLoad, endLoad]);

  const selectedContract = useMemo(() => {
    if (!chain || strike == null) return null;
    const row = chain.chain.find((entry) => entry.strike === strike);
    if (!row) return null;
    return optionType === "CE" ? row.ce : row.pe;
  }, [chain, strike, optionType]);

  const connectWith = useCallback((symbol: string, tick: string) => {
    const nextSymbol = symbol.trim().toUpperCase();
    if (!nextSymbol) return;
    const nextTick = tick.trim() || "0.05";
    setSymbolInput(nextSymbol);
    setTickInput(nextTick);
    setActiveSymbol(nextSymbol);
    setActiveTick(nextTick);
    setReloadKey((k) => k + 1);
  }, []);

  const connect = useCallback(() => {
    connectWith(symbolInput, tickInput);
  }, [symbolInput, tickInput, connectWith]);

  const useContract = useCallback(() => {
    if (!selectedContract) return;
    connectWith(selectedContract.instrument_key, String(selectedContract.tick_size ?? 0.05));
  }, [selectedContract, connectWith]);

  const underlyingOptions = useMemo(
    () => underlyings.map((item) => ({ value: item.symbol, label: item.name || item.symbol })),
    [underlyings],
  );
  const expiryOptions = useMemo(
    () => expiries.map((item) => ({ value: item.date, label: item.date })),
    [expiries],
  );
  const strikeOptions = useMemo(
    () => (chain ? chain.chain.map((row) => ({ value: String(row.strike), label: String(row.strike) })) : []),
    [chain],
  );

  const src = useMemo(() => {
    const params = new URLSearchParams({
      ws: bridgeUrl,
      symbol: activeSymbol,
      tick: activeTick,
      autoconnect: brokerConnected ? "1" : "0",
    });
    if (broker !== "auto") params.set("broker", broker);
    return `/orderflow/index.html?${params.toString()}`;
    // reloadKey forces the iframe to remount on reconnect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeUrl, activeSymbol, activeTick, brokerConnected, broker, reloadKey]);

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
        <SegmentedControl
          size="sm"
          data={[
            { value: "manual", label: "Manual" },
            { value: "options", label: "Options" },
          ]}
          value={mode}
          onChange={(value) => setMode(value as Mode)}
          data-testid="orderflow-mode"
        />
        <Select
          size="sm"
          w={150}
          data={[
            { value: "auto", label: "Auto broker" },
            { value: "upstox", label: "Upstox (5)" },
            { value: "fyers", label: "Fyers (5+ord)" },
            { value: "fyers_tbt", label: "Fyers TBT (50)" },
          ]}
          value={broker}
          onChange={(value) => setBroker(value ?? "auto")}
          data-testid="orderflow-broker"
        />
        {mode === "manual" && (
          <>
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
          </>
        )}
        <Text size="xs" c="dimmed">
          Live via Upstox · 5-level depth · order counts unavailable
        </Text>
      </ToolbarRow>

      {mode === "options" && (
        <ToolbarRow
          gap={8}
          style={{ padding: "8px 16px", borderBottom: "1px solid var(--mui-palette-divider)" }}
          data-testid="orderflow-options-row"
        >
          <Select
            size="sm"
            w={180}
            placeholder="Underlying"
            data={underlyingOptions}
            value={underlying}
            onChange={chooseUnderlying}
            data-testid="orderflow-underlying"
          />
          <Select
            size="sm"
            w={150}
            placeholder="Expiry"
            data={expiryOptions}
            value={expiry}
            onChange={setExpiry}
            data-testid="orderflow-expiry"
          />
          <Select
            size="sm"
            w={130}
            placeholder="Strike"
            data={strikeOptions}
            value={strike == null ? null : String(strike)}
            onChange={(value) => setStrike(value == null ? null : Number(value))}
            data-testid="orderflow-strike"
          />
          <SegmentedControl
            size="sm"
            data={[
              { value: "CE", label: "CE" },
              { value: "PE", label: "PE" },
            ]}
            value={optionType}
            onChange={(value) => setOptionType(value as OptionType)}
            data-testid="orderflow-option-type"
          />
          <Button
            size="sm"
            variant="filled"
            disabled={!selectedContract}
            onClick={useContract}
            data-testid="orderflow-use-contract"
          >
            Use contract
          </Button>
          {optionsLoading && <Loader size="xs" data-testid="orderflow-options-loading" />}
        </ToolbarRow>
      )}

      {mode === "options" && optionsError && (
        <Box sx={{ px: 2, pt: 1 }}>
          <Alert color="error" variant="light" data-testid="orderflow-options-error">
            {optionsError}
          </Alert>
        </Box>
      )}

      {brokerConnected === false && (
        <Box sx={{ px: 2, pt: 1 }} data-testid="orderflow-broker-warning">
          <Alert color="warning" variant="light">
            <Group gap={8} align="center" wrap="wrap">
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
