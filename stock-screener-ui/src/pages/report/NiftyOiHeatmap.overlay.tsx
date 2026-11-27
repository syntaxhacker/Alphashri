import { formatNumberIN } from "@/utils/ui-helpers";
import {
  HEATMAP_FLIP,
  HEATMAP_SPOT,
  HEATMAP_TOUCH_STROKE,
  LEVEL_MAX_PAIN,
  MONO,
  WARNING,
} from "@/ui/palette";
import { For, Show } from "solid-js";
import { REPORT_FONT } from "./reportTokens";
import { cellFill, cellOpacity } from "./NiftyOiHeatmap.format";
import type { FlipGuide, HeatmapScale, StrikeLabels, TimeTick } from "./NiftyOiHeatmap.geometry";
import type { buildOiHeatmap } from "./niftyOiHeatmap";

type Bucket = ReturnType<typeof buildOiHeatmap>["buckets"][number];
type Cell = ReturnType<typeof buildOiHeatmap>["cells"][number];

export interface HeatmapPaintSnapshot {
  cells: Cell[];
  buckets: Bucket[];
  strikes: number[];
  vbW: number;
  vbH: number;
  padL: number;
  cellW: number;
  cellH: number;
}

/**
 * One canvas paint for every cell: one backing buffer, one transform, one
 * fillRect per cell. The former per-cell <rect> map put thousands of nodes in
 * the DOM; the canvas is sized to the SVG box in CSS pixels and scaled by
 * devicePixelRatio so the same viewBox geometry stays crisp.
 */
export function paintHeatmapCells(
  canvas: HTMLCanvasElement,
  svg: SVGSVGElement,
  s: HeatmapPaintSnapshot,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const width = svg.clientWidth;
  const height = svg.clientHeight;
  if (!(width > 0) || !(height > 0)) return;
  const dpr =
    typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  // Setting canvas.width/height reallocates the backing buffer even when the
  // size is unchanged — only touch them when the box actually moved.
  const bufW = Math.max(1, Math.round(width * dpr));
  const bufH = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== bufW) canvas.width = bufW;
  if (canvas.height !== bufH) canvas.height = bufH;
  const styleW = `${width}px`;
  const styleH = `${height}px`;
  if (canvas.style.width !== styleW) canvas.style.width = styleW;
  if (canvas.style.height !== styleH) canvas.style.height = styleH;
  ctx.setTransform(dpr * (width / s.vbW), 0, 0, dpr * (height / s.vbH), 0, 0);
  ctx.clearRect(0, 0, s.vbW, s.vbH);
  const rowAt = new Map<number, number>();
  s.strikes.forEach((strike, i) => rowAt.set(strike, s.strikes.length - 1 - i));
  for (const c of s.cells) {
    // Padded buckets (before the tape's first row) have no spot and must
    // stay blank; a faint "flat" fill there would read as real quiet data.
    if (s.buckets[c.bucket]?.spot === null) continue;
    const alpha = cellOpacity(c.sign, c.intensity);
    if (alpha <= 0) continue;
    const row = rowAt.get(c.strike);
    if (row === undefined) continue;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = cellFill(c.sign);
    ctx.fillRect(
      s.padL + c.bucket * s.cellW,
      row * s.cellH,
      Math.max(0.5, s.cellW - 0.5),
      Math.max(0.5, s.cellH - 0.5),
    );
  }
  ctx.globalAlpha = 1;
}

/** Position the paint layer over the SVG box inside their shared container. */
export function placeHeatmapCanvas(canvas: HTMLCanvasElement, svg: SVGSVGElement): void {
  const root = svg.parentElement;
  if (!root) return;
  const rootRect = root.getBoundingClientRect();
  const rect = svg.getBoundingClientRect();
  canvas.style.left = `${rect.left - rootRect.left}px`;
  canvas.style.top = `${rect.top - rootRect.top}px`;
}

export interface HeatmapOverlayProps {
  buckets: Bucket[];
  strikes: number[];
  scale: HeatmapScale;
  padL: number;
  vbW: number;
  vbH: number;
  flipX: FlipGuide | null;
  flipOverride: number | null;
  timeTicks: TimeTick[];
  strikeLabels: StrikeLabels;
  spotPoints: string;
  spotTitle: string;
}

/**
 * SVG marks only: flip guide, spot line, max-pain/flip overlays and the two
 * axes. Cells live on the canvas behind this SVG; the stretch mapping keeps
 * every mark aligned with the paint at any container aspect.
 */
