import { formatNumberIN } from "@/utils/ui-helpers";
import {
  FUEL_STATE_LABEL,
  NIFTY_LOT_SIZE,
  OI_SIGNAL_MIN_PREMIUM,
  OI_SIGNAL_RISK_BUDGET,
  OI_SIGNAL_SL_PCT,
  OI_SIGNAL_STALE_PCT,
  OI_SIGNAL_TP_PCT,
  SPENT_FUEL_STATES,
} from "./niftyOiBursts.types";
import type {
  OiBurst,
  OiDirection,
  OiEntryFreshness,
  OiFlowKind,
  OiFuelState,
  OiSignal,
} from "./niftyOiBursts.types";
import { round2 } from "./niftyOiBursts.format";
import { isNonTradeAlertType } from "./niftyOiBursts.normalize";

export function fuelStateFromFlow(flow: string): OiFuelState | null {
  switch (flow.trim().toLowerCase()) {
    case "buyers":
      return "fresh_buyers";
    case "writers":
      return "fresh_sellers";
    case "covering":
      return "writers_covering";
    case "liquidation":
      return "longs_liquidating";
    default:
      return null;
  }
}

/** Backend flow label, else the client mirror. Null = unknown (never fresh). */
export function resolveFuelState(
  burst: Pick<OiBurst, "side" | "delta" | "flow" | "premChg"> & {
    fuel_state?: OiFuelState | null;
  },
): OiFuelState | null {
  // The backend's reading wins: it has the SAME-STRIKE premium change, the
  // client only has an ATM guess that can be a strike artefact.
  if (burst.fuel_state && FUEL_STATE_LABEL[burst.fuel_state]) {
    return burst.fuel_state;
  }
  if (typeof burst.flow === "string") {
    const f = fuelStateFromFlow(burst.flow);
    if (f) return f;
  }
  const inferred = inferFlowFromPremium(burst.premChg, burst.delta > 0);
  return inferred ? fuelStateFromFlow(inferred) : null;
}

export function coveringDirection(side: "call" | "put"): "up" | "down" {
  return side === "put" ? "down" : "up";
}

export function isSpentFuel(state: OiFuelState | null): boolean {
  return state !== null && SPENT_FUEL_STATES.has(state);
}

/** Freshness of a signal's entry against the live premium. */
export function entryFreshness(
  signal: Pick<OiSignal, "leg" | "strike" | "entry">,
  chain: Array<{ strike: number; ce?: { ltp?: number }; pe?: { ltp?: number } }>,
): OiEntryFreshness {
  const row = (chain ?? []).find((s) => Math.abs(Number(s.strike) - signal.strike) < 1);
  const live = row
    ? Number(signal.leg === "CE" ? row.ce?.ltp : row.pe?.ltp)
    : NaN;
  if (!Number.isFinite(live) || live <= 0 || !(signal.entry > 0)) {
    return { live: null, driftPct: null, stale: false };
  }
  const driftPct = ((live - signal.entry) / signal.entry) * 100;
  return { live, driftPct, stale: Math.abs(driftPct) >= OI_SIGNAL_STALE_PCT };
}

/** Backend flow label → direction. Covering/liquidation are both-legs
 * verdicts (shorts bought back = bullish; longs sold out = bearish); buyers
 * vs writers splits by side (buyers pay up = bearish puts / bullish calls). */
function directionFromFlow(
  flow: string,
  side: "call" | "put",
): { leg: "CE" | "PE"; bearish: boolean } | null {
  switch (flow.trim().toLowerCase()) {
    case "covering":
      return { leg: "CE", bearish: false };
    case "liquidation":
      return { leg: "PE", bearish: true };
    case "buyers":
      return side === "put" ? { leg: "PE", bearish: true } : { leg: "CE", bearish: false };
    case "writers":
      return side === "put" ? { leg: "CE", bearish: false } : { leg: "PE", bearish: true };
    default:
      return null;
  }
}

