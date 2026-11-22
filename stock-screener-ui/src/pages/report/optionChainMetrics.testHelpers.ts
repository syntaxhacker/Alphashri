
import { safeNum } from "@/utils/reportParsers";
import type { ChainRow, ChainSide } from "./optionChainMetrics";

type ChainSortKey = "strike" | "oi" | "volume" | "oiChange";

export interface ChainSummary {
  ceWriters: number;
  ceBuyers: number;
  peWriters: number;
  peBuyers: number;
  netCe: number;
  netPe: number;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function oiChange(leg: ChainSide): number {
  return safeNum(leg.oi_change ?? leg.oiChange);
}

function oi(leg: ChainSide): number {
  return safeNum(leg.oi);
}

function volume(leg: ChainSide): number {
  return safeNum(leg.volume);
}

export function oiChangePct(leg: ChainSide): number | null {
  const change = finiteOrNull(leg.oi_change ?? leg.oiChange);
  const total = finiteOrNull(leg.oi);
  if (change === null || total === null) return null;
  const base = Math.max(total - change, 1);
  return (change / base) * 100;
}

function sortValue(row: ChainRow, by: ChainSortKey): number {
  switch (by) {
    case "strike":
      return safeNum(row.strike);
    case "oi":
      return oi(row.ce) + oi(row.pe);
    case "volume":
      return volume(row.ce) + volume(row.pe);
    case "oiChange":
      return oiChange(row.ce) + oiChange(row.pe);
  }
}

export function sortChainRows(rows: ChainRow[], by: ChainSortKey): ChainRow[] {
  const direction = by === "strike" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row, by) }))
    .sort((a, b) => {
      if (a.value !== b.value) return (a.value - b.value) * direction;
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}

function finish(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function sentimentLabel(leg: ChainSide): string {
  const sentiment = leg.sentiment;
  const raw =
    typeof sentiment === "string" ? sentiment : sentiment?.label ?? "";
  return raw.trim().toUpperCase();
}

export function chainSummary(rows: ChainRow[]): ChainSummary {
  let ceWriters = 0;
  let ceBuyers = 0;
  let peWriters = 0;
  let peBuyers = 0;
  let netCe = 0;
  let netPe = 0;

  for (const row of rows) {
    const ceChange = oiChange(row.ce);
    const peChange = oiChange(row.pe);
    netCe += ceChange;
    netPe += peChange;

    const ceLabel = sentimentLabel(row.ce);
    if (ceLabel === "SB") ceWriters += ceChange;
    else if (ceLabel === "LB") ceBuyers += ceChange;

    const peLabel = sentimentLabel(row.pe);
    if (peLabel === "SB") peWriters += peChange;
    else if (peLabel === "LB") peBuyers += peChange;
  }

  return {
    ceWriters: finish(ceWriters),
    ceBuyers: finish(ceBuyers),
    peWriters: finish(peWriters),
    peBuyers: finish(peBuyers),
    netCe: finish(netCe),
    netPe: finish(netPe),
  };
}
