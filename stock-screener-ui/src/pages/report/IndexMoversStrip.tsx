import { createEffect, createMemo, createSignal, For, Show, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import { Loader, Text, Tooltip } from "@/ui";
import { IconChevronRight } from "@/components/common/Icons";
import * as palette from "@/ui/palette";
import {
  REPORT_FONT,
} from "./reportTokens";
import { fetchIndexMovers, IndexMoversResponse, IndexMoverRow } from "@/api/indexMovers";
import { useSymbolDock } from "@/components/common/symbolDockContext";

interface IndexMoversStripProps {
  index: "NIFTY" | "SENSEX";
  onExpand: () => void;
  /** Constituent symbol → app-wide chart dock. */
  onOpenSymbol?: (symbol: string) => void;
  /** Optional: in EOD/replay the band has no data: collapse it instead of reserving 24px; the mode banner declares the absence */
  liveOnly?: boolean;
  loading?: boolean;
  error?: string | null;
  /** Other live-only surfaces (e.g. WINDOWS, WALLS) named by this one status row. */
  unavailableSurfaces?: string[];
  /** Single recovery control for every surface named in the status row. */
  onRetry?: () => void;
}

/** One status row for any number of empty surfaces. A fixed 30px, never-wrap
 *  row keeps 390 and 1600 to a single header line; the named surfaces appear
 *  once, next to the one Retry, instead of stacking an empty band per surface. */
export function UnavailableBandsStrip(props: {
  surfaces?: string[];
  testId?: string;
  surfacesTestId?: string;
  retryTestId?: string;
  onRetry?: () => void;
  onToggle?: () => void;
  open?: boolean;
  label?: string;
  message?: string;
  negative?: boolean;
  children?: JSX.Element;
}) {
  const surfaces = () => props.surfaces ?? [];
  return (
    <div
      data-testid={props.testId ?? "report-unavailable-strip"}
      data-surfaces={surfaces().join("|")}
      data-empty="true"
      class="flex items-center gap-2 h-[30px] min-h-[30px] w-full max-w-full min-w-0 shrink-0 px-2 bg-fin-surface font-mono text-ui-micro whitespace-nowrap"
    >
      <Show when={props.label}>
        <Text
          span
          size="xs"
          fw={700}
          c="dimmed"
          data-report-text="label"
          class="text-ui-micro font-extrabold uppercase tracking-[0.08em] shrink-0"
          style={{ color: palette.TEXT_MUTED }}
        >
          {props.label}
        </Text>
      </Show>
      <Show when={props.message}>
        <Text
          span
          size="xs"
          data-report-text="value"
          class={`text-ui-micro shrink-0 ${props.negative ? "text-fin-negative" : "text-fin-text-muted"}`}
        >
          {props.message}
        </Text>
      </Show>
      {props.children}
      <Show when={surfaces().length > 0}>
        <span
          data-testid={props.surfacesTestId ?? "report-unavailable-surfaces"}
          data-report-text="value"
          class="text-ui-micro text-fin-text-muted min-w-0"
        >
          {surfaces().join(" · ")}
        </span>
      </Show>
      <Show when={props.onRetry || props.onToggle}>
        <span class="flex items-center gap-2 ml-auto shrink-0">
          <Show when={props.onToggle}>
            <button
              type="button"
              aria-expanded={props.open ?? false}
              onClick={() => props.onToggle?.()}
              class="inline-flex items-center justify-center whitespace-nowrap rounded-fin border border-fin-text-muted bg-transparent text-fin-text-muted hover:bg-fin-surface-alt transition-colors duration-150 min-w-0 h-[20px] px-1 text-ui-micro font-bold tracking-[0.08em] uppercase"
            >
              {props.open ? "hide" : "details"}
            </button>
          </Show>
          <Show when={props.onRetry}>
            <button
              type="button"
              data-testid={props.retryTestId ?? "report-unavailable-retry"}
              onClick={() => props.onRetry?.()}
              class="inline-flex items-center justify-center whitespace-nowrap rounded-fin border border-fin-text-muted bg-transparent text-fin-text-muted hover:bg-fin-surface-alt transition-colors duration-150 min-w-0 h-[20px] px-2 text-ui-micro font-bold"
            >
              Retry
            </button>
          </Show>
        </span>
      </Show>
    </div>
  );
}

export interface BandSlot {
  label: string;
  available: () => boolean;
  band: () => JSX.Element;
}

/** Renders real bands only where data exists and collapses every empty surface
 *  into one status row. All-empty → one strip; partial → only available bands. */
export function AvailableBands(props: {
  bands: BandSlot[];
  testId?: string;
  surfacesTestId?: string;
  retryTestId?: string;
  onRetry?: () => void;
  onToggle?: () => void;
  open?: boolean;
}) {
  const present = createMemo(() => props.bands.filter((b) => b.available()));
  const missing = createMemo(() => props.bands.filter((b) => !b.available()).map((b) => b.label));
  return (
    <>
      <For each={present()}>{(slot) => <>{slot.band()}</>}</For>
      <Show when={missing().length > 0}>
        <UnavailableBandsStrip
          testId={props.testId}
          surfacesTestId={props.surfacesTestId}
          retryTestId={props.retryTestId}
          surfaces={missing()}
          onRetry={props.onRetry}
          onToggle={props.onToggle}
          open={props.open}
        />
      </Show>
    </>
  );
}

const GAINER_COLOR = palette.POSITIVE;
const LOSER_COLOR = palette.NEGATIVE;
// Values stay at the 13px body step; on a phone the strip wraps whole mover
// groups rather than shrinking or ellipsing a symbol/percentage.
const VALUE_FONT = REPORT_FONT.body;
const ARROW_GAINER = "▲";
const ARROW_LOSER = "▼";

function MoverItem(props: {
  row: IndexMoverRow;
  isGainer: boolean;
  onOpen?: (symbol: string) => void;
}) {
  const row = () => props.row;
  const isGainer = () => props.isGainer;
  const arrow = () => (isGainer() ? ARROW_GAINER : ARROW_LOSER);
  const color = () => (isGainer() ? GAINER_COLOR : LOSER_COLOR);
  const signed = () => (isGainer() ? "+" : "");
  const symbolStyle = () => ({
    "font-size": `${VALUE_FONT}px`,
    "font-variant-numeric": "tabular-nums",
    color: color(),
    "font-family": palette.MONO,
  });
  return (
    <span
      class="inline-flex items-center gap-2 shrink-0 whitespace-nowrap"
    >
      <Text
        span
        size="xs"
        data-report-text="label"
        class="text-ui-micro"
        style={{ color: color() }}
      >
        {arrow()}
      </Text>
      <Show
        when={props.onOpen}
        fallback={
          <Text
            span
            size="xs"
            fw={700}
            data-report-text="value"
            class="text-ui-body"
            style={symbolStyle()}
          >
            {row().symbol}
          </Text>
        }
      >
        <button
          type="button"
          data-testid={`movers-symbol-${row().symbol}`}
          data-report-text="value"
          aria-label={`Open ${row().symbol} chart`}
          title={`Open ${row().symbol} chart`}
          onClick={() => props.onOpen?.(row().symbol)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            props.onOpen?.(row().symbol);
          }}
          class="text-ui-body cursor-pointer border-0 bg-transparent p-0 font-bold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fin-primary"
          style={symbolStyle()}
        >
          {row().symbol}
        </button>
      </Show>
      <Text
        span
        size="xs"
        fw={700}
        data-report-text="value"
        class="text-ui-body tabular-nums"
        style={{
          "font-size": `${VALUE_FONT}px`,
          "font-variant-numeric": "tabular-nums",
          color: color(),
          "font-family": palette.MONO,
        }}
      >
        {signed()}{row().change_pct.toFixed(2)}%
      </Text>
    </span>
  );
}

