import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Center,
  Checkbox,
  Group,
  Loader,
  Popover,
  PopoverDropdown,
  PopoverTarget,
  SegmentedControl,
  Select,
  Stack,
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

/** Data-source brokers and their capability labels (single source of truth). */
export const BROKER_OPTIONS = [
  { value: "upstox", label: "Upstox · 5 lv" },
  { value: "fyers", label: "Fyers · 5 lv + orders" },
  { value: "fyers_tbt", label: "Fyers TBT · 50 lv" },
] as const;

export const DEFAULT_BROKER = "fyers_tbt";

/** Only the capability caveat — broker name lives in the select + source badge. */
export const BROKER_NOTES: Record<string, string> = {
  upstox: "5-level depth · no order counts",
  fyers: "5-level depth · order counts",
  fyers_tbt: "50-level depth · order counts",
};

/** Chart overlays / panels that can be toggled from the app toolbar. */
export const VIEW_ITEMS = [
  { key: "showVWAP", label: "VWAP" },
  { key: "showCVD", label: "CVD" },
  { key: "showVP", label: "Volume profile" },
  { key: "showHM", label: "Heatmap" },
  { key: "showBubbles", label: "Trade bubbles" },
  { key: "showWalls", label: "Liquidity walls" },
  { key: "l2", label: "L2 Depth panel" },
  { key: "book", label: "Book Analytics panel" },
  { key: "micro", label: "Microstructure panel" },
  { key: "tape", label: "Time & Sales panel" },
] as const;

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
  const [broker, setBroker] = useState<string>(DEFAULT_BROKER);
  // The Upstox OAuth gate only applies when Upstox is the selected feed.
  const needsUpstox = broker === "upstox";
  const [view, setView] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(VIEW_ITEMS.map((item) => [item.key, true])),
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const pushView = useCallback((key: string, value: boolean) => {
    iframeRef.current?.contentWindow?.postMessage({ type: "ofm-view", key, value }, "*");
  }, []);
  const syncView = useCallback(() => {
    VIEW_ITEMS.forEach((item) => pushView(item.key, view[item.key]));
  }, [pushView, view]);
  const toggleView = useCallback(
    (key: string, value: boolean) => {
      setView((v) => ({ ...v, [key]: value }));
      pushView(key, value);
    },
    [pushView],
  );

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
      // Only the Upstox feed depends on the OAuth session; adapters carry their own token.
      autoconnect: needsUpstox && !brokerConnected ? "0" : "1",
    });
    params.set("broker", broker);
    return `/orderflow/index.html?${params.toString()}`;
    // reloadKey forces the iframe to remount on reconnect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeUrl, activeSymbol, activeTick, brokerConnected, broker, needsUpstox, reloadKey]);

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
        <Popover>
          <PopoverTarget>
            <Button size="sm" variant="outline" data-testid="orderflow-view">
              View
            </Button>
          </PopoverTarget>
          <PopoverDropdown>
            <Stack gap={2} style={{ padding: 8, minWidth: 220 }}>
              {VIEW_ITEMS.map((item) => (
                <Checkbox
                  key={item.key}
                  size="sm"
                  label={item.label}
                  checked={view[item.key]}
                  onChange={(e) => toggleView(item.key, (e.target as HTMLInputElement).checked)}
                  data-testid={`orderflow-view-${item.key}`}
                />
              ))}
            </Stack>
          </PopoverDropdown>
        </Popover>
        <Select
          size="sm"
          w={170}
          data={[...BROKER_OPTIONS]}
          value={broker}
          onChange={(value) => setBroker(value ?? DEFAULT_BROKER)}
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
        <Text size="xs" c="dimmed" data-testid="orderflow-broker-note">
          {BROKER_NOTES[broker] ?? BROKER_NOTES[DEFAULT_BROKER]}
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

      {needsUpstox && brokerConnected === false && (
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
        {needsUpstox && brokerConnected === null ? (
          <Center>
            <Loader size="sm" />
          </Center>
        ) : (
          <iframe
            key={reloadKey}
            ref={iframeRef}
            onLoad={syncView}
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
