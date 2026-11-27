/**
 * Pure ECharts option builder for the strike × expiry payoff heatmap.
 *
 * No store, no network, no DOM: the component hands over the matrix built by
 * `src/utils/payoffMatrix` and gets back a plain option object, so axes, labels,
 * colours and tooltips can be asserted without mounting a canvas.
 *
 * The matrix type is declared structurally here so this module does not depend
 * on the builder's full contract. Pricing is decided by a cell's explicit
 * `priced`/`basis` flags plus a finite P&L — never by a null `timeValue`: a
 * missing IV quote still leaves a real intrinsic P&L that belongs on the ramp.
 */

import { typeSize } from "@/ui";
import * as palette from "@/ui/palette";
import { compositeOver, pickTextColor } from "@/utils/contrast";
import { aggregateGreeks, type OptionLeg } from "@/utils/optionsMath";
import { hasTimeValue } from "@/utils/payoffMatrix";

export interface PayoffLeg {
  action: "BUY" | "SELL";
  opt: "CE" | "PE";
  strike: number;
  premium: number;
  qty: number;
  /** Optional per-leg greeks; missing values null the net aggregate. */
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
}

export type PayoffCellBasis = "intrinsic+time" | "intrinsic-only";

export interface PayoffCell {
  pnl: number | null;
  intrinsic: number | null;
  timeValue: number | null;
  spotPct: number | null;
  /** false ⇒ the cell cannot be priced at all and must be hatched. Optional for legacy matrices. */
  priced?: boolean;
  /** Whether the P&L carries a time-value model or is intrinsic-only. Optional for legacy matrices. */
  basis?: PayoffCellBasis | null;
}

export interface PayoffKpisShape {
  netDebit?: number;
  maxProfit?: number | null;
  maxLoss?: number | null;
  breakevens?: number[];
  pop?: number | null;
}

export interface PayoffMatrixShape {
  strikes: number[];
  expiries: string[];
  cells: PayoffCell[][];
  kpis?: PayoffKpisShape | null;
  spotRowIndex: number | null;
}

export interface PayoffGreeks {
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  partial?: boolean;
}

/** Symmetric, finite colour bounds. Kept stable while a slider is dragged. */
export interface PnlDomain {
  min: number;
  max: number;
}

export interface PayoffOptionInput {
  matrix: PayoffMatrixShape;
  legs: readonly PayoffLeg[];
  spot: number;
  iv?: number | null;
  rangePct?: number;
  asOf?: string;
  /** Net greeks, normally from `payoffNetGreeks` (optionsMath aggregateGreeks). */
  greeks?: PayoffGreeks | null;
  /** Category label of the expiry the host currently highlights. */
  selectedExpiry?: string;
  /**
   * Frozen domain from the host. When supplied, the scale never follows an IV,
   * range or spot slider — only a change of legs is allowed to re-anchor it.
   */
  domain?: PnlDomain | null;
}