/** Flow label implied by the same-side ATM premium change — the client-side
 * mirror of the backend's `classify_flow` (build+up=buyers, build+down=
 * writers, unwind+up=covering, unwind+down=liquidation). Null when the
 * premium is missing or flat: a guess is worse than the legacy rule. */
export function inferFlowFromPremium(
  premChg: number | null | undefined,
  building: boolean,
): OiFlowKind | null {
  if (premChg === null || premChg === undefined || !Number.isFinite(premChg) || premChg === 0) {
    return null;
  }
  if (building) return premChg > 0 ? "buyers" : "writers";
  return premChg > 0 ? "covering" : "liquidation";
}

function flowBasis(side: "call" | "put", flow: OiFlowKind, leg: "CE" | "PE"): string {
  const s = side === "call" ? "call" : "put";
  switch (flow) {
    case "covering":
      return `${s} OI unwind + covering — shorts bought back → upside fuel → buy calls`;
    case "liquidation":
      return `${s} OI unwind + liquidation — longs sold out → downside fuel → buy puts`;
    case "buyers":
      return leg === "PE"
        ? "put OI build + buyers — buyers paid up → downside fuel → buy puts"
        : "call OI build + buyers — buyers lifting offers → upside fuel → buy calls";
    case "writers":
      return side === "put"
        ? "put OI build + writers — writers sold premium → support holds → buy calls"
        : "call OI build + writers — writers adding ceiling → fade with puts";
  }
}

/**
 * Resolve the trade direction for a plain burst. Precedence: backend
 * `bearish` verdict → backend `flow` label → same-side ATM premium direction
 * (`premChg`) → legacy OI-only rule.
 */
export function resolveOiDirection(
  burst: Pick<OiBurst, "side" | "delta" | "flow" | "bearish" | "premChg">,
): OiDirection {
  const building = burst.delta > 0;
  // 1. The backend verdict is the reading — no inference needed.
  if (typeof burst.bearish === "boolean") {
    const leg = burst.bearish ? "PE" : "CE";
    const flowLabel = typeof burst.flow === "string" ? burst.flow : null;
    const flow = flowLabel ? directionFromFlow(flowLabel, burst.side) : null;
    const basis =
      flow && flow.leg === leg
        ? flowBasis(burst.side, flowLabel!.trim().toLowerCase() as OiFlowKind, leg)
        : `${burst.side === "call" ? "call" : "put"} OI ${
            building ? "build" : "unwind"
          } — backend flow ${burst.bearish ? "bearish" : "bullish"} → ${
            leg === "CE" ? "buy calls" : "buy puts"
          }`;
    return { leg, bearish: burst.bearish, via: "flow", basis };
  }
  // 2. A flow label without the verdict maps deterministically.
  if (typeof burst.flow === "string") {
    const d = directionFromFlow(burst.flow, burst.side);
    if (d) {
      return {
        ...d,
        via: "flow",
        basis: flowBasis(burst.side, burst.flow.trim().toLowerCase() as OiFlowKind, d.leg),
      };
    }
  }
  // 3. Same-side ATM premium direction over the burst minute.
  const inferred = inferFlowFromPremium(burst.premChg, building);
  if (inferred) {
    const d = directionFromFlow(inferred, burst.side);
    if (d) {
      return { ...d, via: "premium", basis: flowBasis(burst.side, inferred, d.leg) };
    }
  }
  // 4. Legacy OI-only rule (no flow information at all).
  const leg = (burst.side === "call") === building ? "PE" : "CE";
  const call = burst.side === "call";
  const basis = call
    ? building
      ? "call OI build — writers adding ceiling → fade with puts"
      : "call OI unwind — writers covering → upside fuel → buy calls"
    : building
      ? "put OI build — writers adding floor → fade with calls"
      : "put OI unwind — support removed → downside fuel → buy puts";
  return { leg, bearish: null, via: "oi", basis };
}