export function HeatmapOverlay(props: HeatmapOverlayProps) {
  const gridH = () => props.scale.gridH;
  const cellW = () => props.scale.cellW;
  const cellH = () => props.scale.cellH;
  const xOf = (bi: number) => props.scale.xOf(bi);
  const yOf = (v: number) => props.scale.yOf(v);
  const rowOf = (s: number) => props.scale.rowOf(s);

  return (
    <>
      {/* Flow-flip vertical guide — the persisted last 5m sign flip. */}
      <Show when={props.flipX}>
        {(flip) => (
          <line
            data-testid="heatmap-flip-line"
            x1={flip().x}
            x2={flip().x}
            y1={0}
            y2={gridH()}
            stroke={WARNING}
            stroke-width={1.5}
            stroke-dasharray="3 3"
          >
            <title>{`Last 5m flow flip ${flip().label}`}</title>
          </line>
        )}
      </Show>
      {/* Spot line (white) across buckets — padded buckets are skipped. */}
      <polyline
        data-testid="nifty-heatmap-spotline"
        fill="none"
        stroke={HEATMAP_SPOT}
        stroke-width={1.5}
        points={props.spotPoints}
      >
        <title>{props.spotTitle}</title>
      </polyline>
      {/* Max-pain touch markers: a row inside the bucket sat on the pin
          (within 10 pts); the circle sits at that row's spot. */}
      <For each={props.buckets}>{(b, bi) => (
        b.touch ? (
          <circle
            data-testid="nifty-heatmap-mp-touch"
            data-bucket={bi()}
            cx={xOf(bi())}
            cy={yOf(b.touch.spot)}
            r={3.5}
            fill={LEVEL_MAX_PAIN}
            stroke={HEATMAP_TOUCH_STROKE}
            stroke-width={1}
          >
            <title>{`Max pain touch ${formatNumberIN(Math.round(b.touch.maxPain))} @ ${b.label}`}</title>
          </circle>
        ) : null
      )}</For>
      {/* Max-pain dashed markers */}
      <For each={props.buckets}>{(b, bi) => (
        b.maxPain !== null ? (
          <line
            data-testid="nifty-heatmap-maxpain"
            x1={props.padL + bi() * cellW()}
            x2={props.padL + (bi() + 1) * cellW()}
            y1={yOf(b.maxPain)}
            y2={yOf(b.maxPain)}
            stroke={LEVEL_MAX_PAIN}
            stroke-width={1}
            stroke-dasharray="4 3"
          >
            <title>{`Max pain ${formatNumberIN(Math.round(b.maxPain))} @ ${b.label}`}</title>
          </line>
        ) : null
      )}</For>
      {/* Flip dashed markers */}
      <For each={props.buckets}>{(b, bi) => {
        // The spot-relative flip wins when the caller passed the gex block;
        // without it each bucket keeps the flip recorded with its row.
        const flip = props.flipOverride ?? b.flip;
        return flip !== null ? (
          <line
            data-testid="nifty-heatmap-flip"
            x1={props.padL + bi() * cellW()}
            x2={props.padL + (bi() + 1) * cellW()}
            y1={yOf(flip)}
            y2={yOf(flip)}
            stroke={HEATMAP_FLIP}
            stroke-width={1}
            stroke-dasharray="2 3"
          >
            <title>{`Flip ${formatNumberIN(Math.round(flip))} @ ${b.label}`}</title>
          </line>
        ) : null;
      }}</For>
      {/* Strike labels every 100 pts */}
      <For each={props.strikeLabels.showAll ? props.strikes : props.strikeLabels.every}>{(s) => (
        <text
          data-testid="nifty-heatmap-strike-label"
          x={props.padL - 6}
          y={rowOf(s) * cellH() + cellH() / 2}
          text-anchor="end"
          dominant-baseline="middle"
          font-size={String(REPORT_FONT.micro)}
          fill="currentColor"
          opacity={0.65}
        >
          {formatNumberIN(Math.round(s))}
        </text>
      )}</For>
      {/* Y-axis caption */}
      <text
        data-testid="nifty-heatmap-oi-label"
        x={14}
        y={gridH() / 2}
        transform={`rotate(-90 14 ${gridH() / 2})`}
        text-anchor="middle"
        dominant-baseline="middle"
        font-size={String(REPORT_FONT.micro)}
        fill="currentColor"
        opacity={0.8}
        font-family={MONO}
      >
        ΔOI
      </text>
      {/* X-axis caption */}
      <text
        data-testid="nifty-heatmap-time-axis"
        x={props.padL - 4}
        y={props.vbH - 10}
        text-anchor="end"
        dominant-baseline="middle"
        font-size={String(REPORT_FONT.micro)}
        fill="currentColor"
        opacity={0.8}
        font-family={MONO}
      >
        time
      </text>
      {/* Time ticks on 30-min marks — inside the plot's bottom margin so the
          flow strip below can never clip them. */}
      <For each={props.timeTicks}>{({ i: bi, label }) => {
        const isFirst = bi === 0;
        const isLast = bi === props.buckets.length - 1;
        return (
          <text
            data-testid="nifty-heatmap-time-label"
            x={isFirst ? props.padL : isLast ? props.vbW - 2 : xOf(bi)}
            y={props.vbH - 10}
            text-anchor={isFirst ? "start" : isLast ? "end" : "middle"}
            dominant-baseline="middle"
            font-size={String(REPORT_FONT.micro)}
            fill="currentColor"
            opacity={0.9}
            font-family={MONO}
          >
            {label}
          </text>
        );
      }}</For>
    </>
  );
}