/** Axis ticks, cell labels, legend and disclosure text all share this floor. */
export const PAYOFF_LABEL_FONT_SIZE = typeSize("micro");
/** Note printed on a genuinely unpriceable (hatched) cell — its P&L is not real. */
export const NO_IV_NOTE = "No valid IV quote — intrinsic only";
/** Priced cell tooltip note: the P&L is real but no IV model produced it. */
export const INTRINSIC_ONLY_NOTE = "intrinsic only — no IV";
/** One prominent header badge when any priced cell is intrinsic-only. */
export const INTRINSIC_ONLY_BADGE = "INTRINSIC ONLY — no IV quote";
/** Never label more than this many expiry columns across a narrow dock. */
export const MAX_EXPIRY_LABELS = 7;
/** Robust upper clip for an unbounded tail (same 96th percentile as replay3d). */
export const PNL_CLIP_PERCENTILE = 0.96;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isNum(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBasis(value: unknown): value is PayoffCellBasis {
  return value === "intrinsic+time" || value === "intrinsic-only";
}

/**
 * A cell is unpriceable only when the builder says so or its P&L is unusable.
 * A null `timeValue` alone is a missing IV quote, not missing prices — the cell
 * still carries a real intrinsic P&L and must stay on the colour ramp.
 */
export function isUnpricedCell(cell: PayoffCell | null | undefined): boolean {
  return !cell || cell.priced === false || !isNum(cell.pnl);
}

/** Resolve the cell's basis, falling back to time-value presence for legacy matrices. */
export function cellBasis(cell: PayoffCell | null | undefined): PayoffCellBasis {
  if (isBasis(cell?.basis)) return cell.basis;
  return hasTimeValue(cell) ? "intrinsic+time" : "intrinsic-only";
}

/** Unicode minus keeps negative values unambiguous at 10px. */
function signed(value: number): string {
  return value > 0 ? "+" : value < 0 ? "−" : "";
}

/** Signed ₹ compact label, e.g. `+1.2k`, `−485`, `0`. Never `NaN`/`undefined`. */
export function formatSignedCompactPnl(value: unknown): string {
  if (!isNum(value)) return "—";
  const abs = Math.abs(value);
  let magnitude: string;
  if (abs >= 10_000_000) magnitude = `${(abs / 10_000_000).toFixed(1)}Cr`;
  else if (abs >= 100_000) magnitude = `${(abs / 100_000).toFixed(1)}L`;
  else if (abs >= 1_000) magnitude = `${(abs / 1_000).toFixed(1)}k`;
  else magnitude = String(Math.round(abs));
  return `${signed(value)}${magnitude}`;
}

/** Locale-independent ₹ grouping; ICU may be trimmed in small test runtimes. */
export function formatRupees(value: unknown): string {
  if (!isNum(value)) return "—";
  const grouped = String(Math.round(Math.abs(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  // Unicode minus only; a positive intrinsic/time value needs no leading plus.
  return `₹${value < 0 ? "−" : ""}${grouped}`;
}

export function formatSpotPct(value: unknown): string {
  if (!isNum(value)) return "—";
  return `${signed(value)}${Math.abs(value).toFixed(1)}%`;
}

/** Axis label for a rupee strike — `24k`, `24.5k`, `500`, never a long integer. */
export function formatStrikeAxis(strike: unknown): string {
  if (!isNum(strike)) return "—";
  if (Math.abs(strike) < 1000) return String(Math.round(strike));
  return `${Number((strike / 1000).toFixed(1))}k`;
}

/** `2026-11-23` → `23 Nov`, with a day count when `asOf` is a parseable date. */
export function formatExpiryLabel(expiry: string, asOf?: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry);
  if (!parts) return expiry || "—";
  const [, year, month, day] = parts;
  const label = `${Number(day)} ${MONTHS[Number(month) - 1] ?? month}`;
  if (!asOf) return label;
  const anchor = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOf);
  if (!anchor) return label;
  const dte = Math.max(
    0,
    Math.round((Date.UTC(Number(year), Number(month) - 1, Number(day)) - Date.UTC(Number(anchor[1]), Number(anchor[2]) - 1, Number(anchor[3]))) / 86_400_000),
  );
  return `${label} · ${dte}d`;
}

/**
 * Explicit category-axis interval: show one label every `interval + 1` columns.
 * Computed from the column count alone, so the same option is legible at 390 and
 * 1600px without a width-dependent ECharts guess.
 */
export function categoryAxisInterval(count: number, maxLabels = MAX_EXPIRY_LABELS): number {
  if (count <= 1 || count <= maxLabels) return 0;
  return Math.ceil(count / maxLabels) - 1;
}

/**
 * Robust, symmetric P&L domain. Defined risk (the leg-imposed max profit / max
 * loss) is the anchor because it never moves with the IV or range slider. Only
 * when a tail is unbounded (a null KPI) do we fall back to the 96th percentile
 * of the observed magnitudes, which clips a single far-OTM outlier without
 * flattening the rest of the lattice.
 */
export function robustPnlDomain(
  pnls: readonly number[],
  risk?: { maxProfit?: number | null; maxLoss?: number | null } | null,
  percentile = PNL_CLIP_PERCENTILE,
): PnlDomain {
  const magnitudes = pnls.filter(isNum).map((value) => Math.abs(value)).sort((a, b) => a - b);
  const q = isNum(percentile) ? Math.min(0.999, Math.max(0.5, percentile)) : PNL_CLIP_PERCENTILE;
  const clipped = magnitudes.length
    ? magnitudes[Math.min(magnitudes.length - 1, Math.floor(magnitudes.length * q))]
    : 0;
  const defined = [risk?.maxProfit, risk?.maxLoss].filter(isNum).map(Math.abs);
  const definedMag = defined.length ? Math.max(...defined) : 0;
  const mag = definedMag > 0 ? definedMag : clipped > 0 ? clipped : 1;
  return { min: -mag, max: mag };
}

/**
 * Cells are `[strikeRow][expiryColumn]` per the builder contract. A matrix with
 * the opposite layout is detected by its outer length, so a late shape change
 * cannot silently paint every cell in the wrong column.
 */
export function cellAt(matrix: PayoffMatrixShape, strikeIndex: number, expiryIndex: number): PayoffCell | null {
  const rowsAreStrikes =
    matrix.cells.length === matrix.strikes.length ||
    matrix.cells.length !== matrix.expiries.length;
  const row = matrix.cells[rowsAreStrikes ? strikeIndex : expiryIndex];
  const cell = row?.[rowsAreStrikes ? expiryIndex : strikeIndex];
  return cell ?? null;
}

/**
 * Net greeks from the same `optionsMath.aggregateGreeks` the dock uses. Legs
 * that carry no greek null that component's aggregate instead of zero-filling,
 * so a missing input can never fake a delta-neutral book.
 */
export function payoffNetGreeks(
  legs: readonly PayoffLeg[],
  byLeg?: (leg: PayoffLeg) => PayoffGreeks,
): PayoffGreeks {
  const pure: OptionLeg[] = [];
  const source = new Map<OptionLeg, PayoffLeg>();
  for (const leg of legs) {
    const converted: OptionLeg = {
      side: leg.action === "BUY" ? "buy" : "sell",
      type: leg.opt,
      strike: leg.strike,
      premium: leg.premium,
      lots: isNum(leg.qty) ? Math.max(0, leg.qty) : 0,
      lotSize: 1,
    };
    pure.push(converted);
    source.set(converted, leg);
  }
  return aggregateGreeks(pure, (leg) => {
    const origin = source.get(leg);
    const greek = byLeg?.(origin ?? (leg as unknown as PayoffLeg)) ?? origin ?? {};
    return {
      delta: greek.delta,
      gamma: greek.gamma,
      theta: greek.theta,
      vega: greek.vega,
    };
  });
}

function greekText(value: unknown, decimals: number): string {
  if (!isNum(value)) return "—";
  return `${signed(value)}${Math.abs(value).toFixed(decimals)}`;
}

/** Rich, stable tooltip. Every field has a fallback: no `undefined` or `NaN`. */
export function payoffTooltipHtml(
  cell: PayoffCell | null,
  args: {
    strike: number;
    expiry: string;
    /** Formatted category label, when the caller has one. */
    expiryLabel?: string;
    spotPct?: number | null;
    greeks?: PayoffGreeks | null;
    /** Overrides the note — the hatched exclusion series passes NO_IV_NOTE. */
    note?: string;
    /** Pricing basis of a priced cell; intrinsic-only adds INTRINSIC_ONLY_NOTE. */
    basis?: PayoffCellBasis | null;
  },
): string {
  const { strike, expiry, expiryLabel, greeks } = args;
  const pnl = cell?.pnl ?? null;
  const intrinsic = cell?.intrinsic ?? null;
  const timeValue = cell?.timeValue ?? null;
  const spotPct = cell?.spotPct ?? args.spotPct ?? null;
  const lines = [
    `<div><b>₹${escapeHtml(formatStrikeAxis(strike))}</b> · ${escapeHtml(expiryLabel || expiry)}</div>`,
    `<div>Spot ${escapeHtml(formatSpotPct(spotPct))}</div>`,
    `<div>P&amp;L <b>${escapeHtml(formatSignedCompactPnl(pnl))}</b></div>`,
    `<div>Intrinsic ${escapeHtml(formatRupees(intrinsic))}</div>`,
    `<div>Time value ${escapeHtml(formatRupees(timeValue))}</div>`,
  ];
  if (greeks && (isNum(greeks.delta) || isNum(greeks.theta))) {
    lines.push(`<div>Δ ${escapeHtml(greekText(greeks.delta, 2))} · θ ${escapeHtml(greekText(greeks.theta, 2))}</div>`);
  }
  if (args.note || timeValue == null || args.basis === "intrinsic-only") {
    const note = args.note ?? INTRINSIC_ONLY_NOTE;
    lines.push(`<div style="color:${palette.WARNING}">${escapeHtml(note)}</div>`);
  }
  return lines.join("");
}

/** Fill used for the per-cell label ink decision; visualMap owns the paint. */
function labelInk(pnl: unknown): string {
  const tone = isNum(pnl) && pnl < 0 ? palette.NEGATIVE : palette.POSITIVE;
  const fill = compositeOver(tone, palette.BG, 0.9);
  return pickTextColor(fill);
}

export interface PayoffCellDatum {
  /** [expiry index, strike-row index, value]. See `placeholder`. */
  value: [number, number, number];
  x: number;
  y: number;
  strike: number;
  expiry: string;
  pnl: number | null;
  intrinsic: number | null;
  timeValue: number | null;
  spotPct: number | null;
  basis: PayoffCellBasis;
  priced: boolean;
  /** The third value is a geometry placeholder, never a quoted P&L. */
  placeholder: boolean;
}

export interface PayoffCellGroups {
  priced: PayoffCellDatum[];
  /** Genuinely unpriceable cells: excluded from the colour ramp, hatched explicitly. */
  unpriced: PayoffCellDatum[];
}

/**
 * Split the full strike × expiry lattice into real quotes and excluded cells.
 * Every intersection is present exactly once. A null `timeValue` is a missing
 * IV quote, NOT missing prices — such a cell keeps its real intrinsic P&L on the
 * colour ramp. Only `priced === false` or a non-finite P&L earns a placeholder
 * value that lives in a series `visualMap` never touches.
 */
export function payoffCellGroups(matrix: PayoffMatrixShape): PayoffCellGroups {
  const strikes = [...(matrix.strikes ?? [])].filter(isNum).sort((a, b) => b - a);
  const expiries = [...(matrix.expiries ?? [])];
  const priced: PayoffCellDatum[] = [];
  const unpriced: PayoffCellDatum[] = [];

  strikes.forEach((strike, y) => {
    const sourceRow = (matrix.strikes ?? []).indexOf(strike);
    expiries.forEach((expiry, x) => {
      const cell = cellAt(matrix, sourceRow < 0 ? y : sourceRow, x);
      const pnl = isNum(cell?.pnl) ? cell.pnl : null;
      const basis = cellBasis(cell);
      const unpriceable = isUnpricedCell(cell);
      const datum: PayoffCellDatum = {
        value: [x, y, pnl ?? 0],
        x,
        y,
        strike,
        expiry,
        pnl,
        intrinsic: isNum(cell?.intrinsic) ? cell.intrinsic : null,
        timeValue: isNum(cell?.timeValue) ? cell.timeValue : null,
        spotPct: isNum(cell?.spotPct) ? cell.spotPct : null,
        basis,
        priced: !unpriceable,
        placeholder: unpriceable,
      };
      if (unpriceable) {
        unpriced.push({ ...datum, value: [x, y, 0], timeValue: null });
      } else {
        priced.push(datum);
      }
    });
  });

  return { priced, unpriced };
}

/** True when at least one priced cell's P&L was computed without a live IV quote. */
export function hasIntrinsicOnlyPricedCell(matrix: PayoffMatrixShape): boolean {
  return payoffCellGroups(matrix).priced.some((datum) => datum.basis === "intrinsic-only");
}

/**
 * The full ECharts option. Strikes are a descending category axis (highest at
 * the top, `inverse` puts index 0 there) and expiries are columns.
 */
export function buildPayoffOption(input: PayoffOptionInput): Record<string, unknown> {
  const { matrix, legs, asOf, greeks, selectedExpiry } = input;
  const { priced, unpriced } = payoffCellGroups(matrix);
  const strikes = [...(matrix.strikes ?? [])].filter(isNum).sort((a, b) => b - a);
  const expiries = [...(matrix.expiries ?? [])];
  const strikeLabels = strikes.map(formatStrikeAxis);
  const expiryLabels = expiries.map((expiry) => formatExpiryLabel(expiry, asOf));
  const samples = [...priced, ...unpriced].map((datum) => datum.pnl).filter(isNum);
  const domain = input.domain ?? robustPnlDomain(samples, matrix.kpis);

  const nearestStrikeIndex = (target: number): number => {
    if (strikes.length === 0) return -1;
    let best = 0;
    for (let i = 1; i < strikes.length; i += 1) {
      if (Math.abs(strikes[i] - target) < Math.abs(strikes[best] - target)) best = i;
    }
    return best;
  };

  const guideLine = (label: string, strikeIndex: number, color: string, dash: "solid" | "dashed" | "dotted") =>
    strikeIndex < 0
      ? null
      : {
          yAxis: strikeLabels[strikeIndex],
          lineStyle: { color, width: 1, type: dash },
          label: {
            show: true,
            formatter: label,
            position: "insideEndTop" as const,
            color: palette.TEXT,
            fontSize: PAYOFF_LABEL_FONT_SIZE,
            fontFamily: palette.MONO,
            backgroundColor: palette.SURFACE,
            padding: [1, 3],
            borderRadius: 2,
          },
        };

  const markData = [
    guideLine("SPOT", nearestStrikeIndex(input.spot), palette.INFO, "solid"),
    ...legs.map((leg) =>
      guideLine(
        `${leg.action} ${formatStrikeAxis(leg.strike)} ${leg.opt}`,
        nearestStrikeIndex(leg.strike),
        palette.PRIMARY,
        "dotted",
      ),
    ),
  ].filter((line): line is NonNullable<typeof line> => line !== null);

  const selectedLabel = selectedExpiry ? formatExpiryLabel(selectedExpiry, asOf) : null;
  const selectedIndex = selectedLabel ? expiryLabels.indexOf(selectedLabel) : -1;

  return {
    animation: false,
    backgroundColor: "transparent",
    grid: { left: 2, right: 8, top: 18, bottom: 2, containLabel: true },
    tooltip: {
      trigger: "item",
      backgroundColor: palette.TOOLTIP_BG,
      borderColor: palette.TOOLTIP_BORDER,
      textStyle: { color: palette.OPTION_PAYOFF_TOOLTIP_TEXT, fontSize: PAYOFF_LABEL_FONT_SIZE },
      formatter: (raw: unknown) => {
        const params = (Array.isArray(raw) ? raw[0] : raw) as { data?: Record<string, unknown> } | undefined;
        const source = params?.data ?? {};
        const x = Number(source.value && Array.isArray(source.value) ? source.value[0] : NaN);
        const y = Number(source.value && Array.isArray(source.value) ? source.value[1] : NaN);
        const strike = isNum(source.strike) ? source.strike : isNum(y) ? strikes[y] : undefined;
        const expiry = typeof source.expiry === "string" ? source.expiry : expiries[x];
        const cell: PayoffCell = {
          pnl: isNum(source.pnl) ? source.pnl : null,
          intrinsic: isNum(source.intrinsic) ? source.intrinsic : null,
          timeValue: isNum(source.timeValue) ? source.timeValue : null,
          spotPct: isNum(source.spotPct) ? source.spotPct : null,
        };
        if (!isNum(strike) || !expiry) return "";
        return payoffTooltipHtml(cell, {
          strike,
          expiry,
          expiryLabel: isNum(x) ? expiryLabels[x] : undefined,
          greeks,
          note: source.placeholder ? NO_IV_NOTE : undefined,
          basis: isBasis(source.basis) ? source.basis : undefined,
        });
      },
    },
    xAxis: {
      type: "category",
      data: expiryLabels,
      axisLine: { lineStyle: { color: palette.AXIS_LINE } },
      axisTick: { show: false },
      axisLabel: {
        color: palette.CHART_MUTED,
        fontSize: PAYOFF_LABEL_FONT_SIZE,
        margin: 4,
        interval: categoryAxisInterval(expiryLabels.length),
        hideOverlap: true,
      },
      splitArea: { show: false },
    },
    yAxis: {
      type: "category",
      data: strikeLabels,
      inverse: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: palette.CHART_MUTED,
        fontSize: PAYOFF_LABEL_FONT_SIZE,
        margin: 4,
      },
      splitArea: { show: false },
    },
    visualMap: {
      type: "continuous",
      min: domain.min,
      max: domain.max,
      calculable: false,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemWidth: 90,
      itemHeight: 6,
      // Only the priced series is colour-mapped. The hatched exclusion series
      // keeps its explicit low-contrast fill and is never read as a P&L value.
      series: [0],
      text: [formatSignedCompactPnl(domain.max), formatSignedCompactPnl(domain.min)],
      textGap: 6,
      textStyle: { color: palette.CHART_MUTED, fontSize: PAYOFF_LABEL_FONT_SIZE },
      inRange: {
        color: [
          palette.alpha(palette.NEGATIVE, 0.92),
          palette.alpha(palette.NEGATIVE, 0.38),
          palette.alpha(palette.NEUTRAL, 0.16),
          palette.alpha(palette.POSITIVE, 0.38),
          palette.alpha(palette.POSITIVE, 0.92),
        ],
      },
    },
    series: [
      {
        name: "P&L",
        type: "heatmap",
        data: priced.map((datum) => ({ ...datum, label: { color: labelInk(datum.pnl) } })),
        label: {
          show: true,
          fontSize: PAYOFF_LABEL_FONT_SIZE,
          fontFamily: palette.MONO,
          formatter: (params: { data?: { pnl?: unknown } }) => formatSignedCompactPnl(params?.data?.pnl),
        },
        itemStyle: { borderColor: palette.BORDER, borderWidth: 0.5 },
        emphasis: { itemStyle: { borderColor: palette.TEXT, borderWidth: 1 } },
      },
      {
        name: "No IV quote",
        type: "heatmap",
        data: unpriced.map((datum) => ({
          ...datum,
          // Readable ink on the raised surface; the hatch is decoration, the
          // number is real intrinsic P&L and must remain legible.
          label: { color: pickTextColor(palette.SURFACE_ALT) },
          tooltip: {
            formatter: () => payoffTooltipHtml(
              {
                pnl: datum.pnl,
                intrinsic: datum.intrinsic,
                timeValue: null,
                spotPct: datum.spotPct,
              },
              {
                strike: datum.strike,
                expiry: datum.expiry,
                expiryLabel: expiryLabels[datum.x],
                greeks,
                note: NO_IV_NOTE,
              },
            ),
          },
        })),
        itemStyle: {
          color: palette.SURFACE_ALT,
          borderColor: palette.BORDER,
          borderWidth: 0.5,
          decal: {
            symbol: "rect",
            symbolSize: 1,
            dashArrayX: [1, 5],
            dashArrayY: [1, 0],
            rotation: Math.PI / 4,
            // Muted ink, but still ≥3:1 on SURFACE_ALT so the exclusion reads.
            color: palette.TEXT_MUTED,
          },
        },
        emphasis: { itemStyle: { color: palette.SURFACE_ALT, borderColor: palette.TEXT } },
      },
      {
        name: "guides",
        type: "line",
        data: [],
        silent: true,
        markLine: { silent: true, symbol: "none", data: markData },
        ...(selectedIndex >= 0
          ? {
              markArea: {
                silent: true,
                itemStyle: { color: palette.alpha(palette.INFO, 0.14) },
                data: [[{ xAxis: expiryLabels[selectedIndex] }, { xAxis: expiryLabels[selectedIndex] }]],
              },
            }
          : {}),
      },
    ],
    graphic: [
      {
        type: "text",
        left: "center",
        bottom: 10,
        style: {
          text: "0",
          fill: palette.CHART_MUTED,
          fontSize: PAYOFF_LABEL_FONT_SIZE,
          fontFamily: palette.MONO,
        },
      },
      {
        type: "text",
        right: 8,
        top: 0,
        style: {
          text: `spot ${formatRupees(input.spot)} · ${isNum(input.iv) && input.iv > 0 ? `IV ${Number(input.iv.toFixed(1))}%` : NO_IV_NOTE}`,
          fill: palette.CHART_MUTED,
          fontSize: PAYOFF_LABEL_FONT_SIZE,
          fontFamily: palette.MONO,
        },
      },
    ],
  };
}
