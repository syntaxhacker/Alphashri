import { formatNumberIN } from "@/utils/ui-helpers";
import { TERM_BORDER, TERM_HEADER } from "@/ui/palette";
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { isMarketOpenNow } from "@/state/holidays";
import { istClock } from "@/utils/marketClock";
import {
  HEATMAP_PAD_L,
  HEATMAP_VB_W,
  buildOiHeatmap,
  heatmapCoverage,
  heatmapEmptyKind,
  heatmapReadText,
  heatmapSessionDate,
  istToday,
  readHeatmap,
  tapeSignature,
  type HeatmapEmptyKind,
  type HeatmapTapeRow,
} from "./niftyOiHeatmap";
import { gexFlipAtSpot } from "./niftyGex";
import type { NiftyGex } from "@/types/niftyReport";
import {
  computeFlipX,
  computeTimeTicks,
  createHeatmapScale,
  strikeLabels,
} from "./NiftyOiHeatmap.geometry";
import {
  formatPairCompact,
  formatWindowLabel,
  formatWindowTitle,
} from "./NiftyOiHeatmap.format";
import { HeatmapEmpty, HeatmapLegend, HeatmapReadout } from "./NiftyOiHeatmap.legend";
import {
  HeatmapOverlay,
  paintHeatmapCells,
  placeHeatmapCanvas,
} from "./NiftyOiHeatmap.overlay";

export { HEATMAP_CE, HEATMAP_FLIP, HEATMAP_MP, HEATMAP_PE, HEATMAP_SPOT } from "@/ui/palette";

const VB_W = HEATMAP_VB_W;
const PAD_L = HEATMAP_PAD_L;

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
  /** Why the plot is empty. Derived from the tape + session clock otherwise
   *  (see `heatmapEmptyKind`). */
  emptyKind?: HeatmapEmptyKind;
  /** Recovery action for the failed state; omitted when nothing can retry. */
  onRetry?: () => void;
  /** Retry label for callers whose recovery is not a fetch retry. */
  retryLabel?: string;
  /** Hide the retry action even on a failed state (read-only surfaces). */
  hideRetry?: boolean;
}

/**
 * OI change heatmap facade: owns the model, reactive geometry and effects,
 * then delegates the legend/readout, SVG marks and canvas paint to focused
 * modules. Hover coordinates and all viewBox values stay in one place so the
 * canvas and its overlays cannot drift apart.
 */
