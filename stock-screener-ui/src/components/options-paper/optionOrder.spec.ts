import type {
  OptionPaperLegInput,
  OptionPaperOrderRequest,
  OptionPaperSource,
} from "@/types/optionsPaper";

/**
 * Dock → order mapping. The order endpoint prices each leg from the premium on
 * the leg itself, which is why this request shape extends the committed client
 * contract rather than restating it.
 */
export interface OrderLegInput {
  side: "buy" | "sell";
  type: "CE" | "PE";
  strike: number | string;
  premium: number;
  lots: number;
  lotSize?: number;
  instrumentKey?: string;
  expiry?: string;
}

export interface OrderChainLadder {
  spot: number;
  strikes: readonly number[];
}

export interface BuildOrderRequestInput {
  symbol: string;
  expiry: string;
  legs: readonly OrderLegInput[];
  source: OptionPaperSource;
  /** Global lots from the order band; falls back to the first leg's lots. */
  lots?: number;
  slippageTicks?: number;
  chainLadder?: OrderChainLadder;
  entryTs?: string;
  name?: string;
  notes?: string;
}

export interface PaperOrderLeg extends OptionPaperLegInput {
  premium: number;
}

export interface PaperOrderRequest extends Omit<OptionPaperOrderRequest, "legs"> {
  legs: PaperOrderLeg[];
}

const ATM_REF = /^ATM\s*([+-]\s*\d+)?$/i;

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

/**
 * ATM refs are dock-only shorthand: the server expects an absolute strike.
 * The offset counts ladder steps (ATM+1 = the next listed strike), not rupees.
 */
