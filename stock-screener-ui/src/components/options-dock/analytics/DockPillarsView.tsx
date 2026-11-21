/**
 * The four-pillar analytics view, rendered INSIDE the options dock.
 *
 * Opening the pillars used to leave the dock for `/options/analytics/:symbol`,
 * which threw away the chain, the legs and the dock's own context. This view
 * replaces that hop: the dock auto-maximizes for chart room, hides the chain /
 * strategy / legs / payoff bands and paints the same `VolatilityPillar`,
 * `PositioningPillar`, `DealerPillar` and `LiquidityPillar` the page paints.
 * No new chart code — the pillars receive the dashboard payload directly.
 *
 * The view owns its active pillar. The selected expiry is controlled by the
 * dock when `selectedExpiry` is passed, because the chain behind the same dock
 * must land on the contract the pillars are reading; an un-controlled mount
 * (a standalone render) falls back to its own signal.
 */

import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Box, Text } from "@/ui";
import {
  abortDashboard,
  loadDashboard,
  optionsDashboardState,
  refreshDashboard,
} from "@/state/optionsDashboard";
import type { PillarKey, Warning } from "@/types/optionsDashboard";
import { DealerPillar } from "@/components/options-dashboard/DealerPillar";
import { LiquidityPillar } from "@/components/options-dashboard/LiquidityPillar";
import { PositioningPillar } from "@/components/options-dashboard/PositioningPillar";
import { VolatilityPillar } from "@/components/options-dashboard/VolatilityPillar";
import type { PanelProps } from "@/components/options-dashboard/types";
import { selectedExpiryLabel } from "./analyticsRead";

const PILLARS: Record<PillarKey, Component<PanelProps>> = {
  volatility: VolatilityPillar,
  positioning: PositioningPillar,
  dealer: DealerPillar,
  liquidity: LiquidityPillar,
};

const PILLAR_TABS: ReadonlyArray<{ key: PillarKey; label: string }> = [
  { key: "volatility", label: "VOLATILITY" },
  { key: "positioning", label: "POSITIONING" },
  { key: "dealer", label: "DEALER" },
  { key: "liquidity", label: "LIQUIDITY" },
];

const PILLAR_INK = {
  "font-size": "9px",
  "letter-spacing": "0.06em",
  "line-height": "1",
} as const;

