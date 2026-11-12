import { memo, useEffect, useState, useCallback, useRef } from "react";
import { Loader, Text, Tooltip } from "@/ui";
import { IconChevronRight } from "@tabler/icons-react";
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
function MoverItem({
  row,
  isGainer,
}: {
  row: IndexMoverRow;
  isGainer: boolean;
}) {
  const arrow = isGainer ? ARROW_GAINER : ARROW_LOSER;
  const color = isGainer ? GAINER_COLOR : LOSER_COLOR;
  const signed = isGainer ? "+" : "";
  return (
    <span
      className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap"
    >
      <Text
        span
        size="xs"
        fw={700}
        style={{
          "font-size": VALUE_FONT,
          "font-variant-numeric": "tabular-nums",
          color,
          "font-family": palette.MONO,
        }}
      >
        {arrow}
      </Text>
      <Text
        span
        size="xs"
        fw={700}
        style={{
          "font-size": VALUE_FONT,
          "font-variant-numeric": "tabular-nums",
          color,
          "font-family": palette.MONO,
        }}
      >
        {row.symbol}
      </Text>
      <Text
        span
        size="xs"
        fw={700}
        style={{
          "font-size": VALUE_FONT,
          "font-variant-numeric": "tabular-nums",
          color,
          "font-family": palette.MONO,
        }}
      >
        {signed}{row.change_pct.toFixed(2)}%
      </Text>
    </span>
  );
}

/** Gain/loss section (left or right). The per-symbol arrow already carries
 *  the direction, so the section no longer repeats it as a label. */
function MoverSection({
  rows,
  isGainer,
}: {
  rows: IndexMoverRow[];
  isGainer: boolean;
}) {
  return (
    <span className="flex items-center gap-2 min-w-0 shrink-0">
      {rows.map((row, i) => (
        <MoverItem key={`${row.symbol}-${i}`} row={row} isGainer={isGainer} />
      ))}
    </span>
  );
}

/**
 * Compact movers strip — always visible under WINDOWS, above WALLS.
 * Shows top 3 gainers + bottom 3 losers, one line, EXPAND button.
 * EOD/replay: "MOVERS · live only" (no fake rows).
 * RELIANCE: parent should not render this component.
 */
