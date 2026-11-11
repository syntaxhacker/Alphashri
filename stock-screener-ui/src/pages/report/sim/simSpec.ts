import type {
  SimAction,
  SimExecSpec,
  SimLegSpec,
  SimOpt,
  SimStrategySpec,
  SimTemplate,
} from "@/types/reportSim";

export function defaultExec(): SimExecSpec {
  return {
    entryTime: "09:35",
    slPct: 30,
    tpPct: 60,
    maxHoldMin: 60,
    trailPct: 0,
    eodExit: "15:10",
  };
}

export function leg(
  action: SimAction,
  opt: SimOpt,
  strike: string,
  lots = 1,
): SimLegSpec {
  return { action, opt, strike, lots };
}

function template(
  id: string,
  name: string,
  blurb: string,
  legs: SimLegSpec[],
): SimTemplate {
  return { id, name, blurb, legs, exec: defaultExec() };
}

export const SIM_TEMPLATES: SimTemplate[] = [
  template("long-call", "Long call", "Buy an ATM call. Unlimited upside, premium at risk.", [
    leg("BUY", "CE", "ATM"),
  ]),
  template("long-put", "Long put", "Buy an ATM put. Profits on a downside move.", [
    leg("BUY", "PE", "ATM"),
  ]),
  template(
    "long-straddle",
    "Long straddle",
    "Buy ATM call + put. Profits from a large move either way.",
    [leg("BUY", "CE", "ATM"), leg("BUY", "PE", "ATM")],
  ),
  template(
    "short-straddle",
    "Short straddle",
    "Sell ATM call + put. Max profit is the credit; a gamma blast hurts both tails.",
    [leg("SELL", "CE", "ATM"), leg("SELL", "PE", "ATM")],
  ),
  template(
    "bull-call-spread",
    "Bull call spread",
    "Buy ATM call, sell a higher call. Capped bullish debit spread.",
    [leg("BUY", "CE", "ATM"), leg("SELL", "CE", "ATM+2")],
  ),
  template(
    "bear-put-spread",
    "Bear put spread",
    "Buy ATM put, sell a lower put. Capped bearish debit spread.",
    [leg("BUY", "PE", "ATM"), leg("SELL", "PE", "ATM-2")],
  ),
  template(
    "bull-put-spread",
    "Bull put spread",
    "Sell ATM put, buy a lower put. Bullish credit spread.",
    [leg("SELL", "PE", "ATM"), leg("BUY", "PE", "ATM-2")],
  ),
  template(
    "bear-call-spread",
    "Bear call spread",
    "Sell ATM call, buy a higher call. Bearish credit spread.",
    [leg("SELL", "CE", "ATM"), leg("BUY", "CE", "ATM+2")],
  ),
  template(
    "short-strangle",
    "Short strangle",
    "Sell an OTM call + put. Collects premium in a range; the tails are open.",
    [leg("SELL", "CE", "ATM+2"), leg("SELL", "PE", "ATM-2")],
  ),
  template(
    "iron-condor",
    "Iron condor",
    "Sell ATM±1, buy ATM±2 wings. Range-bound credit spread.",
    [
      leg("BUY", "PE", "ATM-2"),
      leg("SELL", "PE", "ATM-1"),
      leg("SELL", "CE", "ATM+1"),
      leg("BUY", "CE", "ATM+2"),
    ],
  ),
];

function cloneLegs(legs: SimLegSpec[]): SimLegSpec[] {
  return legs.map((l) => ({ ...l }));
}

export function newStrategy(index: number, templateId?: string): SimStrategySpec {
  const found = templateId ? SIM_TEMPLATES.find((t) => t.id === templateId) : undefined;
  return {
    id: `sc-${index}`,
    name: found ? found.name : `Strategy ${index}`,
    legs: found ? cloneLegs(found.legs) : [],
    exec: found ? { ...found.exec } : defaultExec(),
  };
}

