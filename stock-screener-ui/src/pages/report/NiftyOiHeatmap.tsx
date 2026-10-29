import { Box, Text } from "@/ui";
import { BORDER, MONO, TEXT, TEXT_MUTED, WARNING } from "@/ui/palette";
import { useMemo } from "react";
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
const VB_H = 180;
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

const OPACITY_NOTE: LegendItemDef = {
  id: "opacity",
  color: TEXT_MUTED,
  label: "opacity = |ΔOI|",
  title:
    "Cell opacity scales with the size of the larger leg's OI change (strongest = full)",
  shape: "cell",
};

/** Fixed-size key mark: 8×8 cell square, 12×2 solid rule, or 12-wide dashed rule. */
const SWATCH_SX = {
  display: "inline-block",
  flexShrink: 0,
  width: 8,
  height: 8,
  borderRadius: "1px",
} as const;

const RULE_SX = {
  display: "inline-block",
  flexShrink: 0,
  width: 12,
  height: 2,
} as const;

const DASHED_RULE_SX = {
  display: "inline-block",
  flexShrink: 0,
  width: 12,
  height: 0,
  borderTop: "1px dashed",
} as const;

function cellFill(sign: string): string {
  if (sign === "ce") return HEATMAP_CE;
  if (sign === "pe") return HEATMAP_PE;
  return "transparent";
}

function cellOpacity(sign: string, intensity: number): number {
  if (sign === "flat") return 0;
  return 0.12 + 0.88 * Math.min(1, Math.max(0, intensity));
}

