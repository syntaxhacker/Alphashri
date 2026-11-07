import { Box, Text } from "@/ui";
import { BORDER, MONO, TEXT_MUTED } from "@/ui/palette";
import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import {
  buildFlowEvents,
  clockLabel,
  FLOW_SUMMARY_MAX_CHARS,
  groupFlowRuns,
  summarizeFlowRuns,
  type FlowSide,
  type FlowTapeRow,
} from "./niftyFlowStrip";
import { DERIVATIVES_CLOSE_MIN, SESSION_START_MIN } from "@/utils/marketClock";

export const FLOW_BULL = "#16A34A";
export const FLOW_BEAR = "#DC2626";
export const FLOW_STRUCT = "#F59E0B";

/** At most this many text labels; ticks always render for every event. */
/** Text lane shows only the newest runs; the tooltip keeps the full history. */
const FLOW_MAX_LABELS = 3;

/** NSE derivatives session bounds — the strip's time axis, minute of day. */
const FLOW_SESSION_START_MIN = SESSION_START_MIN;
const FLOW_SESSION_END_MIN = DERIVATIVES_CLOSE_MIN;

/** `"10:33"` / `"2026-10-19T10:33:00+05:30"` → minute of day, else null. */
function flowMinuteOfDay(t: string): number | null {
  const m = /(?:^|[T ])(\d{2}):(\d{2})/.exec(t || "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Horizontal position of an event on the session axis. Ticks are placed by
 * **wall-clock time**, not by their index in the event list: three events at
 * 09:20 / 09:25 / 15:00 must not spread across 0 / 50 / 100% (that put the
 * 09:25 print in the middle of the afternoon), and a burst at 15:00 must land
 * at the right edge under the heatmap's matching column.
 */
export function flowTickPct(t: string): string {
  const min = flowMinuteOfDay(t);
  if (min === null) return "50%";
  const span = FLOW_SESSION_END_MIN - FLOW_SESSION_START_MIN;
  const clamped = Math.min(
    FLOW_SESSION_END_MIN,
    Math.max(FLOW_SESSION_START_MIN, min),
  );
  return `${((clamped - FLOW_SESSION_START_MIN) / span) * 100}%`;
}

function tickColor(side: FlowSide): string {
  if (side === "bullish") return FLOW_BULL;
  if (side === "bearish") return FLOW_BEAR;
  return FLOW_STRUCT;
}

const FLOW_LEGEND: { id: string; color: string; text: string; title: string }[] = [
  {
    id: "bull",
    color: FLOW_BULL,
    text: "green = puts sold / calls bought back (bullish)",
    title:
      "Bullish OI: put OI built (put writing = support) or call OI fell (call writers covering). OI only — a fall is bearish when writers cover (premium up) and mild-bullish when buyers exit (premium down); the OI 1m strip names which one.",
  },
  {
    id: "bear",
    color: FLOW_BEAR,
    text: "red = calls sold / puts bought back (bearish)",
    title:
      "Bearish OI: call OI built (call writing = resistance) or put OI fell (put writers withdrawing support). OI only — a put OI fall is bearish when writers cover (premium up) and mild-bullish when buyers exit (premium down); the OI 1m strip names which one.",
  },
  {
    id: "struct",
    color: FLOW_STRUCT,
    text: "amber = structural (wall / max pain / ATM)",
    title: "Amber tick — a wall, max-pain or ATM strike moved",
  },
];

function FlowLegend() {
  return (
    <Box
      data-testid="nifty-flowstrip-legend"
      aria-label="Flow strip legend"
      sx={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        columnGap: "8px",
        rowGap: "2px",
        fontSize: 9,
        lineHeight: 1.2,
        fontFamily: MONO,
        color: TEXT_MUTED,
        px: 0.75,
        py: 0.25,
        borderBottom: `1px solid ${BORDER}`,
        backgroundColor: "rgba(255,255,255,0.03)",
      }}
    >
      <Box component="span" sx={{ fontSize: 9, letterSpacing: "0.08em", opacity: 0.6 }}>
        FLOW
      </Box>
      {FLOW_LEGEND.map((item) => (
        <Box
          key={item.id}
          component="span"
          data-testid={`nifty-flowstrip-legend-${item.id}`}
          title={item.title}
          sx={{ display: "inline-flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}
        >
          <Box
            component="span"
            data-testid={`nifty-flowstrip-legend-${item.id}-swatch`}
            aria-hidden
            sx={{
              display: "inline-block",
              flexShrink: 0,
              width: 8,
              height: 8,
              borderRadius: "1px",
              backgroundColor: item.color,
            }}
          />
          <Box component="span">{item.text}</Box>
        </Box>
      ))}
    </Box>
  );
}

interface NiftyFlowStripProps {
  rows: FlowTapeRow[];
  burstThreshold?: number;
  maxLabels?: number;
}

function NiftyFlowStripInner({ rows, burstThreshold, maxLabels = FLOW_MAX_LABELS }: NiftyFlowStripProps) {
  const events = useMemo(
    () => buildFlowEvents(rows, burstThreshold !== undefined ? { burstThreshold } : {}),
    [rows, burstThreshold],
  );
  const buckets = useMemo(() => groupFlowRuns(events), [events]);

  // Fit the one-line summary to the measured lane width. A character budget
  // (rather than CSS ellipsis) guarantees we never clip halfway through a
  // number: buckets are whole strings or they move into `+N earlier`.
  const labelsRef = useRef<HTMLDivElement | null>(null);
  const [maxChars, setMaxChars] = useState(FLOW_SUMMARY_MAX_CHARS);

  useEffect(() => {
    const el = labelsRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      if (width > 0) {
        // 10px monospace ≈ 6.4px/char (conservative). Subtract the 12px of
        // horizontal padding and one char of slack; the separator/gap cost is
        // modelled inside `summarizeFlowRuns` so the tail is never clipped.
        setMaxChars(Math.max(24, Math.floor((width - 12) / 6.4) - 1));
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const summary = useMemo(
    () => summarizeFlowRuns(buckets, { maxLabels, maxChars }),
    [buckets, maxLabels, maxChars],
  );

  if (events.length === 0) {
    return (
      <Box data-testid="nifty-flowstrip-empty" sx={{ py: 1, textAlign: "center" }}>
        <Text size="xs" c="dimmed" data-testid="nifty-flowstrip-empty-text">
          no flow events
        </Text>
      </Box>
    );
  }

  const leftPct = (t: string): string => flowTickPct(t);
  const sep = (
    <Box
      component="span"
      aria-hidden
      sx={{ flexShrink: 0, opacity: 0.45, color: TEXT_MUTED }}
    >
      ·
    </Box>
  );

  return (
    <Box data-testid="nifty-flowstrip" sx={{ width: "100%", minWidth: 0 }}>
      <FlowLegend />
      <Box data-testid="nifty-flowstrip-lane" sx={{ position: "relative", height: 28, width: "100%" }}>
        {/* baseline */}
        <Box
          sx={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 17,
            height: 2,
            opacity: 0.25,
            backgroundColor: "currentColor",
          }}
        />
        {events.map((e, i) => (
          <Box
            key={`${e.t}-${e.kind}-${i}`}
            data-testid="nifty-flow-tick"
            data-kind={e.kind}
            data-side={e.side}
            title={`${clockLabel(e.t)} · ${e.label}`}
            sx={{
              position: "absolute",
              left: leftPct(e.t),
              top: 10,
              width: 3,
              height: 15,
              transform: "translateX(-50%)",
              borderRadius: 1,
              backgroundColor: tickColor(e.side),
            }}
          />
        ))}
      </Box>
      {/* One-line, run-aggregated summary. Ticks above keep every raw print;
          this row answers "what actually happened" instead of listing six
          near-identical Put unwind minutes in a row. */}
      <Box
        ref={labelsRef}
        data-testid="nifty-flowstrip-labels"
        title={summary.fullText}
        sx={{
          display: "flex",
          alignItems: "center",
          columnGap: "6px",
          minWidth: 0,
          maxWidth: "100%",
          overflow: "hidden",
          whiteSpace: "nowrap",
          fontFamily: MONO,
          fontSize: 10,
          lineHeight: 1.2,
          color: TEXT_MUTED,
          fontVariantNumeric: "tabular-nums",
          px: 0.75,
          py: 0.25,
        }}
      >
        {summary.showMarker && summary.hidden > 0 ? (
          <Fragment>
            <Box
              component="span"
              data-testid="nifty-flowstrip-more"
              title={`${summary.hidden} older run${summary.hidden === 1 ? "" : "s"} hidden — ${summary.fullText}`}
              sx={{ flexShrink: 0, opacity: 0.75 }}
            >
              +{summary.hidden} earlier
            </Box>
            {sep}
          </Fragment>
        ) : null}
        {summary.visible.map((b, i) => (
          <Fragment key={`${b.segment}-${b.start}-${i}`}>
            {i > 0 ? sep : null}
            <Box
              component="span"
              data-testid="nifty-flow-label"
              data-kind={b.kind}
              data-count={b.count}
              data-total={Math.round(b.total)}
              title={b.detail}
              sx={{ flexShrink: 0, color: tickColor(b.side) }}
            >
              {b.label}
            </Box>
          </Fragment>
        ))}
      </Box>
    </Box>
  );
}

/** Memoised: `rows` (the replay-filtered tape) is a stable memo between
 *  report frames, so the spot tick does not repaint the flow buckets. */
export const NiftyFlowStrip = memo(NiftyFlowStripInner);
NiftyFlowStrip.displayName = "NiftyFlowStrip";
