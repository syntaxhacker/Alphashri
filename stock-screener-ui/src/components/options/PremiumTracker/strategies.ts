import type { PayoffLeg } from "./payoff";

export type StrategySide = "BUY" | "SELL";

export interface StrategyTemplate {
  id: string;
  name: string;
  side: StrategySide;
  blurb: string;
  build(atm: number, step: number): PayoffLeg[];
}

export const BUY_STRATEGIES: StrategyTemplate[] = [
  {
    id: "long-call",
    name: "Long Call",
    side: "BUY",
    blurb: "BUY 1 ATM CE. Unlimited upside, limited risk.",
    build: (atm: number) => [{ strike: atm, optionType: "CE", action: "BUY", qty: 1, entry: 0 }],
  },
  {
    id: "long-straddle",
    name: "Long Straddle",
    side: "BUY",
    blurb: "BUY 1 ATM CE + BUY 1 ATM PE. Profits from big moves either way.",
    build: (atm: number) => [
      { strike: atm, optionType: "CE", action: "BUY", qty: 1, entry: 0 },
      { strike: atm, optionType: "PE", action: "BUY", qty: 1, entry: 0 },
    ],
  },
  {
    id: "bull-call-spread",
    name: "Bull Call Spread",
    side: "BUY",
    blurb: "BUY 1 ATM CE + SELL 1 higher CE. Capped bullish play.",
    build: (atm: number, step: number) => [
      { strike: atm, optionType: "CE", action: "BUY", qty: 1, entry: 0 },
      { strike: atm + 2 * step, optionType: "CE", action: "SELL", qty: 1, entry: 0 },
    ],
  },
];

export const SELL_STRATEGIES: StrategyTemplate[] = [
  {
    id: "bull-put-spread",
    name: "Bull Put Spread",
    side: "SELL",
    blurb: "SELL 1 higher PE + BUY 1 lower PE. Bullish credit spread.",
    build: (atm: number, step: number) => [
      { strike: atm - 2 * step, optionType: "PE", action: "BUY", qty: 1, entry: 0 },
      { strike: atm - step, optionType: "PE", action: "SELL", qty: 1, entry: 0 },
    ],
  },
  {
    id: "bear-call-spread",
    name: "Bear Call Spread",
    side: "SELL",
    blurb: "SELL 1 lower CE + BUY 1 higher CE. Bearish credit spread.",
    build: (atm: number, step: number) => [
      { strike: atm + 2 * step, optionType: "CE", action: "BUY", qty: 1, entry: 0 },
      { strike: atm + step, optionType: "CE", action: "SELL", qty: 1, entry: 0 },
    ],
  },
  {
    id: "iron-condor",
    name: "Iron Condor",
    side: "SELL",
    blurb: "SELL 1 PE + BUY 1 lower PE + SELL 1 CE + BUY 1 higher CE. Range-bound credit spread.",
    build: (atm: number, step: number) => [
      { strike: atm - 2 * step, optionType: "PE", action: "BUY", qty: 1, entry: 0 },
      { strike: atm + 2 * step, optionType: "CE", action: "BUY", qty: 1, entry: 0 },
      { strike: atm - step, optionType: "PE", action: "SELL", qty: 1, entry: 0 },
      { strike: atm + step, optionType: "CE", action: "SELL", qty: 1, entry: 0 },
    ],
  },
];

const ALL_TEMPLATES: StrategyTemplate[] = [...BUY_STRATEGIES, ...SELL_STRATEGIES];

export function stepFor(underlying: "NIFTY" | "BANKNIFTY"): number {
  return underlying === "BANKNIFTY" ? 100 : 50;
}

export function roundToStep(spot: number, step: number): number {
  return Math.round(spot / step) * step;
}

export interface SetupLeg extends PayoffLeg {
  legId: string;
}

export interface PaperSetup {
  id: string;
  templateId: string;
  name: string;
  underlying: "NIFTY" | "BANKNIFTY";
  legs: SetupLeg[];
  createdAt: string;
  closedAt: string | null;
}

const STORAGE_KEY = "premium-paper-setups";

function uid(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export function newSetup(
  templateId: string,
  name: string,
  underlying: PaperSetup["underlying"],
  atm: number,
): PaperSetup | null {
  const template = ALL_TEMPLATES.find((t) => t.id === templateId);
  if (!template) return null;
  const step = stepFor(underlying);
  const legs: SetupLeg[] = template.build(atm, step).map((leg) => ({ ...leg, legId: uid() }));
  return {
    id: uid(),
    templateId,
    name,
    underlying,
    legs,
    createdAt: new Date().toISOString(),
    closedAt: null,
  };
}

export function loadSetups(): PaperSetup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PaperSetup[]) : [];
  } catch {
    return [];
  }
}

export function saveSetups(setups: PaperSetup[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(setups));
  } catch {
    // storage unavailable — ignore
  }
}

export function markSetup(
  setup: PaperSetup,
  ltpOf: (strike: number, optionType: "CE" | "PE") => number | null,
): number | null {
  let total = 0;
  for (const leg of setup.legs) {
    const ltp = ltpOf(leg.strike, leg.optionType);
    if (ltp === null || ltp === undefined) return null;
    total += leg.action === "BUY" ? (ltp - leg.entry) * leg.qty : (leg.entry - ltp) * leg.qty;
  }
  return total;
}