export function resolveOrderStrike(
  ref: number | string,
  ladder?: OrderChainLadder,
): number | null {
  if (typeof ref === "number") {
    return Number.isFinite(ref) && ref > 0 ? ref : null;
  }
  if (typeof ref !== "string") return null;
  const text = ref.trim();
  const atm = ATM_REF.exec(text);
  if (atm) {
    if (!ladder || !Number.isFinite(ladder.spot) || !Array.isArray(ladder.strikes)) return null;
    const strikes = ladder.strikes
      .map((value) => toNumber(value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);
    if (strikes.length === 0) return null;
    let anchor = 0;
    let nearest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < strikes.length; i += 1) {
      const distance = Math.abs(strikes[i] - ladder.spot);
      if (distance < nearest) {
        nearest = distance;
        anchor = i;
      }
    }
    const offset = Number(atm[1]?.replace(/\s+/g, "") ?? 0);
    const resolved = strikes[Math.max(0, Math.min(strikes.length - 1, anchor + offset))];
    return Number.isFinite(resolved) && resolved > 0 ? resolved : null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Mixed-expiry legs cannot be expressed in the order contract (expiry lives on
 * the structure, not on each leg), so the mismatch is rejected here rather than
 * silently dropping a leg that belongs to another contract.
 */
export function buildOrderRequest(input: BuildOrderRequestInput): PaperOrderRequest {
  const expiry = typeof input.expiry === "string" ? input.expiry.trim() : "";
  const sourceLegs = Array.isArray(input.legs) ? input.legs : [];
  for (const leg of sourceLegs) {
    const legExpiry = typeof leg.expiry === "string" ? leg.expiry.trim() : "";
    if (legExpiry && legExpiry !== expiry) {
      throw new Error(`Leg expiry ${leg.expiry} does not match the dock expiry ${expiry}`);
    }
  }

  // Keep invalid lots intact so validateOrderRequest can reject them; clamping
  // here would turn a bad input into a silently different order.
  const requestedLots = toNumber(input.lots ?? sourceLegs[0]?.lots ?? 1);
  const lots = Number.isFinite(requestedLots) ? Math.floor(requestedLots) : 0;
  const slippage = toNumber(input.slippageTicks);
  const legs: PaperOrderLeg[] = sourceLegs.map((leg) => {
    const strike = resolveOrderStrike(leg.strike, input.chainLadder);
    return {
      action: String(leg.side).toUpperCase() === "SELL" ? "SELL" : "BUY",
      opt: leg.type === "PE" ? "PE" : "CE",
      strike: strike === null ? leg.strike : strike,
      premium: leg.premium,
      lots,
      ...(leg.instrumentKey ? { instrumentKey: leg.instrumentKey } : {}),
    };
  });

  return {
    underlying: typeof input.symbol === "string" ? input.symbol.trim().toUpperCase() : "",
    expiry,
    source: input.source,
    ...(input.entryTs ? { entryTs: input.entryTs } : {}),
    legs,
    slippageTicks: Number.isFinite(slippage) ? Math.max(0, Math.floor(slippage)) : 0,
    ...(input.name ? { name: input.name } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
  };
}

export function validateOrderRequest(req: PaperOrderRequest): string[] {
  const errors: string[] = [];
  if (typeof req.underlying !== "string" || !req.underlying.trim()) {
    errors.push("Select an underlying");
  }
  if (typeof req.expiry !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(req.expiry)) {
    errors.push("Select a valid expiry");
  }

  const legs = Array.isArray(req.legs) ? req.legs : [];
  if (legs.length === 0) {
    errors.push("Select at least one leg");
  } else if (legs.length > 4) {
    errors.push("A paper order supports at most 4 legs");
  }

  const seen = new Set<string>();
  for (const [index, leg] of legs.entries()) {
    const label = `Leg ${index + 1}`;
    if (leg.action !== "BUY" && leg.action !== "SELL") {
      errors.push(`${label}: side must be BUY or SELL`);
    }
    if (leg.opt !== "CE" && leg.opt !== "PE") errors.push(`${label}: type must be CE or PE`);
    if (typeof leg.strike !== "number" || !Number.isFinite(leg.strike) || leg.strike <= 0) {
      errors.push(`${label}: strike must be an absolute number`);
    }
    if (!Number.isInteger(leg.lots) || leg.lots < 1) errors.push(`${label}: lots must be at least 1`);
    if (!Number.isFinite(leg.premium) || leg.premium <= 0) {
      errors.push(`${label}: premium must be positive`);
    }
    const key = `${leg.action}|${leg.opt}|${toNumber(leg.strike)}`;
    if (seen.has(key)) errors.push(`Duplicate leg: ${leg.action} ${leg.opt} ${leg.strike}`);
    seen.add(key);
  }

  if (req.slippageTicks != null && (!Number.isFinite(req.slippageTicks) || req.slippageTicks < 0)) {
    errors.push("Slippage ticks cannot be negative");
  }
  return errors;
}

function leg(overrides: Partial<OrderLegInput> = {}): OrderLegInput {
  return {
    side: "buy",
    type: "CE",
    strike: 1420,
    premium: 12.5,
    lots: 1,
    lotSize: 75,
    instrumentKey: "NSE_FO|1420CE",
    ...overrides,
  };
}

function validInput(overrides: Partial<BuildOrderRequestInput> = {}): BuildOrderRequestInput {
  return {
    symbol: "reliance",
    expiry: "2026-11-26",
    source: "live",
    lots: 2,
    legs: [leg(), leg({ side: "sell", strike: 1450, premium: 6.2, instrumentKey: "NSE_FO|1450CE" })],
    ...overrides,
  };
}

// The order band imports these helpers. Test globals only exist in vitest, so
// registration must be skipped when this module loads as part of the app bundle.
if (typeof describe !== "undefined") {
describe("buildOrderRequest", () => {
  it("maps a bull call spread to an order request", () => {
    const req = buildOrderRequest(validInput({ slippageTicks: 2 }));
    expect(req).toEqual({
      underlying: "RELIANCE",
      expiry: "2026-11-26",
      source: "live",
      legs: [
        { action: "BUY", opt: "CE", strike: 1420, premium: 12.5, lots: 2, instrumentKey: "NSE_FO|1420CE" },
        { action: "SELL", opt: "CE", strike: 1450, premium: 6.2, lots: 2, instrumentKey: "NSE_FO|1450CE" },
      ],
      slippageTicks: 2,
    });
    expect(validateOrderRequest(req)).toEqual([]);
  });

  it("resolves ATM and offset refs against the chain ladder", () => {
    const ladder: OrderChainLadder = { spot: 1417.4, strikes: [1340, 1400, 1420, 1450, 1470] };
    const req = buildOrderRequest(
      validInput({
        legs: [
          leg({ strike: "ATM" }),
          leg({ side: "sell", strike: "ATM+1", premium: 6.2 }),
          leg({ type: "PE", strike: "atm-1", premium: 4.1 }),
        ],
        chainLadder: ladder,
      }),
    );
    expect(req.legs.map((row) => row.strike)).toEqual([1420, 1450, 1400]);
    expect(validateOrderRequest(req)).toEqual([]);
  });

  it("keeps numeric string strikes and rejects an unresolvable ATM ref", () => {
    const numeric = buildOrderRequest(validInput({ legs: [leg({ strike: "1450" })] }));
    expect(numeric.legs[0].strike).toBe(1450);

    const unresolved = buildOrderRequest(validInput({ legs: [leg({ strike: "ATM+1" })] }));
    expect(validateOrderRequest(unresolved)).toContain("Leg 1: strike must be an absolute number");
  });

  it("rejects a leg from a different expiry", () => {
    expect(() =>
      buildOrderRequest(validInput({ legs: [leg({ expiry: "2026-12-31" })] })),
    ).toThrow(/does not match the dock expiry/);
  });

  it("does not mutate the dock legs, ladder or request", () => {
    const legs = Object.freeze([leg(), leg({ side: "sell", strike: 1450 })]);
    const ladder: OrderChainLadder = Object.freeze({ spot: 1417, strikes: Object.freeze([1420, 1450]) });
    const before = JSON.stringify({ legs, ladder });
    const req = buildOrderRequest(validInput({ legs, chainLadder: ladder }));
    expect(JSON.stringify({ legs, ladder })).toBe(before);
    expect(req.legs).not.toBe(legs);
    expect(req.legs[0]).not.toBe(legs[0]);

    const frozenReq = Object.freeze(req);
    const errors = validateOrderRequest(frozenReq);
    expect(errors).toEqual([]);
    expect(JSON.stringify(req)).not.toContain("undefined");
  });
});

describe("validateOrderRequest", () => {
  const base = () => buildOrderRequest(validInput());

  it("requires at least one leg and at most four", () => {
    expect(validateOrderRequest(buildOrderRequest(validInput({ legs: [] })))).toContain(
      "Select at least one leg",
    );
    const five = Array.from({ length: 5 }, (_, i) => leg({ strike: 1420 + i * 10 }));
    expect(validateOrderRequest(buildOrderRequest(validInput({ legs: five })))).toContain(
      "A paper order supports at most 4 legs",
    );
  });

  it("requires an underlying and a valid expiry", () => {
    expect(validateOrderRequest({ ...base(), underlying: " " })).toContain("Select an underlying");
    expect(validateOrderRequest({ ...base(), expiry: "" })).toContain("Select a valid expiry");
  });

  it("requires lots of at least one", () => {
    const req = buildOrderRequest(validInput({ lots: 0 }));
    expect(validateOrderRequest(req)).toContain("Leg 1: lots must be at least 1");
  });

  it("requires positive premiums", () => {
    const req = buildOrderRequest(validInput({ legs: [leg({ premium: 0 })] }));
    expect(validateOrderRequest(req)).toContain("Leg 1: premium must be positive");
  });

  it("rejects duplicate action/option/strike rows", () => {
    const req = buildOrderRequest(
      validInput({ legs: [leg(), leg({ instrumentKey: "NSE_FO|other" })] }),
    );
    expect(validateOrderRequest(req)).toContain("Duplicate leg: BUY CE 1420");
  });

  it("rejects negative slippage", () => {
    expect(validateOrderRequest({ ...base(), slippageTicks: -1 })).toContain(
      "Slippage ticks cannot be negative",
    );
  });
});

describe("multi-leg dock → order mapping", () => {
  it("maps 3 legs from dock state into one order request", () => {
    const req = buildOrderRequest(
      validInput({
        lots: 2,
        legs: [
          leg({ side: "buy", type: "CE", strike: 1420, premium: 15.4, instrumentKey: "NSE_FO|1420CE" }),
          leg({ side: "sell", type: "CE", strike: 1460, premium: 6.3, instrumentKey: "NSE_FO|1460CE" }),
          leg({ side: "buy", type: "PE", strike: 1380, premium: 9.1, instrumentKey: "NSE_FO|1380PE" }),
        ],
      }),
    );
    expect(req.legs.map(({ action, opt, strike, premium, lots }) => ({ action, opt, strike, premium, lots }))).toEqual([
      { action: "BUY", opt: "CE", strike: 1420, premium: 15.4, lots: 2 },
      { action: "SELL", opt: "CE", strike: 1460, premium: 6.3, lots: 2 },
      { action: "BUY", opt: "PE", strike: 1380, premium: 9.1, lots: 2 },
    ]);
    expect(req.legs.map((row) => row.instrumentKey)).toEqual([
      "NSE_FO|1420CE",
      "NSE_FO|1460CE",
      "NSE_FO|1380PE",
    ]);
    expect(validateOrderRequest(req)).toEqual([]);
  });

  it("maps a 4-leg iron condor without dropping or reordering legs", () => {
    const req = buildOrderRequest(
      validInput({
        lots: 1,
        source: "replay",
        slippageTicks: 1,
        legs: [
          leg({ side: "sell", type: "CE", strike: 1460, premium: 6.3, instrumentKey: "NSE_FO|1460CE" }),
          leg({ side: "buy", type: "CE", strike: 1500, premium: 1.9, instrumentKey: "NSE_FO|1500CE" }),
          leg({ side: "sell", type: "PE", strike: 1380, premium: 9.1, instrumentKey: "NSE_FO|1380PE" }),
          leg({ side: "buy", type: "PE", strike: 1340, premium: 3.1, instrumentKey: "NSE_FO|1340PE" }),
        ],
      }),
    );
    expect(req).toEqual({
      underlying: "RELIANCE",
      expiry: "2026-11-26",
      source: "replay",
      legs: [
        { action: "SELL", opt: "CE", strike: 1460, premium: 6.3, lots: 1, instrumentKey: "NSE_FO|1460CE" },
        { action: "BUY", opt: "CE", strike: 1500, premium: 1.9, lots: 1, instrumentKey: "NSE_FO|1500CE" },
        { action: "SELL", opt: "PE", strike: 1380, premium: 9.1, lots: 1, instrumentKey: "NSE_FO|1380PE" },
        { action: "BUY", opt: "PE", strike: 1340, premium: 3.1, lots: 1, instrumentKey: "NSE_FO|1340PE" },
      ],
      slippageTicks: 1,
    });
    expect(validateOrderRequest(req)).toEqual([]);
  });

  it("rejects one leg with a different expiry in a 4-leg structure", () => {
    expect(() =>
      buildOrderRequest(
        validInput({
          legs: [
            leg({ side: "buy", type: "CE", strike: 1420 }),
            leg({ side: "sell", type: "CE", strike: 1460 }),
            leg({ side: "sell", type: "PE", strike: 1380 }),
            leg({ side: "buy", type: "PE", strike: 1340, expiry: "2026-12-31" }),
          ],
        }),
      ),
    ).toThrow(/Leg expiry 2026-12-31 does not match the dock expiry 2026-11-26/);
  });

  it("rejects a duplicate leg inside a 4-leg structure", () => {
    const req = buildOrderRequest(
      validInput({
        legs: [
          leg({ strike: 1420, instrumentKey: "NSE_FO|A" }),
          leg({ strike: 1420, instrumentKey: "NSE_FO|B" }),
          leg({ side: "sell", strike: 1450 }),
          leg({ side: "sell", strike: 1460 }),
        ],
      }),
    );
    expect(req.legs).toHaveLength(4);
    expect(validateOrderRequest(req)).toContain("Duplicate leg: BUY CE 1420");
  });

  it("resolves ATM/offset refs against an explicit ladder, clamping at both ends", () => {
    const ladder: OrderChainLadder = { spot: 1417.4, strikes: [1340, 1400, 1420, 1450, 1470] };
    expect(resolveOrderStrike("ATM", ladder)).toBe(1420);
    expect(resolveOrderStrike("ATM+1", ladder)).toBe(1450);
    expect(resolveOrderStrike("atm-1", ladder)).toBe(1400);
    expect(resolveOrderStrike("ATM+2", ladder)).toBe(1470);
    expect(resolveOrderStrike("ATM+9", ladder)).toBe(1470);
    expect(resolveOrderStrike("ATM-9", ladder)).toBe(1340);
    expect(resolveOrderStrike("ATM", undefined)).toBeNull();
    expect(resolveOrderStrike("ATM", { spot: 1417, strikes: [] })).toBeNull();
    expect(resolveOrderStrike("not-a-strike", ladder)).toBeNull();

    const req = buildOrderRequest(
      validInput({
        legs: [
          leg({ strike: "ATM" }),
          leg({ side: "sell", strike: "ATM+1" }),
          leg({ type: "PE", strike: "ATM-1" }),
          leg({ type: "PE", side: "sell", strike: "ATM-2" }),
        ],
        chainLadder: ladder,
      }),
    );
    expect(req.legs.map((row) => row.strike)).toEqual([1420, 1450, 1400, 1340]);
    expect(validateOrderRequest(req)).toEqual([]);
  });

  it("applies lots greater than one to every leg and floors fractional lots", () => {
    const req = buildOrderRequest(
      validInput({
        lots: 3,
        legs: [leg({ lots: 1 }), leg({ side: "sell", strike: 1450, lots: 1 })],
      }),
    );
    expect(req.legs.every((row) => row.lots === 3)).toBe(true);
    expect(validateOrderRequest(req)).toEqual([]);

    expect(buildOrderRequest(validInput({ lots: 2.9 })).legs[0].lots).toBe(2);
    expect(validateOrderRequest(buildOrderRequest(validInput({ lots: Number.NaN })))).toContain(
      "Leg 1: lots must be at least 1",
    );
  });

  it("skips non-finite and string ladder strikes when resolving ATM offsets", () => {
    const ladder = {
      spot: 1417,
      strikes: [NaN, 1400, "1420", 1450, Number.POSITIVE_INFINITY] as unknown as number[],
    };
    expect(resolveOrderStrike("ATM", ladder)).toBe(1420);
    expect(resolveOrderStrike("ATM+1", ladder)).toBe(1450);
    expect(resolveOrderStrike("ATM-2", ladder)).toBe(1400);
    expect(resolveOrderStrike(Number.NaN, ladder)).toBeNull();
  });

  it("survives a malformed dock payload instead of throwing", () => {
    const req = buildOrderRequest({
      symbol: undefined as unknown as string,
      expiry: undefined as unknown as string,
      legs: undefined as unknown as OrderLegInput[],
      source: "live",
    });
    expect(req.legs).toEqual([]);
    expect(validateOrderRequest(req)).toEqual(
      expect.arrayContaining([
        "Select an underlying",
        "Select a valid expiry",
        "Select at least one leg",
      ]),
    );
    expect(() => validateOrderRequest({ ...req, legs: {} as unknown as PaperOrderLeg[] })).not.toThrow();
  });

  it("canonicalises lots/slippage and duplicate strikes across string forms", () => {
    expect(buildOrderRequest(validInput({ lots: "3" as unknown as number })).legs[0].lots).toBe(3);
    expect(buildOrderRequest(validInput({ slippageTicks: "2" as unknown as number })).slippageTicks).toBe(2);

    const req = buildOrderRequest(
      validInput({
        legs: [leg({ strike: 1420 }), leg({ strike: " 1420 ", instrumentKey: "NSE_FO|other" })],
      }),
    );
    expect(validateOrderRequest(req)).toContain("Duplicate leg: BUY CE 1420");
  });
});
}