export function NiftyOiHeatmap(props: NiftyOiHeatmapProps) {
  const [hover, setHover] = createSignal<{ bucket: number; strike: number } | null>(null);
  let svgRef: SVGSVGElement | undefined;
  let canvasRef: HTMLCanvasElement | undefined;

  const bucketMin = () => props.bucketMin ?? 5;
  const metric = () => props.metric ?? "oi";
  // A 1000-unit viewBox stretched into a 420px pane squashed 11px labels to
  // ~5px wide / 17px tall. Once the box is measured, 1 unit = 1 CSS pixel so
  // the 11px floor is real. Unmeasured (tests) keeps the legacy 1000-unit box.
  const [vbW, setVbW] = createSignal(VB_W);
  const [vbH, setVbH] = createSignal<number | null>(null);
  const VB_H = () => vbH() ?? props.viewBoxHeight ?? 180;
  // Keep the same 64-unit axis gutter in both unit and pixel modes: the
  // rotated ΔOI caption lives there and a tighter gutter would cross labels.
  const PAD = () => PAD_L;

  // `rowsForSig` is the array the model paints from. `rowsSig` refreshes it on
  // every frame (cheap signature computation) but the model memo tracks only
  // the signature string, so a fresh-but-equal `props.rows` never rebuilds the
  // model — Solid would otherwise track `props.rows` identity directly.
  let rowsForSig = props.rows;
  const rowsSig = createMemo(() => {
    rowsForSig = props.rows;
    return tapeSignature(props.rows);
  });
  const model = createMemo(() => {
    rowsSig(); // rebuild only when row content changed, never on array identity alone
    return buildOiHeatmap(rowsForSig, {
      bucketMin: bucketMin(),
      widthPts: props.widthPts ?? 500,
      metric: metric(),
      startTime: props.startTime ?? null,
    });
  });

  // Spot-relative flip (the gamma strip's level) — null when no gex block is
  // passed, in which case each bucket keeps the flip recorded with its row.
  const flipOverride = createMemo(() => {
    if (!props.gex) return null;
    let reference = Number.isFinite(props.spot as number) ? (props.spot as number) : null;
    if (reference === null) {
      const buckets = model().buckets;
      for (let i = buckets.length - 1; i >= 0; i--) {
        const s = buckets[i].spot;
        if (s !== null && Number.isFinite(s) && s > 0) {
          reference = s;
          break;
        }
      }
    }
    if (reference === null || !Number.isFinite(reference)) return null;
    return gexFlipAtSpot(props.gex, reference);
  });

  const buckets = () => model().buckets;
  const strikes = () => model().strikes;
  const cells = () => model().cells;
  const nCols = () => buckets().length;
  const nRows = () => strikes().length;

  const scale = createMemo(() =>
    createHeatmapScale({
      vbW: vbW(),
      vbH: VB_H(),
      padL: PAD(),
      strikes: strikes(),
      cols: nCols(),
    }),
  );
  const cellW = () => scale().cellW;
  const cellH = () => scale().cellH;
  const xOf = (bi: number) => scale().xOf(bi);
  const yOf = (v: number) => scale().yOf(v);

  const flipX = createMemo(() => computeFlipX(props.flipAt, buckets(), bucketMin(), xOf));
  const timeTicks = createMemo(() => computeTimeTicks(buckets()));
  const labelStrikes = createMemo(() => strikeLabels(strikes()));
  const spotPoints = createMemo(() =>
    buckets()
      .map((b, bi) => (b.spot === null ? null : `${xOf(bi)},${yOf(b.spot)}`))
      .filter((p): p is string => p !== null)
      .join(" "),
  );
  const spotTitle = createMemo(() =>
    `Spot ${buckets()
      .filter((b) => b.spot !== null)
      .map((b) => `${b.label} ${formatNumberIN(Math.round(b.spot as number))}`)
      .join(" · ")}`,
  );

  // Latest paint implementation, re-pointed by the data effect below so the
  // single ResizeObserver (mount effect) never needs to be torn down on ticks.
  let paint: () => void = () => {};

  createEffect(() => {
    const snapshot = {
      cells: cells(),
      buckets: buckets(),
      strikes: strikes(),
      vbW: vbW(),
      vbH: VB_H(),
      padL: PAD(),
      cellW: cellW(),
      cellH: cellH(),
    };
    const canvas = canvasRef;
    const svg = svgRef;
    if (!canvas || !svg) return;
    paint = () => {
      placeHeatmapCanvas(canvas, svg);
      paintHeatmapCells(canvas, svg, snapshot);
    };
    paint();
    onCleanup(() => {
      paint = () => {};
    });
  });

  // A single ResizeObserver while the plot is mounted — recreated only when
  // the plot appears/disappears (empty ↔ populated), never per tape tick.
  const hasPlot = createMemo(() => !(model().empty || nCols() === 0 || nRows() === 0));
  createEffect(() => {
    if (!hasPlot() || typeof ResizeObserver === "undefined") return;
    const svg = svgRef;
    if (!svg) return;
    const root = svg.parentElement;
    const measure = () => {
      if (svg.clientWidth > 0) setVbW(svg.clientWidth);
      if (svg.clientHeight > 0) setVbH(svg.clientHeight);
      paint();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    if (root) observer.observe(root);
    measure();
    onCleanup(() => observer.disconnect());
  });

  // One-line interpretation of the strongest builds on this tape.
  const read = createMemo(() => readHeatmap(model()));
  const readText = createMemo(() => heatmapReadText(read()));
  const readFallback = createMemo(() =>
    metric() === "volume" ? "no traded volume yet" : metric() === "premium" ? "no premium move yet" : "no ΔOI build yet",
  );
  const windowLabel = createMemo(() => formatWindowLabel(model().windowHalf, nRows()));
  const windowTitle = createMemo(() => formatWindowTitle(model()));
  const hoverCell = createMemo(() => {
    const h = hover();
    if (h === null) return null;
    return cells().find((c) => c.bucket === h.bucket && c.strike === h.strike) ?? null;
  });

  const onHeatMove = (event: MouseEvent) => {
    const currentTarget = event.currentTarget as SVGSVGElement;
    const rect = currentTarget.getBoundingClientRect();
    const cols = nCols();
    const rowsCount = nRows();
    if (rect.width <= 0 || cols === 0 || rowsCount === 0) return;
    const vbX = ((event.clientX - rect.left) / rect.width) * vbW();
    const vbY = ((event.clientY - rect.top) / rect.height) * VB_H();
    const bucket = Math.max(0, Math.min(cols - 1, Math.floor((vbX - PAD()) / cellW())));
    const row = Math.max(0, Math.min(rowsCount - 1, Math.floor(vbY / cellH())));
    const strike = strikes()[rowsCount - 1 - row];
    setHover({ bucket, strike });
  };

  /**
   * Why this pane is blank. Three different facts, three different reads:
   * the feed failed (ours, retry), the market is shut (expected, nothing to
   * record yet), or the session holds no chain (not fixable from here).
   */
  const emptyKind = createMemo<HeatmapEmptyKind>(() => {
    if (props.emptyKind) return props.emptyKind;
    const sessionDate = heatmapSessionDate(props.rows);
    // A tape stamped on an earlier calendar day is a finished session, so the
    // live/closed branch does not apply to it.
    const pastSession = sessionDate !== null && sessionDate !== istToday();
    return heatmapEmptyKind({
      hasTape: props.rows.length > 0,
      hasChain: props.rows.some((row) => !!row.chain && Object.keys(row.chain).length > 0),
      marketOpen: isMarketOpenNow(),
      pastSession,
      minutes: istClock().minutes,
    });
  });
  const coverage = createMemo(() => heatmapCoverage(props.rows));
  const canRetry = () => emptyKind() === "failed" && !props.hideRetry && Boolean(props.onRetry);

  return (
    <Show
      when={hasPlot()}
      fallback={
        <HeatmapEmpty
          kind={emptyKind()}
          coverage={coverage()}
          canRetry={canRetry()}
          retryLabel={props.retryLabel}
          onRetry={props.onRetry}
        />
      }
    >
      {/* Fill the FLOW band's flexible cell: the SVG grows into the slack left by the
          300px chart row while the read/legend stay fixed. The 72px floor (reduced
          from 92) keeps the plot readable on short viewports while reducing dead
          space below the heatmap at DESK/rail. The canvas is absolutely placed over
          the SVG box, so the root is the containing block for both the paint layer
          and the hover readout. */}
      <div
        data-testid="nifty-heatmap"
        class="w-full min-w-0 flex flex-col h-full min-h-[72px] relative"
      >
        <HeatmapLegend
          windowLabel={windowLabel()}
          windowTitle={windowTitle()}
          metric={metric()}
          flipLabel={flipX()?.label ?? null}
        />
        <HeatmapReadout read={read()} readText={readText()} readFallback={readFallback()} />
        {/* Cells paint on the canvas behind this SVG; the stretch mapping
            (`preserveAspectRatio="none"`) keeps the overlay marks aligned with
            the paint at any container aspect — same approach as the lanes. */}
        <svg
          ref={(el) => {
            svgRef = el;
          }}
          data-testid="nifty-heatmap-svg"
          viewBox={`0 0 ${vbW()} ${VB_H()}`}
          width="100%"
          height="100%"
          preserveAspectRatio="none"
          role="img"
          aria-label="OI change heatmap"
          onMouseMove={onHeatMove}
          onMouseLeave={() => setHover(null)}
          style={{
            flex: "1",
            "min-height": "40px",
            display: "block",
            cursor: "crosshair",
            position: "relative",
            "z-index": "1",
          }}
        >
          {/* Cells are painted on the canvas behind this SVG (one paint instead
              of one <rect> per bucket×strike). */}
          <HeatmapOverlay
            buckets={buckets()}
            strikes={strikes()}
            scale={scale()}
            padL={PAD()}
            vbW={vbW()}
            vbH={VB_H()}
            flipX={flipX()}
            flipOverride={flipOverride()}
            timeTicks={timeTicks()}
            strikeLabels={labelStrikes()}
            spotPoints={spotPoints()}
            spotTitle={spotTitle()}
          />
        </svg>
        {/* One canvas paint for the whole cell field — absolutely placed over
            the SVG box and behind it (pointer events stay on the SVG). */}
        <canvas
          ref={(el) => {
            canvasRef = el;
          }}
          data-testid="nifty-heatmap-canvas"
          data-cells={cells().length}
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "0",
            top: "0",
            width: "0",
            height: "0",
            display: "block",
            "pointer-events": "none",
            "z-index": "0",
          }}
        />
        <Show when={hoverCell() && hover() !== null}>
          <div
            data-testid="nifty-heatmap-hover"
            class="absolute right-1 top-[14px] px-1 py-[1px] border border-fin-border rounded-[3px] text-ui-micro leading-[1.2] font-mono text-fin-text whitespace-nowrap pointer-events-none z-[3]"
            style={{ "background-color": TERM_HEADER, "border-color": TERM_BORDER }}
          >
            {buckets()[hover()!.bucket]?.label ?? ""} · {formatNumberIN(hover()!.strike)} · CE{" "}
            {formatPairCompact(hoverCell()!.ceDoi)} / PE
            {formatPairCompact(hoverCell()!.peDoi)}
          </div>
        </Show>
      </div>
    </Show>
  );
}
