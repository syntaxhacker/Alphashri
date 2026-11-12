import { Text } from "@/ui";
import { createEffect, createMemo, createSignal, For, Show, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
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
    <div
      data-testid="nifty-flowstrip-legend"
      aria-label="Flow strip legend"
      class="flex flex-wrap items-center gap-x-2 gap-y-[2px] text-[9px] leading-[1.2] font-mono text-fin-text-muted px-[6px] py-[2px] border-b border-fin-border bg-white/[0.03]"
    >
      <span class="text-[9px] tracking-[0.08em] opacity-60">
        FLOW
      </span>
      <For each={FLOW_LEGEND}>
        {(item) => (
          <span
            data-testid={`nifty-flowstrip-legend-${item.id}`}
            title={item.title}
            class="inline-flex items-center gap-1 whitespace-nowrap"
          >
            <span
              data-testid={`nifty-flowstrip-legend-${item.id}-swatch`}
              aria-hidden
              class="inline-block shrink-0 w-2 h-2 rounded-[1px]"
              style={{ "background-color": item.color }}
            />
            <span>{item.text}</span>
          </span>
        )}
      </For>
    </div>
  );
}

interface NiftyFlowStripProps {
  rows: FlowTapeRow[];
  burstThreshold?: number;
  maxLabels?: number;
}

export function NiftyFlowStrip(props: NiftyFlowStripProps) {
  const rows = () => props.rows;
  const maxLabels = () => props.maxLabels ?? FLOW_MAX_LABELS;
  const events = createMemo(
    () => buildFlowEvents(rows(), props.burstThreshold !== undefined ? { burstThreshold: props.burstThreshold } : {}),
  );
  const buckets = createMemo(() => groupFlowRuns(events()));

  // Fit the one-line summary to the measured lane width. A character budget
  // (rather than CSS ellipsis) guarantees we never clip halfway through a
  // number: buckets are whole strings or they move into `+N earlier`.
  let labelsRef: HTMLDivElement | undefined;
  const [maxChars, setMaxChars] = createSignal(FLOW_SUMMARY_MAX_CHARS);

  createEffect(() => {
    const el = labelsRef;
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
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) {
      ro.observe(el);
      onCleanup(() => ro.disconnect());
    } else {
      window.addEventListener("resize", measure);
      onCleanup(() => window.removeEventListener("resize", measure));
    }
  });

  const summary = createMemo(
    () => summarizeFlowRuns(buckets(), { maxLabels: maxLabels(), maxChars: maxChars() }),
  );

  const leftPct = (t: string): string => flowTickPct(t);
  const sep = (
    <span
      aria-hidden
      class="shrink-0 opacity-45 text-fin-text-muted"
    >
      ·
    </span>
  );

  const emptyView = () => (
    <div data-testid="nifty-flowstrip-empty" class="py-2 text-center">
      <Text size="xs" c="dimmed" data-testid="nifty-flowstrip-empty-text">
        no flow events
      </Text>
    </div>
  );

  const stripView = () => (
    <div data-testid="nifty-flowstrip" class="w-full min-w-0">
      <FlowLegend />
      <div data-testid="nifty-flowstrip-lane" class="relative h-7 w-full">
        {/* baseline */}
        <div
          class="absolute left-0 right-0 top-[17px] h-0.5 opacity-25 bg-current"
        />
        <For each={events()}>
          {(e) => (
            <div
              data-testid="nifty-flow-tick"
              data-kind={e.kind}
              data-side={e.side}
              title={`${clockLabel(e.t)} · ${e.label}`}
              class="absolute top-[10px] w-[3px] h-[15px] -translate-x-1/2 rounded-[1px]"
              style={{ "left": leftPct(e.t), "background-color": tickColor(e.side) }}
            />
          )}
        </For>
      </div>
      {/* One-line, run-aggregated summary. Ticks above keep every raw print;
          this row answers "what actually happened" instead of listing six
          near-identical Put unwind minutes in a row. */}
      <div
        ref={(el) => (labelsRef = el)}
        data-testid="nifty-flowstrip-labels"
        title={summary().fullText}
        class="flex items-center gap-x-[6px] min-w-0 max-w-full overflow-hidden whitespace-nowrap font-mono text-[10px] leading-[1.2] text-fin-text-muted tabular-nums px-[6px] py-[2px]"
      >
        <Show when={summary().showMarker && summary().hidden > 0}>
          <span
            data-testid="nifty-flowstrip-more"
            title={`${summary().hidden} older run${summary().hidden === 1 ? "" : "s"} hidden — ${summary().fullText}`}
            class="shrink-0 opacity-75"
          >
            +{summary().hidden} earlier
          </span>
          {sep}
        </Show>
        <For each={summary().visible}>
          {(b, i) => (
            <>
              <Show when={i() > 0}>{sep}</Show>
              <span
                data-testid="nifty-flow-label"
                data-kind={b.kind}
                data-count={b.count}
                data-total={Math.round(b.total)}
                title={b.detail}
                class="shrink-0"
                style={{ "color": tickColor(b.side) }}
              >
                {b.label}
              </span>
            </>
          )}
        </For>
      </div>
    </div>
  );

  return (
    <Show when={events().length > 0} fallback={emptyView()}>
      {stripView()}
    </Show>
  );
}
