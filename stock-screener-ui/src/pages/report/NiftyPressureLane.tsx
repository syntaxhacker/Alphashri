import { formatNumberIN } from "@/utils/ui-helpers";
import { memo, useState } from "react";
import type { MouseEvent } from "react";
import * as palette from "@/ui/palette";
import type { PressureSeries } from "./niftyPressure";
import { PRESSURE_BURST_RATIO, PRESSURE_CLIMAX_RATIO } from "./niftyPressure";

const VB_W = 1000;
const VB_H = 44;
const PAD_L = 6;
const PAD_R = 56;
const ZERO = 22;

export interface NiftyPressureLaneProps {
  series: PressureSeries;
  /** Height in px (the SVG scales to it). */
  height?: number;
  /** Render an HH:MM axis under the bars (used by the expanded modal). */
  showAxis?: boolean;
}

/** Points worth labelling: every 30 minutes, plus the first and last. */
function axisTicks(points: PressureSeries["points"]): Array<{ i: number; t: string }> {
  const out: Array<{ i: number; t: string }> = [];
  points.forEach((p, i) => {
    const minute = Number(p.t.slice(3, 5));
    if (minute === 0 || minute === 30) out.push({ i, t: p.t });
  });
  if (out.length === 0 && points.length > 0) {
    out.push({ i: 0, t: points[0].t });
    if (points.length > 1) out.push({ i: points.length - 1, t: points[points.length - 1].t });
  }
  // Never crowd: keep at most 20 labels, always including the last.
  return out.length > 20 ? out.filter((_, idx) => idx % Math.ceil(out.length / 20) === 0) : out;
}

interface PressureBarsProps {
  points: PressureSeries["points"];
  cellW: number;
  gridW: number;
  median: number;
  scaleMax: number;
}

/**
 * The static bar layer: burst band, median/zero rules and one bar group per
 * minute. Memoised so a mousemove (which only moves the crosshair) does not
 * re-reconcile hundreds of `<rect>` nodes.
 */
const PressureBars = memo(function PressureBars({
  points,
  cellW,
  gridW,
  median,
  scaleMax,
}: PressureBarsProps) {
  const scale = (v: number) => (Math.min(v, scaleMax) / scaleMax) * (ZERO - 3);
  const medianY = ZERO - scale(median);
  const burstY = ZERO - scale(median * PRESSURE_BURST_RATIO);
  return (
    <>
      {/* Aggressor hatch: solid = BUY (premium richer than delta-implied),
          striped = SELL (cheaper than implied). Side colour still identifies
          CE (blue) vs PE (orange). */}
      <defs>
        <pattern id="pf-sell-ce" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="3" height="3" fill={palette.TERM_CE} opacity={0.18} />
          <line x1="0" y1="0" x2="0" y2="3" stroke={palette.TERM_CE} stroke-width="1.4" opacity={0.95} />
        </pattern>
        <pattern id="pf-sell-pe" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="3" height="3" fill={palette.TERM_PE} opacity={0.18} />
          <line x1="0" y1="0" x2="0" y2="3" stroke={palette.TERM_PE} stroke-width="1.4" opacity={0.95} />
        </pattern>
      </defs>
      {/* 2× burst band */}
      <rect
        x={PAD_L}
        y={burstY}
        width={gridW}
        height={Math.max(0, ZERO - burstY)}
        fill={palette.WARNING}
        opacity={0.05}
      />
      {/* median line */}
      <line
        x1={PAD_L}
        x2={PAD_L + gridW}
        y1={medianY}
        y2={medianY}
        stroke={palette.TEXT_MUTED}
        stroke-width={0.6}
        strokeDasharray="3 3"
        opacity={0.55}
      />
      {/* zero line */}
      <line
        x1={PAD_L}
        x2={PAD_L + gridW}
        y1={ZERO}
        y2={ZERO}
        stroke={palette.TERM_BORDER}
        stroke-width={1}
      />
      {points.map((p, i) => {
        const x = PAD_L + i * cellW;
        const w = Math.max(0.6, cellW - 0.6);
        const up = scale(p.ce);
        const down = scale(p.pe);
        const hot = p.state !== "normal";
        const ceFill =
          p.ceFlow === "sell" ? "url(#pf-sell-ce)" : palette.TERM_CE;
        const peFill =
          p.peFlow === "sell" ? "url(#pf-sell-pe)" : palette.TERM_PE;
        const ceOpacity = p.ceFlow == null ? 0.3 : hot ? 0.95 : 0.55;
        const peOpacity = p.peFlow == null ? 0.3 : hot ? 0.95 : 0.55;
        return (
          <g key={`${p.t}-${i}`}>
            <rect
              x={x}
              y={ZERO - up}
              width={w}
              height={up}
              fill={ceFill}
              opacity={ceOpacity}
            />
            <rect
              x={x}
              y={ZERO}
              width={w}
              height={down}
              fill={peFill}
              opacity={peOpacity}
            />
            {hot ? (
              <rect
                x={x}
                y={Math.min(ZERO - up, ZERO)}
                width={w}
                height={Math.max(up, down)}
                fill="none"
                stroke={p.ratio >= PRESSURE_CLIMAX_RATIO ? palette.NEGATIVE : palette.WARNING}
                stroke-width={0.5}
                opacity={0.9}
              />
            ) : null}
          </g>
        );
      })}
    </>
  );
});