export function nextStrategyId(existing: SimStrategySpec[]): string {
  let max = 0;
  for (const s of existing) {
    const m = /^sc-(\d+)$/.exec(s.id);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `sc-${max + 1}`;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function isTime(value: string): boolean {
  return typeof value === "string" && HHMM.test(value);
}

function isFiniteNumber(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateStrategy(s: SimStrategySpec): string[] {
  const errors: string[] = [];

  if (s.legs.length === 0) errors.push("Add at least one leg.");
  if (s.legs.length > 12) errors.push("Too many legs (maximum 12).");

  s.legs.forEach((l, i) => {
    const n = i + 1;
    if (l.action !== "BUY" && l.action !== "SELL") {
      errors.push(`Leg ${n}: side must be BUY or SELL.`);
    }
    if (l.opt !== "CE" && l.opt !== "PE") {
      errors.push(`Leg ${n}: option must be CE or PE.`);
    }
    if (!Number.isInteger(l.lots) || l.lots < 1 || l.lots > 50) {
      errors.push(`Leg ${n}: lots must be between 1 and 50.`);
    }
    if (typeof l.strike !== "string" || l.strike.trim() === "") {
      errors.push(`Leg ${n}: strike is required.`);
    }
  });

  if (!isTime(s.exec.entryTime)) errors.push("Entry time must be HH:MM.");
  if (!isTime(s.exec.eodExit)) errors.push("EOD exit must be HH:MM.");

  if (!isFiniteNumber(s.exec.slPct) || s.exec.slPct < 0 || s.exec.slPct > 500) {
    errors.push("Stop loss must be between 0 and 500%.");
  }
  if (!isFiniteNumber(s.exec.tpPct) || s.exec.tpPct < 0 || s.exec.tpPct > 500) {
    errors.push("Target must be between 0 and 500%.");
  }
  if (!isFiniteNumber(s.exec.maxHoldMin) || s.exec.maxHoldMin < 0 || s.exec.maxHoldMin > 400) {
    errors.push("Max hold must be between 0 and 400 minutes.");
  }

  return errors;
}

export function legLabel(l: SimLegSpec): string {
  return `${l.action} ${l.opt} ${l.strike} ×${l.lots}`;
}

type StrikeInput = Array<{ strike: number }> | number[];

export function buildLadder(strikes: StrikeInput, _spot?: number): number[] {
  const values: number[] = [];
  for (const item of strikes) {
    const raw = typeof item === "number" ? item : item.strike;
    if (Number.isFinite(raw) && raw > 0) values.push(raw);
  }
  return [...new Set(values)].sort((a, b) => a - b);
}

export function nearestStrike(ladder: number[], spot: number): number | null {
  if (ladder.length === 0 || !Number.isFinite(spot)) return null;
  let best: number | null = null;
  let bestDiff = Infinity;
  for (const strike of ladder) {
    if (!Number.isFinite(strike)) continue;
    const diff = Math.abs(strike - spot);
    // Strictly smaller only: an equal distance keeps the lower strike because
    // the ladder is ascending.
    if (diff < bestDiff) {
      best = strike;
      bestDiff = diff;
    }
  }
  return best;
}

const ATM_OFFSET = /^ATM\s*([+-])\s*(\d+)$/;

export function resolvePreviewStrike(
  ref: string,
  spot: number,
  ladder: number[],
): number | null {
  if (typeof ref !== "string" || ladder.length === 0) return null;
  const text = ref.trim().toUpperCase();
  if (text === "") return null;

  const atm = nearestStrike(ladder, spot);
  if (atm === null) return null;

  if (text === "ATM") return atm;

  const offset = ATM_OFFSET.exec(text);
  if (offset) {
    const steps = Number(offset[2]);
    const dir = offset[1] === "+" ? 1 : -1;
    // The backend treats "ATM-0" as malformed rather than ATM.
    if (dir < 0 && steps === 0) return null;
    if (steps > 12) return null;
    const index = ladder.indexOf(atm);
    const target = index + dir * steps;
    if (target < 0 || target >= ladder.length) return null;
    return ladder[target];
  }

  const absolute = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(absolute)) return null;
  return ladder.find((strike) => Math.abs(strike - absolute) < 1e-6) ?? null;
}

type ParsedStrike =
  | { kind: "atm"; offset: number }
  | { kind: "abs"; value: number }
  | null;

function parseStrike(ref: string): ParsedStrike {
  const text = ref.trim().toUpperCase();
  if (text === "ATM") return { kind: "atm", offset: 0 };
  const offset = ATM_OFFSET.exec(text);
  if (offset) {
    const steps = Number(offset[2]);
    return { kind: "atm", offset: offset[1] === "+" ? steps : -steps };
  }
  const absolute = Number(text.replace(/,/g, ""));
  return Number.isFinite(absolute) && absolute > 0 ? { kind: "abs", value: absolute } : null;
}

/**
 * Credit vs debit is inferred from which side owns the most ITM strike:
 * buying it pays premium (debit), selling it collects premium (credit).
 */
export function structureKind(legs: SimLegSpec[]): string {
  if (legs.length === 0) return "Multi-leg";
  if (legs.length === 1) return "Single leg";

  if (
    legs.length === 2 &&
    legs[0].strike.trim().toUpperCase() === legs[1].strike.trim().toUpperCase() &&
    legs[0].opt !== legs[1].opt
  ) {
    return "Straddle";
  }

  const buys = legs.filter((l) => l.action === "BUY");
  const sells = legs.filter((l) => l.action === "SELL");
  if (buys.length === 0 || sells.length === 0) return "Multi-leg";

  const parsed = legs.map((l) => parseStrike(l.strike));
  if (parsed.some((p) => p === null)) return "Multi-leg";
  const kinds = new Set(parsed.map((p) => (p as Exclude<ParsedStrike, null>).kind));
  if (kinds.size > 1) return "Multi-leg";

  const scores = legs.map((l, i) => {
    const p = parsed[i] as Exclude<ParsedStrike, null>;
    const strike = p.kind === "abs" ? p.value : p.offset;
    return l.opt === "CE" ? -strike : strike;
  });
  const max = Math.max(...scores);
  const mostItm = legs.filter((_, i) => scores[i] === max);
  return mostItm.some((l) => l.action === "SELL") ? "Credit spread" : "Debit spread";
}
