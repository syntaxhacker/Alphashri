import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Center,
  Checkbox,
  Group,
  Loader,
  Modal,
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
import { listJournalFiles, type JournalFile } from "@/api/orderflowJournal";
import {
  getExpiries,
  getFyersSymbol,
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

type Mode = "manual" | "options" | "replay";
type OptionType = "CE" | "PE";

/** Data-source brokers and their capability labels (single source of truth). */
export const BROKER_OPTIONS = [
  { value: "upstox", label: "Upstox · 5 lv" },
  { value: "fyers", label: "Fyers · 5 lv + orders" },
  { value: "fyers_tbt", label: "Fyers TBT · 50 lv" },
] as const;

export const DEFAULT_BROKER = "fyers_tbt";

/** Human names for dialogs and notes. */
export const BROKER_LABELS: Record<string, string> = {
  upstox: "Upstox",
  fyers: "Fyers",
  fyers_tbt: "Fyers TBT",
};

/** Message the embedded visualizer posts when the broker rejects our session. */
export const AUTH_ERROR_MESSAGE = "ofm-auth-error";

export interface AuthError {
  broker: string;
  message: string;
}

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
  const [authError, setAuthError] = useState<AuthError | null>(null);
  const navigate = useNavigate();
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
  // Replay: the stored journals to choose from, and the chosen one.
  const [journalFiles, setJournalFiles] = useState<JournalFile[]>([]);
  const [replayDay, setReplayDay] = useState<string | null>(null);
  const [replayFile, setReplayFile] = useState<string | null>(null);
  // `replayDraft` is what the inputs hold; `replayRange` is what was actually
  // applied. Keeping them apart stops the iframe navigating on every keystroke,
  // which fired loads for half-typed times ("1", "15") that the API rejects.
  const [replayDraft, setReplayDraft] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [replayRange, setReplayRange] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [replayError, setReplayError] = useState<string | null>(null);
  const [journalError, setJournalError] = useState<string | null>(null);
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

  // The embedded visualizer reports broker rejections (expired/revoked session)
  // so we can offer a route to the broker settings instead of leaving a blank
  // chart with a status code in the log.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; broker?: string; message?: string } | null;
      if (!data || data.type !== AUTH_ERROR_MESSAGE) return;
      setAuthError({
        broker: data.broker || broker,
        message: typeof data.message === "string" ? data.message : "",
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [broker]);

  // Fetch the stored-file list lazily, only when Replay is opened — the live
  // modes never touch the journal.
  useEffect(() => {
    if (mode !== "replay" || journalFiles.length > 0) return;
    let alive = true;
    listJournalFiles()
      .then((files) => {
        if (!alive) return;
        setJournalFiles(files);
        setJournalError(null);
        if (files.length > 0) {
          setReplayFile((current) => current ?? files[0].file);
          setReplayDay((current) => current ?? files[0].day);
        }
      })
      .catch((err) => {
        if (alive) setJournalError(err instanceof Error ? err.message : "Failed to list journals");
      });
    return () => {
      alive = false;
    };
  }, [mode, journalFiles.length]);

  const replayDays = useMemo(
    () => Array.from(new Set(journalFiles.map((f) => f.day))).sort().reverse(),
    [journalFiles],
  );
  const replayFilesForDay = useMemo(
    () => journalFiles.filter((f) => !replayDay || f.day === replayDay),
    [journalFiles, replayDay],
  );

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

  const useContract = useCallback(async () => {
    if (!selectedContract) return;
    const tick = String(selectedContract.tick_size ?? 0.05);
    // The Upstox instrument key streams as-is on the Upstox feed, but the
    // Fyers feeds can never resolve it — resolve the Fyers-native contract
    // symbol first so "Use contract" never connects a dead feed.
    if (broker !== "fyers" && broker !== "fyers_tbt") {
      connectWith(selectedContract.instrument_key, tick);
      return;
    }
    if (!underlying || !expiry || strike == null) {
      setOptionsError("Pick an underlying, expiry and strike first.");
      return;
    }
    const leg = `${underlying} ${strike} ${optionType} @ ${expiry}`;
    beginLoad();
    try {
      const resolved = await getFyersSymbol(underlying, expiry, strike, optionType);
      connectWith(resolved.symbol, tick);
    } catch {
      setOptionsError(
        `Could not find ${leg} on Fyers — the Upstox contract key cannot stream on the Fyers feed. Retry, or switch the broker to Upstox.`,
      );
    } finally {
      endLoad();
    }
  }, [selectedContract, connectWith, broker, underlying, expiry, strike, optionType, beginLoad, endLoad]);

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

  const activeJournal = useMemo(
    () => journalFiles.find((f) => f.file === replayFile) ?? null,
    [journalFiles, replayFile],
  );

  // Accept 9:5, 09:05, 0905, 09.05 — reject anything else loudly instead of
  // sending the API a value it answers with a bare 400.
  const applyReplayRange = useCallback(() => {
    const norm = (raw: string): string | null => {
      const text = raw.trim();
      if (!text) return "";
      const compact = text.replace(/[^0-9]/g, "");
      let hour: number;
      let minute: number;
      if (/^[0-9]{1,2}[:.][0-9]{1,2}$/.test(text)) {
        const [h, m] = text.split(/[:.]/);
        hour = Number(h);
        minute = Number(m);
      } else if (/^[0-9]{3,4}$/.test(compact)) {
        hour = Number(compact.slice(0, compact.length - 2));
        minute = Number(compact.slice(-2));
      } else {
        return null;
      }
      if (hour > 23 || minute > 59) return null;
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    };

    const from = norm(replayDraft.from);
    const to = norm(replayDraft.to);
    if (from === null || to === null) {
      setReplayError("Times must be HH:MM (e.g. 09:15).");
      return;
    }
    if (from && to && from >= to) {
      setReplayError("From must be earlier than To.");
      return;
    }
    setReplayError(null);
    setReplayRange({ from, to });
    setReloadKey((k) => k + 1);
  }, [replayDraft]);

  const src = useMemo(() => {
    // Replay is a separate branch in the visualiser: it opens no socket, so
    // autoconnect must never be set here.
    if (mode === "replay" && activeJournal) {
      const params = new URLSearchParams({
        ws: bridgeUrl,
        replay: "1",
        symbol: activeJournal.symbol,
        day: activeJournal.day,
        broker: activeJournal.broker,
      });
      if (replayRange.from) params.set("start", replayRange.from);
      if (replayRange.to) params.set("end", replayRange.to);
      return `/orderflow/index.html?${params.toString()}`;
    }
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
  }, [
    bridgeUrl, activeSymbol, activeTick, brokerConnected, broker, needsUpstox,
    reloadKey, mode, activeJournal, replayRange,
  ]);

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
            { value: "replay", label: "Replay" },
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

      {mode === "replay" && (
        <ToolbarRow
          gap={8}
          style={{ padding: "8px 16px", borderBottom: "1px solid var(--mui-palette-divider)" }}
          data-testid="orderflow-replay-row"
        >
          <Select
            size="sm"
            w={130}
            label="Day"
            data={replayDays.map((d) => ({ value: d, label: d }))}
            value={replayDay}
            onChange={(value) => {
              setReplayDay(value);
              const first = journalFiles.find((f) => f.day === value);
              setReplayFile(first ? first.file : null);
            }}
            data-testid="orderflow-replay-day"
          />
          <Select
            size="sm"
            w={230}
            label="File"
            data={replayFilesForDay.map((f) => ({
              value: f.file,
              label: `${f.symbol} · ${f.broker} · ${(f.bytes / 1048576).toFixed(1)} MB`,
            }))}
            value={replayFile}
            onChange={setReplayFile}
            data-testid="orderflow-replay-file"
          />
          <TextInput
            size="sm"
            w={90}
            label="From"
            placeholder="09:15"
            value={replayDraft.from}
            onChange={(v) => setReplayDraft((r) => ({ ...r, from: v }))}
            data-testid="orderflow-replay-from"
          />
          <TextInput
            size="sm"
            w={90}
            label="To"
            placeholder="15:15"
            value={replayDraft.to}
            onChange={(v) => setReplayDraft((r) => ({ ...r, to: v }))}
            data-testid="orderflow-replay-to"
          />
          <Button
            size="sm"
            variant="filled"
            onClick={applyReplayRange}
            disabled={!replayFile}
            data-testid="orderflow-replay-load"
          >
            Load
          </Button>
          {(journalError || replayError) && (
            <Text size="xs" c="red" data-testid="orderflow-replay-error">
              {journalError ?? replayError}
            </Text>
          )}
          <Text size="xs" c="dimmed">
            Loads stored data only — no live stream is opened.
          </Text>
        </ToolbarRow>
      )}

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

      <Modal
        opened={authError !== null}
        onClose={() => setAuthError(null)}
        title={`${BROKER_LABELS[authError?.broker ?? broker] ?? authError?.broker ?? "Broker"} session expired`}
        size="sm"
        centered
        data-testid="orderflow-auth-error-modal"
      >
        <Stack spacing={1}>
          <Text size="sm">
            <b>{BROKER_LABELS[authError?.broker ?? broker] ?? authError?.broker}</b> rejected the live
            order-flow feed because the session token is no longer valid. Broker sessions expire
            daily and must be re-authenticated.
          </Text>
          <Text size="sm" c="dimmed">
            Reconnect the broker, then retry — the feed subscribes with the fresh session, so no
            restart is needed for this tab.
          </Text>
          {authError?.message && (
            <Text size="xs" c="dimmed" data-testid="orderflow-auth-error-detail">
              {authError.message}
            </Text>
          )}
          <Group gap={8} align="center">
            <Button
              size="sm"
              variant="filled"
              color="success"
              onClick={() => {
                setAuthError(null);
                navigate("/settings");
              }}
              data-testid="orderflow-auth-error-settings"
            >
              Open broker settings
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setAuthError(null);
                setReloadKey((k) => k + 1);
              }}
              data-testid="orderflow-auth-error-retry"
            >
              Retry
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
