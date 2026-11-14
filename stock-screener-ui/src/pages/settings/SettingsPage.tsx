import { createSignal, createEffect, For } from "solid-js";
import { usePolling } from "@/hooks/usePolling";
import { Text, ToolbarRow, Divider, useDensity, type Density } from "@/ui";
import { cn } from "@/ui/cn";
import { useSearchParams } from "@solidjs/router";
import { BrokerConnectionCard } from "../../components/settings/BrokerConnectionCard";
import {
  getBrokerStatus,
  connectUpstox,
  disconnectUpstox,
  connectFyers,
  disconnectFyers,
  type BrokerStatus,
} from "../../api/brokers";
import { addNotification } from "../../state/store/notificationsSlice";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { subscribeToHolidays, isMarketClosedToday } from "../../state/holidays";

// Inline Solid twin of src/hooks/useMarketTickerEnabled (which is still React).
// v2: the v1 key was written automatically with its opt-in default on first
// mount, so every existing profile looked like a deliberate opt-out.
const MARKET_TICKER_KEY = "alphashri_show_market_ticker_v2";

function loadStoredMarketTicker(): boolean {
  try {
    const stored = localStorage.getItem(MARKET_TICKER_KEY);
    return stored ? (JSON.parse(stored) as boolean) : true;
  } catch {
    return true;
  }
}

export function SettingsPage() {
  useStoreSubscription(subscribeToHolidays);
  const [status, setStatus] = createSignal<BrokerStatus | null>(null);
  const [fyersStatus, setFyersStatus] = createSignal<BrokerStatus | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [showMarketTicker, setShowMarketTicker] = createSignal(loadStoredMarketTicker());
  const { density, setDensity } = useDensity();

  createEffect(() => {
    try {
      localStorage.setItem(MARKET_TICKER_KEY, JSON.stringify(showMarketTicker()));
    } catch {
      // Storage unavailable — preference still applies for this session.
    }
  });

  const fetchStatus = async () => {
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
  };

  createEffect(() => {
    void fetchStatus();
  });
  usePolling(
    () => {
      if (isMarketClosedToday()) return;
      void fetchStatus();
    },
    60000,
    { skipIfRunning: false },
  );

  createEffect(() => {
    const connected = searchParams.upstox === "connected";
    const fyersConnected = searchParams.fyers === "connected";
    if (connected) {
      addNotification({
        type: "success",
        message: "Upstox connected successfully!",
        duration: 5000,
      });
    }
    if (fyersConnected) {
      addNotification({
        type: "success",
        message: "Fyers connected successfully!",
        duration: 5000,
      });
    }
    if (connected || fyersConnected) {
      setSearchParams({ upstox: null, fyers: null });
      void fetchStatus();
    }
  });

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
      addNotification({
        type: "success",
        message: "Fyers disconnected successfully",
        duration: 5000,
      });
      await fetchStatus();
    } catch {
      addNotification({
        type: "error",
        message: "Failed to disconnect Fyers",
        duration: 5000,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      await disconnectUpstox();
      addNotification({
        type: "success",
        message: "Upstox disconnected successfully",
        duration: 5000,
      });
      await fetchStatus();
    } catch {
      addNotification({
        type: "error",
        message: "Failed to disconnect Upstox",
        duration: 5000,
      });
    } finally {
      setLoading(false);
    }
  };

  const densityItems = [
    { value: "compact", label: "Compact" },
    { value: "comfortable", label: "Comfortable" },
  ];

  return (
    <div
      id="settings-page"
      class="settings-page h-full min-h-0 overflow-auto flex flex-col items-stretch"
      data-testid="settings-page"
      style={{ padding: "8px", gap: "4px" }}
    >
      <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1 pb-1 border-b border-fin-border">
        <Text size="lg" fw={700} lh={1.2}>
          Settings
        </Text>
        <Text size="xs" c="secondary">
          Broker connection and account integration controls.
        </Text>
      </div>

      {/* Form sections are flat: an outer card around a card was two borders for one grouping. */}
      <div class="flex items-center gap-2 pt-1">
        <Text size="xs" fw={700} c="dimmed" className="uppercase tracking-[0.06em]">
          Broker connections
        </Text>
      </div>
      <BrokerConnectionCard
        status={status()}
        loading={loading()}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onRefresh={fetchStatus}
      />
      <Divider />
      <BrokerConnectionCard
        broker="fyers"
        title="Fyers Connection"
        hint="Connect your Fyers account to enable Fyers order flow (5-level depth)"
        status={fyersStatus()}
        loading={loading()}
        onConnect={handleFyersConnect}
        onDisconnect={handleFyersDisconnect}
        onRefresh={fetchStatus}
      />

      <Divider />

      <div class="flex items-center gap-2 pt-1">
        <Text size="xs" fw={700} c="dimmed" className="uppercase tracking-[0.06em]">
          Display
        </Text>
      </div>
      <ToolbarRow justify="space-between" gap={8}>
        <div class="min-w-0">
          <Text size="sm" fw={600}>
            Market Ticker
          </Text>
          <Text size="xs" c="dimmed">
            Show live indices and commodities in the header (Nifty, Gold, USD/INR, etc.)
          </Text>
        </div>
        <span
          class="relative inline-flex items-center gap-2 text-sm leading-none cursor-pointer select-none"
          data-testid="market-ticker-toggle"
          onClick={(e) => {
            if (!(e.target instanceof HTMLInputElement)) setShowMarketTicker((v) => !v);
          }}
        >
          <input
            type="checkbox"
            role="switch"
            checked={showMarketTicker()}
            onInput={(event) => setShowMarketTicker(event.currentTarget.checked)}
            class="peer sr-only"
          />
          <span
            class={cn(
              "relative inline-block shrink-0 flex items-center rounded-full border border-fin-border bg-fin-surface transition-colors duration-200 h-5 w-9",
              showMarketTicker() ? "bg-fin-positive" : "",
              "peer-checked:bg-fin-positive peer-focus-visible:ring-1 peer-focus-visible:ring-fin-primary",
            )}
            aria-hidden="true"
          >
            <span
              class={cn(
                "my-auto block rounded-full bg-fin-bg shadow-sm transition-transform duration-200 h-4 w-4",
                showMarketTicker() ? "ml-auto mr-1" : "ml-1 mr-1",
              )}
              aria-hidden="true"
            />
          </span>
        </span>
      </ToolbarRow>
      <Divider />
      <ToolbarRow justify="space-between" gap={8}>
        <div class="min-w-0">
          <Text size="sm" fw={600}>
            Table density
          </Text>
          <Text size="xs" c="dimmed">
            Compact is the default dense layout; Comfortable adds row and card padding.
          </Text>
        </div>
        <div
          role="radiogroup"
          aria-label="Table density"
          class="inline-flex rounded-fin border border-fin-border bg-fin-surface"
          data-testid="density-control"
        >
          <For each={densityItems}>
            {(item) => (
              // Plain button: @/ui Button drops aria-* props, and the
              // density control's aria-pressed/aria-checked contract is
              // asserted by tests and E2E.
              <button
                type="button"
                class={cn(
                  "px-2 h-5 text-[11px] leading-none rounded-sm transition-colors duration-150 border",
                  density() === item.value
                    ? "bg-fin-primary text-fin-bg border-fin-primary"
                    : "bg-transparent text-fin-primary border-fin-primary",
                )}
                onClick={() => setDensity(item.value as Density)}
                aria-pressed={density() === item.value}
                aria-checked={density() === item.value}
              >
                {item.label}
              </button>
            )}
          </For>
        </div>
      </ToolbarRow>
    </div>
  );
}