/**
 * Turn a burst into a mechanical option suggestion.
 *
 * Direction follows WHO traded, not just the OI move (backend `classify_flow`
 * verdict, mirrored here). The full mapping:
 *
 *   put  UNWIND + covering   (PE premium up)    → bullish  → buy CE
 *   put  UNWIND + liquidation(PE premium down)  → bearish  → buy PE
 *   put  BUILD  + buyers     (PE premium up)    → bearish  → buy PE
 *   put  BUILD  + writers     (PE premium down)  → bullish  → buy CE
 *   call UNWIND + covering   (CE premium up)    → bullish  → buy CE
 *   call UNWIND + liquidation(CE premium down)   → bearish  → buy PE
 *   call BUILD  + buyers     (CE premium up)    → bullish  → buy CE
 *   call BUILD  + writers     (CE premium down)  → bearish  → buy PE
 *
 * Source precedence: backend `bearish` verdict → backend `flow` label →
 * same-side ATM premium direction over the burst minute (`premChg`) →
 * legacy OI-only rule. A squeeze is MOMENTUM (buy the break, leg from the
 * burst); a premium impulse buys the moved leg; both skip the flow reading.
 *
 * Strike = nearest listed strike to spot with a tradeable premium. Sizing
 * assumes a fixed risk budget and a 25% premium stop.
 *
 * This is a heuristic, not advice, and it does not place orders.
 */