export function DockPillarsView(props: {
  symbol: string;
  onBack: () => void;
  /** The dock's chain expiry. Omit to let the pillars own the selection. */
  selectedExpiry?: string | null;
  onExpiry?: (date: string) => void;
}) {
  const [active, setActive] = createSignal<PillarKey>("volatility");
  const [localExpiry, setLocalExpiry] = createSignal<string | null>(null);
  let tabRefs: (HTMLButtonElement | null)[] = [];
  let tabStripRef: HTMLDivElement | undefined;

  /**
   * Keep the selected tab inside the strip. The strip is `overflow-x-auto`, so
   * a chosen tab can sit off-screen at 390px; `inline: "nearest"` moves only the
   * strip (block axis is already in view) and never scrolls the page.
   */
  const revealTab = (key: PillarKey) => {
    const index = PILLAR_TABS.findIndex((tab) => tab.key === key);
    if (index < 0) return;
    const node = tabRefs[index];
    if (!tabStripRef || !node || typeof node.scrollIntoView !== "function") return;
    node.scrollIntoView({ inline: "nearest", block: "nearest" });
  };
  createEffect(() => revealTab(active()));

  const controlled = () => props.selectedExpiry !== undefined;

  // One read per symbol. `loadDashboard` is single-flight + LRU: reopening the
  // same symbol costs zero requests, and a symbol switch supersedes the old
  // flight instead of painting it late.
  let lastLoaded: string | null = null;
  createEffect(() => {
    const current = String(props.symbol ?? "").trim().toUpperCase();
    if (!current) {
      lastLoaded = null;
      abortDashboard();
      return;
    }
    if (current === lastLoaded) return;
    // A symbol switch is a new read: cancel the previous flight before it can
    // paint under the new symbol. `loadDashboard` also supersedes flights, but
    // the abort is the explicit contract here.
    if (lastLoaded) abortDashboard();
    lastLoaded = current;
    void loadDashboard(current);
  });
  onCleanup(() => {
    lastLoaded = null;
    abortDashboard();
  });

  // Only a payload for THIS symbol may paint. The store is shared and keeps the
  // last good frame across a switch; without this guard a stale frame from the
  // previous symbol would render under the new tab's header.
  const data = () => {
    const current = optionsDashboardState.data;
    const wanted = String(props.symbol ?? "").trim().toUpperCase();
    return current && current.symbol?.toUpperCase() === wanted ? current : null;
  };

  // Keep the selection valid when a new payload arrives; default to the front
  // expiry. A controlled mount never writes: the dock owns the value.
  createEffect(() => {
    if (controlled()) return;
    const expiries = data()?.expiries ?? [];
    const current = localExpiry();
    if (current && expiries.some((expiry) => expiry.date === current)) return;
    setLocalExpiry(expiries[0]?.date ?? null);
  });

  /**
   * The expiry on screen. A controlled value the payload does not list (the
   * chain and the dashboard can disagree on the far end) falls back to the
   * payload's front contract rather than painting an empty pillar.
   */
  const selectedExpiry = (): string | null => {
    const expiries = data()?.expiries ?? [];
    const wanted = controlled() ? (props.selectedExpiry ?? null) : localExpiry();
    if (wanted && expiries.some((expiry) => expiry.date === wanted)) return wanted;
    return expiries[0]?.date ?? null;
  };

  const chooseExpiry = (date: string) => {
    if (controlled()) {
      props.onExpiry?.(date);
      return;
    }
    setLocalExpiry(date);
  };

  const error = () => {
    if (optionsDashboardState.status !== "error") return null;
    const current = optionsDashboardState.symbol;
    const wanted = String(props.symbol ?? "").trim().toUpperCase();
    // A failure for another symbol is not this view's failure, and its Retry
    // would re-read that other symbol.
    if (current && current.toUpperCase() !== wanted) return null;
    return optionsDashboardState.error;
  };
  const isLoading = () => optionsDashboardState.status === "loading";
  const refreshing = () => optionsDashboardState.refreshing;
  const quotesLive = () => data()?.quotesLive === true;
  const hasExpiries = createMemo(() => (data()?.expiries.length ?? 0) > 0);
  const panel = createMemo(() => PILLARS[active()]);

  const asOfLabel = createMemo(() => {
    const asOf = data()?.asOf;
    if (!asOf) return null;
    const parsed = new Date(asOf);
    if (Number.isNaN(parsed.getTime())) return asOf;
    const time = parsed.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${time} IST`;
  });

  const warningLine = createMemo(() => {
    // Some payloads carry plain strings; the DTO says `Warning`. Accept both so
    // an old cached frame can never throw on the way to the header.
    const list = (data()?.warnings ?? []) as Array<Warning | string>;
    const messages = list
      .map((warning) => (typeof warning === "string" ? warning : (warning?.message ?? warning?.code ?? "")))
      .map((message) => message.trim())
      .filter((message) => message.length > 0);
    return messages.length > 0 ? messages.join(" · ") : null;
  });

  const back = () => {
    abortDashboard();
    props.onBack();
  };

  // The tablist moves focus AND selection on Arrow/Home/End: a keyboard user
  // switches pillars in one keystroke, exactly like the standalone page.
  const onTabKeys = (event: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const index = PILLAR_TABS.findIndex((tab) => tab.key === active());
    if (index < 0) return;
    event.preventDefault();
    let next = index;
    if (event.key === "ArrowLeft") next = (index - 1 + PILLAR_TABS.length) % PILLAR_TABS.length;
    else if (event.key === "ArrowRight") next = (index + 1) % PILLAR_TABS.length;
    else if (event.key === "Home") next = 0;
    else next = PILLAR_TABS.length - 1;
    tabRefs[next]?.focus();
    setActive(PILLAR_TABS[next].key);
  };

  return (
    <Box className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="dock-pillars">
      <Box
        className="flex h-[24px] min-w-0 shrink-0 items-center gap-1 border-b border-fin-border pr-1 pl-12 sm:px-1"
        data-testid="dock-pillars-header"
      >
        <button
          type="button"
          data-testid="dock-pillars-back"
          onClick={back}
          className="inline-flex h-[20px] shrink-0 items-center gap-1 whitespace-nowrap border border-fin-border bg-transparent px-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.06em] text-fin-text-muted hover:text-fin-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fin-primary"
          style={{ "border-radius": "4px" }}
        >
          <span aria-hidden="true">←</span>
          <span>Back to chain</span>
        </button>

        <div
          ref={(node) => (tabStripRef = node)}
          role="tablist"
          aria-label="Options pillars"
          data-testid="dock-pillars-tabs"
          onKeyDown={onTabKeys}
          className="flex h-full min-w-0 flex-1 items-stretch overflow-x-auto"
          style={{ "scrollbar-width": "none" }}
        >
          <For each={PILLAR_TABS}>
            {(tab, index) => (
              <button
                ref={(node) => (tabRefs[index()] = node)}
                type="button"
                role="tab"
                aria-selected={active() === tab.key}
                tabIndex={active() === tab.key ? 0 : -1}
                data-testid={`dock-pillar-tab-${tab.key}`}
                title={tab.label}
                onClick={() => setActive(tab.key)}
                className={`inline-flex shrink-0 items-center justify-center border-b-2 px-2 font-mono outline-none focus-visible:ring-1 focus-visible:ring-fin-primary max-sm:px-1 ${
                  active() === tab.key
                    ? "border-fin-primary text-fin-text"
                    : "border-transparent text-fin-text-muted hover:text-fin-text"
                }`}
                style={PILLAR_INK}
              >
                {tab.label}
              </button>
            )}
          </For>
        </div>

        <Text
          size="xs"
          fw={700}
          className="shrink-0 truncate font-mono tabular-nums max-sm:hidden"
          style={{ "font-size": "9px" }}
          data-testid="dock-pillars-symbol"
        >
          {String(props.symbol ?? "").toUpperCase()}
        </Text>
      </Box>

      {/* Stale cue: a payload can be cached, closed-session or partially
          degraded. Say which, so the pillars are never read as live when they
          are not, and leave a one-click re-read next to the verdict. */}
      <Box
        className="flex h-[16px] min-w-0 shrink-0 items-center gap-1.5 overflow-hidden border-b border-fin-border px-1 font-mono"
        style={PILLAR_INK}
        data-testid="dock-pillars-status"
      >
        <Show when={asOfLabel()}>
          <Text
            size="xs"
            c="dimmed"
            className="shrink-0 truncate font-mono tabular-nums"
            style={PILLAR_INK}
            data-testid="dock-pillars-asof"
            title={`as of ${data()?.asOf ?? ""}`}
          >
            AS OF {asOfLabel()}
          </Text>
        </Show>
        <Show when={data()}>
          <Text
            size="xs"
            fw={700}
            className={`shrink-0 font-mono ${
              quotesLive() ? "text-fin-positive" : "text-fin-warning"
            }`}
            style={PILLAR_INK}
            data-testid="dock-pillars-live"
            title={
              quotesLive()
                ? "Quotes are streaming"
                : "Quotes are cached or from a closed session — the pillars are not live"
            }
          >
            {quotesLive() ? "LIVE" : "STALE"}
          </Text>
        </Show>
        <button
          type="button"
          aria-label="Refresh options pillars"
          title="Refresh options pillars"
          data-testid="dock-pillars-refresh"
          onClick={() => void refreshDashboard()}
          disabled={refreshing()}
          className="inline-flex h-[16px] w-[16px] shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 font-mono text-[9px] leading-none text-fin-text-muted hover:text-fin-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fin-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span aria-hidden="true">⟳</span>
        </button>
        <Show when={warningLine()}>
          <Text
            size="xs"
            className="min-w-0 flex-1 truncate font-mono text-fin-warning"
            style={PILLAR_INK}
            data-testid="dock-pillars-warnings"
            title={warningLine() ?? undefined}
          >
            {warningLine()}
          </Text>
        </Show>
      </Box>

      <Show when={data() && hasExpiries()}>
        <Box
          className="flex h-[20px] min-w-0 shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-fin-border px-1"
          style={{ "scrollbar-width": "none" }}
          data-testid="dock-pillars-expiry-row"
        >
          <Text size="xs" c="dimmed" className="shrink-0 font-mono uppercase" style={PILLAR_INK}>
            EXPIRY
          </Text>
          <For each={data()?.expiries ?? []}>
            {(expiry) => (
              <button
                type="button"
                aria-pressed={selectedExpiry() === expiry.date}
                data-testid={`dock-pillars-expiry-${expiry.date}`}
                onClick={() => chooseExpiry(expiry.date)}
                className={`inline-flex h-[16px] shrink-0 items-center border px-1 font-mono text-[9px] tabular-nums leading-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fin-primary ${
                  selectedExpiry() === expiry.date
                    ? "border-fin-primary bg-fin-surface-alt text-fin-text"
                    : "border-fin-border bg-transparent text-fin-text-muted hover:text-fin-text"
                }`}
                style={{ "border-radius": "4px" }}
              >
                {selectedExpiryLabel(expiry.date, expiry.dte, " ")}
              </button>
            )}
          </For>
        </Box>
      </Show>

      <Show when={error()}>
        <Box
          data-testid="dock-pillars-error"
          className="flex h-[26px] shrink-0 items-center gap-2 overflow-hidden border-l-[3px] bg-fin-surface-alt px-2"
          style={{ "border-left-color": "var(--color-fin-negative)" }}
        >
          <Text
            size="xs"
            fw={600}
            className="min-w-0 flex-1 truncate font-mono"
            style={{ "font-size": "10px", color: "var(--color-fin-negative)" }}
          >
            {error()!.kind === "auth" ? "Reconnect Upstox in Settings" : error()!.message}
          </Text>
          <Show when={error()!.kind === "auth"}>
            <a
              href="/settings"
              data-testid="dock-pillars-reconnect"
              className="shrink-0 font-mono text-[10px] font-semibold text-fin-primary hover:underline"
            >
              Reconnect Upstox
            </a>
          </Show>
          <button
            type="button"
            aria-label="Retry options pillars"
            data-testid="dock-pillars-retry"
            onClick={() => void refreshDashboard()}
            className="inline-flex h-[20px] shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 font-mono text-[10px] font-semibold hover:underline"
            style={{ color: "var(--color-fin-negative)" }}
          >
            Retry
          </button>
        </Box>
      </Show>

      <Switch>
        <Match when={data() && !hasExpiries()}>
          <Box
            className="flex flex-1 flex-col items-center justify-center gap-1 px-4 text-center"
            data-testid="dock-pillars-empty"
          >
            <Text size="sm" fw={600}>
              No expiries available for {String(props.symbol ?? "").toUpperCase()}
            </Text>
            <Text size="xs" c="dimmed">
              The pillars need at least one listed expiry.
            </Text>
          </Box>
        </Match>

        <Match when={data() && hasExpiries()}>
          <Box className="flex min-h-0 flex-1 flex-col" data-testid="dock-pillars-body">
            <Dynamic
              component={panel()}
              data={data()!}
              selectedExpiry={selectedExpiry()}
              onExpiry={chooseExpiry}
            />
          </Box>
        </Match>

        <Match when={isLoading() || optionsDashboardState.status === "idle"}>
          <Box
            className="flex flex-1 flex-col items-center justify-center gap-1"
            data-testid="dock-pillars-loading"
          >
            <Text size="xs" c="dimmed">
              Loading {String(props.symbol ?? "").toUpperCase()} pillars…
            </Text>
          </Box>
        </Match>

        <Match when={error()}>
          <Box
            className="flex flex-1 flex-col items-center justify-center gap-1 px-4 text-center"
            data-testid="dock-pillars-unavailable"
          >
            <Text size="xs" c="dimmed">
              The pillars need a live analytics payload. Retry above when Upstox is connected.
            </Text>
          </Box>
        </Match>

        {/* The store holds another symbol's frame (cached open elsewhere): wait
            for this symbol's read instead of painting a foreign one. */}
        <Match when={true}>
          <Box
            className="flex flex-1 flex-col items-center justify-center gap-1"
            data-testid="dock-pillars-waiting"
          >
            <Text size="xs" c="dimmed">
              Waiting for {String(props.symbol ?? "").toUpperCase()} pillars…
            </Text>
          </Box>
        </Match>
      </Switch>
    </Box>
  );
}