/**
 * Mirrored option-volume bars: CE up (blue), PE down (orange), with the 20-min
 * median as a solid line and the 2×/4× bursts shaded. A burst is a bar poking
 * out of the band — no numbers to read. The last minute is outlined and its
 * multiple is printed at the right.
 */
const NiftyPressureLaneInner = function NiftyPressureLane({
  series,
  height = 44,
  showAxis = false,
}: NiftyPressureLaneProps) {
  const [hover, setHover] = useState<number | null>(null);
  const points = series.points;
  if (points.length === 0 || series.maxRatio === 0) {
    return (
      <div
        data-testid="nifty-pressure-empty"
        className="flex items-center justify-center"
        style={{ height }}
      >
        <span className="text-[11px] text-fin-text-muted">no volume tape</span>
      </div>
    );
  }

  // Scale to 4× the median, not the day's climax: a 65M print must not squash
  // every normal 4M minute into a 1px line. Bars above the cap clip at the top
  // and stay outlined (the ratio label carries the true multiple).
  const scaleMax = Math.max(series.median * PRESSURE_CLIMAX_RATIO, 1);
  const gridW = VB_W - PAD_L - PAD_R;
  const cellW = gridW / points.length;
  const last = points[points.length - 1];
  const lastColor =
    last.ratio >= PRESSURE_CLIMAX_RATIO
      ? palette.NEGATIVE
      : last.ratio >= PRESSURE_BURST_RATIO
        ? palette.WARNING
        : palette.TEXT_MUTED;

  // Hover crosshair: one bar out of 375 cannot carry a printed label, so the
  // expanded lane reads the hovered minute instead (time + CE/PE + multiple).
  // The cursor maps through the SVG viewBox and the bar grid's padding — using
  // the element width alone put the line/readout left of the cursor, because
  // PAD_R (56 units) belongs to the right-hand multiple label, not the bars.
  const xOfBar = (i: number) => ((PAD_L + (i + 0.5) * cellW) / VB_W) * 100;
  const indexFromClientX = (clientX: number, rect: DOMRect) => {
    if (rect.width <= 0) return 0;
    const vbX = ((clientX - rect.left) / rect.width) * VB_W;
    const t = (vbX - PAD_L) / gridW;
    return Math.max(0, Math.min(points.length - 1, Math.round(t * (points.length - 1))));
  };
  const hoverPoint = hover != null ? points[hover] : null;
  const hoverPct = hover != null ? xOfBar(hover) : 0;
  const readoutShift =
    hoverPct > 85 ? "translateX(-100%)" : hoverPct < 15 ? "none" : "translateX(-50%)";
  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    setHover(indexFromClientX(e.clientX, e.currentTarget.getBoundingClientRect()));
  };
  const compactVol = (v: number) =>
    v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : `${Math.round(v / 1000)}K`;

  return (
    <div data-testid="nifty-pressure-lane" className="w-full min-w-0 relative">
      <span
        aria-hidden
        className="absolute left-0 top-0 text-[8px] tracking-[0.06em] pointer-events-none"
        style={{ color: palette.TEXT_MUTED }}
      >
        VOL
      </span>
      <svg
        data-testid="nifty-pressure-svg"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        role="img"
        aria-label="Option volume pressure: CE above, PE below; solid bars are aggressive buying, hatched bars aggressive selling"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        style={{ display: "block", cursor: "crosshair" }}
      >
        <PressureBars
          points={points}
          cellW={cellW}
          gridW={gridW}
          median={series.median}
          scaleMax={scaleMax}
        />
        {/* hover crosshair */}
        {hoverPoint ? (
          <line
            x1={PAD_L + (hover! + 0.5) * cellW}
            x2={PAD_L + (hover! + 0.5) * cellW}
            y1={2}
            y2={VB_H - 4}
            stroke={palette.TEXT}
            stroke-width={0.5}
            opacity={0.85}
          />
        ) : null}
        {/* last-minute outline + multiple */}
        <rect
          x={PAD_L + (points.length - 1) * cellW}
          y={2}
          width={Math.max(1, cellW - 0.6)}
          height={VB_H - 4}
          fill="none"
          stroke={palette.TEXT}
          stroke-width={0.6}
          opacity={0.8}
        />
      </svg>
      <span
        data-testid="nifty-pressure-last"
        title={`${last.t}: ${last.ratio.toFixed(1)}× the 20-min median (CE ${formatNumberIN(Math.round(last.ce))} ${last.ceFlow ?? "?"}, PE ${formatNumberIN(Math.round(last.pe))} ${last.peFlow ?? "?"})`}
        className="absolute right-0 top-2 text-[9px] font-black font-mono whitespace-nowrap"
        style={{ color: lastColor }}
      >
        {last.ratio > 0 ? `${last.ratio.toFixed(1)}×` : "—"}
      </span>
      {hoverPoint && showAxis ? (
        <div
          data-testid="nifty-pressure-readout"
          className="absolute top-0 px-1 py-[1px] rounded-[3px] text-[9px] font-mono whitespace-nowrap pointer-events-none z-2"
          style={{
            left: `${hoverPct}%`,
            transform: readoutShift,
            "background-color": palette.TERM_HEADER,
            border: `1px solid ${palette.TERM_BORDER}`,
            color: palette.TEXT,
          }}
        >
          {hoverPoint.t} · CE {compactVol(hoverPoint.ce)}
          {hoverPoint.ceFlow ? ` ${hoverPoint.ceFlow.toUpperCase()}` : ""} · PE{" "}
          {compactVol(hoverPoint.pe)}
          {hoverPoint.peFlow ? ` ${hoverPoint.peFlow.toUpperCase()}` : ""} ·{" "}
          {hoverPoint.ratio.toFixed(1)}×
        </div>
      ) : null}
      {showAxis ? (
        <>
          <div
            data-testid="nifty-pressure-axis"
            className="relative h-[12px] mt-[2px] w-full pointer-events-none"
          >
            {axisTicks(points).map(({ i, t }) => {
              const pct = xOfBar(i);
              const shift =
                pct > 92 ? "translateX(-100%)" : pct < 2 ? "none" : "translateX(-50%)";
              return (
                <span
                  component="span"
                  key={`${t}-${i}`}
                  className="absolute text-[8px] leading-[12px] font-mono whitespace-nowrap"
                  style={{
                    left: `${pct}%`,
                    transform: shift,
                    color: palette.TEXT_MUTED,
                  }}
                >
                  {t}
                </span>
              );
            })}
          </div>
          <div
            data-testid="nifty-pressure-legend"
            className="flex items-center gap-[10px] flex-wrap mt-[3px] text-[8.5px] font-mono text-fin-text-muted"
          >
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-[1px]" style={{ "background-color": palette.TERM_CE }} />
              CE volume (up)
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-[1px]" style={{ "background-color": palette.TERM_PE }} />
              PE volume (down)
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-[1px]" style={{ "background-color": palette.TEXT_MUTED, opacity: 0.35 }} />
              solid = buy
            </span>
            <span className="inline-flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-[1px] border border-fin-text-muted"
                style={{
                  background: `repeating-linear-gradient(45deg, ${palette.TEXT_MUTED} 0 1px, transparent 1px 3px)`,
                }}
              />
              hatched = sell
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-[12px] border-t border-t-fin-text-muted border-dashed" />
              20-min median
            </span>
            <span className="inline-flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-[1px] border border-fin-warning"
                style={{ "background-color": palette.WARNING, opacity: 0.25 }}
              />
              ≥2× burst (4× climax)
            </span>
            <span
              className="inline-flex items-center gap-1"
              data-testid="nifty-pressure-flow"
              title="Volume traded by aggressive buyers vs sellers, per leg (premium richer/cheaper than delta-implied)"
            >
              CE buy {compactVol(series.flow.ceBuy)} / sell {compactVol(series.flow.ceSell)} · PE buy{" "}
              {compactVol(series.flow.peBuy)} / sell {compactVol(series.flow.peSell)}
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
};

export const NiftyPressureLane = memo(NiftyPressureLaneInner);
NiftyPressureLane.displayName = "NiftyPressureLane";
