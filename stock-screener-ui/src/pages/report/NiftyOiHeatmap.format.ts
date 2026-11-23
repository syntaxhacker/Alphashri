import { formatNumberIN } from "@/utils/ui-helpers";
import { OI_CALL, OI_PUT, TEXT_MUTED } from "@/ui/palette";
import { REPORT_MINUS, formatReportCompact } from "./reportFormat";
import type { buildOiHeatmap, readHeatmap } from "./niftyOiHeatmap";
import type { HeatmapCoverage, HeatmapEmptyKind } from "./niftyOiHeatmap";

type HeatmapModel = ReturnType<typeof buildOiHeatmap>;
type HeatmapRead = ReturnType<typeof readHeatmap>;

export const OPACITY_LABELS: Record<"oi" | "volume" | "premium", { label: string; title: string }> = {
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

export const EMPTY_COPY: Record<HeatmapEmptyKind, { title: string; description: string; hint: string }> = {
  "no-data": {
    title: "No option-chain tape",
    // Carries the phrase the pane used to show, inside a real sentence.
    description: "no tape chain — the recorder saved spot only for this session.",
    hint: "Pick another session",
  },
  "market-closed": {
    title: "Market closed",
    description: "Tape recording starts at the 09:15 IST open.",
    hint: "",
  },
  failed: {
    title: "Heatmap feed failed",
    description: "The chain request returned nothing usable during a live session.",
    // A local retry renders below when the caller wires one; otherwise the
    // recoverable path is the page-level ErrorAlert banner, so name it.
    hint: "Retry from the page banner",
  },
};

export function cellFill(sign: string): string {
  if (sign === "ce") return OI_CALL;
  if (sign === "pe") return OI_PUT;
  if (sign === "flat") return TEXT_MUTED;
  return "transparent";
}

export function cellOpacity(sign: string, intensity: number): number {
  // A flat cell is "no OI change", not "no data". Draw it faintly so a quiet
  // strike does not read as a gap in the tape (2026-10-29: the expanded 1-min
  // view looked like it was missing columns for exactly this reason).
  if (sign === "flat") return 0.14;
  // 0.22 floor: at 0.12 a quiet minute's red/green is indistinguishable from
  // the black background and the column reads as missing data.
  return 0.22 + 0.78 * Math.min(1, Math.max(0, intensity));
}

export interface SpotRead {
  spot: string;
  maxPain: string;
  relation: string;
}

export function formatSpotRead(read: HeatmapRead): SpotRead | null {
  if (read.spot === null || read.maxPain === null || read.spotVsMaxPain === null) return null;
  return {
    spot: formatNumberIN(Math.round(read.spot)),
    maxPain: formatNumberIN(Math.round(read.maxPain)),
    relation: read.spotVsMaxPain.toUpperCase(),
  };
}

export function formatWindowLabel(windowHalf: number, nRows: number): string {
  return windowHalf > 0
    ? `±${windowHalf} STRIKES`
    : `${nRows} STRIKE${nRows === 1 ? "" : "S"}`;
}

export function formatWindowTitle(model: HeatmapModel): string {
  if (model.strikes.length === 0) return "Strike window";
  return `Showing ${model.strikes.length} strikes nearest spot · ±${Math.round(model.windowPts)} pts · ${formatNumberIN(model.strikes[0])}–${formatNumberIN(model.strikes[model.strikes.length - 1])}. Wider chains are windowed so axis labels stay at the 11px floor.`;
}

export function formatCoverageText(coverage: HeatmapCoverage): string {
  if (coverage.rows === 0) return "0 tape rows";
  const window = coverage.first && coverage.last ? `${coverage.first}–${coverage.last}` : "";
  return `${coverage.rows} tape rows · ${coverage.chainRows} with chain${coverage.strikes > 0 ? ` · ${coverage.strikes} strikes` : ""}${window ? ` · ${window}` : ""}`;
}

export function formatPairCompact(value: number | null | undefined): string {
  return formatReportCompact(value, {
    sign: "always",
    minus: REPORT_MINUS,
    thousands: 1,
    grouped: false,
  });
}
