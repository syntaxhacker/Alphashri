import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
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
    <div className="flex items-center gap-[3px]">
      {line ? (
        <span className="w-[11px]" style={{ borderTop: `1px ${dashed ? "dashed" : "solid"} ${color}` }} />
      ) : (
        <span className="w-2 h-2 rounded-[1px]" style={{ backgroundColor: color }} />
      )}
      <div className="text-[7.5px] leading-1 text-fin-text-muted">{label}</div>
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
      {indexes.map((index) => (
        <text
          key={`axis-${xOffset}-${index}`}
          x={xOffset + index * cellW + cellW / 2}
          y={HEADER_H + rowsH + 11}
          textAnchor="middle"
          fontSize={7.5}
          fill={palette.TEXT_MUTED}
        >
          {timeLabel(times[index])}
        </text>
      ))}
    </>
  );
}

export function WallsMapChart({
  map,
  events = [],
  callWall,
  putWall,
  maxPain,
  regime,
}: {
  map: WallsMapData;
  events?: WallsEvent[];
  callWall?: number | null;
  putWall?: number | null;
  maxPain?: number | null;
  regime?: "LONG" | "SHORT" | null;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [pinnedTime, setPinnedTime] = useState<string | null>(null);
  const [horizon, setHorizon] = useState<"window" | "session">("window");
  const [measure, setMeasure] = useState<"pct" | "oi">("pct");
  const svgRef = useRef<SVGSVGElement | null>(null);

  const strikes = map.strikes;
  const times = map.times;
  if (strikes.length === 0 || times.length === 0) return null;

  const cellW = PLOT_W / times.length;
  const rowsH = strikes.length * ROW_H;
  const height = HEADER_H + rowsH + AXIS_H;
  const lastIndex = times.length - 1;
  const safeHover = hoverIndex != null && hoverIndex >= 0 && hoverIndex < times.length ? hoverIndex : null;
  const pinnedIndex = pinnedTime ? times.indexOf(pinnedTime) : -1;
  const activeIndex = safeHover ?? (pinnedIndex >= 0 ? pinnedIndex : lastIndex);
  const isLive = activeIndex === lastIndex && safeHover == null && pinnedTime == null;
  const activeTime = times[activeIndex];
  const activeSpot = map.spot[activeIndex];
  const activeMaxPain = map.max_pain[activeIndex];
  const activeFlip = map.flip[activeIndex];
  const activeX = activeIndex * cellW + cellW / 2;
  const activeCall = (row: number) => map.call_oi?.[row]?.[activeIndex] ?? map.call_now[row] ?? 0;
  const activePut = (row: number) => map.put_oi?.[row]?.[activeIndex] ?? map.put_now[row] ?? 0;
  const maxOi = Math.max(
    1,
    ...(map.call_oi ?? map.call_now).flat(),
    ...(map.put_oi ?? map.put_now).flat(),
  );

  const callBase = (row: number) =>
    horizon === "session" ? map.call_open?.[row] ?? 0 : map.call_oi?.[row]?.[0] ?? 0;
  const putBase = (row: number) =>
    horizon === "session" ? map.put_open?.[row] ?? 0 : map.put_oi?.[row]?.[0] ?? 0;
  const callDelta = (row: number, column: number) =>
    horizon === "session"
      ? map.call_delta_open?.[row]?.[column] ?? map.call_delta[row]?.[column]
      : map.call_delta[row]?.[column];
  const putDelta = (row: number, column: number) =>
    horizon === "session"
      ? map.put_delta_open?.[row]?.[column] ?? map.put_delta[row]?.[column]
      : map.put_delta[row]?.[column];
  const callOiAt = (row: number, column: number) => map.call_oi?.[row]?.[column] ?? map.call_now[row] ?? 0;
  const putOiAt = (row: number, column: number) => map.put_oi?.[row]?.[column] ?? map.put_now[row] ?? 0;
  const maxAbsChange = (() => {
    let max = 0;
    strikes.forEach((_, row) => {
      times.forEach((_, column) => {
        const callChange = Math.abs(callOiAt(row, column) - callBase(row));
        const putChange = Math.abs(putOiAt(row, column) - putBase(row));
        max = Math.max(max, callChange, putChange);
      });
    });
    return max;
  })();
  const cellFill = (side: "call" | "put", row: number, column: number) => {
    if (measure === "pct") {
      return deltaFill(side === "call" ? callDelta(row, column) : putDelta(row, column));
    }
    const oi = side === "call" ? callOiAt(row, column) : putOiAt(row, column);
    const base = side === "call" ? callBase(row) : putBase(row);
    return oiFill(oi - base, maxAbsChange);
  };
  const cellTitle = (side: "call" | "put", strike: number, row: number, column: number, time: string) => {
    const delta = side === "call" ? callDelta(row, column) : putDelta(row, column);
    if (measure === "pct") return `${timeLabel(time)} · ${fmtNum(strike)} ${side} Δ ${fmtPct(delta)}`;
    const oi = side === "call" ? callOiAt(row, column) : putOiAt(row, column);
    const base = side === "call" ? callBase(row) : putBase(row);
    return `${timeLabel(time)} · ${fmtNum(strike)} ${side} Δ ${fmtSignedOI(oi - base)} (${fmtPct(delta)})`;
  };

  const hasFlip = map.flip.some((value) => value != null && Number.isFinite(value));
  const firstMinute = times[0]?.slice(0, 16) ?? "";
  const lastMinute = times[lastIndex]?.slice(0, 16) ?? "";
  const mapEvents = events.filter((event) => {
    const minute = event.at.slice(0, 16);
    return minute >= firstMinute && minute <= lastMinute;
  });

  const columnFromClientX = (clientX: number): number | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const x = ((clientX - rect.left) / rect.width) * TOTAL_W;
    let local: number | null = null;
    if (x >= 0 && x <= PLOT_W) local = x;
    else if (x >= PUT_PLOT_X && x <= PUT_PLOT_X + PLOT_W) local = x - PUT_PLOT_X;
    if (local == null) return null;
    return Math.max(0, Math.min(times.length - 1, Math.floor(local / cellW)));
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const step = event.key === "ArrowLeft" ? -1 : 1;
      const next = Math.max(0, Math.min(times.length - 1, activeIndex + step));
      if (pinnedTime != null) setPinnedTime(times[next]);
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
      points.push(`${xOffset + index * cellW + cellW / 2},${strikeY(lastFinite, strikes)}`);
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
      const x = xOffset + index * cellW + cellW / 2;
      const y = strikeY(lastFinite, strikes);
      if (prevY == null) {
        points.push(`${x},${y}`);
      } else {
        const stepX = xOffset + (index - 0.5) * cellW + cellW / 2;
        points.push(`${stepX},${prevY}`, `${stepX},${y}`, `${x},${y}`);
      }
      prevY = y;
    });
    return points.join(" ");
  };

  const toggleButton = (testId: string, pressed: boolean, label: string, onClick: () => void) => (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={pressed}
      onClick={onClick}
      className="inline-flex items-center justify-center min-w-0 rounded-sm text-[7.5px] font-bold leading-[1.4] whitespace-nowrap"
      style={{
        padding: "1px 4px",
        color: pressed ? palette.TEXT_COLOR : palette.TEXT_MUTED,
        backgroundColor: pressed ? palette.SURFACE_ALT : "transparent",
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
      className="min-w-0 outline-none focus-visible:outline-1 focus-visible:outline-fin-primary"
    >
      <div
        className="flex items-center justify-between flex-wrap mb-[3px] row-gap-[2px]"
      >
        <div className="flex items-baseline gap-1.5 min-w-0 flex-wrap row-gap-[1px]">
          <div className="text-[9px] font-bold tracking-[0.5em] text-fin-text">WALL MAP</div>
          <div data-testid="walls-map-horizon-label" className="text-[8px] text-fin-text-muted">
            Δ vs {horizon === "session" ? "open" : timeLabel(times[0])} · {times.length}m · {strikes.length} strikes
          </div>
          <div
            data-testid="walls-map-active-time"
            className="text-[8px] font-bold"
            style={{ color: isLive ? palette.POSITIVE : palette.WARNING }}
          >
            {isLive ? "LIVE" : pinnedTime ? "PINNED" : "PREVIEW"} · {timeLabel(activeTime)}
          </div>
          <div className="text-[8px] text-fin-text-muted">
            spot {fmtNum(activeSpot)} · MP {fmtNum(activeMaxPain)} · FLIP {activeFlip != null ? fmtNum(activeFlip) : "—"}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap row-gap-[2px]">
          {regime ? (
            <span
              data-testid="walls-map-regime"
              className="px-1 py-[1px] border rounded-sm text-[8px] font-bold leading-[1.4]"
              style={{
                borderColor: regime === "SHORT" ? palette.NEGATIVE : palette.POSITIVE,
                color: regime === "SHORT" ? palette.NEGATIVE : palette.POSITIVE,
              }}
            >
              {regime} Γ
            </span>
          ) : null}
          <Legend color={palette.NEGATIVE} label="erosion" />
          <Legend color={palette.POSITIVE} label="build" />
          <Legend color={palette.TEXT_COLOR} label="spot" line />
          <Legend color={palette.WARNING} label="max pain" line dashed />
          {hasFlip ? <Legend color={palette.PRIMARY} label="flip" line dashed /> : null}
          <Legend color={palette.NEGATIVE} label="top call" line />
          <Legend color={palette.POSITIVE} label="top put" line />
          {!isLive ? (
            <button
              type="button"
              size="small"
              data-testid="walls-map-live"
              onClick={clearInspect}
              className="inline-flex items-center justify-center min-w-0 rounded-sm text-[8px] font-bold leading-[1.4] whitespace-nowrap"
              style={{
                padding: "1px 5px",
                color: palette.PRIMARY,
                border: `1px solid ${palette.PRIMARY}`,
                borderRadius: 4,
              }}
            >
              LIVE
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex items-center flex-wrap mb-[3px] gap-1 row-gap-[2px]">
        <div className="text-[7px] font-bold tracking-[0.5em] text-fin-text-muted">COLOR</div>
        {(["window", "session"] as const).map((mode) => (
          toggleButton(`walls-map-horizon-${mode}`, horizon === mode, mode === "window" ? "60m" : "SESSION", () => setHorizon(mode))
        ))}
        <div className="text-[7px] font-bold tracking-[0.5em] text-fin-text-muted ml-[8px]">MEASURE</div>
        {(["pct", "oi"] as const).map((mode) => (
          toggleButton(`walls-map-measure-${mode}`, measure === mode, mode === "pct" ? "%" : "OI", () => setMeasure(mode))
        ))}
        <div className="text-[7px] text-fin-text-muted ml-[8px]">bars: muted = open · bright = new</div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${TOTAL_W} ${height}`}
        width="100%"
        role="img"
        aria-label="Call and put open-interest change by strike and time"
        style={{ display: "block", height: "auto", overflow: "visible", cursor: "crosshair" }}
        onMouseMove={(event) => setHoverIndex(columnFromClientX(event.clientX))}
        onMouseLeave={() => setHoverIndex(null)}
        onClick={(event) => {
          const column = columnFromClientX(event.clientX);
          if (column != null) setPinnedTime(times[column]);
        }}
      >
        {/* panel headers + current-OI columns */}
        <text x={4} y={9} fontSize={8} fontWeight={800} fill={palette.NEGATIVE}>
          CALLS · OI Δ
        </text>
        <text x={PLOT_W + NOW_W / 2} y={9} textAnchor="middle" fontSize={7.5} fill={palette.TEXT_MUTED}>
          {isLive ? "NOW" : timeLabel(activeTime)}
        </text>
        <text x={PUT_NOW_X + NOW_W / 2} y={9} textAnchor="middle" fontSize={7.5} fill={palette.TEXT_MUTED}>
          {isLive ? "NOW" : timeLabel(activeTime)}
        </text>
        <text x={PUT_PLOT_X + 4} y={9} fontSize={8} fontWeight={800} fill={palette.POSITIVE}>
          PUTS · OI Δ
        </text>

        <rect x={PLOT_W} y={HEADER_H} width={NOW_W} height={rowsH} fill={palette.SURFACE_ALT} />
        <rect x={PANEL_W} y={HEADER_H} width={CENTER_W} height={rowsH} fill={palette.SURFACE_ALT} />
        <rect x={PUT_NOW_X} y={HEADER_H} width={NOW_W} height={rowsH} fill={palette.SURFACE_ALT} />

        {/* heatmap cells */}
        <g data-testid="walls-map-calls">
          {strikes.map((strike, row) =>
            times.map((time, column) => {
              return (
                <rect
                  key={`call-${strike}-${column}`}
                  x={column * cellW}
                  y={HEADER_H + row * ROW_H}
                  width={Math.max(0.6, cellW - 0.35)}
                  height={ROW_H - 1}
                  rx={0.5}
                  fill={cellFill("call", row, column)}
                >
                  <title>{cellTitle("call", strike, row, column, time)}</title>
                </rect>
              );
            }),
          )}
        </g>
        <g data-testid="walls-map-puts">
          {strikes.map((strike, row) =>
            times.map((time, column) => {
              return (
                <rect
                  key={`put-${strike}-${column}`}
                  x={PUT_PLOT_X + column * cellW}
                  y={HEADER_H + row * ROW_H}
                  width={Math.max(0.6, cellW - 0.35)}
                  height={ROW_H - 1}
                  rx={0.5}
                  fill={cellFill("put", row, column)}
                >
                  <title>{cellTitle("put", strike, row, column, time)}</title>
                </rect>
              );
            }),
          )}
        </g>

        {/* max pain ± half a strike gap: the pin zone */}
        {map.pin_band ? (
          <g data-testid="walls-map-pin-band" pointerEvents="none">
            {[0, PUT_PLOT_X].map((offset) => {
              const high = map.pin_band!.high.map(
                (value, index) => `${offset + index * cellW + cellW / 2},${strikeY(value, strikes)}`,
              );
              const low = map.pin_band!.low
                .map((value, index) => `${offset + index * cellW + cellW / 2},${strikeY(value, strikes)}`)
                .reverse();
              return (
                <polygon
                  key={`pin-band-${offset}`}
                  points={[...high, ...low].join(" ")}
                  fill={alpha(palette.WARNING, 0.12)}
                />
              );
            })}
            <polyline points={path(map.pin_band.high, 0)} fill="none" stroke={palette.WARNING} strokeWidth={0.7} strokeDasharray="2 3" opacity={0.45} />
            <polyline points={path(map.pin_band.low, 0)} fill="none" stroke={palette.WARNING} strokeWidth={0.7} strokeDasharray="2 3" opacity={0.45} />
            <polyline points={path(map.pin_band.high, PUT_PLOT_X)} fill="none" stroke={palette.WARNING} strokeWidth={0.7} strokeDasharray="2 3" opacity={0.45} />
            <polyline points={path(map.pin_band.low, PUT_PLOT_X)} fill="none" stroke={palette.WARNING} strokeWidth={0.7} strokeDasharray="2 3" opacity={0.45} />
          </g>
        ) : null}

        {/* current OI bars, flanking the strike column */}
        {strikes.map((strike, row) => {
          const callValue = activeCall(row);
          const putValue = activePut(row);
          const callOpenValue = Math.max(0, map.call_open?.[row] ?? 0);
          const putOpenValue = Math.max(0, map.put_open?.[row] ?? 0);
          const callOld = Math.min(Math.max(0, callValue), callOpenValue);
          const putOld = Math.min(Math.max(0, putValue), putOpenValue);
          const callNew = Math.max(0, Math.max(0, callValue) - callOpenValue);
          const putNew = Math.max(0, Math.max(0, putValue) - putOpenValue);
          const callX = PLOT_W + NOW_W - 2 - (Math.max(0, callValue) / maxOi) * (NOW_W - 4);
          const putX = PUT_NOW_X + 2;
          const callOldW = (callOld / maxOi) * (NOW_W - 4);
          const callNewW = (callNew / maxOi) * (NOW_W - 4);
          const putOldW = (putOld / maxOi) * (NOW_W - 4);
          const putNewW = (putNew / maxOi) * (NOW_W - 4);
          const y = HEADER_H + row * ROW_H + 4;
          return (
            <g key={`now-${strike}`}>
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
        })}

        {/* spot / max pain / flip paths over both panels */}
        <g pointerEvents="none">
          <polyline points={path(map.spot, 0)} fill="none" stroke={palette.TEXT_COLOR} strokeWidth={1.2} strokeLinejoin="round" />
          <polyline points={path(map.spot, PUT_PLOT_X)} fill="none" stroke={palette.TEXT_COLOR} strokeWidth={1.2} strokeLinejoin="round" />
          <polyline points={path(map.max_pain, 0)} fill="none" stroke={palette.WARNING} strokeWidth={1} strokeDasharray="4 3" opacity={0.9} />
          <polyline points={path(map.max_pain, PUT_PLOT_X)} fill="none" stroke={palette.WARNING} strokeWidth={1} strokeDasharray="4 3" opacity={0.9} />
          {hasFlip ? (
            <>
              <polyline points={path(map.flip, 0)} fill="none" stroke={palette.PRIMARY} strokeWidth={1} strokeDasharray="2 3" opacity={0.8} />
              <polyline points={path(map.flip, PUT_PLOT_X)} fill="none" stroke={palette.PRIMARY} strokeWidth={1} strokeDasharray="2 3" opacity={0.8} />
            </>
          ) : null}
          {map.top_call?.some((value) => value != null) ? (
            <polyline points={stepPath(map.top_call, 0)} fill="none" stroke={palette.NEGATIVE} strokeWidth={1.6} strokeLinejoin="miter" opacity={0.75} />
          ) : null}
          {map.top_put?.some((value) => value != null) ? (
            <polyline points={stepPath(map.top_put, PUT_PLOT_X)} fill="none" stroke={palette.POSITIVE} strokeWidth={1.6} strokeLinejoin="miter" opacity={0.75} />
          ) : null}
        </g>

        {/* event markers (touch / break) */}
        {mapEvents.map((event, index) => {
          const column = timeIndex(times, event.at);
          const x = column * cellW + cellW / 2;
          const y = strikeY(event.spot, strikes);
          const isBreak = event.kind === "BREAK";
          return (
            <g key={`event-${event.at}-${index}`} pointerEvents="none">
              <line x1={x} x2={x} y1={HEADER_H} y2={HEADER_H + rowsH} stroke={isBreak ? palette.NEGATIVE : palette.WARNING} strokeWidth={1} opacity={0.16} />
              <line x1={PUT_PLOT_X + x} x2={PUT_PLOT_X + x} y1={HEADER_H} y2={HEADER_H + rowsH} stroke={isBreak ? palette.NEGATIVE : palette.WARNING} strokeWidth={1} opacity={0.16} />
              <circle cx={x} cy={y} r={isBreak ? 2.8 : 2} fill={isBreak ? palette.NEGATIVE : palette.WARNING}>
                <title>{`${timeLabel(event.at)} ${event.kind} ${fmtNum(event.wall)}`}</title>
              </circle>
              <circle cx={PUT_PLOT_X + x} cy={y} r={isBreak ? 2.8 : 2} fill={isBreak ? palette.NEGATIVE : palette.WARNING} opacity={0.8}>
                <title>{`${timeLabel(event.at)} ${event.kind} ${fmtNum(event.wall)}`}</title>
              </circle>
              {isBreak ? (
                <text
                  x={x}
                  y={HEADER_H + 8}
                  textAnchor="middle"
                  fontSize={7}
                  fontWeight={800}
                  fill={palette.NEGATIVE}
                  style={{ paintOrder: "stroke", stroke: palette.SURFACE, strokeWidth: 2 }}
                >
                  BREAK {fmtNum(event.wall)}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* crosshair + active dots */}
        {!isLive ? (
          <g pointerEvents="none">
            <line x1={activeX} x2={activeX} y1={HEADER_H} y2={HEADER_H + rowsH} stroke={palette.TEXT_COLOR} strokeWidth={1} opacity={0.5} />
            <line x1={PUT_PLOT_X + activeX} x2={PUT_PLOT_X + activeX} y1={HEADER_H} y2={HEADER_H + rowsH} stroke={palette.TEXT_COLOR} strokeWidth={1} opacity={0.5} />
          </g>
        ) : null}
        <circle cx={activeX} cy={strikeY(activeSpot, strikes)} r={2.2} fill={palette.TEXT_COLOR} />
        <circle cx={PUT_PLOT_X + activeX} cy={strikeY(activeSpot, strikes)} r={2.2} fill={palette.TEXT_COLOR} />
        <circle cx={activeX} cy={strikeY(activeMaxPain, strikes)} r={1.8} fill={palette.WARNING} />
        <circle cx={PUT_PLOT_X + activeX} cy={strikeY(activeMaxPain, strikes)} r={1.8} fill={palette.WARNING} />
        {activeFlip != null && Number.isFinite(activeFlip) ? (
          <>
            <circle cx={activeX} cy={strikeY(activeFlip, strikes)} r={1.6} fill={palette.PRIMARY} />
            <circle cx={PUT_PLOT_X + activeX} cy={strikeY(activeFlip, strikes)} r={1.6} fill={palette.PRIMARY} />
          </>
        ) : null}

        {/* strike labels with wall tags */}
        {strikes.map((strike, row) => {
          const isCallWall = callWall != null && strike === callWall;
          const isPutWall = putWall != null && strike === putWall;
          const isMaxPain = maxPain != null && strike === maxPain;
          const ws = wallSide(strike, activeSpot);
          const tag = isCallWall ? wallCode(true, ws, false) : isPutWall ? wallCode(false, ws, false) : isMaxPain ? "MP" : "";
          const tagColor = isCallWall ? palette.NEGATIVE : isPutWall ? palette.POSITIVE : palette.WARNING;
          const y = HEADER_H + row * ROW_H + ROW_H / 2 + 3;
          return (
            <text
              key={`strike-${strike}`}
              x={PANEL_W + CENTER_W / 2}
              y={y}
              textAnchor="middle"
              fontSize={9}
              fontWeight={tag ? 800 : 500}
              fill={tag ? tagColor : palette.TEXT_COLOR}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {fmtNum(strike)}
              {tag ? <tspan dx={2} fontSize={6.5} fill={tagColor}>{tag}</tspan> : null}
            </text>
          );
        })}

        {/* time axis */}
        <g>
          <AxisLabels times={times} cellW={cellW} xOffset={0} rowsH={rowsH} />
          <AxisLabels times={times} cellW={cellW} xOffset={PUT_PLOT_X} rowsH={rowsH} />
        </g>
      </svg>
    </div>
  );
}
