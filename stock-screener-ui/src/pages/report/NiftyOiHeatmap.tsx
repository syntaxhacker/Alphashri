import { formatNumberIN } from "@/utils/ui-helpers";
import { Box, Text } from "@/ui";
import { MONO, TERM_BORDER, TERM_HEADER, TEXT_MUTED, WARNING } from "@/ui/palette";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  HEATMAP_PAD_L,
  HEATMAP_VB_W,
  buildOiHeatmap,
  heatmapReadText,
  readHeatmap,
  type HeatmapTapeRow,
} from "./niftyOiHeatmap";
import { gexFlipAtSpot } from "./niftyGex";
import { REPORT_MINUS, formatReportCompact } from "./reportFormat";
import type { NiftyGex } from "@/types/niftyReport";

export const HEATMAP_CE = "#DC2626";
export const HEATMAP_PE = "#16A34A";
export const HEATMAP_SPOT = "#FFFFFF";
export const HEATMAP_MP = "#F59E0B";
export const HEATMAP_FLIP = "#38BDF8";

const VB_W = HEATMAP_VB_W;
const PAD_L = HEATMAP_PAD_L;
/** Bottom margin holds the 30-min ticks + the `time` axis caption. */
const PAD_B = 30;

interface LegendItemDef {
  id: string;
  color: string;
  label: string;
  title: string;
  /** cell = filled square, line = solid stroke, dashed = dashed stroke, dot = round touch marker */
  shape: "cell" | "line" | "dashed" | "dot";
}

const LEGEND: LegendItemDef[] = [
  {
    id: "ce",
    color: HEATMAP_CE,
    label: "net call-led",
    title:
      "Red cell — call-side ΔOI grew more than put-side ΔOI (net call-led). A red cell does NOT mean calls were bought: the put leg may simply have fallen less than the call leg.",
    shape: "cell",
  },
  {
    id: "pe",
    color: HEATMAP_PE,
    label: "net put-led",
    title:
      "Green cell — put-side ΔOI grew more than call-side ΔOI (net put-led). Same caveat as the red cell: it is a net read, not a single-leg build.",
    shape: "cell",
  },
  {
    id: "flat",
    color: TEXT_MUTED,
    label: "no ΔOI",
    title:
      "Gray cell — no OI change vs the previous bucket (or the first bucket, which is the baseline). A gray cell is NOT missing data.",
    shape: "cell",
  },
  {
    id: "spot",
    color: HEATMAP_SPOT,
    label: "spot",
    title: "Solid white line — NIFTY spot through the session",
    shape: "line",
  },
  {
    id: "maxpain",
    color: HEATMAP_MP,
    label: "max pain",
    title: "Amber dashed — max-pain strike for each bucket",
    shape: "dashed",
  },
  {
    id: "flip",
    color: HEATMAP_FLIP,
    label: "gamma flip",
    title: "Blue dashed — gamma-flip strike for each bucket",
    shape: "dashed",
  },
  {
    id: "mp-touch",
    color: WARNING,
    label: "max pain touch",
    title: "Amber dot — spot sits within 10 pts of max pain in that bucket",
    shape: "dot",
  },
];

const OPACITY_LABELS: Record<"oi" | "volume" | "premium", { label: string; title: string }> = {
  oi: {
    label: "opacity = |ΔOI|",
    title: "Cell opacity scales with the size of the larger leg's OI change (strongest = full)",
  },
  volume: {
    label: "opacity = |ΔVOL|",
    title: "Cell opacity scales with premium volume traded in that strike bucket (strongest = full)",
  },
  premium: {
    label: "opacity = |ΔPREM|",
    title: "Cell opacity scales with the larger leg's premium change (strongest = full)",
  },
};

function cellFill(sign: string): string {
  if (sign === "ce") return HEATMAP_CE;
  if (sign === "pe") return HEATMAP_PE;
  if (sign === "flat") return TEXT_MUTED;
  return "transparent";
}

function cellOpacity(sign: string, intensity: number): number {
  // A flat cell is "no OI change", not "no data". Draw it faintly so a quiet
  // strike does not read as a gap in the tape (2026-10-29: the expanded 1-min
  // view looked like it was missing columns for exactly this reason).
  if (sign === "flat") return 0.14;
  // 0.22 floor: at 0.12 a quiet minute's red/green is indistinguishable from
  // the black background and the column reads as missing data.
  return 0.22 + 0.78 * Math.min(1, Math.max(0, intensity));
}

