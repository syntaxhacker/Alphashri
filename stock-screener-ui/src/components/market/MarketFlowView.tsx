/**
 * Market → Vis "Money flow".
 *
 * Chart form: the D3 gallery "Radial Area / Arc diagram" family — one annular
 * sector per market sector. Three independent encodings, never one overloaded
 * colour: arc fill = median session change (zero-centred P&L ramp), arc outer
 * radius = turnover, and a static dashed radial rail = the signed-turnover
 * proxy. Rail colour, width and its static arrowhead all derive from the
 * *same* signed-turnover sign, so colour can never contradict direction
 * (AUDIT P0-2). The rails deliberately do not animate: the arrowhead already
 * encodes direction and the rail width already encodes magnitude.
 *
 * The headline is deliberately not a blended 5m/session number (AUDIT P0-1):
 * this view has no blend at all. Every signed figure is named "signed turnover
 * (proxy)" — it is not observed buy/sell flow (AUDIT P0-3).
 *
 * Reference: https://observablehq.com/@d3/gallery (Radial Area)
 */
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { Box, Text, ToolbarRow, typeSize } from "@/ui";
import {
  alpha,
  MONO,
  VIZ_BG,
  VIZ_DOWN,
  VIZ_GRID,
  VIZ_MUTED,
  VIZ_PANEL,
  VIZ_SCALE_PNL,
  VIZ_TEXT,
  VIZ_UP,
} from "@/ui/palette";
import { CURRENCIES, type CurrencyCode } from "@/config/currency";
import { compositeOver, contrastRatio, pickTextColor } from "@/utils/contrast";
import type { MarketRow } from "@/types/marketScreener";
import type { VisRenderProps } from "./MarketMapView";
import {
  formatSignedPct as formatSignedPercent,
  isFiniteNumber as finite,
  VIZ_PNL_NEUTRAL_INDEX,
} from "./vis/visScale";

export { formatSignedPercent };

export const UNCLASSIFIED_SECTOR = "Unclassified";
const EXTENT_FLOOR = 0.5;
const MIN_TEXT_CONTRAST = 4.5;
const EMPTY: MarketRow[] = [];

/** SVG geometry, in viewBox units. Sized so labels fit at 1600 and 390. */
const VIEW = 440;
const CX = VIEW / 2;
const CY = VIEW / 2;
const R_INNER = 50;
const BAND_MIN = 10;
const BAND_MAX = 46;
const GAP_DEG = 2.2;
const START_DEG = -90;
const LABEL_FONT = typeSize("title");
const CENTRE_FONT = typeSize("label");
/** Radial bands: adjacent arcs start in different bands, never one shared ring. */
const LABEL_GAP = 10;
const LABEL_BAND_STEP = 13;
/** Measured advance of the monospace stack at `LABEL_FONT`, per em. */
const MONO_ADVANCE = 0.62;

export interface SectorFlowGroup {
  /** Trimmed sector name, or `Unclassified` when the row has none. */
  sector: string;
  /** Rows with a finite change, including any whose turnover could not be derived. */
  members: number;
  /** Σ finite value traded; `volume × close` only when value traded is null. */
  turnover: number;
  /** Σ(turnover_i × sign(change_i)) — a directional proxy, not measured flow. */
  signedTurnover: number;
  /** Robust centre of the cohort: median of finite member changes. */
  change: number | null;
  advances: number;
  declines: number;
  /** Members excluded from turnover because neither source was available. */
  missingTurnover: number;
}

