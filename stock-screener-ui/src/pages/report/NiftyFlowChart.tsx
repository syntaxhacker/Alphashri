import Box from "@mui/material/Box";
import { memo, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import * as palette from "@/ui/palette";
import type { FlowSeries } from "./niftyFlowSeries";

const VB_W = 1000;
const VB_H = 56;
const PAD_L = 6;
const PAD_R = 56;
const FLOW_H = 38;
const GEX_TOP = 44;
const GEX_H = 9;

function regimeColor(regime: "long" | "short" | null) {
  return regime === "long" ? palette.POSITIVE : regime === "short" ? palette.NEGATIVE : palette.TERM_BORDER;
}

/** Value → y inside the flow lane (top pad 3, bottom pad 3). */
function flowY(v: number, min: number, max: number) {
  const span = Math.max(1e-9, max - min);
  return 3 + (1 - (v - min) / span) * (FLOW_H - 6);
}

function axisTicks(points: FlowSeries["points"]): Array<{ i: number; t: string }> {
  const out: Array<{ i: number; t: string }> = [];
  points.forEach((p, i) => {
    const m = Number(p.t.slice(3, 5));
    if (m === 0 || m === 30) out.push({ i, t: p.t });
  });
  if (out.length === 0 && points.length > 0) {
    out.push({ i: 0, t: points[0].t });
    if (points.length > 1) out.push({ i: points.length - 1, t: points[points.length - 1].t });
  }
  return out.length > 20 ? out.filter((_, idx) => idx % Math.ceil(out.length / 20) === 0) : out;
}

interface GammaBarsProps {
  points: FlowSeries["points"];
  cellW: number;
  /** Pre-built cumulative-flow path (stroked polyline). */
  path: string;
  zeroY: number;
  flips: string[];
}

/**
 * The static plot layer: zero rule, cumulative-flow path, gamma regime strip
 * and the flip markers. Memoised so hover only re-renders the crosshair.
 */
const GammaBars = memo(function GammaBars({ points, cellW, path, zeroY, flips }: GammaBarsProps) {
  return (
    <>
      {/* zero line */}
      <line x1={PAD_L} x2={PAD_L + (VB_W - PAD_L - PAD_R)} y1={zeroY} y2={zeroY} stroke={palette.TERM_BORDER} strokeWidth={0.8} />
      {/* cumulative flow */}
      <path d={path} fill="none" stroke={palette.PRIMARY} strokeWidth={1.1} opacity={0.95} />
      {/* gamma regime strip */}
      {points.map((p, i) => (
        <rect
          key={`g-${i}`}
          x={PAD_L + i * cellW}
          y={GEX_TOP}
          width={Math.max(0.6, cellW - 0.4)}
          height={GEX_H}
          fill={regimeColor(p.regime)}
          opacity={p.regime === null ? 0.15 : 0.85}
        />
      ))}
      {/* regime flips */}
      {flips.map((t) => {
        const i = points.findIndex((p) => p.t === t);
        if (i < 0) return null;
        const x = PAD_L + (i + 0.5) * cellW;
        return (
          <line
            key={`f-${t}`}
            x1={x}
            x2={x}
            y1={GEX_TOP - 1}
            y2={GEX_TOP + GEX_H + 1}
            stroke={palette.TEXT}
            strokeWidth={0.6}
            opacity={0.8}
          />
        );
      })}
    </>
  );
});

export interface NiftyFlowChartProps {
  series: FlowSeries;
  height?: number;
  showAxis?: boolean;
}

/**
 * Two lanes on one time axis:
 *  - cumulative OI flow (line) — positioning drift; price up + line flat = absorption
 *  - dealer-gamma regime (8px strip) — green long / red short, flips marked white
 * Hover reads the minute, the flow value and the regime.
 */
const NiftyFlowChartInner = function NiftyFlowChart({ series, height = 64, showAxis = false }: NiftyFlowChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const points = series.points;
  const gridW = VB_W - PAD_L - PAD_R;
  const cellW = points.length > 0 ? gridW / points.length : gridW;
  // The path depends only on the data, not the hover — keep it out of the
  // mousemove render.
  const path = useMemo(
    () =>
      points
        .map(
          (p, i) =>
            `${i === 0 ? "M" : "L"}${(PAD_L + (i + 0.5) * cellW).toFixed(2)},${flowY(
              p.net,
              series.min,
              series.max,
            ).toFixed(2)}`,
        )
        .join(" "),
    [points, cellW, series.min, series.max],
  );
  if (points.length === 0) {
    return (
      <Box data-testid="nifty-flowchart-empty" sx={{ height, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Box component="span" sx={{ fontSize: 9, color: palette.TEXT_MUTED }}>no flow tape</Box>
      </Box>
    );
  }

  const xOf = (i: number) => PAD_L + (i + 0.5) * cellW;
  const zeroY = flowY(0, series.min, series.max);
  const hoverPoint = hover != null ? points[hover] : null;
  const hoverPct = hover != null ? (xOf(hover) / VB_W) * 100 : 0;
  const shift = hoverPct > 85 ? "translateX(-100%)" : hoverPct < 15 ? "none" : "translateX(-50%)";
  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0) return;
    const vbX = ((e.clientX - r.left) / r.width) * VB_W;
    const t = (vbX - PAD_L) / gridW;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(t * (points.length - 1)))));
  };

  const fmtFlow = (v: number) =>
    Math.abs(v) >= 1e6
      ? `${(v / 1e6).toFixed(1)}M`
      : Math.abs(v) >= 1e3
        ? `${(v / 1e3).toFixed(0)}K`
        : v.toFixed(0);

  return (
    <Box data-testid="nifty-flowchart" sx={{ width: "100%", minWidth: 0, position: "relative" }}>
      <Box
        component="span"
        aria-hidden
        sx={{ position: "absolute", left: 0, top: 0, fontSize: 8, letterSpacing: "0.06em", color: palette.TEXT_MUTED, pointerEvents: "none" }}
      >
        FLOW
      </Box>
      <svg
        data-testid="nifty-flowchart-svg"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        role="img"
        aria-label="Cumulative OI flow with the book net-gamma regime strip"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        style={{ display: "block", cursor: "crosshair" }}
      >
        <GammaBars points={points} cellW={cellW} path={path} zeroY={zeroY} flips={series.flips} />
        {hoverPoint ? (
          <line x1={xOf(hover!)} x2={xOf(hover!)} y1={2} y2={FLOW_H} stroke={palette.TEXT} strokeWidth={0.5} opacity={0.85} />
        ) : null}
      </svg>
      <Box
        component="span"
        data-testid="nifty-flowchart-last"
        title={`${points[points.length - 1].t} · flow ${series.points[points.length - 1].net.toFixed(2)}`}
        sx={{ position: "absolute", right: 0, top: 2, fontSize: 9, fontWeight: 800, fontFamily: palette.MONO, color: palette.PRIMARY, whiteSpace: "nowrap" }}
      >
        {fmtFlow(points[points.length - 1].net)}
      </Box>
      {hoverPoint && showAxis ? (
        <Box
          data-testid="nifty-flowchart-readout"
          sx={{
            position: "absolute", top: 0, left: `${hoverPct}%`, transform: shift,
            px: "4px", py: "1px", bgcolor: palette.TERM_HEADER,
            border: `1px solid ${palette.TERM_BORDER}`, borderRadius: "3px",
            fontSize: 9, fontFamily: palette.MONO, color: palette.TEXT, whiteSpace: "nowrap", pointerEvents: "none", zIndex: 2,
          }}
        >
          {hoverPoint.t} · flow {fmtFlow(hoverPoint.net)} · {hoverPoint.regime ?? "—"} book Γ
        </Box>
      ) : null}
      {showAxis ? (
        <Box data-testid="nifty-flowchart-axis" sx={{ position: "relative", height: 12, mt: "1px", width: "100%", pointerEvents: "none" }}>
          {axisTicks(points).map(({ i, t }) => {
            const pct = (xOf(i) / VB_W) * 100;
            const tr = pct > 92 ? "translateX(-100%)" : pct < 2 ? "none" : "translateX(-50%)";
            return (
              <Box key={`${t}-${i}`} component="span" sx={{ position: "absolute", left: `${pct}%`, transform: tr, fontSize: 8, lineHeight: "12px", color: palette.TEXT_MUTED, fontFamily: palette.MONO, whiteSpace: "nowrap" }}>
                {t}
              </Box>
            );
          })}
        </Box>
      ) : null}
    </Box>
  );
};

export const NiftyFlowChart = memo(NiftyFlowChartInner);
NiftyFlowChart.displayName = "NiftyFlowChart";
