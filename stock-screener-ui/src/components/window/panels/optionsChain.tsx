import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { Box, Button, Text, TextInput, ToolbarRow } from "@/ui";
import { DEFAULT_RATE_LIMIT_RETRY_MS } from "@/state/optionsDock";
import {
  OptionDockError,
  fetchChain,
  type ChainRow,
  type OptionChainLevels,
  type OptionDockChain,
} from "@/api/optionsDock";
import { OptionChainTable } from "../../options-dock/OptionChainTable";
import { BrokerAuthNotice, isBrokerAuthKind } from "@/components/common/BrokerAuthNotice";
import type { DockPanelApi, DockPanelContext, DockPanelSpec } from "../../dock/types";
import { ExpirySelect, useExpiryPicker } from "./expiryPicker";

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

export interface ChainFlight {
  key: string;
  promise: Promise<OptionDockChain | null>;
  controller: AbortController;
  refs: number;
  settled: boolean;
}

const flights = new Map<string, ChainFlight>();

/**
 * Windows asking for the same symbol+expiry share one in-flight request. Each
 * panel still owns its symbol/expiry controls; only the identical flight is
 * coalesced. A settled entry is dropped so Retry really refetches, and the last
 * subscriber leaving aborts a request nobody is waiting for any more.
 */
export function acquireChain(symbol: string, expiry: string): ChainFlight {
  const key = `${symbol}\u0000${expiry}`;
  let flight = flights.get(key);
  if (!flight) {
    const controller = new AbortController();
    const promise = fetchChain(symbol, expiry, controller.signal);
    flight = { key, promise, controller, refs: 0, settled: false };
    flights.set(key, flight);
    const created = flight;
    const settle = () => {
      created.settled = true;
      if (flights.get(key) === created) flights.delete(key);
    };
    // `.finally()` would return a second promise that rejects with the original
    // error; nobody observes it, so a failed chain would surface as an unhandled
    // rejection. Handle both outcomes on the same promise instead.
    void promise.then(settle, settle);
  }
  flight.refs += 1;
  return flight;
}

export function releaseChain(flight: ChainFlight | null): void {
  if (!flight) return;
  flight.refs -= 1;
  if (flight.refs <= 0 && !flight.settled) {
    flight.controller.abort();
    if (flights.get(flight.key) === flight) flights.delete(flight.key);
  }
}

/**
 * The narrowest real chain surface: the shared `OptionChainTable` (columns and
 * cell semantics included) plus one `fetchChain` flight. It never mounts the
 * dock's strategy legs, payoff or Size-by controls, and it passes `levels`
 * explicitly so the table cannot fall back to the global dock store.
 *
 * Symbol and expiry are owned here. The desk context is a seed, not a
 * dependency: /home no longer carries context inputs in its page toolbar.
 */
/** The host frame exposes this optional channel; direct mounts simply omit it. */
type SparseAwareApi = DockPanelApi & { onSparseChange?: (sparse: boolean) => void };

/** A single-strike expiry should not render a 700px empty ladder. */
const SPARSE_ROW_LIMIT = 3;

