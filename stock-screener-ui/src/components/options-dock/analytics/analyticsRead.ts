/**
 * Plain-English reads on the analytics payload. Pure: no store, no DOM, no
 * fetch — the strip recomputes these on every paint so a tab or expiry switch
 * never waits on another request.
 *
 * The words are deliberately short. A chip is a verdict, not a metric dump;
 * the exact number sits beside it and the popover explains the convention.
 */

import type { OptionsAnalytics } from "@/api/optionsAnalytics";
import { surfaceGrid, termPoints, termSlope } from "@/utils/optionsAnalyticsMath";
import type { AnalyticsTone } from "./types";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export interface Verdict {
  label: string;
  tone: AnalyticsTone;
  text: string;
}

/** One decimal, but `-22` instead of `-22.0` — the strip is only ~22px tall. */
function vp(value: number, suffix: string, digits = 1): string {
  const body = Math.abs(value).toFixed(digits).replace(/\.0+$/, "");
  return `${value < 0 ? "-" : "+"}${body} ${suffix}`;
}

const finite = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value);

/** 25Δ call IV − put IV. Negative = the option market pays up for puts. */
export function rrVerdict(rr: number | null | undefined): Verdict {
  if (!finite(rr)) return { label: "FLAT", tone: "neutral", text: "—" };
  if (Math.abs(rr) < 1) return { label: "FLAT", tone: "neutral", text: vp(rr, "vp") };
  return rr < 0
    ? { label: "PUTS RICH", tone: "negative", text: vp(rr, "vp") }
    : { label: "CALLS RICH", tone: "positive", text: vp(rr, "vp") };
}

/** ATM-IV slope per expiry ordinal. Falling near-term = event/panic premium. */
export function termVerdict(slope: number | null | undefined): Verdict {
  if (!finite(slope)) return { label: "FLAT", tone: "neutral", text: "—" };
  if (Math.abs(slope) < 1) return { label: "FLAT", tone: "neutral", text: vp(slope, "vp/expiry") };
  return slope < 0
    ? { label: "BACKWARDATION", tone: "negative", text: vp(slope, "vp/expiry") }
    : { label: "CONTANGO", tone: "positive", text: vp(slope, "vp/expiry") };
}

/** Share of the strike × expiry lattice with a real quote. */
export function coverageVerdict(coverage: number, total: number): Verdict {
  const pct = total > 0 && Number.isFinite(coverage) ? Math.round((coverage / total) * 100) : 0;
  const tone: AnalyticsTone = pct >= 80 ? "positive" : pct >= 50 ? "warning" : "negative";
  return { label: `${pct}% QUOTED`, tone, text: `${coverage}/${total} cells` };
}

/** `2026-11-23`, 6 → `23 NOV · 6d`. Separator is ` ` for the compact expiry chips. */
export function selectedExpiryLabel(
  expiry: string | { date: string } | null | undefined,
  dte: number | null | undefined,
  separator = " · ",
): string {
  const date = typeof expiry === "string" ? expiry : expiry?.date;
  if (!date) return "—";
  const parts = date.split("-");
  const day = parts[2] ?? date;
  const month = MONTHS[Number(parts[1]) - 1] ?? parts[1] ?? "";
  const base = `${day} ${month}`.trim();
  if (!finite(dte)) return base;
  return `${base}${separator}${Math.max(0, Math.round(dte))}d`;
}

export interface VerdictChip {
  testId: string;
  label: string;
  value: string;
  text?: string;
  tone: AnalyticsTone;
  title?: string;
}

const rupees = (value: number): string =>
  `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/**
 * The four verdicts that fit one 18px line. Each chip carries its own testid so
 * a consumer can assert a verdict without depending on chip order.
 */
export function verdictChips(args: {
  data: OptionsAnalytics | null | undefined;
  selectedExpiry: string | null;
  atmIv: number | null;
  maxPain: number | null;
  spot: number;
}): VerdictChip[] {
  const { data, selectedExpiry, maxPain, spot } = args;
  const selected = data?.expiries.find((entry) => entry.date === selectedExpiry) ?? null;
  const rr = selected?.rr25 ?? null;
  const rrV = rrVerdict(rr);
  const slope = data ? termSlope(termPoints(data)) : null;
  const termV = termVerdict(slope);
  const grid = data ? surfaceGrid(data) : null;
  const covV = coverageVerdict(grid?.coverage ?? 0, grid?.total ?? 0);
  const iv = finite(args.atmIv) ? `${args.atmIv.toFixed(1)}%` : "—";

  let painText = "—";
  let painTone: AnalyticsTone = "neutral";
  if (finite(maxPain) && finite(spot) && spot > 0) {
    const pct = ((maxPain - spot) / spot) * 100;
    painText = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% ${pct >= 0 ? "above" : "below"} spot`;
    painTone = Math.abs(pct) < 1 ? "neutral" : pct > 0 ? "positive" : "negative";
  }

  return [
    {
      testId: "analytics-chip-rr",
      label: "25Δ SKEW",
      value: rr == null ? "—" : rrV.label,
      text: rrV.text,
      tone: rr == null ? "neutral" : rrV.tone,
      title: `25-delta call IV minus put IV at ${iv} ATM IV. Negative = puts priced richer.`,
    },
    {
      testId: "analytics-chip-term",
      label: "TERM",
      value: slope == null ? "—" : termV.label,
      text: termV.text,
      tone: slope == null ? "neutral" : termV.tone,
      title: "ATM IV slope across expiries. Falling = near-term event premium.",
    },
    {
      testId: "analytics-chip-coverage",
      label: "IV COVER",
      value: (grid?.total ?? 0) > 0 ? covV.label : "—",
      text: covV.text,
      tone: (grid?.total ?? 0) > 0 ? covV.tone : "neutral",
      title: "Strike × expiry cells with a real IV quote. Blank cells are never zero-filled.",
    },
    {
      testId: "analytics-chip-maxpain",
      label: "MAX PAIN",
      value: maxPain != null ? rupees(maxPain) : "—",
      text: painText,
      tone: painTone,
      title: "Largest-OI strike versus spot — a magnet, not a forecast.",
    },
  ];
}
