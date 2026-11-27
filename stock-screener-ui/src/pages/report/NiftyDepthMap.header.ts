import * as palette from "@/ui/palette";
import type { NiftyReport } from "@/types/niftyReport";
import { fmtStrike, num, signedOiText, signedPctText } from "./NiftyDepthMap.format";
import { oiChangeByStrike, type DayStats, type DepthRow } from "./NiftyDepthMap.geometry";

export interface DepthLegendData {
  ceDom: number;
  peDom: number;
  totalOi: number;
  netChg: number;
}

export function depthLegendData(rows: DepthRow[], report: NiftyReport): DepthLegendData {
  const ceDom = rows.filter((x) => x.ceOi > x.peOi).length;
  const peDom = rows.filter((x) => x.peOi > x.ceOi).length;
  const totalOi = rows.reduce((acc, x) => acc + x.ceOi + x.peOi, 0);
  const chgByStrike = oiChangeByStrike(report);
  const netChg = rows.reduce((acc, x) => acc + (chgByStrike.get(x.strike) ?? 0), 0);
  return { ceDom, peDom, totalOi, netChg };
}

export function changeTone(stats: DayStats): string {
  if (stats.changePct == null) return "default";
  if (stats.changePct > 0) return palette.POSITIVE;
  if (stats.changePct < 0) return palette.NEGATIVE;
  return "default";
}

export function changeText(stats: DayStats): string {
  return signedPctText(stats.changePct);
}

export function netChgTone(legend: DepthLegendData): string {
  if (legend.netChg > 0) return palette.POSITIVE;
  if (legend.netChg < 0) return palette.NEGATIVE;
  return palette.TEXT_MUTED;
}

export function netChgText(legend: DepthLegendData): string {
  return signedOiText(legend.netChg);
}

export function lastText(report: NiftyReport): string {
  return fmtStrike(num(report?.spot));
}

export function hiLoText(stats: DayStats): string {
  if (stats.hi == null || stats.lo == null) return "—";
  return `${fmtStrike(stats.hi)} / ${fmtStrike(stats.lo)}`;
}

export function pcrText(report: NiftyReport): string {
  return Number.isFinite(Number(report?.pcrOi)) ? Number(report?.pcrOi).toFixed(2) : "—";
}

export function maxPainText(report: NiftyReport): string {
  return Number(report?.maxPain) > 0 ? fmtStrike(Number(report?.maxPain)) : "—";
}

export function pocText(poc: number | null): string {
  return poc != null ? fmtStrike(poc) : "—";
}
