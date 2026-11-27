import { Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import { Anchor, Box, Button, Text, TextInput, ToolbarRow } from "@/ui";
import { DEFAULT_RATE_LIMIT_RETRY_MS } from "@/state/optionsDock";
import { OptionDockError, type ChainRow } from "@/api/optionsDock";
import { BrokerAuthNotice, isBrokerAuthKind } from "@/components/common/BrokerAuthNotice";
import { optionsAnalyticsState, refreshAnalytics } from "@/state/optionsAnalytics";
import { AnalyticsPanel, type AnalyticsContentTab } from "../../options-dock/analytics/AnalyticsPanel";
import {
  AnalyticsTabStrip,
  type AnalyticsStripContext,
} from "../../options-dock/analytics/AnalyticsTabStrip";
import type { AnalyticsTab } from "../../options-dock/analytics/types";
import type { DockPanelContext, DockPanelSpec } from "../../dock/types";
import { ExpirySelect, useExpiryPicker } from "./expiryPicker";
import { acquireChain, releaseChain, type ChainFlight } from "./optionsChain";

type ChainStatus = "loading" | "ready" | "empty" | "error";

interface ChainFailure {
  kind: string;
  message: string;
  retryAfterMs: number | null;
}

const FAILURE_LABEL: Record<string, string> = {
  rate_limited: "Rate limited by the options service",
  not_fno: "No listed options for this symbol",
  network: "Could not reach the options service",
  timeout: "The options service took too long to respond",
  upstream: "Options service error",
  unknown: "Could not load the option chain",
};

const failureOf = (cause: unknown): ChainFailure => {
  if (cause instanceof OptionDockError) {
    return { kind: cause.kind, message: cause.message, retryAfterMs: cause.retryAfterMs };
  }
  return {
    kind: "unknown",
    message: cause instanceof Error ? cause.message : "Could not load the option chain",
    retryAfterMs: null,
  };
};

const MIN_TTE_YEARS = 15 / (365 * 24 * 60);

/** Calendar-year T, floored at 15 minutes so an expired contract never goes negative. */
function dteYearsOf(expiry: string): number {
  if (!expiry) return MIN_TTE_YEARS;
  const close = new Date(`${expiry}T15:30:00+05:30`);
  if (Number.isNaN(close.getTime())) return MIN_TTE_YEARS;
  const years = (close.getTime() - Date.now()) / (365 * 24 * 3600 * 1000);
  return Number.isFinite(years) && years > MIN_TTE_YEARS ? years : MIN_TTE_YEARS;
}

/**
 * The self-contained analytics slice: the dock's real `AnalyticsPanel` (and its
 * tab strip, loading skeleton, error banner, retry and four chart panels) fed
 * from this window's own symbol/expiry controls and the app-wide analytics
 * store. No dock context, legs or payoff strategy are mounted — the PAYOFF tab
 * says plainly that a position has to be built in the Options dock.
 *
 * The chain flight is local and separate from the analytics read: only SMILE
 * consumes its rows, while TERM/SURFACE paint straight from the analytics DTO.
 */
function OptionsAnalyticsWindow(props: { context: Accessor<DockPanelContext> }) {
  const [symbol, setSymbol] = createSignal(
    (props.context().symbol ?? "NIFTY").trim().toUpperCase() || "NIFTY",
  );
  const picker = useExpiryPicker(symbol, props.context);
  const expiryOverride = picker.expiry;
  const setExpiryOverride = picker.setExpiry;
  const [chainRetry, setChainRetry] = createSignal(0);
  const [tab, setTab] = createSignal<AnalyticsTab>("term");

  const [chainStatus, setChainStatus] = createSignal<ChainStatus>("empty");
  const [rows, setRows] = createSignal<ChainRow[]>([]);
  const [spot, setSpot] = createSignal(0);
  const [atmIv, setAtmIv] = createSignal<number | null>(null);
  const [failure, setFailure] = createSignal<ChainFailure | null>(null);
  const [retryReady, setRetryReady] = createSignal(true);

  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let heldFlight: ChainFlight | null = null;
  const clearRetryTimer = () => {
    if (retryTimer != null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };
  const rateLimited = () => failure()?.kind === "rate_limited";
  const retryWaitSeconds = () =>
    Math.ceil((failure()?.retryAfterMs ?? DEFAULT_RATE_LIMIT_RETRY_MS) / 1000);

  // The store is shared; a frame painted for another symbol is not this view's
  // data. That guard also keeps the strip's expiry chips from borrowing NIFTY.
  const analyticsData = () => {
    const data = optionsAnalyticsState.data;
    return data != null && data.symbol?.toUpperCase() === symbol() ? data : null;
  };
  const expiries = createMemo(() => analyticsData()?.expiries ?? []);
  const selectedExpiry = createMemo(() => expiryOverride() || expiries()[0]?.date || "");

  createEffect(() => {
    const sym = symbol();
    const exp = selectedExpiry();
    void chainRetry();
    clearRetryTimer();
    setRetryReady(true);
    onCleanup(() => {
      releaseChain(heldFlight);
      heldFlight = null;
      clearRetryTimer();
    });

    if (!sym || !exp) {
      setChainStatus("empty");
      setRows([]);
      setSpot(0);
      setAtmIv(null);
      setFailure(null);
      return;
    }

    // Join an identical in-flight chain fetch (a chain window on the same key)
    // instead of spending a second request. The key includes symbol and expiry,
    // so a different view still owns its own flight.
    const flight = acquireChain(sym, exp);
    heldFlight = flight;
    setChainStatus("loading");
    setFailure(null);
    void flight.promise
      .then((chain) => {
        if (flight.controller.signal.aborted) return;
        setSpot(chain?.spot ?? 0);
        setAtmIv(chain?.atmIv ?? null);
        if (!chain || chain.rows.length === 0) {
          setRows([]);
          setFailure(null);
          setChainStatus("empty");
          return;
        }
        setRows(chain.rows);
        setChainStatus("ready");
      })
      .catch((cause: unknown) => {
        if (flight.controller.signal.aborted) return;
        setFailure(failureOf(cause));
        setRows([]);
        setSpot(0);
        setAtmIv(null);
        setChainStatus("error");
        if (cause instanceof OptionDockError && cause.kind === "rate_limited") {
          setRetryReady(false);
          retryTimer = setTimeout(() => {
            retryTimer = null;
            setRetryReady(true);
          }, cause.retryAfterMs ?? DEFAULT_RATE_LIMIT_RETRY_MS);
        }
      });
  });

  // The chain and the analytics payload are separate flights. A failed chain
  // refresh must not leave the last analytics frame looking current.
  const showChainStale = () => chainStatus() === "error" && analyticsData() != null;

  const onSymbolChange = (value: string) => {
    const next = value.trim().toUpperCase();
    if (next !== symbol()) setSymbol(next);
  };

  const stripContext = (): AnalyticsStripContext => ({
    symbol: symbol(),
    expiry: selectedExpiry()
      ? {
          date: selectedExpiry(),
          dteDays: expiries().find((entry) => entry.date === selectedExpiry())?.dte ?? 0,
        }
      : null,
    spot: spot(),
    atmIv: atmIv(),
    marketState: analyticsData()?.marketState ?? null,
  });

  const strip = () => (
    <AnalyticsTabStrip
      value={tab()}
      onChange={setTab}
      symbol={symbol()}
      context={stripContext()}
      data={analyticsData()}
      maxPain={analyticsData()?.levels?.maxPain ?? null}
      expiryOptions={expiries()}
      selectedExpiry={selectedExpiry()}
      onSelectExpiry={setExpiryOverride}
      onRefresh={() => void refreshAnalytics()}
      refreshing={optionsAnalyticsState.refreshing}
    />
  );

  return (
    <Box className="flex h-full min-h-0 flex-col bg-fin-surface" data-testid="options-analytics-window">
      <ToolbarRow
        data-testid="options-analytics-controls"
        className="shrink-0 border-b border-fin-border px-2 py-1"
        wrap={false}
      >
        <Text size="xs" fw={700}>
          ANALYTICS
        </Text>
        <TextInput
          aria-label="Symbol"
          data-testid="options-analytics-symbol-input"
          size="xs"
          w={110}
          placeholder="NIFTY"
          value={symbol()}
          onChange={onSymbolChange}
        />
        <ExpirySelect
          model={picker}
          ariaLabel="Expiry"
          controlTestId="options-analytics-expiry-input"
          pickerTestId="options-analytics-expiry-picker"
          loadingTestId="options-analytics-expiry-loading"
          errorTestId="options-analytics-expiry-error"
          emptyTestId="options-analytics-expiry-empty"
        />
        <Show when={spot() > 0}>
          <Text size="xs" c="dimmed">
            Spot {spot().toLocaleString("en-IN")}
          </Text>
        </Show>
      </ToolbarRow>

      <Show when={showChainStale()}>
        <Box
          data-testid="options-analytics-stale"
          className="shrink-0 border-b border-fin-border px-2 py-1"
        >
          <Text size="xs" c="warning">
            Chain refresh failed · showing last available analytics
          </Text>
        </Box>
      </Show>

      <Show when={!symbol()}>
        <Box
          data-testid="options-analytics-empty-symbol"
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-2"
        >
          <Text size="xs" c="dimmed">
            Enter a symbol to load options analytics.
          </Text>
          <Button
            size="xs"
            variant="subtle"
            data-testid="options-analytics-empty-action"
            onClick={() => setSymbol("NIFTY")}
          >
            Use NIFTY
          </Button>
        </Box>
      </Show>

      <Show when={chainStatus() === "loading"}>
        <Box
          data-testid="options-analytics-chain-loading"
          className="shrink-0 px-2 py-1 text-ui-micro text-fin-text-muted"
        >
          Loading chain…
        </Box>
      </Show>

      <Show when={chainStatus() === "empty"}>
        <Box
          data-testid="options-analytics-chain-empty"
          className="flex shrink-0 flex-col gap-1 px-2 py-1 text-ui-micro text-fin-text-muted"
        >
          <Text size="xs" c="dimmed">
            No strikes listed for {symbol() || "—"} {selectedExpiry() || "— choose an expiry"}
          </Text>
          <Button
            size="xs"
            variant="subtle"
            data-testid="options-analytics-chain-empty-retry"
            onClick={() => setChainRetry((count) => count + 1)}
          >
            Retry
          </Button>
        </Box>
      </Show>

      <Show when={chainStatus() === "error" && failure()}>
        {(error) => (
          <Box
            data-testid="options-analytics-chain-error"
            data-kind={error().kind}
            role="alert"
            className="m-2 flex shrink-0 flex-col gap-1 border border-fin-border p-2"
          >
            <Show
              when={isBrokerAuthKind(error().kind)}
              fallback={
                <>
                  <Text size="xs" fw={700}>
                    {FAILURE_LABEL[error().kind] ?? FAILURE_LABEL.unknown}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {error().message}
                    {rateLimited() || error().retryAfterMs != null
                      ? ` · retry in ${retryWaitSeconds()}s`
                      : ""}
                  </Text>
                </>
              }
            >
              <BrokerAuthNotice connectTestId="options-analytics-connect" />
            </Show>
            <Button
              size="xs"
              variant="subtle"
              disabled={rateLimited() && !retryReady()}
              onClick={() => setChainRetry((count) => count + 1)}
            >
              {rateLimited() && !retryReady() ? `Retry in ${retryWaitSeconds()}s` : "Retry"}
            </Button>
          </Box>
        )}
      </Show>

      <Show when={symbol()}>
        <Switch>
          <Match when={tab() === "payoff"}>
            <Box className="flex min-h-0 flex-1 flex-col">
              {strip()}
              <Box
                data-testid="options-analytics-payoff-empty"
                className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-2"
              >
                <Text size="xs" c="dimmed">
                  Payoff needs a position — build legs in the Options dock.
                </Text>
                <Anchor href="/options" data-testid="options-analytics-payoff-open-dock">
                  Open Options dock
                </Anchor>
              </Box>
            </Box>
          </Match>
          <Match when={tab() !== "payoff"}>
            <AnalyticsPanel
              tab={tab() as AnalyticsContentTab}
              symbol={symbol()}
              rows={rows()}
              spot={spot()}
              atmIv={atmIv()}
              legs={[]}
              selectedExpiry={selectedExpiry()}
              dteYears={dteYearsOf(selectedExpiry())}
              onTabChange={setTab}
              context={stripContext()}
              maxPain={analyticsData()?.levels?.maxPain ?? null}
              expiryOptions={expiries()}
              onSelectExpiry={setExpiryOverride}
              onRefresh={() => void refreshAnalytics()}
              refreshing={optionsAnalyticsState.refreshing}
            />
          </Match>
        </Switch>
      </Show>
    </Box>
  );
}

export const OPTIONS_ANALYTICS_PANEL: DockPanelSpec = {
  id: "options.analytics",
  page: "report",
  title: "OPTIONS ANALYTICS",
  size: 1,
  minWidth: 420,
  singleton: false,
  requires: [],
  mount: (ctx: Accessor<DockPanelContext>) => <OptionsAnalyticsWindow context={ctx} />,
};