export function deriveOiSignal(
  burst: OiBurst,
  strikes: Array<{ strike: number; ce?: { ltp?: number }; pe?: { ltp?: number } }>,
  spot: number,
  opts: { riskBudget?: number; slPct?: number; tpPct?: number; minPremium?: number; trend?: "up" | "down" | null; trend5m?: "up" | "down" | null } = {},
): OiSignal | null {
  const riskBudget = opts.riskBudget ?? OI_SIGNAL_RISK_BUDGET;
  const slPct = opts.slPct ?? OI_SIGNAL_SL_PCT;
  const tpPct = opts.tpPct ?? OI_SIGNAL_TP_PCT;
  const minPremium = opts.minPremium ?? OI_SIGNAL_MIN_PREMIUM;

  // A coil is a heads-up, not a trade.
  if (burst.type === "coil") return null;
  // Wall geometry and stale-data warnings never carry a mechanical plan.
  if (isNonTradeAlertType(burst.type)) return null;

  const call = burst.side === "call";
  const building = burst.delta > 0;
  const isSqueeze = burst.type === "squeeze";
  const isPremium = burst.type === "premium";
  // Plain bursts read WHO traded (flow → premium → OI-only). A squeeze is
  // MOMENTUM: the broken side is being run over, so buy the break.
  const dir = isSqueeze || isPremium ? null : resolveOiDirection(burst);
  const leg: "CE" | "PE" = dir
    ? dir.leg
    : (burst.leg ?? (call ? "CE" : "PE")) === "CE"
      ? "CE"
      : "PE";

  const candidates = (strikes ?? [])
    .map((s) => ({
      strike: Number(s.strike),
      ltp: Number(leg === "CE" ? s.ce?.ltp : s.pe?.ltp),
    }))
    .filter((c) => Number.isFinite(c.strike) && Number.isFinite(c.ltp) && c.ltp >= minPremium)
    .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot));

  // Flow/plan consistency: a "call writers adding" burst is bearish; a
  // "BUY CE" plan on it is a contradictory banner (seen live 2026-10-28 at
  // 14:58). If the flow-derived leg and the chosen leg disagree, withhold the
  // plan rather than print two opposite instructions.
  const fuelState = resolveFuelState(burst);
  const fuelFlow =
    fuelState === "fresh_buyers"
      ? "buyers"
      : fuelState === "fresh_sellers"
        ? "writers"
        : fuelState === "writers_covering"
          ? "covering"
          : fuelState === "longs_liquidating"
            ? "liquidation"
            : null;
  const fuelLeg = fuelFlow ? directionFromFlow(fuelFlow, burst.side)?.leg ?? null : null;
  if (!isSqueeze && !isPremium && fuelLeg && leg !== fuelLeg) return null;

  const pick = candidates[0];
  if (!pick) return null;

  // A per-strike burst names its own strike — use it instead of nearest-to-spot.
  const wantStrike = typeof burst.strike === "number" ? burst.strike : undefined;
  const exact = wantStrike !== undefined
    ? candidates.find((c) => c.strike === wantStrike)
    : undefined;
  const chosen = exact ?? pick;

  const entry = round2(chosen.ltp);
  const sl = round2(entry * (1 - slPct / 100));
  const target = round2(entry * (1 + tpPct / 100));
  const riskPerUnit = Math.max(0.05, entry - sl);
  const units = Math.floor(riskBudget / riskPerUnit);
  const lots = Math.floor(units / NIFTY_LOT_SIZE);
  const qty = lots * NIFTY_LOT_SIZE;

  let basis = isPremium
    ? `ATM premium impulse ${
        burst.pct !== undefined ? `${burst.pct >= 0 ? "+" : ""}${burst.pct.toFixed(2)}` : "?"
      }% (${leg} ${
        typeof burst.strike === "number" ? formatNumberIN(burst.strike) : "?"
      })`
    : isSqueeze
      ? `short-covering squeeze — ${burst.side} wall ${
        typeof burst.wall === "number" ? formatNumberIN(burst.wall) : "?"
        } broken while that side unwound ${formatNumberIN(Math.abs(burst.delta))} units`
      : (dir?.basis ??
        (call
          ? building
            ? "call OI build — writers adding ceiling → fade with puts"
            : "call OI unwind — writers covering → upside fuel → buy calls"
          : building
            ? "put OI build — writers adding floor → fade with calls"
            : "put OI unwind — support removed → downside fuel → buy puts"));

  // Trend gate: a plan fighting the tape is the wrong side, so no plan is
  // emitted. The gate passes when the leg matches EITHER the session trend
  // or the 5-minute trend — a covering burst aligned with the current
  // 5-minute move is actionable even when the session trend disagrees
  // (a reversal). Only a plan opposed by every known trend is suppressed
  // (counter-trend resolved 0.32 vs 0.80 aligned on 2026-10-15).
  // A squeeze is with the break by construction, so it is always aligned.
  const trends = [opts.trend ?? null, opts.trend5m ?? null].filter(
    (t): t is "up" | "down" => t === "up" || t === "down",
  );
  let aligned: boolean | null = null;
  if (isSqueeze || isPremium) {
    aligned = true;
  } else if (trends.length === 0) {
    aligned = null;
  } else {
    aligned = trends.some(
      (t) => (leg === "CE" && t === "up") || (leg === "PE" && t === "down"),
    );
    if (!aligned) return null;
  }

  // The backend's own verdict wins: a plan the backend withheld stays
  // withheld (spent fuel with no structure break, a counter-trend plan, …).
  if (burst.plan_suppressed) return null;

  // Fuel gate: a covering burst (premium rising on an unwind) is only
  // tradeable when the underlying closed beyond a level IN THE SAME
  // DIRECTION. When the backend supplies evidence that contradicts the leg,
  // there is no trade. With no evidence the trend gate stands — the
  // conservative default belongs to the backend, and the freshness check in
  // useNiftyOiAlerts catches a plan priced off a stale chain.
  if (!isSqueeze && !isPremium) {
    const fuel = burst.fuel_state ?? resolveFuelState(burst);
    if (fuel === "writers_covering") {
      const structure = burst.structure ?? null;
      if (structure && structure.direction !== coveringDirection(burst.side)) return null;
    }
  }

  return { leg, strike: chosen.strike, entry, sl, target, qty, lots, basis, trend: opts.trend ?? null, aligned };
}