/** HH:MM → minutes since midnight (null when the label is malformed). */
function clockMinutes(label: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(label);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

function LegendItem({ item }: { item: LegendItemDef }) {
  const swatchTestId = `nifty-heatmap-legend-${item.id}-swatch`;
  return (
    <Box
      component="span"
      data-testid={`nifty-heatmap-legend-${item.id}`}
      title={item.title}
      className="inline-flex items-center gap-1 whitespace-nowrap"
    >
      {item.shape === "cell" ? (
        <Box
          component="span"
          data-testid={swatchTestId}
          aria-hidden
          className="inline-block shrink-0 w-2 h-2 rounded-[1px]"
          style={{ backgroundColor: item.color }}
        />
      ) : item.shape === "dot" ? (
        <Box
          component="span"
          data-testid={swatchTestId}
          aria-hidden
          className="inline-block shrink-0 w-2 h-2 rounded-full"
          style={{ backgroundColor: item.color }}
        />
      ) : item.shape === "line" ? (
        <Box
          component="span"
          data-testid={swatchTestId}
          aria-hidden
          className="inline-block shrink-0 w-3 h-0.5"
          style={{ backgroundColor: item.color }}
        />
      ) : (
        <Box
          component="span"
          data-testid={swatchTestId}
          aria-hidden
          className="inline-block shrink-0 w-3 h-0 border-t border-dashed"
          style={{ borderColor: item.color }}
        />
      )}
      <Box component="span">{item.label}</Box>
    </Box>
  );
}

interface NiftyOiHeatmapProps {
  rows: HeatmapTapeRow[];
  bucketMin?: number;
  widthPts?: number;
  /**
   * The report's dealer-gamma block. When present, the flip line is the
   * spot-relative flip (`gexFlipAtSpot`) — the same level the gamma strip
   * shows — instead of the flip recorded with each tape row.
   */
  gex?: NiftyGex;
  /** Spot used to place the flip; falls back to the last bucket's spot. */
  spot?: number | null;
  /**
   * SVG viewBox height in the same units as its 1000-wide width. The default
   * 180 is a ~5.5:1 ribbon; a pane that wants to fill a tall container passes
   * a larger value so the cells grow vertically instead of leaving a black
   * band (the modal passes 380).
   */
  viewBoxHeight?: number;
  /** Cell field: OI change (default), traded volume, or premium change. */
  metric?: "oi" | "volume" | "premium";
  /** Session start (first intraday candle) so the axis begins at 09:15 even
   *  when the first tape chain arrives later. */
  startTime?: string | null;
  /** Last 5m sign flip (ISO). Draws a dashed vertical guide at that time. */
  flipAt?: string | null;
}

const NiftyOiHeatmapInner = function NiftyOiHeatmap({
  rows,
  bucketMin = 5,
  widthPts = 500,
  gex,
  spot = null,
  viewBoxHeight = 180,
  metric = "oi",
  startTime = null,
  flipAt = null,
}: NiftyOiHeatmapProps) {
  const [hover, setHover] = useState<{ bucket: number; strike: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const VB_H = viewBoxHeight;
  const model = useMemo(
    () => buildOiHeatmap(rows, { bucketMin, widthPts, metric, startTime }),
    [rows, bucketMin, widthPts, metric, startTime],
  );
  // Spot-relative flip (the gamma strip's level) — null when no gex block is
  // passed, in which case each bucket keeps the flip recorded with its row.
  const flipOverride = useMemo(() => {
    if (!gex) return null;
    let reference = Number.isFinite(spot as number) ? (spot as number) : null;
    if (reference === null) {
      for (let i = model.buckets.length - 1; i >= 0; i--) {
        const s = model.buckets[i].spot;
        if (s !== null && Number.isFinite(s) && s > 0) {
          reference = s;
          break;
        }
      }
    }
    if (reference === null || !Number.isFinite(reference)) return null;
    return gexFlipAtSpot(gex, reference);
  }, [gex, spot, model.buckets]);

  const { buckets, strikes, cells } = model;
  const nCols = buckets.length;
  const nRows = strikes.length;
  const gridW = VB_W - PAD_L;
  const gridH = VB_H - PAD_B;
  const cellW = gridW / Math.max(1, nCols);
  const cellH = gridH / Math.max(1, nRows);
  // Empty models never paint, so the fallback bounds only keep the geometry
  // finite for the hooks that run before the muted state bails out.
  const lo = nRows > 0 ? strikes[0] : 0;
  const hi = nRows > 0 ? strikes[nRows - 1] : 1;
  const span = Math.max(1, hi - lo);
  const yOf = (v: number): number => {
    const clamped = Math.min(hi, Math.max(lo, v));
    return gridH - ((clamped - lo) / span) * gridH;
  };
  const xOf = (bi: number): number => PAD_L + bi * cellW + cellW / 2;

  // Flow-flip guide: map the flip's HH:MM into the same bucket coordinate
  // system as the cells. Null when the stamp predates the plotted window.
  const flipX = useMemo(() => {
    if (!flipAt || buckets.length === 0) return null;
    const time = flipAt.includes("T") ? flipAt.split("T")[1] ?? "" : flipAt;
    const flipMin = clockMinutes(time.slice(0, 5));
    const first = clockMinutes(buckets[0].startLabel);
    if (flipMin === null || first === null || flipMin < first) return null;
    const idx = Math.max(
      0,
      Math.min(buckets.length - 1, Math.floor((flipMin - first) / Math.max(1, bucketMin))),
    );
    return { x: xOf(idx), label: time.slice(0, 5) };
  }, [flipAt, buckets, bucketMin, cellW, PAD_L]);

  // Row index: strikes ascending, highest strike on top.
  const rowOf = (strike: number): number => nRows - 1 - strikes.indexOf(strike);

  // Ticks on the 30-min wall-clock marks. With 1-min buckets a bucket starts on
  // :00/:30; with 5m/15m aggregation the buckets are offset from the tape's
  // first minute (09:32), so we place the tick on the bucket CONTAINING each
  // half-hour and label it with the wall-clock time, not the bucket start.
  const timeTicks = useMemo(() => {
    const out: Array<{ i: number; label: string }> = [];
    const starts = buckets.map((b) => clockMinutes(b.startLabel));
    const first = starts.find((m): m is number => m !== null);
    const last = [...starts].reverse().find((m): m is number => m !== null);
    if (first === undefined || last === undefined) return out;
    for (let t = Math.ceil(first / 30) * 30; t <= last; t += 30) {
      // Nearest bucket to the wall-clock mark (buckets can be offset from :00
      // by the tape's first minute, especially at 5m/15m aggregation).
      let best = -1;
      let bestDistance = Infinity;
      starts.forEach((m, i) => {
        if (m === null) return;
        const d = Math.abs(m - t);
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      });
      if (best >= 0 && !out.some((x) => x.i === best)) {
        const hh = String(Math.floor(t / 60)).padStart(2, "0");
        const mm = String(t % 60).padStart(2, "0");
        out.push({ i: best, label: `${hh}:${mm}` });
      }
    }
    if (out.length === 0) {
      out.push({ i: 0, label: buckets[0].startLabel });
      if (buckets.length > 1) {
        out.push({ i: buckets.length - 1, label: buckets[buckets.length - 1].startLabel });
      }
    }
    return out;
  }, [buckets]);

  // Latest paint implementation, re-pointed by the data effect below so the
  // single ResizeObserver (mount effect) never needs to be torn down on ticks.
  const paintRef = useRef<() => void>(() => {});

  // One canvas paint for every cell. The former per-cell <rect> map put one
  // node per bucket×strike (2,420 inline / 4,840 expanded) in the DOM — the
  // page's largest cost. The canvas is sized to the SVG box in CSS pixels and
  // scaled by devicePixelRatio, so the same viewBox geometry stays crisp.
  useEffect(() => {
    const canvas = canvasRef.current;
    const svg = svgRef.current;
    if (!canvas || !svg) return;
    const root = svg.parentElement;
    const rowAt = new Map<number, number>();
    strikes.forEach((s, i) => rowAt.set(s, nRows - 1 - i));

    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const width = svg.clientWidth;
      const height = svg.clientHeight;
      if (!(width > 0) || !(height > 0)) return;
      const dpr = typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
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
      ctx.setTransform(dpr * (width / VB_W), 0, 0, dpr * (height / VB_H), 0, 0);
      ctx.clearRect(0, 0, VB_W, VB_H);
      for (const c of cells) {
        // Padded buckets (before the tape's first row) have no spot and must
        // stay blank; a faint "flat" fill there would read as real quiet data.
        if (buckets[c.bucket]?.spot === null) continue;
        const alpha = cellOpacity(c.sign, c.intensity);
        if (alpha <= 0) continue;
        const row = rowAt.get(c.strike);
        if (row === undefined) continue;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = cellFill(c.sign);
        ctx.fillRect(
          PAD_L + c.bucket * cellW,
          row * cellH,
          Math.max(0.5, cellW - 0.5),
          Math.max(0.5, cellH - 0.5),
        );
      }
      ctx.globalAlpha = 1;
    };

    const place = () => {
      if (!root) return;
      const rootRect = root.getBoundingClientRect();
      const rect = svg.getBoundingClientRect();
      canvas.style.left = `${rect.left - rootRect.left}px`;
      canvas.style.top = `${rect.top - rootRect.top}px`;
    };

    const paint = () => {
      place();
      draw();
    };

    paintRef.current = paint;
    paint();
    return () => {
      paintRef.current = () => {};
    };
  }, [cells, strikes, nRows, cellW, cellH, VB_H, buckets]);

  // A single ResizeObserver while the plot is mounted — recreated only when
  // the plot appears/disappears (empty ↔ populated), never per tape tick.
  // Deps: the empty state renders no SVG, so the observer can only attach
  // once the plot exists.
  const hasPlot = !(model.empty || model.buckets.length === 0 || model.strikes.length === 0);
  useEffect(() => {
    if (!hasPlot || typeof ResizeObserver === "undefined") return;
    const svg = svgRef.current;
    if (!svg) return;
    const root = svg.parentElement;
    const observer = new ResizeObserver(() => paintRef.current());
    observer.observe(svg);
    if (root) observer.observe(root);
    return () => observer.disconnect();
  }, [hasPlot]);

  if (model.empty || model.buckets.length === 0 || model.strikes.length === 0) {
    return (
      <Box data-testid="nifty-heatmap-empty" className="py-4 text-center">
        <Text size="xs" c="dimmed" data-testid="nifty-heatmap-empty-text">
          no tape chain
        </Text>
      </Box>
    );
  }

  const strikeLabelEvery = strikes.filter((s) => Math.round(s) % 100 === 0);
  const showAllStrikes = strikeLabelEvery.length === 0;

  // One-line interpretation of the strongest builds on this tape. Max-pain
  // touch marks come from the model (any row inside a bucket counts).
  const read = readHeatmap(model);
  const readText = heatmapReadText(read);

  const hoverCell =
    hover === null
      ? null
      : cells.find((c) => c.bucket === hover.bucket && c.strike === hover.strike) ?? null;
  const onHeatMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || nCols === 0 || nRows === 0) return;
    const vbX = ((event.clientX - rect.left) / rect.width) * VB_W;
    const vbY = ((event.clientY - rect.top) / rect.height) * VB_H;
    const bucket = Math.max(0, Math.min(nCols - 1, Math.floor((vbX - PAD_L) / cellW)));
    const row = Math.max(0, Math.min(nRows - 1, Math.floor(vbY / cellH)));
    const strike = strikes[nRows - 1 - row];
    setHover({ bucket, strike });
  };

  // Fill the FLOW band's flexible cell: the SVG grows into the slack left by the
  // 300px chart row while the read/legend stay fixed. The 72px floor (reduced
  // from 92) keeps the plot readable on short viewports while reducing dead
  // space below the heatmap at DESK/rail. The canvas is absolutely placed over
  // the SVG box, so the root is the containing block for both the paint layer
  // and the hover readout.
  return (
    <Box
      data-testid="nifty-heatmap"
      className="w-full min-w-0 flex flex-col h-full min-h-[72px] relative"
    >
      {/* Key for the cells and the overlay marks — a header bar above the plot. */}
      <Box
        data-testid="nifty-heatmap-legend"
        aria-label="Heatmap legend"
        className="flex flex-wrap items-center gap-x-[10px] gap-y-[2px] min-h-5 shrink-0 px-[6px] py-[2px] border-b border-fin-border bg-white/[0.03] text-[10px] leading-[1.2] font-mono text-fin-text-muted"
      >
        <Box
          component="span"
          data-testid="nifty-heatmap-legend-title"
          className="text-[9px] tracking-[0.08em] opacity-60"
        >
          HEATMAP
        </Box>
        {LEGEND.map((item) => (
          <LegendItem key={item.id} item={item} />
        ))}
        {flipX ? (
          <LegendItem
            item={{
              id: "flow-flip",
              color: WARNING,
              label: "flow flip",
              title: "Amber dashed vertical — persisted last 5m CE/PE flow sign flip",
              shape: "dashed",
            }}
          />
        ) : null}
        <LegendItem
          item={{
            id: "opacity",
            color: TEXT_MUTED,
            label: OPACITY_LABELS[metric].label,
            title: OPACITY_LABELS[metric].title,
            shape: "cell",
          }}
        />
      </Box>

      {/* Plain-English read of the tape — what the colours are actually saying. */}
      <Box
        data-testid="nifty-heatmap-read"
        title="Strongest OI builds on this tape, in plain English"
        className="px-[6px] mt-[2px] shrink-0 text-[10px] leading-[1.2] font-mono text-fin-text whitespace-nowrap overflow-hidden text-ellipsis"
      >
        {readText || (metric === "volume" ? "no traded volume yet" : metric === "premium" ? "no premium move yet" : "no ΔOI build yet")}
      </Box>

      {/* Cells paint on the canvas behind this SVG; the stretch mapping
          (`preserveAspectRatio="none"`) keeps the overlay marks aligned with
          the paint at any container aspect — same approach as the lanes. */}
      <svg
        ref={svgRef}
        data-testid="nifty-heatmap-svg"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        role="img"
        aria-label="OI change heatmap"
        onMouseMove={onHeatMove}
        onMouseLeave={() => setHover(null)}
        style={{
          flex: 1,
          minHeight: 40,
          display: "block",
          cursor: "crosshair",
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* Cells are painted on the canvas behind this SVG (one paint instead
            of one <rect> per bucket×strike). */}
        {/* Flow-flip vertical guide — the persisted last 5m sign flip. */}
        {flipX ? (
          <line
            data-testid="heatmap-flip-line"
            x1={flipX.x}
            x2={flipX.x}
            y1={0}
            y2={gridH}
            stroke={WARNING}
            strokeWidth={1.5}
            strokeDasharray="3 3"
          >
            <title>{`Last 5m flow flip ${flipX.label}`}</title>
          </line>
        ) : null}
        {/* Spot line (white) across buckets — padded buckets are skipped. */}
        <polyline
          data-testid="nifty-heatmap-spotline"
          fill="none"
          stroke={HEATMAP_SPOT}
          strokeWidth={1.5}
          points={buckets
            .map((b, bi) => (b.spot === null ? null : `${xOf(bi)},${yOf(b.spot)}`))
            .filter((p): p is string => p !== null)
            .join(" ")}
        >
          <title>{`Spot ${buckets
            .filter((b) => b.spot !== null)
            .map((b) => `${b.label} ${formatNumberIN(Math.round(b.spot as number))}`)
            .join(" · ")}`}</title>
        </polyline>
        {/* Max-pain touch markers: a row inside the bucket sat on the pin
            (within 10 pts); the circle sits at that row's spot. */}
        {buckets.map((b, bi) =>
          b.touch ? (
            <circle
              key={`mpt-${bi}`}
              data-testid="nifty-heatmap-mp-touch"
              data-bucket={bi}
              cx={xOf(bi)}
              cy={yOf(b.touch.spot)}
              r={3.5}
              fill={WARNING}
              stroke="#000"
              strokeWidth={1}
            >
              <title>{`Max pain touch ${formatNumberIN(Math.round(b.touch.maxPain))} @ ${b.label}`}</title>
            </circle>
          ) : null,
        )}
        {/* Max-pain dashed markers */}
        {buckets.map((b, bi) =>
          b.maxPain !== null ? (
            <line
              key={`mp-${bi}`}
              data-testid="nifty-heatmap-maxpain"
              x1={PAD_L + bi * cellW}
              x2={PAD_L + (bi + 1) * cellW}
              y1={yOf(b.maxPain)}
              y2={yOf(b.maxPain)}
              stroke={HEATMAP_MP}
              strokeWidth={1}
              strokeDasharray="4 3"
            >
              <title>{`Max pain ${formatNumberIN(Math.round(b.maxPain))} @ ${b.label}`}</title>
            </line>
          ) : null,
        )}
        {/* Flip dashed markers */}
        {buckets.map((b, bi) => {
          // The spot-relative flip wins when the caller passed the gex block;
          // without it each bucket keeps the flip recorded with its row.
          const flip = flipOverride ?? b.flip;
          return flip !== null ? (
            <line
              key={`flip-${bi}`}
              data-testid="nifty-heatmap-flip"
              x1={PAD_L + bi * cellW}
              x2={PAD_L + (bi + 1) * cellW}
              y1={yOf(flip)}
              y2={yOf(flip)}
              stroke={HEATMAP_FLIP}
              strokeWidth={1}
              strokeDasharray="2 3"
            >
              <title>{`Flip ${formatNumberIN(Math.round(flip))} @ ${b.label}`}</title>
            </line>
          ) : null;
        })}
        {/* Strike labels every 100 pts */}
        {(showAllStrikes ? strikes : strikeLabelEvery).map((s) => (
          <text
            key={`sl-${s}`}
            data-testid="nifty-heatmap-strike-label"
            x={PAD_L - 6}
            y={rowOf(s) * cellH + cellH / 2 + 3.5}
            textAnchor="end"
            fontSize={10}
            fill="currentColor"
            opacity={0.65}
          >
            {formatNumberIN(Math.round(s))}
          </text>
        ))}
        {/* Y-axis caption */}
        <text
          data-testid="nifty-heatmap-oi-label"
          x={10}
          y={gridH / 2}
          transform={`rotate(-90 10 ${gridH / 2})`}
          textAnchor="middle"
          fontSize={9}
          fill="currentColor"
          opacity={0.8}
          fontFamily={MONO}
        >
          ΔOI
        </text>
        {/* X-axis caption */}
        <text
          data-testid="nifty-heatmap-time-axis"
          x={PAD_L - 4}
          y={VB_H - 8}
          textAnchor="end"
          fontSize={9}
          fill="currentColor"
          opacity={0.8}
          fontFamily={MONO}
        >
          time
        </text>
        {/* Time ticks on 30-min marks — inside the plot's bottom margin so the
            flow strip below can never clip them. */}
        {timeTicks.map(({ i: bi, label }) => {
          const isFirst = bi === 0;
          const isLast = bi === buckets.length - 1;
          return (
            <text
              key={`tl-${bi}`}
              data-testid="nifty-heatmap-time-label"
              x={isFirst ? PAD_L : isLast ? VB_W - 2 : xOf(bi)}
              y={VB_H - 8}
              textAnchor={isFirst ? "start" : isLast ? "end" : "middle"}
              fontSize={10}
              fill="currentColor"
              opacity={0.9}
              fontFamily={MONO}
            >
              {label}
            </text>
          );
        })}
      </svg>
      {/* One canvas paint for the whole cell field — absolutely placed over
          the SVG box and behind it (pointer events stay on the SVG). */}
      <canvas
        ref={canvasRef}
        data-testid="nifty-heatmap-canvas"
        data-cells={cells.length}
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          display: "block",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      {hoverCell && hover ? (
        <Box
          data-testid="nifty-heatmap-hover"
          className="absolute right-1 top-[14px] px-1 py-[1px] border border-fin-border rounded-[3px] text-[9px] font-mono text-fin-text whitespace-nowrap pointer-events-none z-[3]"
          style={{ backgroundColor: TERM_HEADER, borderColor: TERM_BORDER }}
        >
          {buckets[hover.bucket]?.label ?? ""} · {formatNumberIN(hover.strike)} · CE{" "}
          {formatReportCompact(hoverCell.ceDoi, {
            sign: "always",
            minus: REPORT_MINUS,
            thousands: 1,
            grouped: false,
          })} / PE
          {formatReportCompact(hoverCell.peDoi, {
            sign: "always",
            minus: REPORT_MINUS,
            thousands: 1,
            grouped: false,
          })}
        </Box>
      ) : null}
    </Box>
  );
};

export const NiftyOiHeatmap = memo(NiftyOiHeatmapInner);
NiftyOiHeatmap.displayName = "NiftyOiHeatmap";