/** Gain/loss section (left or right). The per-symbol arrow already carries
 *  the direction, so the section no longer repeats it as a label. */
function MoverSection(props: {
  rows: IndexMoverRow[];
  isGainer: boolean;
  onOpen?: (symbol: string) => void;
}) {
  return (
    <span class="flex items-center gap-2 min-w-0 shrink-0">
      <For each={props.rows}>
        {(row) => (
          <MoverItem row={row} isGainer={props.isGainer} onOpen={props.onOpen} />
        )}
      </For>
    </span>
  );
}

/**
 * Compact movers strip — visible in live mode under WINDOWS, above WALLS.
 * Shows top 3 gainers + bottom 3 losers, one line, EXPAND button.
 * EOD/replay: collapsed (no empty band, no fake rows).
 * RELIANCE: parent should not render this component.
 */
export function IndexMoversStrip(props: IndexMoversStripProps) {
  const index = () => props.index;
  const liveOnly = () => props.liveOnly ?? false;
  const dock = useSymbolDock();
  // Index names are symbol chips too: NIFTY 50 / SENSEX 30 open the canonical
  // index chart in the app-wide dock, never the report's underlying Select.
  const openIndex = (value: "NIFTY" | "SENSEX") =>
    dock.open(value === "SENSEX" ? "SENSEX" : "NIFTY");
  const openSymbol = (symbol: string) =>
    (props.onOpenSymbol ?? ((s) => dock.open(s)))(symbol);
  const [data, setData] = createSignal<IndexMoversResponse | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let abortController: AbortController | null = null;
  let mounted = true;

  const poll = async () => {
    if (!mounted || liveOnly()) return;
    abortController?.abort();
    const controller = new AbortController();
    abortController = controller;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchIndexMovers(index(), 5, controller.signal);
      if (!mounted || controller.signal.aborted) return;
      setData(res);
    } catch (e) {
      if (!mounted || controller.signal.aborted) return;
      if (e instanceof Error && e.message === "MOVERS_UNAVAILABLE") {
        setError("unavailable");
      } else {
        setError(e instanceof Error ? e.message : "Failed to load movers");
      }
    } finally {
      if (mounted) setLoading(false);
    }
  };

  createEffect(() => {
    // Track the index/liveOnly inputs so switching re-arms the poll.
    index();
    liveOnly();
    mounted = true;
    if (!liveOnly()) {
      void poll();
      const id = window.setInterval(() => void poll(), 30_000);
      onCleanup(() => window.clearInterval(id));
    }
    onCleanup(() => {
      mounted = false;
      abortController?.abort();
    });
  });

  const isLoading = () => props.loading ?? loading();
  const isError = () => props.error ?? error();

  // Stale detection: backend sets the `stale` flag
  const isStale = () => data()?.stale === true;

  const gainers = () => data()?.gainers ?? [];
  const losers = () => data()?.losers ?? [];

  // The striped lane can be squeezed below its content width on a wide-viewport
  // desk panel; the full mover text stays reachable from the tooltip.
  const moversTitle = () => {
    const label = `MOVERS · ${index()} ${index() === "NIFTY" ? "50" : "30"}`;
    const format = (row: IndexMoverRow, isGainer: boolean) =>
      `${isGainer ? ARROW_GAINER : ARROW_LOSER} ${row.symbol} ${isGainer ? "+" : ""}${row.change_pct.toFixed(2)}%`;
    return [
      label,
      ...gainers().map((row) => format(row, true)),
      ...losers().map((row) => format(row, false)),
    ].join("  ");
  };

  const dataView = () => (
    <div
      data-testid="movers-strip"
      data-report-spacing="8"
      class="flex items-center justify-between gap-2 h-[24px] min-h-[24px] px-2 bg-fin-surface font-mono text-ui-micro whitespace-nowrap shrink-0 max-[700px]:h-auto max-[700px]:min-h-0 max-[700px]:flex-wrap max-[700px]:gap-y-1 max-[700px]:py-1"
    >
      <span
        data-testid="movers-row"
        title={moversTitle()}
        class="inline-flex items-center gap-2 min-w-0 flex-auto overflow-hidden max-[700px]:flex-wrap max-[700px]:gap-y-1"
        style={{ "text-overflow": "ellipsis" }}
      >
        <button
          type="button"
          data-testid="movers-index"
          data-report-text="label"
          title={`Open ${index()} index report`}
          onClick={() => openIndex(index())}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            openIndex(index());
          }}
          class="shrink-0 cursor-pointer border-0 bg-transparent p-0 font-bold tracking-[0.08em] text-ui-micro focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fin-primary"
          style={{ color: palette.TEXT_MUTED }}
        >
          MOVERS · {index()} {index() === "NIFTY" ? "50" : "30"}
        </button>

        {/* Gainers */}
        <MoverSection rows={gainers()} isGainer={true} onOpen={openSymbol} />

        {/* Separator — fixed 1px: a stretched flex item would push the
            losers past the strip edge. On a phone the groups wrap instead. */}
        <span
          aria-hidden="true"
          class="shrink-0 self-center mx-2 h-[10px] w-[1px] min-w-[1px]"
          style={{ "background-color": palette.alpha(palette.BORDER, 0.6) }}
        />

        {/* Losers */}
        <MoverSection rows={losers()} isGainer={false} onOpen={openSymbol} />
      </span>

      {/* Right side: EXPAND button + stale badge */}
      <span data-testid="movers-actions" class="flex items-center gap-2 shrink-0">
        <Show when={isStale()}>
          <Tooltip label={`Data is stale (${data()?.as_of})`} position="bottom-start">
            <span
              class="inline-flex items-center gap-1 px-[2px] py-[1px] rounded-sm text-ui-micro font-bold tracking-[0.05em] whitespace-nowrap"
              style={{
                "background-color": palette.alpha(palette.WARNING, 0.12),
                color: palette.WARNING,
              }}
            >
              STALE
            </span>
          </Tooltip>
        </Show>
        <button
          type="button"
          data-testid="movers-expand"
          class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-fin border border-fin-text-muted text-fin-text-muted bg-transparent hover:bg-fin-surface-alt transition-colors duration-150 min-w-0 shrink-0 h-[20px] px-1 py-0 text-ui-micro font-bold tracking-[0.08em] uppercase"
          onClick={() => props.onExpand()}
          aria-label="Expand index movers"
          title="Expand index movers"
        >
          EXPAND
          <IconChevronRight size={12} />
        </button>
      </span>
    </div>
  );

  return (
    <Show
      when={liveOnly()}
      fallback={
        <Show
          when={isLoading() && !data()}
          fallback={
            <Show when={isError() && !data()} fallback={dataView()}>
              <UnavailableBandsStrip
                testId="movers-strip"
                retryTestId="movers-retry"
                label="MOVERS"
                message="unavailable"
                negative
                surfaces={props.unavailableSurfaces}
                onRetry={props.onRetry ?? (() => void poll())}
              />
            </Show>
          }
        >
          <UnavailableBandsStrip
            testId="movers-strip"
            retryTestId="movers-retry"
            label="MOVERS"
            message="loading…"
            surfaces={props.unavailableSurfaces}
          >
            <Loader size="xs" color={palette.PRIMARY} />
          </UnavailableBandsStrip>
        </Show>
      }
    >
      {/* Replay has no movers feed. The mode banner names MOVERS as unavailable
          once for every live-only band; an empty 24px strip adds no information. */}
      {null}
    </Show>
  );
}