function OptionsChainWindow(props: {
  context: Accessor<DockPanelContext>;
  onSparseChange?: (sparse: boolean) => void;
}) {
  const [symbol, setSymbol] = createSignal(
    (props.context().symbol ?? "NIFTY").trim().toUpperCase() || "NIFTY",
  );
  const picker = useExpiryPicker(symbol, props.context);
  const expiry = picker.expiry;
  const [status, setStatus] = createSignal<ChainStatus>(
    expiry() ? "loading" : "empty",
  );
  const [rows, setRows] = createSignal<ChainRow[]>([]);
  const [spot, setSpot] = createSignal(0);
  const [levels, setLevels] = createSignal<OptionChainLevels | null>(null);
  const [chainExpiry, setChainExpiry] = createSignal<string | null>(null);
  const [failure, setFailure] = createSignal<ChainFailure | null>(null);
  const [retryReady, setRetryReady] = createSignal(true);
  const sparse = createMemo(
    () => status() === "ready" && rows().length > 0 && rows().length <= SPARSE_ROW_LIMIT,
  );
  // Let the frame collapse to its content while the ladder is this thin. The
  // note below replaces the old blank body instead of leaving one row floating
  // in ~700px of empty panel.
  createEffect(() => props.onSparseChange?.(sparse()));
  onCleanup(() => props.onSparseChange?.(false));

  let requestId = 0;
  let heldFlight: ChainFlight | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const clearRetryTimer = () => {
    if (retryTimer != null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };
  const rateLimited = () => failure()?.kind === "rate_limited";
  const retryWaitSeconds = () =>
    Math.ceil((failure()?.retryAfterMs ?? DEFAULT_RATE_LIMIT_RETRY_MS) / 1000);

  const load = async () => {
    const id = ++requestId;
    clearRetryTimer();
    setRetryReady(true);
    releaseChain(heldFlight);
    heldFlight = null;
    const sym = symbol().trim().toUpperCase();
    const exp = expiry().trim();

    if (!sym || !exp) {
      setRows([]);
      setSpot(0);
      setLevels(null);
      setChainExpiry(null);
      setFailure(null);
      setStatus("empty");
      return;
    }

    const flight = acquireChain(sym, exp);
    heldFlight = flight;
    setStatus("loading");
    setFailure(null);

    try {
      const chain = await flight.promise;
      if (id !== requestId || flight.controller.signal.aborted) return;
      setSpot(chain?.spot ?? 0);
      setLevels(chain?.levels ?? null);
      setChainExpiry(chain?.expiry || exp);
      if (!chain || chain.rows.length === 0) {
        setRows([]);
        setFailure(null);
        setStatus("empty");
        return;
      }
      setRows(chain.rows);
      setFailure(null);
      setStatus("ready");
    } catch (cause) {
      if (id !== requestId || flight.controller.signal.aborted) return;
      setFailure(failureOf(cause));
      setRows([]);
      setSpot(0);
      setLevels(null);
      setChainExpiry(null);
      setStatus("error");
      if (cause instanceof OptionDockError && cause.kind === "rate_limited") {
        setRetryReady(false);
        retryTimer = setTimeout(() => {
          retryTimer = null;
          setRetryReady(true);
        }, cause.retryAfterMs ?? DEFAULT_RATE_LIMIT_RETRY_MS);
      }
    }
  };

  // Symbol and expiry are the only inputs to the chain flight. When the picker
  // resolves its default (or the user picks another date) this re-runs once;
  // Retry calls load() explicitly and keeps the same key.
  createEffect(() => {
    void load();
  });
  onCleanup(() => {
    requestId += 1;
    clearRetryTimer();
    releaseChain(heldFlight);
    heldFlight = null;
  });

  const onSymbolChange = (value: string) => {
    const next = value.trim().toUpperCase() || "NIFTY";
    if (next === symbol()) return;
    setSymbol(next);
  };

  return (
    <Box
      className="flex h-full min-h-0 flex-col bg-fin-surface"
      data-testid="options-chain-window"
    >
      <ToolbarRow
        data-testid="options-chain-controls"
        className="shrink-0 border-b border-fin-border px-2 py-1"
      >
        <Text size="xs" fw={700}>
          CHAIN
        </Text>
        <TextInput
          aria-label="Symbol"
          data-testid="options-chain-symbol-input"
          size="xs"
          w={110}
          placeholder="NIFTY"
          value={symbol()}
          onChange={onSymbolChange}
        />
        <ExpirySelect
          model={picker}
          ariaLabel="Expiry"
          controlTestId="options-chain-expiry-input"
          pickerTestId="options-chain-expiry-picker"
          loadingTestId="options-chain-expiry-loading"
          errorTestId="options-chain-expiry-error"
          emptyTestId="options-chain-expiry-empty"
        />
        <Show when={status() === "ready"}>
          <Text size="xs" c="dimmed">
            Spot {spot().toLocaleString("en-IN")}
          </Text>
        </Show>
      </ToolbarRow>

      <Show when={status() === "loading"}>
        <Box data-testid="options-chain-loading" className="px-2 py-1 text-ui-micro text-fin-text-muted">
          Loading chain…
        </Box>
      </Show>

      <Show when={status() === "empty"}>
        <Box
          data-testid="options-chain-empty"
          className="flex flex-col gap-1 px-2 py-1 text-ui-micro text-fin-text-muted"
        >
          <Text size="xs" c="dimmed">
            No strikes listed for {symbol() || "—"} {expiry() || "— choose an expiry in this window"}
          </Text>
          <Button
            size="xs"
            variant="subtle"
            data-testid="options-chain-empty-retry"
            onClick={() => void load()}
          >
            Retry
          </Button>
        </Box>
      </Show>

      <Show when={status() === "error" && failure()}>
        {(error) => (
          <Box
            data-testid="options-chain-error"
            data-kind={error().kind}
            role="alert"
            className="m-2 flex flex-col gap-1 border border-fin-border p-2"
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
              <BrokerAuthNotice connectTestId="options-chain-connect" />
            </Show>
            <Button
              size="xs"
              variant="subtle"
              disabled={rateLimited() && !retryReady()}
              onClick={() => void load()}
            >
              {rateLimited() && !retryReady() ? `Retry in ${retryWaitSeconds()}s` : "Retry"}
            </Button>
          </Box>
        )}
      </Show>

      <Show when={status() === "ready"}>
        <div
          class="flex min-h-0 flex-col"
          style={
            sparse()
              ? {
                  flex: "0 0 auto",
                  "max-height": `${Math.max(1, rows().length) * 20 + 28}px`,
                }
              : { flex: "1 1 0%" }
          }
        >
          <OptionChainTable rows={rows()} spot={spot()} levels={levels()} expiry={chainExpiry()} />
        </div>
        <Show when={sparse()}>
          <Box
            data-testid="options-chain-sparse"
            className="shrink-0 border-t border-fin-border px-2 py-1 text-ui-micro text-fin-text-muted"
          >
            <Text size="xs" fw={700}>
              Sparse chain · {rows().length} strike{rows().length === 1 ? "" : "s"} listed
            </Text>
            <Text size="xs" c="dimmed">
              Only {rows().length} strike{rows().length === 1 ? "" : "s"} for{" "}
              {chainExpiry() ?? expiry() ?? "this expiry"}. The ladder fills as expiry approaches.
            </Text>
          </Box>
        </Show>
      </Show>
    </Box>
  );
}

export const OPTIONS_CHAIN_PANEL: DockPanelSpec = {
  id: "options.chain",
  page: "report",
  title: "OPTIONS CHAIN",
  size: 1,
  minWidth: 360,
  singleton: false,
  requires: [],
  mount: (ctx: Accessor<DockPanelContext>, api: DockPanelApi) => (
    <OptionsChainWindow
      context={ctx}
      onSparseChange={(api as SparseAwareApi).onSparseChange}
    />
  ),
};
