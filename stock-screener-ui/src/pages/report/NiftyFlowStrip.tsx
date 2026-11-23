import { Text } from "@/ui";
import { FLOW_BEAR, FLOW_BULL, FLOW_STRUCT } from "@/ui/palette";
import { createEffect, createMemo, createSignal, For, Show, onCleanup } from "solid-js";
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
import { clockMinutes } from "./tapeRange";

export { FLOW_BEAR, FLOW_BULL, FLOW_STRUCT };

const FLOW_MAX_LABELS = 3;

/** NSE derivatives session bounds — the strip's time axis, minute of day. */
const FLOW_SESSION_START_MIN = SESSION_START_MIN;
const FLOW_SESSION_END_MIN = DERIVATIVES_CLOSE_MIN;

/** `"10:33"` / `"2026-10-19T10:33:00+05:30"` → minute of day, else null. */
function flowMinuteOfDay(t: string): number | null {
  if (!/(?:^|[T ])(\d{2}):(\d{2})/.test(t || "")) return null;
  return clockMinutes(t);
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

const FLOW_LEGEND: { id: string; code: string; color: string; text: string; title: string }[] = [
  {
    id: "bull",
    code: "BULL",
    color: FLOW_BULL,
    text: "green = puts sold / calls bought back (bullish)",
    title:
      "Bullish OI: put OI built (put writing = support) or call OI fell (call writers covering). OI only — a fall is bearish when writers cover (premium up) and mild-bullish when buyers exit (premium down); the OI 1m strip names which one.",
  },
  {
    id: "bear",
    code: "BEAR",
    color: FLOW_BEAR,
    text: "red = calls sold / puts bought back (bearish)",
    title:
      "Bearish OI: call OI built (call writing = resistance) or put OI fell (put writers withdrawing support). OI only — a put OI fall is bearish when writers cover (premium up) and mild-bullish when buyers exit (premium down); the OI 1m strip names which one.",
  },
  {
    id: "struct",
    code: "STRUCT",
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
      class="flex flex-wrap items-center gap-x-3 gap-y-1 text-ui-micro leading-[1.2] font-mono text-fin-text-muted px-2 py-1 border-b border-fin-border bg-white/[0.03]"
    >
      <span class="text-ui-micro font-bold tracking-[0.08em]">
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
            <span class="font-bold">{item.code}</span>
            <span class="hidden min-[720px]:inline">{item.text}</span>
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
        // 13px monospace ≈ 8px/char (conservative). Subtract the 16px of
        // horizontal padding and one char of slack; the separator/gap cost is
        // modelled inside `summarizeFlowRuns` so the tail is never clipped.
        setMaxChars(Math.max(16, Math.floor((width - 16) / 8) - 1));
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
        class="flex items-center gap-x-[6px] min-w-0 max-w-full overflow-x-auto whitespace-nowrap font-mono text-ui-body leading-[1.2] text-fin-text-muted tabular-nums px-2 py-1"
      >
        <Show when={summary().showMarker && summary().hidden > 0}>
          <span
            data-testid="nifty-flowstrip-more"
            title={`${summary().hidden} older run${summary().hidden === 1 ? "" : "s"} hidden — ${summary().fullText}`}
            class="shrink-0 opacity-75 text-ui-micro"
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
      <div
        data-testid="nifty-flowstrip-scroll-cue"
        class="text-ui-micro text-fin-text-muted px-2 pb-1 min-[720px]:hidden"
      >
        scroll → for older runs
      </div>
    </div>
  );

  return (
    <Show when={events().length > 0} fallback={emptyView()}>
      {stripView()}
    </Show>
  );
}
