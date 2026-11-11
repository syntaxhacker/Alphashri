import { memo, useEffect, useState, useCallback, useRef } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import { IconChevronRight } from "@tabler/icons-react";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import {
  REPORT_FONT,
  REPORT_ROW,
  REPORT_PAD,
  REPORT_RADIUS,
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
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      <Text
        span
        size="xs"
        fw={700}
        style={{
          fontSize: VALUE_FONT,
          fontVariantNumeric: "tabular-nums",
          color,
          fontFamily: palette.MONO,
        }}
      >
        {arrow}
      </Text>
      <Text
        span
        size="xs"
        fw={700}
        style={{
          fontSize: VALUE_FONT,
          fontVariantNumeric: "tabular-nums",
          color,
          fontFamily: palette.MONO,
        }}
      >
        {row.symbol}
      </Text>
      <Text
        span
        size="xs"
        fw={700}
        style={{
          fontSize: VALUE_FONT,
          fontVariantNumeric: "tabular-nums",
          color,
          fontFamily: palette.MONO,
        }}
      >
        {signed}{row.change_pct.toFixed(2)}%
      </Text>
    </Box>
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
    <Box
      component="span"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexShrink: 0,
        minWidth: 0,
      }}
    >
      {rows.map((row, i) => (
        <MoverItem key={`${row.symbol}-${i}`} row={row} isGainer={isGainer} />
      ))}
    </Box>
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
      <Box
        data-testid="movers-strip"
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: REPORT_ROW.normal,
          px: REPORT_PAD.md,
          borderTop: `1px solid ${palette.TERM_BORDER}`,
          borderBottom: `1px solid ${palette.TERM_BORDER}`,
          bgcolor: palette.TERM_HEADER,
          fontFamily: palette.MONO,
          fontSize: REPORT_FONT.xs,
          color: palette.TEXT_MUTED,
        }}
      >
        <Text span size="xs" fw={700} c="dimmed" style={{ letterSpacing: "0.1em" }}>
          MOVERS
        </Text>
        <Text span size="xs" c="dimmed" sx={{ ml: 2, fontStyle: "italic" }}>
          · live only
        </Text>
      </Box>
    );
  }

  // Loading state
  if (isLoading && !data) {
    return (
      <Box
        data-testid="movers-strip"
        sx={{
          display: "flex",
          alignItems: "center",
          height: REPORT_ROW.normal,
          px: REPORT_PAD.md,
          borderTop: `1px solid ${palette.TERM_BORDER}`,
          borderBottom: `1px solid ${palette.TERM_BORDER}`,
          bgcolor: palette.TERM_HEADER,
        }}
      >
        <Text span size="xs" fw={700} c="dimmed" style={{ letterSpacing: "0.1em" }}>
          MOVERS
        </Text>
        <Box
          component="span"
          sx={{ ml: 2, display: "inline-flex", alignItems: "center", gap: 4 }}
        >
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              border: `2px solid ${palette.TEXT_MUTED}`,
              borderTopColor: palette.PRIMARY,
              animation: "spin 0.8s linear infinite",
              "@keyframes spin": { to: { transform: "rotate(360deg)" } },
            }}
          />
          <Text span size="xs" c="dimmed">
            loading…
          </Text>
        </Box>
      </Box>
    );
  }

  // Error state
  if (isError && !data) {
    return (
      <Box
        data-testid="movers-strip"
        sx={{
          display: "flex",
          alignItems: "center",
          height: REPORT_ROW.normal,
          px: REPORT_PAD.md,
          borderTop: `1px solid ${palette.TERM_BORDER}`,
          borderBottom: `1px solid ${palette.TERM_BORDER}`,
          bgcolor: palette.TERM_HEADER,
        }}
      >
        <Text span size="xs" fw={700} c="dimmed" style={{ letterSpacing: "0.1em" }}>
          MOVERS
        </Text>
        <Text span size="xs" c="error" sx={{ ml: 2 }}>
          unavailable
        </Text>
        <Button
          size="sm"
          variant="subtle"
          onClick={poll}
          sx={{ ml: "auto", minWidth: 0, px: 1, fontSize: REPORT_FONT.micro }}
        >
          Retry
        </Button>
      </Box>
    );
  }

  // Render data
  const gainers = data?.gainers ?? [];
  const losers = data?.losers ?? [];

  return (
    <Box
      data-testid="movers-strip"
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: REPORT_PAD.md,
        height: REPORT_ROW.normal,
        minHeight: REPORT_ROW.normal,
        px: REPORT_PAD.md,
        borderTop: `1px solid ${palette.TERM_BORDER}`,
        borderBottom: `1px solid ${palette.TERM_BORDER}`,
        bgcolor: palette.TERM_HEADER,
        fontFamily: palette.MONO,
        fontSize: REPORT_FONT.xs,
        whiteSpace: "nowrap",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <Box
        component="span"
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: REPORT_PAD.sm,
          minWidth: 0,
          flex: "1 1 auto",
        }}
      >
        <Text
          span
          size="xs"
          fw={700}
          c="dimmed"
          style={{ letterSpacing: "0.1em", flexShrink: 0 }}
        >
          MOVERS · {index} {index === "NIFTY" ? "50" : "30"}
        </Text>

        {/* Gainers */}
        <MoverSection rows={gainers} isGainer={true} />

        {/* Separator — fixed 1px: a stretched flex item would push the
            losers past the strip's `overflow: hidden`. */}
        <Box
          component="span"
          sx={{
            flex: "0 0 1px",
            width: "1px",
            minWidth: "1px",
            height: 10,
            alignSelf: "center",
            bgcolor: palette.TERM_BORDER,
            mx: REPORT_PAD.xs,
          }}
        />

        {/* Losers */}
        <MoverSection rows={losers} isGainer={false} />
      </Box>

      {/* Right side: EXPAND button + stale badge */}
      <Box
        component="span"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: REPORT_PAD.sm,
          flexShrink: 0,
        }}
      >
        {isStale && (
          <Tooltip title={`Data is stale (${data?.as_of})`} placement="bottom-start">
            <Box
              component="span"
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 2,
                px: REPORT_PAD.xs,
                py: "1px",
                border: `1px solid ${palette.WARNING}`,
                borderRadius: REPORT_RADIUS.sm,
                color: palette.WARNING,
                fontSize: REPORT_FONT.micro,
                fontWeight: 700,
                letterSpacing: "0.05em",
              }}
            >
              STALE
            </Box>
          </Tooltip>
        )}
        <Button
          data-testid="movers-expand"
          size="sm"
          variant="subtle"
          onClick={onExpand}
          aria-label="Expand index movers"
          title="Expand index movers"
          sx={{
            minWidth: 0,
            px: REPORT_PAD.sm,
            py: 0,
            height: 20,
            fontSize: REPORT_FONT.micro,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            border: `1px solid ${palette.TERM_BORDER}`,
            borderRadius: REPORT_RADIUS.sm,
            display: "inline-flex",
            alignItems: "center",
            gap: 2,
          }}
        >
          EXPAND
          <IconChevronRight size={12} />
        </Button>
      </Box>
    </Box>
  );
});

IndexMoversStrip.displayName = "IndexMoversStrip";