/** Median of finite readings only; a missing quote is not a zero. */
export function medianFinite(values: readonly (number | null | undefined)[]): number | null {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Group by sector, then aggregate. Rows with a non-finite change are ignored
 * entirely — their direction is unknown, so neither the median nor the proxy
 * may use them. Null/blank sectors land in one explicit `Unclassified` group.
 */
export function aggregateSectorFlow(rows: readonly MarketRow[] | null | undefined): SectorFlowGroup[] {
  const groups = new Map<string, MarketRow[]>();
  for (const row of rows ?? EMPTY) {
    if (!row || !finite(row.change)) continue;
    const raw = typeof row.sector === "string" ? row.sector.trim() : "";
    const sector = raw || UNCLASSIFIED_SECTOR;
    const members = groups.get(sector);
    if (members) members.push(row);
    else groups.set(sector, [row]);
  }

  const result: SectorFlowGroup[] = [];
  for (const [sector, members] of groups) {
    let turnover = 0;
    let signedTurnover = 0;
    let missingTurnover = 0;
    let advances = 0;
    let declines = 0;

    for (const row of members) {
      const change = row.change as number;
      let traded = finite(row.valueTraded) ? row.valueTraded : null;
      if (traded === null && finite(row.volume) && finite(row.close)) {
        traded = row.volume * row.close;
      }
      if (traded !== null && finite(traded)) {
        turnover += traded;
        signedTurnover += traded * Math.sign(change);
      } else {
        missingTurnover += 1;
      }
      if (change > 0) advances += 1;
      else if (change < 0) declines += 1;
    }

    result.push({
      sector,
      members: members.length,
      turnover,
      signedTurnover,
      change: medianFinite(members.map((row) => row.change)),
      advances,
      declines,
      missingTurnover,
    });
  }

  // Every group survives; only the order is decided here. Tie-break on name so
  // a refresh cannot make two equal sectors swap places.
  return result.sort((a, b) => b.turnover - a.turnover || a.sector.localeCompare(b.sector));
}

/** Symmetric colour domain; a flat set still gets a 0.5% half-domain. */
export function flowExtent(groups: readonly SectorFlowGroup[]): number {
  let max = EXTENT_FLOOR;
  for (const group of groups) {
    if (group.change !== null) max = Math.max(max, Math.abs(group.change));
  }
  return max;
}

/** Zero-centred, √-curved VIZ_SCALE_PNL stop — small moves stay visible. */
export function flowChangeColor(change: number | null, extent: number): string {
  if (!finite(change)) return VIZ_SCALE_PNL[VIZ_PNL_NEUTRAL_INDEX]!;
  const span = finite(extent) && extent > 0 ? extent : EXTENT_FLOOR;
  const curved = Math.sign(change) * span * Math.sqrt(Math.min(Math.abs(change) / span, 1));
  const t = Math.max(-1, Math.min(1, curved / span));
  const raw = Math.round(((t + 1) / 2) * (VIZ_SCALE_PNL.length - 1));
  const index = Math.max(0, Math.min(VIZ_SCALE_PNL.length - 1, raw));
  return VIZ_SCALE_PNL[index]!;
}

export interface TileAppearance {
  fill: string;
  ink: string;
  alpha: number;
}

/**
 * A translucent ramp over the panel. If neither text anchor clears 4.5:1, the
 * fill alpha is capped and re-composited rather than shipping unreadable text.
 */
export function tileAppearance(change: number | null, extent: number): TileAppearance {
  const ramp = flowChangeColor(change, extent);
  const magnitude = change === null ? 0 : Math.min(Math.abs(change) / (extent || EXTENT_FLOOR), 1);
  let alphaValue = 0.45 + 0.5 * Math.sqrt(magnitude);
  let fill = compositeOver(ramp, VIZ_PANEL, alphaValue);
  let ink = pickTextColor(fill, VIZ_TEXT, VIZ_BG);
  while (contrastRatio(ink, fill) < MIN_TEXT_CONTRAST && alphaValue > 0.1) {
    alphaValue = Math.max(0.1, alphaValue - 0.05);
    fill = compositeOver(ramp, VIZ_PANEL, alphaValue);
    ink = pickTextColor(fill, VIZ_TEXT, VIZ_BG);
  }
  return { fill, ink, alpha: alphaValue };
}

export interface RailAppearance {
  /** `in` = toward the centre, `out` = away from it. */
  direction: "in" | "out";
  color: string;
  width: number;
}

/** Width encodes magnitude; colour encodes the same sign as direction. */
export function railAppearance(signedTurnover: number, maxAbsSigned: number): RailAppearance {
  const denominator = finite(maxAbsSigned) && maxAbsSigned > 0 ? maxAbsSigned : 1;
  const magnitude = Math.min(Math.abs(signedTurnover) / denominator, 1);
  const curved = Math.sqrt(magnitude);
  return {
    direction: signedTurnover >= 0 ? "in" : "out",
    color: signedTurnover >= 0 ? VIZ_UP : VIZ_DOWN,
    width: 1.5 + 5 * curved,
  };
}

const SHORT_NAMES: Readonly<Record<string, string>> = {
  Finance: "Finance",
  "Producer Manufacturing": "Producer Mfg",
  "Technology Services": "Tech Services",
  "Non-Energy Minerals": "Non-Energy Min",
  "Electronic Technology": "Electronic Tech",
  "Consumer Durables": "Cons Durables",
  "Health Technology": "Health Tech",
  Utilities: "Utilities",
  Miscellaneous: "Misc",
  "Energy Minerals": "Energy",
  "Process Industries": "Process Ind",
  "Consumer Non-Durables": "Cons Non-Dur",
  Transportation: "Transport",
  "Industrial Services": "Ind Services",
  Communications: "Comms",
  "Retail Trade": "Retail",
  "Consumer Services": "Cons Services",
  "Distribution Services": "Distribution",
  "Health Services": "Health Services",
  "Commercial Services": "Comm Services",
  [UNCLASSIFIED_SECTOR]: UNCLASSIFIED_SECTOR,
};

/** Abbreviate by initials for unknown long names; never ellipsis-truncate. */
export function shortSectorName(name: string): string {
  const known = SHORT_NAMES[name];
  if (known) return known;
  if (name.length <= 13) return name;
  return name
    .replace(/[^A-Za-z\s]/g, "")
    .trim()
    .split(/\s+/)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 8);
}

