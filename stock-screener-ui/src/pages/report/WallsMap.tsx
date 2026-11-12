import { createMemo, createSignal, For, Show } from "solid-js";
import { alpha } from "@/ui/alpha";
import type { WallsEvent, WallsMap as WallsMapData } from "@/api/reportNifty";
import * as palette from "@/ui/palette";
import { fmtNum, fmtOI, fmtPct, fmtSignedOI } from "./niftyWallsFormat";
import { wallCode, wallSide } from "./niftyChartMath";

const ROW_H = 15;
const HEADER_H = 14;
const AXIS_H = 18;
const PANEL_W = 520;
const NOW_W = 44;
const PLOT_W = PANEL_W - NOW_W;
const CENTER_W = 88;
const PUT_NOW_X = PANEL_W + CENTER_W;
const PUT_PLOT_X = PUT_NOW_X + NOW_W;
const TOTAL_W = PUT_PLOT_X + PLOT_W;

/** Red = erosion, green = build; brighter = larger move. */
const deltaFill = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value) || value === 0) return palette.SURFACE;
  // Saturate at a 35% move so the ordinary 10-20% wall erosion is clearly
  // visible; the old 50% ceiling left most of the map looking near-black.
  const magnitude = Math.min(1, Math.abs(value) / 0.35);
  return alpha(value < 0 ? palette.NEGATIVE : palette.POSITIVE, 0.2 + 0.7 * magnitude);
};

/** Absolute OI-change scale: size-aware, so a 50K row cannot shout like a 10M wall. */
const oiFill = (change: number, maxAbs: number): string => {
  if (!Number.isFinite(change) || change === 0 || maxAbs <= 0) return palette.SURFACE;
  const magnitude = Math.min(1, Math.abs(change) / maxAbs);
  return alpha(change < 0 ? palette.NEGATIVE : palette.POSITIVE, 0.2 + 0.7 * magnitude);
};

/** Equal-row ladder: interpolate the spot/max-pain line between strikes. */
const strikeY = (value: number | null | undefined, strikes: number[]): number => {
  if (value == null || !Number.isFinite(value) || strikes.length === 0) return HEADER_H + ROW_H / 2;
  const top = strikes[0];
  const bottom = strikes[strikes.length - 1];
  if (value >= top) return HEADER_H + ROW_H / 2;
  if (value <= bottom) return HEADER_H + (strikes.length - 0.5) * ROW_H;
  for (let i = 0; i < strikes.length - 1; i += 1) {
    const high = strikes[i];
    const low = strikes[i + 1];
    if (value <= high && value >= low) {
      const t = high === low ? 0 : (high - value) / (high - low);
      return HEADER_H + (i + 0.5 + t) * ROW_H;
    }
  }
  return HEADER_H + ROW_H / 2;
};

const timeIndex = (times: string[], at: string): number => {
  const target = at.slice(11, 19);
  let best = 0;
  for (let i = 0; i < times.length; i += 1) {
    if (times[i].slice(11, 19) <= target) best = i;
    else break;
  }
  return best;
};

const timeLabel = (value: string | undefined): string => (value ? value.slice(11, 16) : "—");

function Legend({
  color,
  label,
  line = false,
  dashed = false,
}: {
  color: string;
  label: string;
  line?: boolean;
  dashed?: boolean;
}) {
  return (
    <div class="flex items-center gap-[3px]">
      {line ? (
        <span class="w-[11px]" style={{ "border-top": `1px ${dashed ? "dashed" : "solid"} ${color}` }} />
      ) : (
        <span class="w-2 h-2 rounded-[1px]" style={{ "background-color": color }} />
      )}
      <div class="text-[7.5px] leading-1 text-fin-text-muted">{label}</div>
    </div>
  );
}

function AxisLabels({
  times,
  cellW,
  xOffset,
  rowsH,
}: {
  times: string[];
  cellW: number;
  xOffset: number;
  rowsH: number;
}) {
  const last = times.length - 1;
  const indexes = [...new Set([0, Math.floor(last / 4), Math.floor(last / 2), Math.floor((last * 3) / 4), last])];
  return (
    <>
      <For each={indexes}>{(index) => (
        <text
          x={xOffset + index * cellW + cellW / 2}
          y={HEADER_H + rowsH + 11}
          text-anchor="middle"
          font-size={7.5}
          fill={palette.TEXT_MUTED}
        >
          {timeLabel(times[index])}
        </text>
      )}</For>
    </>
  );
}

