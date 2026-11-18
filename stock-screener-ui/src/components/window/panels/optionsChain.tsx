import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { Box, Button, Text, TextInput, ToolbarRow } from "@/ui";
import {
  OptionDockError,
  fetchChain,
  type ChainRow,
  type OptionChainLevels,
} from "@/api/optionsDock";
import { OptionChainTable } from "../../options-dock/OptionChainTable";
import type { DockPanelContext, DockPanelSpec } from "../../dock/types";

type ChainStatus = "loading" | "ready" | "empty" | "error";

interface ChainFailure {
  kind: string;
  message: string;
  retryAfterMs: number | null;
}

const FAILURE_LABEL: Record<string, string> = {
  auth: "Broker connection needed",
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

/**
 * The narrowest real chain surface: the shared `OptionChainTable` (columns and
 * cell semantics included) plus one `fetchChain` flight. It never mounts the
 * dock's strategy legs, payoff or Size-by controls, and it passes `levels`
 * explicitly so the table cannot fall back to the global dock store.
 *
 * Symbol and expiry are owned here. The desk context is a seed, not a
 * dependency: /home no longer carries context inputs in its page toolbar.
 */
function OptionsChainWindow(props: { context: Accessor<DockPanelContext> }) {
  const [symbol, setSymbol] = createSignal(
    (props.context().symbol ?? "NIFTY").trim().toUpperCase() || "NIFTY",
  );
  const [expiry, setExpiry] = createSignal((props.context().expiry ?? "").trim());
  const [status, setStatus] = createSignal<ChainStatus>(
    expiry() ? "loading" : "empty",
  );
  const [rows, setRows] = createSignal<ChainRow[]>([]);
  const [spot, setSpot] = createSignal(0);
  const [levels, setLevels] = createSignal<OptionChainLevels | null>(null);
  const [chainExpiry, setChainExpiry] = createSignal<string | null>(null);
  const [failure, setFailure] = createSignal<ChainFailure | null>(null);

  let requestId = 0;
  let controller: AbortController | null = null;

  const load = async () => {
    const id = ++requestId;
    controller?.abort();
    const sym = symbol().trim().toUpperCase();
    const exp = expiry().trim();

    if (!sym || !exp) {
      if (id !== requestId) return;
      controller = null;
      setRows([]);
      setSpot(0);
      setLevels(null);
      setChainExpiry(null);
      setFailure(null);
      setStatus("empty");
      return;
    }

    const active = new AbortController();
    controller = active;
    setStatus("loading");
    setFailure(null);

    try {
      const chain = await fetchChain(sym, exp, active.signal);
      if (id !== requestId || active.signal.aborted) return;
      controller = null;
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
      if (id !== requestId || active.signal.aborted) return;
      controller = null;
      setFailure(failureOf(cause));
      setRows([]);
      setSpot(0);
      setLevels(null);
      setChainExpiry(null);
      setStatus("error");
    }
  };

  onMount(() => {
    void load();
  });
  onCleanup(() => {
    requestId += 1;
    controller?.abort();
  });

  const onSymbolChange = (value: string) => {
    const next = value.trim().toUpperCase();
    if (next === symbol()) return;
    setSymbol(next);
    void load();
  };

  const onExpiryChange = (value: string) => {
    const next = value.trim();
    if (next === expiry()) return;
    setExpiry(next);
    void load();
  };

  return (
    <Box
      className="flex h-full min-h-0 flex-col bg-fin-surface"
      data-testid="options-chain-window"
    >
      <ToolbarRow
        data-testid="options-chain-controls"
        className="shrink-0 border-b border-fin-border px-2 py-1"
        wrap={false}
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
        <TextInput
          aria-label="Expiry"
          data-testid="options-chain-expiry-input"
          size="xs"
          w={130}
          placeholder="YYYY-MM-DD"
          value={expiry()}
          onChange={onExpiryChange}
        />
        <Show when={status() === "ready"}>
          <Text size="xs" c="dimmed">
            Spot {spot().toLocaleString("en-IN")}
          </Text>
        </Show>
      </ToolbarRow>

      <Show when={status() === "loading"}>
        <Box data-testid="options-chain-loading" className="px-2 py-1 text-[10px] text-fin-text-muted">
          Loading chain…
        </Box>
      </Show>

      <Show when={status() === "empty"}>
        <Box data-testid="options-chain-empty" className="px-2 py-1 text-[10px] text-fin-text-muted">
          No strikes listed for {symbol() || "—"} {expiry() || "— choose an expiry in this window"}
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
            <Text size="xs" fw={700}>
              {FAILURE_LABEL[error().kind] ?? FAILURE_LABEL.unknown}
            </Text>
            <Text size="xs" c="dimmed">
              {error().message}
              {error().retryAfterMs != null
                ? ` · retry in ${Math.ceil(error().retryAfterMs! / 1000)}s`
                : ""}
            </Text>
            <Button size="xs" variant="subtle" onClick={() => void load()}>
              Retry
            </Button>
          </Box>
        )}
      </Show>

      <Show when={status() === "ready"}>
        <OptionChainTable rows={rows()} spot={spot()} levels={levels()} expiry={chainExpiry()} />
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
  mount: (ctx: Accessor<DockPanelContext>) => <OptionsChainWindow context={ctx} />,
};
