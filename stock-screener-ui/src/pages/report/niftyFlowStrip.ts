/**
 * Flow-event strip builder — pure, no store, no network.
 *
 * Collapses the tape into a thin lane of events:
 * - `burst`: a minute whose |ΔOI| (first difference of the cumulative
 *   `call_doi`/`put_doi`) meets `burstThreshold` (default 2M units).
 * - `wall`: the top call-wall or top put-wall strike changed.
 * - `maxpain`: `max_pain` changed.
 * - `atm`: `atm_strike` changed.
 *
 * Side convention: put build / call unwind read bullish (green); call build /
 * put unwind read bearish (red); wall / max-pain / ATM shifts are structural
 * (neutral, amber in the strip).
 */

export type FlowKind = "burst" | "wall" | "maxpain" | "atm";
export type FlowSide = "bullish" | "bearish" | "neutral";

export interface FlowTapeRow {
  t: string;
  spot?: number;
  call_doi?: number;
  put_doi?: number;
  max_pain?: number | null;
  maxPain?: number | null;
  atm_strike?: number | null;
  walls?: { call?: number; put?: number } | null;
}

interface FlowEvent {
  t: string;
  kind: FlowKind;
  label: string;
  side: FlowSide;
  /** Contracts for bursts, points for wall/max-pain/ATM shifts. */
  magnitude: number;
}

interface FlowOptions {
  burstThreshold?: number;
}

const FLOW_BURST_THRESHOLD = 2_000_000;

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function fmtInt(v: number): string {
  return Math.round(v).toLocaleString("en-IN");
}

function compact(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "+";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${Math.round(abs)}`;
}

export function buildFlowEvents(rows: FlowTapeRow[], opts: FlowOptions = {}): FlowEvent[] {
  const threshold = opts.burstThreshold ?? FLOW_BURST_THRESHOLD;
  const asc = (rows ?? [])
    .filter((r) => r && typeof r.t === "string" && r.t.length > 0)
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  const out: FlowEvent[] = [];
  for (let i = 1; i < asc.length; i++) {
    const prev = asc[i - 1];
    const cur = asc[i];

    // Burst-like minutes on either side's first difference.
    const dCall = num(cur.call_doi) - num(prev.call_doi);
    const dPut = num(cur.put_doi) - num(prev.put_doi);
    if (Math.abs(dCall) >= threshold) {
      out.push({
        t: cur.t,
        kind: "burst",
        label: `Call ${dCall > 0 ? "build" : "unwind"} ${compact(dCall)}`,
        side: dCall > 0 ? "bearish" : "bullish",
        magnitude: Math.abs(dCall),
      });
    }
    if (Math.abs(dPut) >= threshold) {
      out.push({
        t: cur.t,
        kind: "burst",
        label: `Put ${dPut > 0 ? "build" : "unwind"} ${compact(dPut)}`,
        side: dPut > 0 ? "bullish" : "bearish",
        magnitude: Math.abs(dPut),
      });
    }

    // Top wall-strike changes.
    const pc = num(cur.walls?.call);
    const pp = num(prev.walls?.call);
    if (pc !== pp && pc > 0 && pp > 0) {
      out.push({
        t: cur.t,
        kind: "wall",
        label: `Call wall ${fmtInt(pp)} → ${fmtInt(pc)}`,
        side: "neutral",
        magnitude: Math.abs(pc - pp),
      });
    }
    const wc = num(cur.walls?.put);
    const wp = num(prev.walls?.put);
    if (wc !== wp && wc > 0 && wp > 0) {
      out.push({
        t: cur.t,
        kind: "wall",
        label: `Put wall ${fmtInt(wp)} → ${fmtInt(wc)}`,
        side: "neutral",
        magnitude: Math.abs(wc - wp),
      });
    }

    // Max-pain changes.
    const mpC = num(cur.max_pain ?? cur.maxPain);
    const mpP = num(prev.max_pain ?? prev.maxPain);
    if (mpC !== mpP && mpC > 0 && mpP > 0) {
      out.push({
        t: cur.t,
        kind: "maxpain",
        label: `Max pain ${fmtInt(mpP)} → ${fmtInt(mpC)}`,
        side: "neutral",
        magnitude: Math.abs(mpC - mpP),
      });
    }

    // ATM-strike roll.
    const aC = num(cur.atm_strike);
    const aP = num(prev.atm_strike);
    if (aC !== aP && aC > 0 && aP > 0) {
      out.push({
        t: cur.t,
        kind: "atm",
        label: `ATM ${fmtInt(aP)} → ${fmtInt(aC)}`,
        side: "neutral",
        magnitude: Math.abs(aC - aP),
      });
    }
  }
  return out;
}