export function formatAmount(value: number, currency: CurrencyCode = "INR", signed = false): string {
  const spec = CURRENCIES[currency];
  const rounded = Math.abs(value) < 0.5 ? 0 : value;
  const number = new Intl.NumberFormat(spec.grouping, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Math.abs(rounded));
  const sign = signed ? (rounded > 0 ? "+" : rounded < 0 ? "-" : "") : rounded < 0 ? "-" : "";
  return `${sign}${spec.symbol}${number}`;
}

interface Point {
  x: number;
  y: number;
}

const polar = (radius: number, degrees: number): Point => {
  const radians = (degrees * Math.PI) / 180;
  return { x: CX + radius * Math.sin(radians), y: CY - radius * Math.cos(radians) };
};

const xy = (point: Point): string => `${point.x.toFixed(2)},${point.y.toFixed(2)}`;

function annularPath(inner: number, outer: number, start: number, end: number): string {
  const large = end - start > 180 ? 1 : 0;
  return (
    `M${xy(polar(outer, start))} ` +
    `A${outer.toFixed(2)},${outer.toFixed(2)} 0 ${large} 1 ${xy(polar(outer, end))} ` +
    `L${xy(polar(inner, end))} ` +
    `A${inner.toFixed(2)},${inner.toFixed(2)} 0 ${large} 0 ${xy(polar(inner, start))} Z`
  );
}

function arrowPath(midDeg: number, tipRadius: number, baseRadius: number): string {
  const tip = polar(tipRadius, midDeg);
  const left = polar(baseRadius, midDeg - 3.5);
  const right = polar(baseRadius, midDeg + 3.5);
  return `M${xy(tip)} L${xy(left)} L${xy(right)} Z`;
}

/** Axis-aligned bounds of a rotated label, in viewBox units. */
export interface RingLabelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedRingLabel {
  sector: string;
  x: number;
  y: number;
  rotation: number;
  textAnchor: "start" | "end";
  fontSize: number;
  /** Radial offset from the arc edge; > 0 gets a leader line. */
  band: number;
  rect: RingLabelRect;
}

export interface SuppressedRingLabel {
  sector: string;
}

export interface RingLabelPlacement {
  placed: PlacedRingLabel[];
  suppressed: SuppressedRingLabel[];
}

/** Pairwise test used by both the placement pass and its regression tests. */
export function rectsOverlap(a: RingLabelRect, b: RingLabelRect, gap = 0): boolean {
  return (
    a.x - gap < b.x + b.width &&
    b.x - gap < a.x + a.width &&
    a.y - gap < b.y + b.height &&
    b.y - gap < a.y + a.height
  );
}