export function WallsMapChart(props: {
  map: WallsMapData;
  events?: WallsEvent[];
  callWall?: number | null;
  putWall?: number | null;
  maxPain?: number | null;
  regime?: "LONG" | "SHORT" | null;
}) {
  const events = () => props.events ?? [];
  const [hoverIndex, setHoverIndex] = createSignal<number | null>(null);
  const [pinnedTime, setPinnedTime] = createSignal<string | null>(null);
  const [horizon, setHorizon] = createSignal<"window" | "session">("window");
  const [measure, setMeasure] = createSignal<"pct" | "oi">("pct");
  let svgRef: SVGSVGElement | undefined;

  const strikes = () => props.map.strikes;
  const times = () => props.map.times;
  const cellW = () => PLOT_W / Math.max(1, times().length);
  const rowsH = () => strikes().length * ROW_H;
  const height = () => HEADER_H + rowsH() + AXIS_H;
  const lastIndex = () => times().length - 1;
  const safeHover = () => {
    const h = hoverIndex();
    return h != null && h >= 0 && h < times().length ? h : null;
  };
  const pinnedIndex = () => (pinnedTime() ? times().indexOf(pinnedTime()!) : -1);
  const activeIndex = () => safeHover() ?? (pinnedIndex() >= 0 ? pinnedIndex() : lastIndex());
  const isLive = () => activeIndex() === lastIndex() && safeHover() == null && pinnedTime() == null;
  const activeTime = () => times()[activeIndex()];
  const activeSpot = () => props.map.spot[activeIndex()];
  const activeMaxPain = () => props.map.max_pain[activeIndex()];
  const activeFlip = () => props.map.flip[activeIndex()];
  const activeX = () => activeIndex() * cellW() + cellW() / 2;
  const activeCall = (row: number) => (props.map as typeof props.map).call_oi?.[row]?.[activeIndex()] ?? props.map.call_now[row] ?? 0;
  const activePut = (row: number) => props.map.put_oi?.[row]?.[activeIndex()] ?? props.map.put_now[row] ?? 0;
  const maxOi = () =>
    Math.max(
      1,
      ...(props.map.call_oi ?? props.map.call_now).flat(),
      ...(props.map.put_oi ?? props.map.put_now).flat(),
    );

  const callBase = (row: number) =>
    horizon() === "session" ? props.map.call_open?.[row] ?? 0 : props.map.call_oi?.[row]?.[0] ?? 0;
  const putBase = (row: number) =>
    horizon() === "session" ? props.map.put_open?.[row] ?? 0 : props.map.put_oi?.[row]?.[0] ?? 0;
  const callDelta = (row: number, column: number) =>
    horizon() === "session"
      ? props.map.call_delta_open?.[row]?.[column] ?? props.map.call_delta[row]?.[column]
      : props.map.call_delta[row]?.[column];
  const putDelta = (row: number, column: number) =>
    horizon() === "session"
      ? props.map.put_delta_open?.[row]?.[column] ?? props.map.put_delta[row]?.[column]
      : props.map.put_delta[row]?.[column];
  const callOiAt = (row: number, column: number) => props.map.call_oi?.[row]?.[column] ?? props.map.call_now[row] ?? 0;
  const putOiAt = (row: number, column: number) => props.map.put_oi?.[row]?.[column] ?? props.map.put_now[row] ?? 0;
  const maxAbsChange = () => {
    let max = 0;
    strikes().forEach((_, row) => {
      times().forEach((_, column) => {
        const callChange = Math.abs(callOiAt(row, column) - callBase(row));
        const putChange = Math.abs(putOiAt(row, column) - putBase(row));
        max = Math.max(max, callChange, putChange);
      });
    });
    return max;
  };
  const cellFill = (side: "call" | "put", row: number, column: number) => {
    if (measure() === "pct") {
      return deltaFill(side === "call" ? callDelta(row, column) : putDelta(row, column));
    }
    const oi = side === "call" ? callOiAt(row, column) : putOiAt(row, column);
    const base = side === "call" ? callBase(row) : putBase(row);
    return oiFill(oi - base, maxAbsChange());
  };
  const cellTitle = (side: "call" | "put", strike: number, row: number, column: number, time: string) => {
    const delta = side === "call" ? callDelta(row, column) : putDelta(row, column);
    if (measure() === "pct") return `${timeLabel(time)} · ${fmtNum(strike)} ${side} Δ ${fmtPct(delta)}`;
    const oi = side === "call" ? callOiAt(row, column) : putOiAt(row, column);
    const base = side === "call" ? callBase(row) : putBase(row);
    return `${timeLabel(time)} · ${fmtNum(strike)} ${side} Δ ${fmtSignedOI(oi - base)} (${fmtPct(delta)})`;
  };

  const hasFlip = () => props.map.flip.some((value) => value != null && Number.isFinite(value));
  const firstMinute = () => times()[0]?.slice(0, 16) ?? "";
  const lastMinute = () => times()[lastIndex()]?.slice(0, 16) ?? "";
  const mapEvents = createMemo(() => {
    const first = firstMinute();
    const last = lastMinute();
    return events().filter((event) => {
      const minute = event.at.slice(0, 16);
      return minute >= first && minute <= last;
    });
  });

  const columnFromClientX = (clientX: number): number | null => {
    const svg = svgRef;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const x = ((clientX - rect.left) / rect.width) * TOTAL_W;
    let local: number | null = null;
    if (x >= 0 && x <= PLOT_W) local = x;
    else if (x >= PUT_PLOT_X && x <= PUT_PLOT_X + PLOT_W) local = x - PUT_PLOT_X;
    if (local == null) return null;
    return Math.max(0, Math.min(times().length - 1, Math.floor(local / cellW())));
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const step = event.key === "ArrowLeft" ? -1 : 1;
      const next = Math.max(0, Math.min(times().length - 1, activeIndex() + step));
      if (pinnedTime() != null) setPinnedTime(times()[next]);
      else setHoverIndex(next);
    } else if (event.key === "Escape") {
      setPinnedTime(null);
      setHoverIndex(null);
    }
  };

  const clearInspect = () => {
    setPinnedTime(null);
    setHoverIndex(null);
  };

  const path = (values: (number | null | undefined)[], xOffset: number) => {
    let lastFinite: number | null = null;
    const points: string[] = [];
    values.forEach((value, index) => {
      if (value != null && Number.isFinite(value)) lastFinite = value;
      if (lastFinite == null) return;
      points.push(`${xOffset + index * cellW() + cellW() / 2},${strikeY(lastFinite, strikes())}`);
    });
    return points.join(" ");
  };

  const stepPath = (values: (number | null | undefined)[], xOffset: number) => {
    let lastFinite: number | null = null;
    let prevY: number | null = null;
    const points: string[] = [];
    values.forEach((value, index) => {
      if (value != null && Number.isFinite(value)) lastFinite = value;
      if (lastFinite == null) return;
      const x = xOffset + index * cellW() + cellW() / 2;
      const y = strikeY(lastFinite, strikes());
      if (prevY == null) {
        points.push(`${x},${y}`);
      } else {
        const stepX = xOffset + (index - 0.5) * cellW() + cellW() / 2;
        points.push(`${stepX},${prevY}`, `${stepX},${y}`, `${x},${y}`);
      }
      prevY = y;
    });
    return points.join(" ");
  };

  if (strikes().length === 0 || times().length === 0) return null;

  const toggleButton = (testId: string, pressed: boolean, label: string, onClick: () => void) => (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={pressed}
      onClick={onClick}
      class="inline-flex items-center justify-center min-w-0 rounded-sm text-[7.5px] font-bold leading-[1.4] whitespace-nowrap"
      style={{
        padding: "1px 4px",
        color: pressed ? palette.TEXT_COLOR : palette.TEXT_MUTED,
        "background-color": pressed ? palette.SURFACE_ALT : "transparent",
        border: `1px solid ${pressed ? palette.BORDER : "transparent"}`,
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      data-testid="walls-map"
      tabIndex={0}
      role="group"
      aria-label="Wall map. Use left and right arrows to inspect minutes."
      onKeyDown={handleKeyDown}
      class="min-w-0 outline-none focus-visible:outline-1 focus-visible:outline-fin-primary"
    >
      <div
        class="flex items-center justify-between flex-wrap mb-[3px] row-gap-[2px]"
      >
        <div class="flex items-baseline gap-1.5 min-w-0 flex-wrap row-gap-[1px]">
          <div class="text-[9px] font-bold tracking-[0.5em] text-fin-text">WALL MAP</div>
          <div data-testid="walls-map-horizon-label" class="text-[8px] text-fin-text-muted">
            Δ vs {horizon() === "session" ? "open" : timeLabel(times()[0])} · {times().length}m · {strikes().length} strikes
          </div>
          <div
            data-testid="walls-map-active-time"
            class="text-[8px] font-bold"
            style={{ color: isLive() ? palette.POSITIVE : palette.WARNING }}
          >
            {isLive() ? "LIVE" : pinnedTime() ? "PINNED" : "PREVIEW"} · {timeLabel(activeTime())}
          </div>
          <div class="text-[8px] text-fin-text-muted">
            spot {fmtNum(activeSpot())} · MP {fmtNum(activeMaxPain())} · FLIP {activeFlip() != null ? fmtNum(activeFlip()!) : "—"}
          </div>
        </div>
        <div class="flex items-center gap-2 flex-wrap row-gap-[2px]">
          <Show when={props.regime}>
            {(regime) => (
              <span
                data-testid="walls-map-regime"
                class="px-1 py-[1px] border rounded-sm text-[8px] font-bold leading-[1.4]"
                style={{
                  "border-color": regime() === "SHORT" ? palette.NEGATIVE : palette.POSITIVE,
                  color: regime() === "SHORT" ? palette.NEGATIVE : palette.POSITIVE,
                }}
              >
                {regime()} Γ
              </span>
            )}
          </Show>
          <Legend color={palette.NEGATIVE} label="erosion" />
          <Legend color={palette.POSITIVE} label="build" />
          <Legend color={palette.TEXT_COLOR} label="spot" line />
          <Legend color={palette.WARNING} label="max pain" line dashed />
          <Show when={hasFlip()}><Legend color={palette.PRIMARY} label="flip" line dashed /></Show>
          <Legend color={palette.NEGATIVE} label="top call" line />
          <Legend color={palette.POSITIVE} label="top put" line />
          <Show when={!isLive()}>
            <button
              type="button"
              data-testid="walls-map-live"
              onClick={clearInspect}
              class="inline-flex items-center justify-center min-w-0 rounded-sm text-[8px] font-bold leading-[1.4] whitespace-nowrap"
              style={{
                padding: "1px 5px",
                color: palette.PRIMARY,
                border: `1px solid ${palette.PRIMARY}`,
                "border-radius": "4px",
              }}
            >
              LIVE
            </button>
          </Show>
        </div>
      </div>

      <div class="flex items-center flex-wrap mb-[3px] gap-1 row-gap-[2px]">
        <div class="text-[7px] font-bold tracking-[0.5em] text-fin-text-muted">COLOR</div>
        <For each={["window", "session"] as const}>{(mode) =>
          toggleButton(`walls-map-horizon-${mode}`, horizon() === mode, mode === "window" ? "60m" : "SESSION", () => setHorizon(mode))
        }</For>
        <div class="text-[7px] font-bold tracking-[0.5em] text-fin-text-muted ml-[8px]">MEASURE</div>
        <For each={["pct", "oi"] as const}>{(mode) =>
          toggleButton(`walls-map-measure-${mode}`, measure() === mode, mode === "pct" ? "%" : "OI", () => setMeasure(mode))
        }</For>
        <div class="text-[7px] text-fin-text-muted ml-[8px]">bars: muted = open · bright = new</div>
      </div>

      <svg
        ref={(el) => (svgRef = el)}
        viewBox={`0 0 ${TOTAL_W} ${height()}`}
        width="100%"
        role="img"
        aria-label="Call and put open-interest change by strike and time"
        style={{ display: "block", height: "auto", overflow: "visible", cursor: "crosshair" }}
        onMouseMove={(event) => {
          const x = columnFromClientX(event.clientX);
          setHoverIndex(x);
        }}
        onMouseLeave={() => setHoverIndex(null)}
        onClick={(event) => {
          const column = columnFromClientX(event.clientX);
          if (column != null) setPinnedTime(times()[column]);
        }}
      >
        {/* panel headers + current-OI columns */}
        <text x={4} y={9} font-size={8} font-weight={800} fill={palette.NEGATIVE}>
          CALLS · OI Δ
        </text>
        <text x={PLOT_W + NOW_W / 2} y={9} text-anchor="middle" font-size={7.5} fill={palette.TEXT_MUTED}>
          {isLive() ? "NOW" : timeLabel(activeTime())}
        </text>
        <text x={PUT_NOW_X + NOW_W / 2} y={9} text-anchor="middle" font-size={7.5} fill={palette.TEXT_MUTED}>
          {isLive() ? "NOW" : timeLabel(activeTime())}
        </text>
        <text x={PUT_PLOT_X + 4} y={9} font-size={8} font-weight={800} fill={palette.POSITIVE}>
          PUTS · OI Δ
        </text>

        <rect x={PLOT_W} y={HEADER_H} width={NOW_W} height={rowsH()} fill={palette.SURFACE_ALT} />
        <rect x={PANEL_W} y={HEADER_H} width={CENTER_W} height={rowsH()} fill={palette.SURFACE_ALT} />
        <rect x={PUT_NOW_X} y={HEADER_H} width={NOW_W} height={rowsH()} fill={palette.SURFACE_ALT} />

        {/* heatmap cells */}
        <g data-testid="walls-map-calls">
          <For each={strikes()}>{(strike, row) => (
            <For each={times()}>{(time, column) => {
              return (
                <rect
                  x={column() * cellW()}
                  y={HEADER_H + row() * ROW_H}
                  width={Math.max(0.6, cellW() - 0.35)}
                  height={ROW_H - 1}
                  rx={0.5}
                  fill={cellFill("call", row(), column())}
                >
                  <title>{cellTitle("call", strike, row(), column(), time)}</title>
                </rect>
              );
            }}</For>
          )}</For>
        </g>
        <g data-testid="walls-map-puts">
          <For each={strikes()}>{(strike, row) => (
            <For each={times()}>{(time, column) => {
              return (
                <rect
                  x={PUT_PLOT_X + column() * cellW()}
                  y={HEADER_H + row() * ROW_H}
                  width={Math.max(0.6, cellW() - 0.35)}
                  height={ROW_H - 1}
                  rx={0.5}
                  fill={cellFill("put", row(), column())}
                >
                  <title>{cellTitle("put", strike, row(), column(), time)}</title>
                </rect>
              );
            }}</For>
          )}</For>
        </g>

        {/* max pain ± half a strike gap: the pin zone */}
        {props.map.pin_band ? (
          <g data-testid="walls-map-pin-band" pointer-events="none">
            <For each={[0, PUT_PLOT_X]}>{(offset) => {
              const high = props.map.pin_band!.high.map(
                (value, index) => `${offset + index * cellW() + cellW() / 2},${strikeY(value, strikes())}`,
              );
              const low = props.map.pin_band!.low
                .map((value, index) => `${offset + index * cellW() + cellW() / 2},${strikeY(value, strikes())}`)
                .reverse();
              return (
                <polygon
                  points={[...high, ...low].join(" ")}
                  fill={alpha(palette.WARNING, 0.12)}
                />
              );
            }}</For>
            <polyline points={path(props.map.pin_band.high, 0)} fill="none" stroke={palette.WARNING} stroke-width={0.7} stroke-dasharray="2 3" opacity={0.45} />
            <polyline points={path(props.map.pin_band.low, 0)} fill="none" stroke={palette.WARNING} stroke-width={0.7} stroke-dasharray="2 3" opacity={0.45} />
            <polyline points={path(props.map.pin_band.high, PUT_PLOT_X)} fill="none" stroke={palette.WARNING} stroke-width={0.7} stroke-dasharray="2 3" opacity={0.45} />
            <polyline points={path(props.map.pin_band.low, PUT_PLOT_X)} fill="none" stroke={palette.WARNING} stroke-width={0.7} stroke-dasharray="2 3" opacity={0.45} />
          </g>
        ) : null}

        {/* current OI bars, flanking the strike column */}
        <For each={strikes()}>{(strike, row) => {
          const callValue = activeCall(row());
          const putValue = activePut(row);
          const callOpenValue = Math.max(0, props.map.call_open?.[row()] ?? 0);
          const putOpenValue = Math.max(0, props.map.put_open?.[row()] ?? 0);
          const callOld = Math.min(Math.max(0, callValue), callOpenValue);
          const putOld = Math.min(Math.max(0, putValue), putOpenValue);
          const callNew = Math.max(0, Math.max(0, callValue) - callOpenValue);
          const putNew = Math.max(0, Math.max(0, putValue) - putOpenValue);
          const callX = PLOT_W + NOW_W - 2 - (Math.max(0, callValue) / maxOi()) * (NOW_W - 4);
          const putX = PUT_NOW_X + 2;
          const callOldW = (callOld / maxOi()) * (NOW_W - 4);
          const callNewW = (callNew / maxOi()) * (NOW_W - 4);
          const putOldW = (putOld / maxOi()) * (NOW_W - 4);
          const putNewW = (putNew / maxOi()) * (NOW_W - 4);
          const y = HEADER_H + row() * ROW_H + 4;
          return (
            <g>
              <rect x={callX} y={y} width={callOldW} height={ROW_H - 8} fill={palette.NEGATIVE} opacity={0.35}>
                <title>{`${timeLabel(activeTime)} · ${fmtNum(strike)} call open OI ${fmtOI(callOpenValue)}`}</title>
              </rect>
              <rect x={callX + callOldW} y={y} width={callNewW} height={ROW_H - 8} fill={palette.NEGATIVE} opacity={0.95}>
                <title>{`${timeLabel(activeTime)} · ${fmtNum(strike)} call OI ${fmtOI(callValue)} · new ${fmtSignedOI(callValue - callOpenValue)} since open`}</title>
              </rect>
              <rect x={putX} y={y} width={putOldW} height={ROW_H - 8} fill={palette.POSITIVE} opacity={0.35}>
                <title>{`${timeLabel(activeTime)} · ${fmtNum(strike)} put open OI ${fmtOI(putOpenValue)}`}</title>
              </rect>
              <rect x={putX + putOldW} y={y} width={putNewW} height={ROW_H - 8} fill={palette.POSITIVE} opacity={0.95}>
                <title>{`${timeLabel(activeTime)} · ${fmtNum(strike)} put OI ${fmtOI(putValue)} · new ${fmtSignedOI(putValue - putOpenValue)} since open`}</title>
              </rect>
            </g>
          );
        }}</For>

        {/* spot / max pain / flip paths over both panels */}
        <g pointer-events="none">
          <polyline points={path(props.map.spot, 0)} fill="none" stroke={palette.TEXT_COLOR} stroke-width={1.2} stroke-linejoin="round" />
          <polyline points={path(props.map.spot, PUT_PLOT_X)} fill="none" stroke={palette.TEXT_COLOR} stroke-width={1.2} stroke-linejoin="round" />
          <polyline points={path(props.map.max_pain, 0)} fill="none" stroke={palette.WARNING} stroke-width={1} stroke-dasharray="4 3" opacity={0.9} />
          <polyline points={path(props.map.max_pain, PUT_PLOT_X)} fill="none" stroke={palette.WARNING} stroke-width={1} stroke-dasharray="4 3" opacity={0.9} />
          <Show when={hasFlip()}>
            <polyline points={path(props.map.flip, 0)} fill="none" stroke={palette.PRIMARY} stroke-width={1} stroke-dasharray="2 3" opacity={0.8} />
            <polyline points={path(props.map.flip, PUT_PLOT_X)} fill="none" stroke={palette.PRIMARY} stroke-width={1} stroke-dasharray="2 3" opacity={0.8} />
          </Show>
          <Show when={props.map.top_call?.some((value) => value != null)}>
            <polyline points={stepPath(props.map.top_call!, 0)} fill="none" stroke={palette.NEGATIVE} stroke-width={1.6} stroke-linejoin="miter" opacity={0.75} />
          </Show>
          <Show when={props.map.top_put?.some((value) => value != null)}>
            <polyline points={stepPath(props.map.top_put!, PUT_PLOT_X)} fill="none" stroke={palette.POSITIVE} stroke-width={1.6} stroke-linejoin="miter" opacity={0.75} />
          </Show>
        </g>

        {/* event markers (touch / break) */}
        <For each={mapEvents()}>{(event) => {
          const column = timeIndex(times(), event.at);
          const x = column * cellW() + cellW() / 2;
          const y = strikeY(event.spot, strikes());
          const isBreak = event.kind === "BREAK";
          return (
            <g pointer-events="none">
              <line x1={x} x2={x} y1={HEADER_H} y2={HEADER_H + rowsH} stroke={isBreak ? palette.NEGATIVE : palette.WARNING} stroke-width={1} opacity={0.16} />
              <line x1={PUT_PLOT_X + x} x2={PUT_PLOT_X + x} y1={HEADER_H} y2={HEADER_H + rowsH} stroke={isBreak ? palette.NEGATIVE : palette.WARNING} stroke-width={1} opacity={0.16} />
              <circle cx={x} cy={y} r={isBreak ? 2.8 : 2} fill={isBreak ? palette.NEGATIVE : palette.WARNING}>
                <title>{`${timeLabel(event.at)} ${event.kind} ${fmtNum(event.wall)}`}</title>
              </circle>
              <circle cx={PUT_PLOT_X + x} cy={y} r={isBreak ? 2.8 : 2} fill={isBreak ? palette.NEGATIVE : palette.WARNING} opacity={0.8}>
                <title>{`${timeLabel(event.at)} ${event.kind} ${fmtNum(event.wall)}`}</title>
              </circle>
              <Show when={isBreak}>
                <text
                  x={x}
                  y={HEADER_H + 8}
                  text-anchor="middle"
                  font-size={7}
                  font-weight={800}
                  fill={palette.NEGATIVE}
                  style={{ paintOrder: "stroke", "stroke": palette.SURFACE, "stroke-width": 2 }}
                >
                  BREAK {fmtNum(event.wall)}
                </text>
              </Show>
            </g>
          );
        }}</For>

        {/* crosshair + active dots */}
        <Show when={!isLive()}>
          <g pointer-events="none">
            <line x1={activeX()} x2={activeX()} y1={HEADER_H} y2={HEADER_H + rowsH()} stroke={palette.TEXT_COLOR} stroke-width={1} opacity={0.5} />
            <line x1={PUT_PLOT_X + activeX()} x2={PUT_PLOT_X + activeX()} y1={HEADER_H} y2={HEADER_H + rowsH()} stroke={palette.TEXT_COLOR} stroke-width={1} opacity={0.5} />
          </g>
        </Show>
        <circle cx={activeX()} cy={strikeY(activeSpot(), strikes())} r={2.2} fill={palette.TEXT_COLOR} />
        <circle cx={PUT_PLOT_X + activeX()} cy={strikeY(activeSpot(), strikes())} r={2.2} fill={palette.TEXT_COLOR} />
        <circle cx={activeX()} cy={strikeY(activeMaxPain(), strikes())} r={1.8} fill={palette.WARNING} />
        <circle cx={PUT_PLOT_X + activeX()} cy={strikeY(activeMaxPain(), strikes())} r={1.8} fill={palette.WARNING} />
        <Show when={activeFlip() != null && Number.isFinite(activeFlip()!)}>
          <circle cx={activeX()} cy={strikeY(activeFlip()!, strikes())} r={1.6} fill={palette.PRIMARY} />
          <circle cx={PUT_PLOT_X + activeX()} cy={strikeY(activeFlip()!, strikes())} r={1.6} fill={palette.PRIMARY} />
        </Show>

        {/* strike labels with wall tags */}
        <For each={strikes()}>{(strike, row) => {
          const isCallWall = props.callWall != null && strike === props.callWall;
          const isPutWall = props.putWall != null && strike === props.putWall;
          const isMaxPain = props.maxPain != null && strike === props.maxPain;
          const ws = wallSide(strike, activeSpot());
          const tag = isCallWall ? wallCode(true, ws, false) : isPutWall ? wallCode(false, ws, false) : isMaxPain ? "MP" : "";
          const tagColor = isCallWall ? palette.NEGATIVE : isPutWall ? palette.POSITIVE : palette.WARNING;
          const y = HEADER_H + row() * ROW_H + ROW_H / 2 + 3;
          return (
            <text
              x={PANEL_W + CENTER_W / 2}
              y={y}
              text-anchor="middle"
              font-size={9}
              font-weight={tag ? 800 : 500}
              fill={tag ? tagColor : palette.TEXT_COLOR}
              style={{ "font-variant-numeric": "tabular-nums" }}
            >
              {fmtNum(strike)}
              {tag ? <tspan dx={2} font-size={6.5} fill={tagColor}>{tag}</tspan> : null}
            </text>
          );
        }}</For>

        {/* time axis */}
        <g>
          <AxisLabels times={times()} cellW={cellW()} xOffset={0} rowsH={rowsH()} />
          <AxisLabels times={times()} cellW={cellW()} xOffset={PUT_PLOT_X} rowsH={rowsH()} />
        </g>
      </svg>
    </div>
  );
}
