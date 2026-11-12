import { createMemo, createSignal, Show, For } from "solid-js";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import type { NiftyPositioningStrike } from "@/types/niftyReport";
import { sortByField, formatNumberIN } from "@/utils/ui-helpers";

/** Strike half-width kept around spot — same band as the option-chain OI. */
const DELTA_PROFILE_WINDOW_PTS = 750;

/** One plotted strike: its OI delta exposure, today's initiated flow, and the
 * running exposure total used to locate the Δ pivot. */
interface DeltaProfilePoint {
  strike: number;
  /** OI × |delta| (Cr), calls + / puts −. */
  netState: number;
  /** ΔOI × |delta| signed by class (Cr); + = bullish initiation. */
  netInitiated: number;
  /** Running Σ netState over the **whole** chain, so the zero crossing still
   * matches the backend's Δ pivot after windowing. */
  cumulative: number;
}

/**
 * Build the per-strike delta profile.
 *
 * `netState` (OI delta exposure) is what defines the Δ pivot, so it must be
 * accumulated **before** the ±window filter — resetting the sum at the first
 * visible strike would move the zero crossing and contradict the pivot chip.
 * Payloads recorded before `net_state` existed return `[]` (the panel then
 * shows its empty state instead of a fake flat line).
 */
export function buildDeltaProfile(
  strikes: NiftyPositioningStrike[] | null | undefined,
  spot?: number | null,
  width: number = DELTA_PROFILE_WINDOW_PTS,
): DeltaProfilePoint[] {
  const rows = sortByField(
    (Array.isArray(strikes) ? strikes : []).filter((s) => s && Number.isFinite(s.strike)),
    "strike",
    "asc",
  );
  if (rows.length === 0) return [];
  if (!rows.some((s) => Number.isFinite(s.netState as number))) return [];

  let cumulative = 0;
  const all = rows.map((s): DeltaProfilePoint => {
    const netState = Number.isFinite(s.netState as number)
      ? (s.netState as number)
      : 0;
    cumulative += netState;
    return {
      strike: s.strike,
      netState,
      netInitiated: Number.isFinite(s.netInitiated) ? s.netInitiated : 0,
      cumulative,
    };
  });

  if (!Number.isFinite(spot as number) || (spot as number) <= 0) return all;
  const near = all.filter(
    (p) => Math.abs(p.strike - (spot as number)) <= width,
  );
  return near.length > 0 ? near : all;
}

/** Nearest point index to a strike, or -1 when the level is missing or sits
 * outside the plotted band (a marker pinned to the edge would misstate it). */
function nearestIndex(
  points: DeltaProfilePoint[],
  level: number | null | undefined,
): number {
  if (!Number.isFinite(level as number) || points.length === 0) return -1;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = Math.abs(points[i].strike - (level as number));
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  const step =
    points.length > 1
      ? Math.abs(points[1].strike - points[0].strike)
      : 0;
  return bestDist <= Math.max(step, 1) ? best : -1;
}

const W = 600;
const PAD_X = 2;
const LINE_TOP = 8;
const LINE_H = 96;
const BAR_TOP = 116;
const BAR_H = 52;
const BAR_BASE = BAR_TOP + BAR_H / 2;
const H = BAR_TOP + BAR_H + 2;

/** Compress bar lengths: |v|^0.5 keeps a single wall from flattening the rest. */
function barHeight(value: number, maxAbs: number): number {
  if (!Number.isFinite(value) || maxAbs <= 0) return 0;
  const v = Math.abs(value);
  if (v === 0) return 0;
  return Math.max(0.6, Math.sqrt(v / maxAbs) * (BAR_H / 2));
}

interface DeltaProfileChartProps {
  points: DeltaProfilePoint[];
  spot?: number | null;
  flip?: number | null;
  /** Value formatter for the hover readout (e.g. signed crore). */
  formatValue?: (v: number) => string;
  testId?: string;
  emptyMessage?: string;
}

