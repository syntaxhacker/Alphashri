import type { NiftyReport, NiftyStrike } from "@/types/niftyReport";
import { formatNumberIN } from "@/utils/ui-helpers";

export function formatSignedPoints(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${formatNumberIN(rounded)} pts`;
}

export function formatOiCr(oi: number | null | undefined): string {
  if (oi == null || !Number.isFinite(oi) || oi <= 0) return "—";
  if (oi >= 1e7) return `${(oi / 1e7).toFixed(2)} Cr`;
  if (oi >= 1e5) return `${(oi / 1e5).toFixed(1)} L`;
  return formatNumberIN(oi);
}

export function setupBannerHeadline(
  flipped: boolean,
  reason: string | null | undefined,
  score: number,
  max: number,
): string {
  return flipped
    ? `FLOW FLIP · ${reason ?? "5m vs 15m"} — setup paused`
    : `⏳ SETUP ARMING ${score}/${max}`;
}

export function buildOvernightLevels(report: NiftyReport): {
  resistance: { strike: number; pct: number }[];
  support: { strike: number; pct: number }[];
  painPull: { dir: string; pct: number };
  pcrVerdict: string;
} {
  const pct = (s: number) => (report.spot > 0 ? ((s - report.spot) / report.spot) * 100 : 0);
  const resistance = [...(report.walls?.calls ?? [])]
    .map((w) => w.strike)
    .filter((s) => s > report.spot)
    .sort((a, b) => a - b)
    .slice(0, 2)
    .map((strike) => ({ strike, pct: pct(strike) }));
  const support = [...(report.walls?.puts ?? [])]
    .map((w) => w.strike)
    .filter((s) => s < report.spot)
    .sort((a, b) => b - a)
    .slice(0, 2)
    .map((strike) => ({ strike, pct: pct(strike) }));
  const painPct = pct(report.maxPain);
  const painPull = {
    dir: painPct > 0.05 ? "up" : painPct < -0.05 ? "down" : "flat",
    pct: painPct,
  };
  const pcrOi = Number(report.pcrOi);
  const pcrVerdict = !Number.isFinite(pcrOi)
    ? "PCR-OI n/a — chain incomplete"
    : pcrOi < 0.7
      ? `Bearish (PCR-OI ${pcrOi.toFixed(2)} — call writers in control)`
      : pcrOi > 1.0
        ? `Bullish (PCR-OI ${pcrOi.toFixed(2)} — put writers in control)`
        : `Neutral (PCR-OI ${pcrOi.toFixed(2)})`;
  return { resistance, support, painPull, pcrVerdict };
}

export function gexRegimeText(regime: string): string {
  if (regime === "long") return "Dealers LONG gamma — moves dampened";
  if (regime === "short") return "Dealers SHORT gamma — moves amplified";
  return "Flat";
}

export function formatGexTotal(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)} Cr/pt`;
}

export function formatGexLevel(strike: number, netGex: number): string {
  return `${formatNumberIN(strike)} (${netGex >= 0 ? "+" : ""}${netGex.toFixed(2)} Cr)`;
}

export function oiBurstLogHeight(count: number): number {
  return Math.min(22 + count * 20 + 18, 140);
}

export function findAtmStrike(strikes: NiftyStrike[], spot: number): number | null {
  if (!strikes || strikes.length === 0) return null;
  if (!Number.isFinite(spot)) return null;
  let best = strikes[0].strike;
  let bestDist = Math.abs(best - spot);
  for (let i = 1; i < strikes.length; i++) {
    const s = strikes[i].strike;
    const d = Math.abs(s - spot);
    if (d < bestDist || (d === bestDist && s < best)) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}