export const IndexMoversStrip = memo(function IndexMoversStrip({
  index,
  onExpand,
  liveOnly = false,
  loading: loadingProp,
  error: errorProp,
}: IndexMoversStripProps) {
  const [data, setData] = useState<IndexMoversResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Poll every 30s in live mode
  const poll = useCallback(async () => {
    if (!mountedRef.current || liveOnly) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchIndexMovers(index, 5, controller.signal);
      if (!mountedRef.current || controller.signal.aborted) return;
      setData(res);
    } catch (e) {
      if (!mountedRef.current || controller.signal.aborted) return;
      if (e instanceof Error && e.message === "MOVERS_UNAVAILABLE") {
        setError("unavailable");
      } else {
        setError(e instanceof Error ? e.message : "Failed to load movers");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [index, liveOnly]);

  // Initial load + interval
  useEffect(() => {
    mountedRef.current = true;
    if (!liveOnly) {
      poll();
      pollTimerRef.current = window.setInterval(poll, 30_000);
    }
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [poll, liveOnly]);

  // Use parent's loading/error if provided, else local
  const isLoading = loadingProp ?? loading;
  const isError = errorProp ?? error;

  // Stale detection: backend sets the `stale` flag
  const isStale = data?.stale === true;

  // Live-only message
  if (liveOnly) {
    return (
      <div
        data-testid="movers-strip"
        className="flex items-center justify-center h-[24px] min-h-[24px] px-2 border-t border-fin-border border-b border-fin-border bg-fin-surface font-mono text-[11px] text-fin-text-muted"
      >
        <Text span size="xs" fw={700} c="dimmed" style={{ "letter-spacing": "0.1em" }}>
          MOVERS
        </Text>
        <Text span size="xs" c="dimmed" className="ml-4 italic" style={{ "font-size": REPORT_FONT.xs }}>
          · live only
        </Text>
      </div>
    );
  }

  // Strip chrome shared by loading / error / data states
  const stripChrome = (children: React.ReactNode) => (
    <div
      data-testid="movers-strip"
      className="flex items-center h-[24px] min-h-[24px] px-2 border-t border-fin-border border-b border-fin-border bg-fin-surface font-mono text-[11px]"
    >
      {children}
    </div>
  );

  // Loading state
  if (isLoading && !data) {
    return stripChrome(
      <>
        <Text span size="xs" fw={700} c="dimmed" style={{ "letter-spacing": "0.1em" }}>
          MOVERS
        </Text>
        <span className="ml-2 inline-flex items-center gap-1">
          <Loader size="xs" color={palette.PRIMARY} />
          <Text span size="xs" c="dimmed">
            loading…
          </Text>
        </span>
      </>
    );
  }

  // Error state
  if (isError && !data) {
    return stripChrome(
      <>
        <Text span size="xs" fw={700} c="dimmed" style={{ "letter-spacing": "0.1em" }}>
          MOVERS
        </Text>
        <Text span size="xs" c="error" className="ml-2">
          unavailable
        </Text>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-fin border border-fin-border text-fin-border bg-transparent hover:bg-fin-surface-alt transition-colors duration-150 px-2 py-0 text-[10px] font-bold ml-auto min-w-0"
          onClick={poll}
        >
          Retry
        </button>
      </>
    );
  }

  // Render data
  const gainers = data?.gainers ?? [];
  const losers = data?.losers ?? [];

  return (
    <div
      data-testid="movers-strip"
      className="flex items-center justify-between gap-2 h-[24px] min-h-[24px] px-2 border-t border-fin-border border-b border-fin-border bg-fin-surface font-mono text-[11px] whitespace-nowrap overflow-hidden shrink-0"
    >
      <span className="inline-flex items-center gap-1 min-w-0 flex-auto">
        <Text
          span
          size="xs"
          fw={700}
          c="dimmed"
          className="shrink-0 tracking-[0.1em] text-[11px]"
          style={{ color: palette.TEXT_MUTED }}
        >
          MOVERS · {index} {index === "NIFTY" ? "50" : "30"}
        </Text>

        {/* Gainers */}
        <MoverSection rows={gainers} isGainer={true} />

        {/* Separator — fixed 1px: a stretched flex item would push the
            losers past the strip's `overflow: hidden`. */}
        <span
          className="shrink-0 self-center mx-[2px] h-[10px] w-[1px] min-w-[1px]"
          style={{ "background-color": palette.TERM_BORDER }}
        />

        {/* Losers */}
        <MoverSection rows={losers} isGainer={false} />
      </span>

      {/* Right side: EXPAND button + stale badge */}
      <span className="flex items-center gap-1 shrink-0">
        {isStale && (
          <Tooltip label={`Data is stale (${data?.as_of})`} placement="bottom-start">
            <span
              className="inline-flex items-center gap-1 px-[2px] py-[1px] rounded-sm text-[10px] font-bold tracking-[0.05em] whitespace-nowrap"
              style={{
                border: `1px solid ${palette.WARNING}`,
                color: palette.WARNING,
              }}
            >
              STALE
            </span>
          </Tooltip>
        )}
        <button
          type="button"
          data-testid="movers-expand"
          className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-fin border border-fin-border text-fin-border bg-transparent hover:bg-fin-surface-alt transition-colors duration-150 min-w-0 shrink-0 h-[20px] px-1 py-0 text-[10px] font-bold tracking-[0.08em] uppercase"
          onClick={onExpand}
          aria-label="Expand index movers"
          title="Expand index movers"
        >
          EXPAND
          <IconChevronRight size={12} />
        </button>
      </span>
    </div>
  );
});

IndexMoversStrip.displayName = "IndexMoversStrip";