/**
 * Live delta-positioning visual: a cumulative exposure curve over today's
 * per-strike initiated flow.
 *
 * Reading it:
 *   - white curve = running Σ OI×delta (above 0 = long-delta book)
 *   - dotted grey line = zero; where the curve climbs through it is the pivot
 *   - green/red columns = today's initiated delta per strike
 *   - blue dashed = spot, gold dashed = Δ pivot
 *
 * Deliberately SVG (like the GEX panel): a 600px-wide chart over ~30 strikes
 * does not justify a canvas instance, and HTML remains readable by tests.
 */
export function DeltaProfileChart(props: DeltaProfileChartProps) {
  const points = () => props.points;
  const spot = () => props.spot ?? null;
  const flip = () => props.flip ?? null;
  const formatValue = () => props.formatValue ?? ((v: number) => formatNumberIN(Math.round(v)));
  const testId = () => props.testId ?? "nifty-positioning-profile";
  const emptyMessage = () => props.emptyMessage ?? "No strike breakdown";
  const [hover, setHover] = createSignal<number | null>(null);

  const bounds = createMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const p of points()) {
      if (p.cumulative < min) min = p.cumulative;
      if (p.cumulative > max) max = p.cumulative;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
    if (min === max) {
      const pad = Math.abs(min) * 0.05 || 1;
      return { min: min - pad, max: max + pad };
    }
    return { min, max };
  });

  const maxAbsFlow = createMemo(
    () => points().reduce((m, p) => Math.max(m, Math.abs(p.netInitiated)), 0),
  );

  const spotIdx = createMemo(() => nearestIndex(points(), spot()));
  const flipIdx = createMemo(() => nearestIndex(points(), flip()));

  const metrics = createMemo(() => {
    const b = bounds();
    const pts = points();
    const innerW = W - PAD_X * 2;
    const stepX = pts.length > 1 ? innerW / (pts.length - 1) : 0;
    const xOf = (i: number) => PAD_X + i * stepX;
    const span = b.max - b.min || 1;
    const yOf = (v: number) =>
      LINE_TOP + LINE_H - ((v - b.min) / span) * LINE_H;
    const zeroY = yOf(0);
    const zeroInBand = zeroY >= LINE_TOP - 0.5 && zeroY <= LINE_TOP + LINE_H + 0.5;
    const line = pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)} ${yOf(p.cumulative).toFixed(1)}`)
      .join(" ");
    const area = `${line} L${xOf(pts.length - 1).toFixed(1)} ${(LINE_TOP + LINE_H).toFixed(1)} L${PAD_X} ${(LINE_TOP + LINE_H).toFixed(1)} Z`;
    return { xOf, yOf, stepX, span, zeroY, zeroInBand, line, area };
  });

  const barW = () => Math.max(1.5, metrics().stepX * 0.62);
  const hoverPoint = () => (hover() != null ? points()[hover()!] : null);
  const hoverX = () => (hover() != null ? metrics().xOf(hover()!) : 0);

  const onMove = (e: MouseEvent & { currentTarget: SVGSVGElement }) => {
    const pts = points();
    if (pts.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round((x - PAD_X) / (metrics().stepX || 1));
    setHover(Math.max(0, Math.min(pts.length - 1, idx)));
  };

  const marker = (idx: number, color: string, key: string, dashed = true) =>
    idx >= 0 ? (
      <line
        data-testid={`${testId()}-marker-${key}`}
        x1={metrics().xOf(idx)}
        x2={metrics().xOf(idx)}
        y1={LINE_TOP}
        y2={BAR_TOP + BAR_H}
        stroke={color}
        stroke-dasharray={dashed ? "2 3" : undefined}
        stroke-width={dashed ? 1 : 1.25}
        vector-effect="non-scaling-stroke"
      />
    ) : null;

  const emptyView = () => (
    <div
      data-testid={testId()}
      class="flex items-center justify-center"
      style={{ flex: 1, "min-height": "120px" }}
    >
      <Text size="xs" c="dimmed" span>
        {emptyMessage()}
      </Text>
    </div>
  );

  const chartView = () => (
    <div
      data-testid={testId()}
      class="flex flex-col"
      style={{ flex: 1, "min-height": 0, "min-width": 0, gap: "2px" }}
    >
      <div class="min-h-[120px] min-w-0" style={{ flex: 1 }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ width: "100%", height: "100%", display: "block" }}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          role="img"
          aria-label="Cumulative delta exposure and today's initiated delta by strike"
        >
          {/* zero reference for the cumulative curve */}
          <Show when={metrics().zeroInBand}>
            <line
              x1={PAD_X}
              x2={W - PAD_X}
              y1={metrics().zeroY}
              y2={metrics().zeroY}
              stroke={palette.TEXT_MUTED}
              stroke-dasharray="3 3"
              stroke-width={1}
              vector-effect="non-scaling-stroke"
            />
          </Show>
          {marker(spotIdx(), palette.TERM_SPOT, "spot", false)}
          {marker(flipIdx(), palette.TERM_FLIP, "flip")}
          <path d={metrics().area} fill={palette.TEXT} opacity={0.06} stroke="none" />
          <path
            d={metrics().line}
            fill="none"
            stroke={palette.TEXT}
            stroke-width={1.6}
            vector-effect="non-scaling-stroke"
          />
          <For each={points()}>
            {(p, i) => {
              const h = barHeight(p.netInitiated, maxAbsFlow());
              if (h <= 0) return null;
              const up = p.netInitiated >= 0;
              return (
                <rect
                  x={metrics().xOf(i()) - barW() / 2}
                  y={up ? BAR_BASE - h : BAR_BASE}
                  width={barW()}
                  height={h}
                  fill={up ? palette.POSITIVE : palette.NEGATIVE}
                  opacity={0.72}
                />
              );
            }}
          </For>
          {/* baseline for the flow columns */}
          <line
            x1={PAD_X}
            x2={W - PAD_X}
            y1={BAR_BASE}
            y2={BAR_BASE}
            stroke={palette.CHART_BORDER}
            stroke-width={1}
            vector-effect="non-scaling-stroke"
          />
          <Show when={hover() != null}>
            <line
              x1={hoverX()}
              x2={hoverX()}
              y1={LINE_TOP}
              y2={BAR_TOP + BAR_H}
              stroke={palette.TEXT_MUTED}
              stroke-width={1}
              vector-effect="non-scaling-stroke"
            />
          </Show>
        </svg>
      </div>

      <div class="flex items-center justify-between" style={{ "min-width": 0, "padding-left": "2px", gap: "8px" }}>
        <div class="flex items-center gap-[10px]" style={{ "min-width": 0, "overflow": "hidden" }}>
          <Legend color={palette.TEXT} label="Cumulative δ" line />
          <Legend color={palette.POSITIVE} label="Flow +" block />
          <Legend color={palette.NEGATIVE} label="Flow −" block />
          <Legend color={palette.TERM_SPOT} label="Spot" line />
          <Legend color={palette.TERM_FLIP} label="Δ pivot" dashed />
        </div>
        <Text
          size="xs"
          c="dimmed"
          span
          data-testid={`${testId()}-readout`}
          className="tabular-nums whitespace-nowrap shrink-0"
        >
          {hoverPoint()
            ? `${formatNumberIN(hoverPoint()!.strike)} · cum ${formatValue()(hoverPoint()!.cumulative)} · flow ${formatValue()(hoverPoint()!.netInitiated)}`
            : `${formatNumberIN(points()[0].strike)}–${formatNumberIN(points()[points().length - 1].strike)}`}
        </Text>
      </div>
    </div>
  );

  return (
    <Show when={points().length > 0} fallback={emptyView()}>
      {chartView()}
    </Show>
  );
}

function Legend(props: {
  color: string;
  label: string;
  line?: boolean;
  dashed?: boolean;
  block?: boolean;
}) {
  const line = () => props.line ?? false;
  const dashed = () => props.dashed ?? false;
  const block = () => props.block ?? false;
  return (
    <div class="flex items-center gap-2 shrink-0" style={{ "flex-shrink": 0 }}>
      <div
        aria-hidden
        style={{
          "width": block() ? "6px" : "12px",
          "height": block() ? "6px" : "0",
          "border-radius": block() ? "1px" : "0",
          "background-color": block() ? props.color : "transparent",
          "border-top": line() || dashed() ? `1px ${dashed() ? "dashed" : "solid"} ${props.color}` : undefined,
          "opacity": 0.9,
        }}
      />
      <Text size="xs" c="dimmed" span>
        {props.label}
      </Text>
    </div>
  );
}