function rotatedLabelRect(
  anchor: Point,
  rotation: number,
  length: number,
  fontSize: number,
  textAnchor: "start" | "end",
): RingLabelRect {
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x0 = textAnchor === "start" ? 0 : -length;
  const x1 = x0 + length;
  // Monospace glyphs sit mostly ABOVE the baseline; a centred ±½em box misses
  // the ascenders and let two near-vertical labels slip past the pass.
  const corners: readonly [number, number][] = [
    [x0, -fontSize],
    [x1, -fontSize],
    [x1, fontSize * 0.35],
    [x0, fontSize * 0.35],
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [dx, dy] of corners) {
    const x = anchor.x + dx * cos - dy * sin;
    const y = anchor.y + dx * sin + dy * cos;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Place ring labels by collision search, never by eyeballing. Each candidate
 * is the axis-aligned bounding box of the *rotated* full name; the first box
 * that clears every already-placed box wins, otherwise the label is suppressed
 * (its arc, title and heatmap tile still carry the full name). Adjacent arcs
 * start in alternating radial bands, so labels converging near the top cannot
 * share one annulus. `viewWidth` is the rendered SVG width: a narrow view
 * enlarges the type in viewBox units to keep it legible and suppresses more.
 */
export function placeRingLabels(
  sectors: readonly Pick<SectorFlowGroup, "sector" | "turnover">[],
  viewWidth: number,
): RingLabelPlacement {
  const placed: PlacedRingLabel[] = [];
  const suppressed: SuppressedRingLabel[] = [];
  const count = sectors.length;
  if (count === 0) return { placed, suppressed };

  const width = finite(viewWidth) && viewWidth > 0 ? viewWidth : VIEW;
  const fontSize = LABEL_FONT * Math.max(1, VIEW / width);
  const clearance = width <= 480 ? 3 : 1.5;
  const maxTurnover = Math.max(1, ...sectors.map((sector) => sector.turnover));
  const slot = 360 / count;

  for (let index = 0; index < count; index += 1) {
    const group = sectors[index]!;
    const start = START_DEG + index * slot + GAP_DEG / 2;
    const mid = start + (slot - GAP_DEG) / 2;
    const band = BAND_MIN + (group.turnover / maxTurnover) * (BAND_MAX - BAND_MIN);
    const outer = R_INNER + band;
    const normalized = ((mid % 360) + 360) % 360;
    const rightHalf = normalized <= 180;
    const rotation = rightHalf ? mid - 90 : mid + 90;
    const textAnchor: "start" | "end" = rightHalf ? "start" : "end";
    // Ring labels use the registry's short name: no ellipsis, and the full
    // name stays on the arc title, aria-label and heatmap tile.
    const length = shortSectorName(group.sector).length * fontSize * MONO_ADVANCE;
    const parity = index % 2;
    const offsets = [parity, 1 - parity].flatMap((candidate) =>
      [0, 2, 4].map((step) => (candidate + step * 2) * LABEL_BAND_STEP),
    );

    let chosen: PlacedRingLabel | null = null;
    for (const bandOffset of offsets) {
      const anchor = polar(outer + LABEL_GAP + bandOffset, mid);
      const rect = rotatedLabelRect(anchor, rotation, length, fontSize, textAnchor);
      // A clipped label is a truncated label. The SVG owns this rectangle, so
      // anything crossing its edge is suppressed, not half-drawn.
      const inside =
        rect.x >= 2 &&
        rect.y >= 2 &&
        rect.x + rect.width <= VIEW - 2 &&
        rect.y + rect.height <= VIEW - 2;
      if (!inside) continue;
      if (placed.every((label) => !rectsOverlap(label.rect, rect, clearance))) {
        chosen = {
          sector: group.sector,
          x: anchor.x,
          y: anchor.y,
          rotation,
          textAnchor,
          fontSize,
          band: bandOffset,
          rect,
        };
        break;
      }
    }
    if (chosen) placed.push(chosen);
    else suppressed.push({ sector: group.sector });
  }

  return { placed, suppressed };
}

/** Group title/aria text — one honest sentence reused by arc and tile. */
export function flowSentence(group: SectorFlowGroup, currency: CurrencyCode): string {
  const word = group.signedTurnover >= 0 ? "inflow" : "outflow";
  return (
    `${group.sector} · turnover ${formatAmount(group.turnover, currency)} · ` +
    `signed turnover (proxy) ${formatAmount(group.signedTurnover, currency, true)} (${word}) · ` +
    `median change ${formatSignedPercent(group.change)} · ${group.members} members · ` +
    `${group.advances} advances / ${group.declines} declines`
  );
}

const CSS = `
.mf-rail { fill: none; stroke-linecap: round; stroke-dasharray: 5 7; }
.mf-sector { cursor: pointer; outline: none; }
.mf-arc { transition: stroke .15s, stroke-width .15s; }
.mf-sector:hover .mf-arc, .mf-sector:focus-visible .mf-arc, .mf-sector.mf-active .mf-arc { stroke: ${VIZ_TEXT}; stroke-width: 2; }
.mf-sector:hover .mf-lbl, .mf-sector:focus-visible .mf-lbl, .mf-sector.mf-active .mf-lbl { fill: ${VIZ_TEXT}; font-weight: 700; }
.mf-tile.mf-active { outline: 2px solid ${VIZ_TEXT}; outline-offset: 1px; }
/* Compact tiles: 12px text floor, tighter leading and padding, no fixed row
   height that could force the heatmap past its flex container. */
.mf-tile span { line-height: 14px; }
.mf-heat-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-rows: minmax(0, auto); gap: 8px; align-content: start; min-width: 0; min-height: 0; }
.mf-canvas { flex: 1; min-width: 0; min-height: 0; display: flex; align-items: center; justify-content: center; }
.mf-layout { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, auto) minmax(0, 1fr); gap: 8px; flex: 1; min-width: 0; min-height: 0; max-width: 1080px; }
@media (min-width: 900px) {
  .mf-layout { grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); grid-template-rows: minmax(0, 1fr); gap: 16px; }
  .mf-heat-grid { grid-auto-rows: minmax(0, 1fr); align-content: stretch; }
}
/* Narrow screens keep a readable ring with short labels and full tiles; the
   heatmap lives in this single scrollport, with one cue in the toolbar. */
@media (max-width: 899px) {
  .market-flow-view { overflow-y: auto; overflow-x: hidden; }
  .market-flow-toolbar { height: 30px !important; }
  .mf-layout { flex: none !important; grid-template-rows: auto auto; gap: 4px; padding: 4px; }
  .mf-canvas { flex: none; }
  .mf-canvas svg { width: 100% !important; max-width: 260px; height: auto !important; }
  .mf-heat-sub { line-height: 12px; }
  .mf-heat-grid { flex: none !important; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: minmax(0, auto); gap: 4px; }
  .mf-tile { padding: 2px !important; }
  .mf-tile span { line-height: 14px; }
  .mf-legend { padding: 0 8px !important; }
  .mf-legend-row, .mf-legend-note { display: none; }
}
`;

/** Market → Vis money-flow renderer: SVG ring + sector heatmap. */
export function MarketFlowView(props: VisRenderProps) {
  const [hovered, setHovered] = createSignal<string | null>(null);
  const [pinned, setPinned] = createSignal<string | null>(null);
  const [labelWidth, setLabelWidth] = createSignal(VIEW);
  const active = () => hovered() ?? pinned();
  const currency = (): CurrencyCode => props.currency ?? "INR";
  // Same 480px breakpoint as the ring label pass: narrow viewports keep the
  // short `(proxy)` qualifier so the signed figure never truncates at 2 columns.
  const narrow = () => labelWidth() <= 480;

  // jsdom/happy-dom have no layout; the viewBox width is the honest default.
  // In a real browser the measured width makes narrow screens drop more labels
  // instead of stacking overlapping ones.
  const measureSvg = (element: SVGSVGElement) => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (finite(next) && next > 0) setLabelWidth(next);
    });
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  };

  const groups = createMemo(() => aggregateSectorFlow(props.rows ?? EMPTY));
  // A narrow ring is drawn small, so lay its short labels out against a wider
  // virtual box; the rendered glyphs stay above 12px while more names clear.
  const labelSizingWidth = () => (narrow() ? Math.max(labelWidth(), 290) : labelWidth());
  const labelPlacement = createMemo(() => placeRingLabels(groups(), labelSizingWidth()));
  const labelBySector = createMemo(
    () => new Map(labelPlacement().placed.map((label) => [label.sector, label])),
  );
  const extent = createMemo(() => flowExtent(groups()));
  const maxSigned = createMemo(() =>
    Math.max(1, ...groups().map((group) => Math.abs(group.signedTurnover))),
  );
  const totalTurnover = createMemo(() => groups().reduce((sum, group) => sum + group.turnover, 0));
  const maxTurnover = createMemo(() => Math.max(1, ...groups().map((group) => group.turnover)));

  const toggle = (sector: string) => setPinned((current) => (current === sector ? null : sector));

  return (
    <Box
      className="market-flow-view flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden"
      style={{ "background-color": VIZ_BG, color: VIZ_TEXT }}
      data-testid="market-flow-view"
    >
      <style data-testid="market-flow-css">{CSS}</style>

      <ToolbarRow
        gap={8}
        wrap={false}
        clip
        className="market-flow-toolbar h-10 flex-shrink-0 border-b px-2"
        style={{ "border-color": VIZ_GRID }}
        data-testid="market-flow-toolbar"
      >
        <Text span size="xs" fw={600} c={VIZ_TEXT} className="whitespace-nowrap shrink-0">
          Money flow
        </Text>
        <Box className="flex-1 min-w-0" />
        <Text span size="xs" c={VIZ_MUTED} className="whitespace-nowrap shrink-0 font-mono tabular-nums" data-testid="market-flow-count">
          {groups().length} sectors · {(props.rows ?? EMPTY).length} stocks
          <Show when={narrow()}> · ↓ scroll</Show>
        </Text>
        {/*
          The count and scroll cue own the narrow header; the helper only fits
          once the layout switches to two columns. Its wording stays on the
          element itself so the hidden state still carries the same meaning.
        */}
        <Text
          span
          size="xs"
          c={VIZ_MUTED}
          className="hidden min-[900px]:inline whitespace-nowrap shrink-0"
          title={active() ? `Selected: ${active()}` : "Hover or focus a sector"}
          aria-label={active() ? `Selected: ${active()}` : "Hover or focus a sector"}
          data-testid="market-flow-selected"
        >
          {active() ? `Selected: ${active()}` : "Hover or focus a sector"}
        </Text>
      </ToolbarRow>

      <Show
        when={groups().length > 0}
        fallback={
          <Box
            className="flex-1 min-w-0 flex items-center justify-center p-4"
            data-testid="market-flow-empty"
          >
            <Text span size="sm" c={VIZ_MUTED}>
              No sector data in the current filter.
            </Text>
          </Box>
        }
      >
        <Box className="mf-layout flex-1 min-w-0 min-h-0 p-2" data-testid="market-flow-layout">
          <Box className="flex min-w-0 min-h-0 flex-col" data-testid="market-flow-ring-panel">
            <Box className="mf-canvas flex-1 min-w-0 min-h-0 flex items-center justify-center" data-testid="market-flow-canvas">
            <svg
              ref={measureSvg}
              viewBox={`0 0 ${VIEW} ${VIEW}`}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label="Sector money flow ring: arc radius is turnover, fill is median change, dashed rail and arrow are the signed turnover proxy."
              style={{ width: "100%", height: "100%", display: "block" }}
              data-testid="market-flow-svg"
            >
              <title>Sector money flow ring — signed turnover is a directional proxy</title>
              <For each={groups()}>
                {(group, index) => {
                  const slot = 360 / groups().length;
                  const start = START_DEG + index() * slot + GAP_DEG / 2;
                  const end = start + slot - GAP_DEG;
                  const mid = (start + end) / 2;
                  const band = BAND_MIN + (group.turnover / maxTurnover()) * (BAND_MAX - BAND_MIN);
                  const outer = R_INNER + band;
                  const rail = railAppearance(group.signedTurnover, maxSigned());
                  const sentence = () => flowSentence(group, currency());
                  const label = () => labelBySector().get(group.sector);
                  const tipR = rail.direction === "in" ? R_INNER - 6 : outer + 4;
                  const baseR = rail.direction === "in" ? R_INNER + 5 : outer - 7;
                  const isActive = () => active() === group.sector;
                  return (
                    <g
                      class="mf-sector"
                      classList={{ "mf-active": isActive() }}
                      tabindex="0"
                      role="img"
                      aria-label={sentence()}
                      onMouseEnter={() => setHovered(group.sector)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setHovered(group.sector)}
                      onBlur={() => setHovered(null)}
                      onClick={() => toggle(group.sector)}
                      data-testid={`market-flow-arc-${index()}`}
                      data-sector={group.sector}
                      data-fill={flowChangeColor(group.change, extent())}
                      data-direction={rail.direction}
                    >
                      <title>{sentence()}</title>
                      <path
                        class="mf-arc"
                        d={annularPath(R_INNER, outer, start, end)}
                        fill={flowChangeColor(group.change, extent())}
                        fill-opacity="0.82"
                        stroke={VIZ_BG}
                        stroke-width="1"
                      />
                      <path
                        class={`mf-rail mf-${rail.direction}`}
                        d={`M${xy(polar(outer + 4, mid))} L${xy(polar(R_INNER - 6, mid))}`}
                        stroke={rail.color}
                        stroke-width={rail.width.toFixed(2)}
                        data-testid={`market-flow-rail-${index()}`}
                        data-width={rail.width.toFixed(2)}
                      />
                      <path
                        d={arrowPath(mid, tipR, baseR)}
                        fill={rail.color}
                        data-testid={`market-flow-arrow-${index()}`}
                      />
                      <Show when={label()}>
                        {(item) => (
                          <>
                            <Show when={item().band > 0}>
                              <line
                                x1={polar(outer + 2, mid).x.toFixed(2)}
                                y1={polar(outer + 2, mid).y.toFixed(2)}
                                x2={item().x.toFixed(2)}
                                y2={item().y.toFixed(2)}
                                stroke={VIZ_GRID}
                                stroke-width="1"
                                data-testid={`market-flow-leader-${index()}`}
                              />
                            </Show>
                            <text
                              class="mf-lbl"
                              x={item().x.toFixed(2)}
                              y={item().y.toFixed(2)}
                              transform={`rotate(${item().rotation.toFixed(2)} ${item().x.toFixed(2)} ${item().y.toFixed(2)})`}
                              text-anchor={item().textAnchor}
                              fill={VIZ_MUTED}
                              style={{ "font-size": `${item().fontSize.toFixed(2)}px`, "font-family": MONO }}
                              data-testid={`market-flow-label-${index()}`}
                            >
                              {shortSectorName(group.sector)}
                            </text>
                          </>
                        )}
                      </Show>
                    </g>
                  );
                }}
              </For>
              <circle cx={CX} cy={CY} r="40" fill={VIZ_PANEL} stroke={VIZ_GRID} stroke-width="1" />
              <text
                x={CX}
                y={CY - 8}
                text-anchor="middle"
                fill={VIZ_TEXT}
                style={{ "font-size": `${CENTRE_FONT}px`, "font-family": MONO, "font-weight": "700" }}
                data-testid="market-flow-centre"
              >
                MARKET
              </text>
              <text
                x={CX}
                y={CY + 10}
                text-anchor="middle"
                fill={VIZ_UP}
                style={{ "font-size": `${CENTRE_FONT}px`, "font-family": MONO }}
                data-testid="market-flow-total"
              >
                {formatAmount(totalTurnover(), currency())}
              </text>
              <text
                x={CX}
                y={CY + 26}
                text-anchor="middle"
                fill={VIZ_MUTED}
                style={{ "font-size": `${CENTRE_FONT}px`, "font-family": MONO }}
                data-testid="market-flow-session"
              >
                SESSION
              </text>
            </svg>
            </Box>
          </Box>

          <Box className="flex min-w-0 min-h-0 flex-col gap-1" data-testid="market-flow-heat-panel">
            <Show
              when={narrow()}
              fallback={
                <Text span size="xs" c={VIZ_MUTED} className="mf-heat-sub min-w-0 break-words" data-testid="market-flow-heat-sub">
                  Sector heatmap · median change · signed turnover (proxy) · same order as the ring (turnover desc)
                </Text>
              }
            >
              <Text span size="xs" c={VIZ_MUTED} className="mf-heat-sub min-w-0 break-words" data-testid="market-flow-heat-sub">
                Sector heatmap · signed turnover (proxy)
              </Text>
            </Show>
            <Box
              className="mf-heat-grid flex-1 min-w-0 min-h-0"
              data-testid="market-flow-heat"
            >
              <For each={groups()}>
                {(group, index) => {
                  const look = () => tileAppearance(group.change, extent());
                  const sentence = () => flowSentence(group, currency());
                  const isActive = () => active() === group.sector;
                  return (
                    <Box
                      className="mf-tile flex min-w-0 flex-col rounded-fin p-1"
                      classList={{ "mf-active": isActive(), "mf-tile-narrow": narrow() }}
                      role="img"
                      tabindex="0"
                      title={sentence()}
                      aria-label={sentence()}
                      onMouseEnter={() => setHovered(group.sector)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setHovered(group.sector)}
                      onBlur={() => setHovered(null)}
                      onClick={() => toggle(group.sector)}
                      style={{ "background-color": look().fill, color: look().ink }}
                      data-testid={`market-flow-tile-${index()}`}
                      data-sector={group.sector}
                      data-fill={look().fill}
                      data-ink={look().ink}
                      data-alpha={look().alpha.toFixed(2)}
                    >
                      <Text
                        span
                        size="xs"
                        fw={600}
                        className="min-w-0 break-words leading-tight"
                        data-testid={`market-flow-tile-name-${index()}`}
                      >
                        {group.sector}
                      </Text>
                      <Text
                        span
                        size="xs"
                        fw={700}
                        className="font-mono tabular-nums"
                        data-testid={`market-flow-tile-change-${index()}`}
                      >
                        {formatSignedPercent(group.change)}
                      </Text>
                      <Text
                        span
                        size="xs"
                        className="font-mono tabular-nums leading-tight"
                        data-testid={`market-flow-tile-signed-${index()}`}
                      >
                        {group.signedTurnover >= 0 ? "inflow" : "outflow"}{" "}
                        <span className="min-w-0 break-words">(proxy) {formatAmount(group.signedTurnover, currency(), true)}</span>
                      </Text>
                      <Text
                        span
                        size="xs"
                        className="font-mono tabular-nums opacity-80"
                        data-testid={`market-flow-tile-turnover-${index()}`}
                      >
                        turnover {formatAmount(group.turnover, currency())}
                      </Text>
                    </Box>
                  );
                }}
              </For>
            </Box>
          </Box>
        </Box>
      </Show>

      <Box
        className="mf-legend flex-shrink-0 flex flex-col gap-1 border-t px-2 py-2"
        style={{ "border-color": VIZ_GRID, "background-color": alpha(VIZ_PANEL, 0.6) }}
        data-testid="market-flow-legend"
      >
        <Box className="mf-legend-row flex flex-wrap items-center gap-2">
          <Box
            className="h-2 w-24 flex-shrink-0 rounded-fin"
            style={{ background: `linear-gradient(to right, ${VIZ_SCALE_PNL.join(", ")})` }}
            data-testid="market-flow-legend-ramp"
          />
          <Text span size="xs" c={VIZ_MUTED} className="whitespace-nowrap" data-testid="market-flow-legend-change">
            loss ← change → gain
          </Text>
          <Box className="flex items-center gap-1 whitespace-nowrap" data-testid="market-flow-legend-in">
            <Box className="h-2 w-2 rounded-fin" style={{ "background-color": VIZ_UP }} />
            <Text span size="xs" c={VIZ_MUTED}>inflow</Text>
          </Box>
          <Box className="flex items-center gap-1 whitespace-nowrap" data-testid="market-flow-legend-out">
            <Box className="h-2 w-2 rounded-fin" style={{ "background-color": VIZ_DOWN }} />
            <Text span size="xs" c={VIZ_MUTED}>outflow</Text>
          </Box>
        </Box>
        <Text span size="xs" c={VIZ_MUTED} className="min-w-0 break-words" data-testid="market-flow-legend-encodings">
          arc radius ∝ turnover · rail width ∝ |signed turnover (proxy)| · arrow = direction
        </Text>
        <Text span size="xs" c={VIZ_TEXT} className="mf-legend-note min-w-0 break-words" data-testid="market-flow-note">
          Signed turnover is Σ(value traded × sign(change)) — a directional proxy, not measured buy/sell flow.
        </Text>
      </Box>
    </Box>
  );
}
