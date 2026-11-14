import { createEffect, createSignal, For, Show, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import { Loader, Text, Tooltip } from "@/ui";
import { IconChevronRight } from "@/components/common/Icons";
import * as palette from "@/ui/palette";
import {
  REPORT_FONT,
} from "./reportTokens";
import { fetchIndexMovers, IndexMoversResponse, IndexMoverRow } from "@/api/indexMovers";

interface IndexMoversStripProps {
  /** "NIFTY" | "SENSEX" — RELIANCE hides the strip entirely. */
  index: "NIFTY" | "SENSEX";
  /** Called when user clicks EXPAND. */
  onExpand: () => void;
  /** Optional: when in EOD/replay mode, strip shows "live only" message. */
  liveOnly?: boolean;
  /** Loading/error states from parent (optional override). */
  loading?: boolean;
  error?: string | null;
}

const GAINER_COLOR = palette.POSITIVE;   // green
const LOSER_COLOR = palette.NEGATIVE;    // red
// 11px keeps 5+5 worst-case symbols inside a 1440px strip.
const VALUE_FONT = REPORT_FONT.xs;
const ARROW_GAINER = "▲";
const ARROW_LOSER = "▼";

/** One mover line: symbol + % change. */
function MoverItem(props: { row: IndexMoverRow; isGainer: boolean }) {
  const row = () => props.row;
  const isGainer = () => props.isGainer;
  const arrow = () => (isGainer() ? ARROW_GAINER : ARROW_LOSER);
  const color = () => (isGainer() ? GAINER_COLOR : LOSER_COLOR);
  const signed = () => (isGainer() ? "+" : "");
  return (
    <span
      class="inline-flex items-center gap-1 shrink-0 whitespace-nowrap"
    >
      <Text
        span
        size="xs"
        fw={700}
        style={{
          "font-size": `${VALUE_FONT}px`,
          "font-variant-numeric": "tabular-nums",
          color: color(),
          "font-family": palette.MONO,
        }}
      >
        {arrow()}
      </Text>
      <Text
        span
        size="xs"
        fw={700}
        style={{
          "font-size": `${VALUE_FONT}px`,
          "font-variant-numeric": "tabular-nums",
          color: color(),
          "font-family": palette.MONO,
        }}
      >
        {row().symbol}
      </Text>
      <Text
        span
        size="xs"
        fw={700}
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
function MoverSection(props: { rows: IndexMoverRow[]; isGainer: boolean }) {
  return (
    <span class="flex items-center gap-2 min-w-0 shrink-0">
      <For each={props.rows}>
        {(row) => <MoverItem row={row} isGainer={props.isGainer} />}
      </For>
    </span>
  );
}

/**
 * Compact movers strip — always visible under WINDOWS, above WALLS.
 * Shows top 3 gainers + bottom 3 losers, one line, EXPAND button.
 * EOD/replay: "MOVERS · live only" (no fake rows).
 * RELIANCE: parent should not render this component.
 */
export function IndexMoversStrip(props: IndexMoversStripProps) {
  const index = () => props.index;
  const liveOnly = () => props.liveOnly ?? false;
  const [data, setData] = createSignal<IndexMoversResponse | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let abortController: AbortController | null = null;
  let mounted = true;

  // Poll every 30s in live mode
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

  // Initial load + interval
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

  // Use parent's loading/error if provided, else local
  const isLoading = () => props.loading ?? loading();
  const isError = () => props.error ?? error();

  // Stale detection: backend sets the `stale` flag
  const isStale = () => data()?.stale === true;

  const stripChrome = (children: JSX.Element) => (
    <div
      data-testid="movers-strip"
      class="flex items-center h-[24px] min-h-[24px] px-2 border-t border-fin-border border-b border-fin-border bg-fin-surface font-mono text-[11px]"
    >
      {children}
    </div>
  );

  // Render data
  const gainers = () => data()?.gainers ?? [];
  const losers = () => data()?.losers ?? [];

  const dataView = () => (
    <div
      data-testid="movers-strip"
      class="flex items-center justify-between gap-2 h-[24px] min-h-[24px] px-2 border-t border-fin-border border-b border-fin-border bg-fin-surface font-mono text-[11px] whitespace-nowrap overflow-hidden shrink-0"
    >
      <span class="inline-flex items-center gap-1 min-w-0 flex-auto">
        <Text
          span
          size="xs"
          fw={700}
          c="dimmed"
          className="shrink-0 tracking-[0.1em] text-[11px]"
          style={{ color: palette.TEXT_MUTED }}
        >
          MOVERS · {index()} {index() === "NIFTY" ? "50" : "30"}
        </Text>

        {/* Gainers */}
        <MoverSection rows={gainers()} isGainer={true} />

        {/* Separator — fixed 1px: a stretched flex item would push the
            losers past the strip's `overflow: hidden`. */}
        <span
          class="shrink-0 self-center mx-[2px] h-[10px] w-[1px] min-w-[1px]"
          style={{ "background-color": palette.TERM_BORDER }}
        />

        {/* Losers */}
        <MoverSection rows={losers()} isGainer={false} />
      </span>

      {/* Right side: EXPAND button + stale badge */}
      <span class="flex items-center gap-1 shrink-0">
        <Show when={isStale()}>
          <Tooltip label={`Data is stale (${data()?.as_of})`} position="bottom-start">
            <span
              class="inline-flex items-center gap-1 px-[2px] py-[1px] rounded-sm text-[10px] font-bold tracking-[0.05em] whitespace-nowrap"
              style={{
                border: `1px solid ${palette.WARNING}`,
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
          class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-fin border border-fin-border text-fin-border bg-transparent hover:bg-fin-surface-alt transition-colors duration-150 min-w-0 shrink-0 h-[20px] px-1 py-0 text-[10px] font-bold tracking-[0.08em] uppercase"
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
              {stripChrome(
                <>
                  <Text span size="xs" fw={700} c="dimmed" style={{ "letter-spacing": "0.1em" }}>
                    MOVERS
                  </Text>
                  <Text span size="xs" c="error" className="ml-2">
                    unavailable
                  </Text>
                  <button
                    type="button"
                    class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-fin border border-fin-border text-fin-border bg-transparent hover:bg-fin-surface-alt transition-colors duration-150 px-2 py-0 text-[10px] font-bold ml-auto min-w-0"
                    onClick={() => void poll()}
                  >
                    Retry
                  </button>
                </>,
              )}
            </Show>
          }
        >
          {stripChrome(
            <>
              <Text span size="xs" fw={700} c="dimmed" style={{ "letter-spacing": "0.1em" }}>
                MOVERS
              </Text>
              <span class="ml-2 inline-flex items-center gap-1">
                <Loader size="xs" color={palette.PRIMARY} />
                <Text span size="xs" c="dimmed">
                  loading…
                </Text>
              </span>
            </>,
          )}
        </Show>
      }
    >
      <div
        data-testid="movers-strip"
        class="flex items-center justify-center h-[24px] min-h-[24px] px-2 border-t border-fin-border border-b border-fin-border bg-fin-surface font-mono text-[11px] text-fin-text-muted"
      >
        <Text span size="xs" fw={700} c="dimmed" style={{ "letter-spacing": "0.1em" }}>
          MOVERS
        </Text>
        <Text span size="xs" c="dimmed" className="ml-4 italic" style={{ "font-size": `${REPORT_FONT.xs}px` }}>
          · live only
        </Text>
      </div>
    </Show>
  );
}
