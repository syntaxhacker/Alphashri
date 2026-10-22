import { Box, Text } from "@/ui";
import { BORDER, MONO, TEXT_MUTED } from "@/ui/palette";
import { useMemo } from "react";
import { buildFlowEvents, type FlowSide, type FlowTapeRow } from "./niftyFlowStrip";

export const FLOW_BULL = "#16A34A";
export const FLOW_BEAR = "#DC2626";
export const FLOW_STRUCT = "#F59E0B";

/** At most this many text labels; ticks always render for every event. */
const FLOW_MAX_LABELS = 12;

/** NSE continuous session bounds — the strip's time axis, minute of day. */
const FLOW_SESSION_START_MIN = 9 * 60 + 15;
const FLOW_SESSION_END_MIN = 15 * 60 + 29;

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
    text: "green = put build / call unwind",
    title: "Green tick — put OI built or call OI unwound (bullish)",
  },
  {
    id: "bear",
    color: FLOW_BEAR,
    text: "red = call build / put unwind",
    title: "Red tick — call OI built or put OI unwound (bearish)",
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

export function NiftyFlowStrip({ rows, burstThreshold, maxLabels = FLOW_MAX_LABELS }: NiftyFlowStripProps) {
  const events = useMemo(
    () => buildFlowEvents(rows, burstThreshold !== undefined ? { burstThreshold } : {}),
    [rows, burstThreshold],
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

  // Labels: keep the lane readable — the largest-magnitude events win.
  const labeled = useMemo(() => {
    const top = events
      .map((e, i) => ({ e, i }))
      .sort((a, b) => b.e.magnitude - a.e.magnitude || a.i - b.i)
      .slice(0, Math.max(0, maxLabels))
      .map(({ i }) => i);
    return new Set(top);
  }, [events, maxLabels]);

  const leftPct = (t: string): string => flowTickPct(t);

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
            title={`${e.t} · ${e.label}`}
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
      <Box data-testid="nifty-flowstrip-labels" sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
        {events.map((e, i) =>
          labeled.has(i) ? (
            <Text
              key={`lbl-${e.t}-${e.kind}-${i}`}
              size="xs"
              c="dimmed"
              span
              data-testid="nifty-flow-label"
              data-kind={e.kind}
              title={`${e.t} · ${e.label}`}
            >
              {e.label}
            </Text>
          ) : null,
        )}
      </Box>
    </Box>
  );
}