function compactOi(v: number | null): string {
  return formatReportCompact(v, {
    sign: "always",
    minus: REPORT_MINUS,
    thousands: 1,
    grouped: false,
  });
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
      sx={{ display: "inline-flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}
    >
      {item.shape === "cell" ? (
        <Box
          component="span"
          data-testid={swatchTestId}
          aria-hidden
          sx={{ ...SWATCH_SX, backgroundColor: item.color }}
        />
      ) : item.shape === "dot" ? (
        <Box
          component="span"
          data-testid={swatchTestId}
          aria-hidden
          sx={{ ...SWATCH_SX, borderRadius: "50%", backgroundColor: item.color }}
        />
      ) : item.shape === "line" ? (
        <Box
          component="span"
          data-testid={swatchTestId}
          aria-hidden
          sx={{ ...RULE_SX, backgroundColor: item.color }}
        />
      ) : (
        <Box
          component="span"
          data-testid={swatchTestId}
          aria-hidden
          sx={{ ...DASHED_RULE_SX, borderColor: item.color }}
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
}

export function NiftyOiHeatmap({
  rows,
  bucketMin = 5,
  widthPts = 500,
  gex,
  spot = null,
}: NiftyOiHeatmapProps) {
  const model = useMemo(() => buildOiHeatmap(rows, { bucketMin, widthPts }), [rows, bucketMin, widthPts]);
  // Spot-relative flip (the gamma strip's level) — null when no gex block is
  // passed, in which case each bucket keeps the flip recorded with its row.
  const flipOverride = useMemo(() => {
    if (!gex) return null;
    const last = model.buckets.length > 0 ? model.buckets[model.buckets.length - 1] : null;
    const reference = Number.isFinite(spot as number) ? (spot as number) : last?.spot ?? null;
    if (reference === null || !Number.isFinite(reference)) return null;
    return gexFlipAtSpot(gex, reference);
  }, [gex, spot, model.buckets]);

  if (model.empty || model.buckets.length === 0 || model.strikes.length === 0) {
    return (
      <Box data-testid="nifty-heatmap-empty" sx={{ py: 2, textAlign: "center" }}>
        <Text size="xs" c="dimmed" data-testid="nifty-heatmap-empty-text">
          no tape chain
        </Text>
      </Box>
    );
  }

  const { buckets, strikes, cells } = model;
  const nCols = buckets.length;
  const nRows = strikes.length;
  const gridW = VB_W - PAD_L;
  const gridH = VB_H - PAD_B;
  const cellW = gridW / Math.max(1, nCols);
  const cellH = gridH / Math.max(1, nRows);
  const lo = strikes[0];
  const hi = strikes[nRows - 1];
  const span = Math.max(1, hi - lo);
  const yOf = (v: number): number => {
    const clamped = Math.min(hi, Math.max(lo, v));
    return gridH - ((clamped - lo) / span) * gridH;
  };
  const xOf = (bi: number): number => PAD_L + bi * cellW + cellW / 2;

  // Row index: strikes ascending, highest strike on top.
  const rowOf = (strike: number): number => nRows - 1 - strikes.indexOf(strike);

  const strikeLabelEvery = strikes.filter((s) => Math.round(s) % 100 === 0);
  const showAllStrikes = strikeLabelEvery.length === 0;

  // One-line interpretation of the strongest builds on this tape. Max-pain
  // touch marks come from the model (any row inside a bucket counts).
  const read = readHeatmap(model);
  const readText = heatmapReadText(read);

  // Ticks on the 30-min wall-clock marks (bucket starts, not representative
  // rows — the last row of a 09:15 bucket is 09:19, which never lands on :00/:30).
  const timeTicks = useMemo(() => {
    const idx: number[] = [];
    buckets.forEach((b, bi) => {
      const mins = clockMinutes(b.startLabel);
      if (mins !== null && mins % 30 === 0) idx.push(bi);
    });
    if (idx.length === 0) {
      idx.push(0);
      if (buckets.length > 1) idx.push(buckets.length - 1);
    }
    return idx;
  }, [buckets]);

  return (
    <Box
      data-testid="nifty-heatmap"
      sx={{
        width: "100%",
        minWidth: 0,
        // Fill the FLOW band's flexible cell: the SVG grows into the slack
        // left by the 300px chart row while the read/legend stay fixed.
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      {/* Key for the cells and the overlay marks — a header bar above the plot. */}
      <Box
        data-testid="nifty-heatmap-legend"
        aria-label="Heatmap legend"
        sx={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          columnGap: "10px",
          rowGap: "2px",
          minHeight: 20,
          flexShrink: 0,
          px: 0.75,
          py: 0.25,
          borderBottom: `1px solid ${BORDER}`,
          backgroundColor: "rgba(255,255,255,0.03)",
          fontSize: 10,
          lineHeight: 1.2,
          fontFamily: MONO,
          color: TEXT_MUTED,
        }}
      >
        <Box
          component="span"
          data-testid="nifty-heatmap-legend-title"
          sx={{ fontSize: 9, letterSpacing: "0.08em", opacity: 0.6 }}
        >
          HEATMAP
        </Box>
        {LEGEND.map((item) => (
          <LegendItem key={item.id} item={item} />
        ))}
        <LegendItem item={OPACITY_NOTE} />
      </Box>

      {/* Plain-English read of the tape — what the colours are actually saying. */}
      <Box
        data-testid="nifty-heatmap-read"
        title="Strongest OI builds on this tape, in plain English"
        sx={{
          px: 0.75,
          mt: "2px",
          flexShrink: 0,
          fontSize: 10,
          lineHeight: 1.2,
          fontFamily: MONO,
          color: TEXT,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {readText || "no ΔOI build yet"}
      </Box>

      <svg
        data-testid="nifty-heatmap-svg"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        width="100%"
        height="100%"
        style={{ flex: 1, minHeight: 0, display: "block" }}
        role="img"
        aria-label="OI change heatmap"
      >
        {cells.map((c) => {
          const r = rowOf(c.strike);
          const x = PAD_L + c.bucket * cellW;
          const y = r * cellH;
          return (
            <rect
              key={`${c.bucket}-${c.strike}`}
              data-testid="nifty-heatmap-cell"
              data-bucket={c.bucket}
              data-strike={c.strike}
              data-sign={c.sign}
              x={x}
              y={y}
              width={Math.max(0.5, cellW - 0.5)}
              height={Math.max(0.5, cellH - 0.5)}
              fill={cellFill(c.sign)}
              fillOpacity={cellOpacity(c.sign, c.intensity)}
            >
              <title>
                {`${buckets[c.bucket]?.label ?? ""} · ${c.strike.toLocaleString("en-IN")} · CE ${compactOi(c.ceDoi)} / PE ${compactOi(c.peDoi)}`}
              </title>
            </rect>
          );
        })}
        {/* Spot line (white) across buckets */}
        <polyline
          data-testid="nifty-heatmap-spotline"
          fill="none"
          stroke={HEATMAP_SPOT}
          strokeWidth={1.5}
          points={buckets.map((b, bi) => `${xOf(bi)},${yOf(b.spot)}`).join(" ")}
        >
          <title>{`Spot ${buckets.map((b) => `${b.label} ${Math.round(b.spot).toLocaleString("en-IN")}`).join(" · ")}`}</title>
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
              <title>{`Max pain touch ${Math.round(b.touch.maxPain).toLocaleString("en-IN")} @ ${b.label}`}</title>
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
              <title>{`Max pain ${Math.round(b.maxPain).toLocaleString("en-IN")} @ ${b.label}`}</title>
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
              <title>{`Flip ${Math.round(flip).toLocaleString("en-IN")} @ ${b.label}`}</title>
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
            {Math.round(s).toLocaleString("en-IN")}
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
        {timeTicks.map((bi) => {
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
              {buckets[bi].startLabel}
            </text>
          );
        })}
      </svg>
    </Box>
  );
}
