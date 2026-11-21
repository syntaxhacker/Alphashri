import { describe, expect, test } from "vitest";
import {
  buildPreset,
  STRATEGY_PRESETS,
  strategiesFor,
  type ChainRow,
  type OptionLeg,
  type Outlook,
  type StrategyContext,
} from "./optionsStrategies";

const SPOT = 24031;
const LOT = 65;

function row(strike: number, ceLtp = 120, peLtp = 110): ChainRow {
  return {
    strike,
    ce: { ltp: ceLtp, oi: 1_000, iv: 0.138 },
    pe: { ltp: peLtp, oi: 1_100, iv: 0.14 },
  };
}

/** 23 700 … 24 300 step 50 — the plan's §4.1 neighbourhood. */
function fullChain(): ChainRow[] {
  const rows: ChainRow[] = [];
  for (let strike = 23_700; strike <= 24_300; strike += 50) rows.push(row(strike));
  return rows;
}

function ctx(rows: readonly ChainRow[] = fullChain()): StrategyContext {
  return { spot: SPOT, rows, lotSize: LOT };
}

function strikesOf(rows: readonly ChainRow[]): Set<number> {
  return new Set(rows.map((r) => r.strike));
}

/** Structural facts every preset leg set must satisfy, whatever the preset. */
function expectValidLegs(legs: OptionLeg[] | null, rows: readonly ChainRow[]): OptionLeg[] {
  expect(legs).not.toBeNull();
  const built = legs as OptionLeg[];
  const listed = strikesOf(rows);
  expect(built.length).toBeGreaterThan(0);
  expect(built.length).toBeLessThanOrEqual(4);

  const seen = new Set<string>();
  for (const leg of built) {
    expect(listed.has(leg.strike)).toBe(true);
    expect(leg.premium).toBeGreaterThan(0);
    expect(leg.lots).toBe(1);
    expect(leg.lotSize).toBe(LOT);
    expect(["buy", "sell"]).toContain(leg.side);
    expect(["CE", "PE"]).toContain(leg.type);

    const key = `${leg.type}:${leg.strike}`;
    expect(seen.has(key)).toBe(false);
    seen.add(key);
  }
  return built;
}

describe("STRATEGY_PRESETS registry", () => {
  test("ids are unique and every preset has a complete shape", () => {
    const ids = STRATEGY_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of STRATEGY_PRESETS) {
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
      expect(["defined", "undefined"]).toContain(preset.risk);
      expect(["bullish", "bearish", "neutral"]).toContain(preset.outlook);
    }
  });

  test("naked short options and short vol structures are flagged undefined", () => {
    const undefinedRisk = STRATEGY_PRESETS.filter((p) => p.risk === "undefined").map((p) => p.id);
    expect(undefinedRisk.sort()).toEqual(["short_call", "short_put", "short_straddle", "short_strangle"]);
  });

  test("strategiesFor groups exactly: 3 bullish, 3 bearish, 5 neutral", () => {
    const counts = ["bullish", "bearish", "neutral"].map(
      (outlook) => strategiesFor(outlook as Outlook).length,
    );
    expect(counts).toEqual([3, 3, 5]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(STRATEGY_PRESETS.length);
  });

  test("strategiesFor returns only the requested outlook", () => {
    for (const outlook of ["bullish", "bearish", "neutral"] as const) {
      for (const preset of strategiesFor(outlook)) expect(preset.outlook).toBe(outlook);
    }
    expect(strategiesFor("bullish").map((p) => p.id)).toEqual([
      "long_call",
      "bull_call_spread",
      "short_put",
    ]);
  });
});

describe("buildPreset — every preset builds on a full chain", () => {
  const rows = fullChain();
  const context = ctx(rows);

  test.each(STRATEGY_PRESETS.map((p) => p.id))("%s builds valid listed legs", (id) => {
    expectValidLegs(buildPreset(id, context), rows);
  });

  test("unknown id yields null rather than a guess", () => {
    expect(buildPreset("no_such_preset", context)).toBeNull();
  });
});

describe("bullish presets", () => {
  test("long_call buys the ATM call", () => {
    const legs = expectValidLegs(buildPreset("long_call", ctx()), fullChain());
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({ side: "buy", type: "CE", strike: 24_050 });
  });

  test("bull_call_spread is long the lower strike, short the higher one", () => {
    const legs = expectValidLegs(buildPreset("bull_call_spread", ctx()), fullChain());
    expect(legs).toHaveLength(2);
    const long = legs.find((l) => l.side === "buy") as OptionLeg;
    const short = legs.find((l) => l.side === "sell") as OptionLeg;
    expect(long.type).toBe("CE");
    expect(short.type).toBe("CE");
    expect(long.strike).toBeLessThan(short.strike);
    expect(long.strike).toBe(24_050);
    expect(short.strike).toBe(24_150);
  });

  test("short_put sells a put below spot, clamped to the nearest listed strike", () => {
    const legs = expectValidLegs(buildPreset("short_put", ctx()), fullChain());
    expect(legs).toHaveLength(1);
    // 2% below 24 031 is 23 550 — past the chain floor, so the lowest listed put wins.
    expect(legs[0]).toMatchObject({ side: "sell", type: "PE", strike: 23_700 });
    expect(legs[0].strike).toBeLessThan(SPOT);
  });
});

describe("bearish presets", () => {
  test("long_put buys the ATM put", () => {
    const legs = expectValidLegs(buildPreset("long_put", ctx()), fullChain());
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({ side: "buy", type: "PE", strike: 24_050 });
  });

  test("bear_put_spread is long the higher strike, short the lower one", () => {
    const legs = expectValidLegs(buildPreset("bear_put_spread", ctx()), fullChain());
    expect(legs).toHaveLength(2);
    const long = legs.find((l) => l.side === "buy") as OptionLeg;
    const short = legs.find((l) => l.side === "sell") as OptionLeg;
    expect(long.type).toBe("PE");
    expect(short.type).toBe("PE");
    expect(long.strike).toBeGreaterThan(short.strike);
    expect(long.strike).toBe(24_050);
    expect(short.strike).toBe(23_950);
  });

  test("short_call sells a call above spot", () => {
    const legs = expectValidLegs(buildPreset("short_call", ctx()), fullChain());
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({ side: "sell", type: "CE" });
    expect(legs[0].strike).toBeGreaterThan(SPOT);
  });
});

describe("neutral presets", () => {
  const context = ctx();
  const rows = fullChain();

  test("short_straddle sells the same ATM strike on both sides", () => {
    const legs = expectValidLegs(buildPreset("short_straddle", context), rows);
    expect(legs).toHaveLength(2);
    expect(legs.every((l) => l.side === "sell")).toBe(true);
    expect(new Set(legs.map((l) => l.type))).toEqual(new Set(["CE", "PE"]));
    expect(new Set(legs.map((l) => l.strike))).toEqual(new Set([24_050]));
  });

  test("long_straddle buys the same ATM strike on both sides", () => {
    const legs = expectValidLegs(buildPreset("long_straddle", context), rows);
    expect(legs).toHaveLength(2);
    expect(legs.every((l) => l.side === "buy")).toBe(true);
    expect(new Set(legs.map((l) => l.strike))).toEqual(new Set([24_050]));
  });

  test("short_strangle sells a put below spot and a call above it", () => {
    const legs = expectValidLegs(buildPreset("short_strangle", context), rows);
    expect(legs).toHaveLength(2);
    const put = legs.find((l) => l.type === "PE") as OptionLeg;
    const call = legs.find((l) => l.type === "CE") as OptionLeg;
    expect(put.side).toBe("sell");
    expect(call.side).toBe("sell");
    expect(put.strike).toBeLessThan(SPOT);
    expect(call.strike).toBeGreaterThan(SPOT);
  });

  test("iron_condor has 4 legs, puts below spot, calls above it, short inside long", () => {
    const legs = expectValidLegs(buildPreset("iron_condor", context), rows);
    expect(legs).toHaveLength(4);

    const calls = legs.filter((l) => l.type === "CE");
    const puts = legs.filter((l) => l.type === "PE");
    expect(calls).toHaveLength(2);
    expect(puts).toHaveLength(2);
    expect(puts.every((l) => l.strike < SPOT)).toBe(true);
    expect(calls.every((l) => l.strike > SPOT)).toBe(true);

    const shortCall = calls.find((l) => l.side === "sell") as OptionLeg;
    const longCall = calls.find((l) => l.side === "buy") as OptionLeg;
    const shortPut = puts.find((l) => l.side === "sell") as OptionLeg;
    const longPut = puts.find((l) => l.side === "buy") as OptionLeg;
    expect(longCall.strike).toBeGreaterThan(shortCall.strike);
    expect(longPut.strike).toBeLessThan(shortPut.strike);
    expect(longCall.strike - shortCall.strike).toBe(shortPut.strike - longPut.strike);
  });

  test("iron_butterfly sells the ATM body and buys both wings", () => {
    const legs = expectValidLegs(buildPreset("iron_butterfly", context), rows);
    expect(legs).toHaveLength(4);

    const body = legs.filter((l) => l.side === "sell");
    const wings = legs.filter((l) => l.side === "buy");
    expect(body.map((l) => l.type).sort()).toEqual(["CE", "PE"]);
    expect(wings.map((l) => l.type).sort()).toEqual(["CE", "PE"]);
    expect(new Set(body.map((l) => l.strike))).toEqual(new Set([24_050]));

    const bodyStrike = body[0].strike;
    expect((wings.find((l) => l.type === "CE") as OptionLeg).strike).toBeGreaterThan(bodyStrike);
    expect((wings.find((l) => l.type === "PE") as OptionLeg).strike).toBeLessThan(bodyStrike);
  });
});

describe("premium sourcing", () => {
  test("premium is the chain ltp for that side and type", () => {
    const rows = fullChain().map((r) =>
      r.strike === 24_050 ? { ...r, ce: { ...r.ce, ltp: 88.4 }, pe: { ...r.pe, ltp: 81.2 } } : r,
    );
    const straddle = buildPreset("short_straddle", ctx(rows)) as OptionLeg[];
    expect(straddle.find((l) => l.type === "CE")?.premium).toBe(88.4);
    expect(straddle.find((l) => l.type === "PE")?.premium).toBe(81.2);

    const call = buildPreset("long_call", ctx(rows)) as OptionLeg[];
    expect(call[0].premium).toBe(88.4);
  });

  test("an untradeable ATM quote is skipped for a listed neighbour, never zero-filled", () => {
    const rows = fullChain().map((r) =>
      r.strike === 24_050 ? { ...r, ce: { ...r.ce, ltp: 0 } } : r,
    );
    const legs = expectValidLegs(buildPreset("long_call", ctx(rows)), rows);
    expect(legs[0].premium).toBeGreaterThan(0);
    expect(legs[0].strike).not.toBe(24_050);
  });

  test("a dead wing quote substitutes a neighbour but keeps the wing outside the short", () => {
    // The 24 150 (upper call of the bull spread) has no bid; the substitute must
    // still sit above the long strike, or the spread silently inverts.
    const rows = fullChain().map((r) =>
      r.strike === 24_150 ? { ...r, ce: { ...r.ce, ltp: 0 } } : r,
    );
    const legs = expectValidLegs(buildPreset("bull_call_spread", ctx(rows)), rows);
    const long = legs.find((l) => l.side === "buy") as OptionLeg;
    const short = legs.find((l) => l.side === "sell") as OptionLeg;
    expect(short.strike).toBeGreaterThan(long.strike);
    expect(short.premium).toBeGreaterThan(0);
  });

  test("a dead wing quote cannot collapse the iron condor onto its short strike", () => {
    const rows = fullChain().map((r) =>
      r.strike === 24_250 ? { ...r, ce: { ...r.ce, ltp: 0 } } : r,
    );
    const legs = expectValidLegs(buildPreset("iron_condor", ctx(rows)), rows);
    const calls = legs.filter((l) => l.type === "CE");
    const shortCall = calls.find((l) => l.side === "sell") as OptionLeg;
    const longCall = calls.find((l) => l.side === "buy") as OptionLeg;
    expect(longCall.strike).toBeGreaterThan(shortCall.strike);
  });

  test("a straddle moves to the next strike when one side of ATM is dead", () => {
    const rows = fullChain().map((r) =>
      r.strike === 24_050 ? { ...r, pe: { ...r.pe, ltp: 0 } } : r,
    );
    const legs = expectValidLegs(buildPreset("short_straddle", ctx(rows)), rows);
    expect(legs).toHaveLength(2);
    expect(legs[0].strike).toBe(legs[1].strike);
    expect(legs[0].strike).not.toBe(24_050);
    expect(legs.every((l) => l.premium > 0)).toBe(true);
  });
});

describe("missing strikes are null, not fabricated", () => {
  test("a chain too narrow for the upper wing cannot build a bull call spread", () => {
    const narrow = [23_900, 23_950, 24_000, 24_050].map((k) => row(k));
    expect(buildPreset("bull_call_spread", ctx(narrow))).toBeNull();
  });

  test("a chain with the ATM at its floor cannot build a bear put spread", () => {
    // Spot 24 031 rounds up to the lowest listed strike, so the short lower leg
    // has nothing below it to sell.
    const narrow = [24_050, 24_100, 24_150].map((k) => row(k));
    expect(buildPreset("bear_put_spread", ctx(narrow))).toBeNull();
  });

  test("a chain with one strike per side cannot build an iron condor", () => {
    const narrow = [24_000, 24_050, 24_100].map((k) => row(k));
    expect(buildPreset("iron_condor", ctx(narrow))).toBeNull();
    expect(buildPreset("iron_butterfly", ctx(narrow))).not.toBeNull();
  });

  test("an empty or degenerate chain yields null everywhere", () => {
    expect(buildPreset("long_call", { spot: SPOT, rows: [], lotSize: LOT })).toBeNull();
    expect(buildPreset("long_call", { spot: 0, rows: fullChain(), lotSize: LOT })).toBeNull();
    expect(buildPreset("long_call", { spot: SPOT, rows: fullChain(), lotSize: 0 })).toBeNull();
    for (const preset of STRATEGY_PRESETS) {
      expect(preset.legs({ spot: Number.NaN, rows: fullChain(), lotSize: LOT })).toBeNull();
    }
  });

  test("every built strike exists in a chain with holes", () => {
    const holed = fullChain().filter((r) => r.strike !== 24_150 && r.strike !== 23_750);
    for (const preset of STRATEGY_PRESETS) {
      const legs = preset.legs(ctx(holed));
      if (legs === null) continue;
      for (const leg of legs) expect(strikesOf(holed).has(leg.strike)).toBe(true);
    }
  });
});

describe("percent offsets snap to listed strikes", () => {
  /** Wide enough that 2% / 4% targets land inside the chain rather than on its edge. */
  function wideChain(): ChainRow[] {
    const rows: ChainRow[] = [];
    for (let strike = 23_000; strike <= 25_000; strike += 50) rows.push(row(strike));
    return rows;
  }

  test("short_put lands near 2% below spot", () => {
    const rows = wideChain();
    const legs = expectValidLegs(buildPreset("short_put", ctx(rows)), rows);
    // 24 031 × 0.98 = 23 550.4 → the 23 550 strike.
    expect(legs[0].strike).toBe(23_550);
  });

  test("short_call lands near 2% above spot", () => {
    const rows = wideChain();
    const legs = expectValidLegs(buildPreset("short_call", ctx(rows)), rows);
    // 24 031 × 1.02 = 24 511.6 → the 24 500 strike.
    expect(legs[0].strike).toBe(24_500);
  });

  test("iron_condor shorts near 2% and wings near 4%", () => {
    const rows = wideChain();
    const legs = expectValidLegs(buildPreset("iron_condor", ctx(rows)), rows);
    const shortCall = legs.find((l) => l.type === "CE" && l.side === "sell") as OptionLeg;
    const longCall = legs.find((l) => l.type === "CE" && l.side === "buy") as OptionLeg;
    const shortPut = legs.find((l) => l.type === "PE" && l.side === "sell") as OptionLeg;
    const longPut = legs.find((l) => l.type === "PE" && l.side === "buy") as OptionLeg;

    expect(shortCall.strike).toBe(24_500);
    expect(shortPut.strike).toBe(23_550);
    expect(longCall.strike).toBe(25_000);
    expect(longPut.strike).toBe(23_050);
  });
});

describe("determinism", () => {
  test("same input yields an identical, correctly ordered array", () => {
    const context = ctx();
    for (const preset of STRATEGY_PRESETS) {
      const first = preset.legs(context);
      const second = preset.legs(context);
      expect(second).toEqual(first);
      if (!first) continue;

      const rank = (leg: OptionLeg) =>
        [
          leg.side === "sell" ? 0 : 1,
          leg.type === "CE" ? 0 : 1,
          leg.strike,
        ].join(":");
      const ordered = [...first].sort((a, b) =>
        rank(a).localeCompare(rank(b), undefined, { numeric: true }),
      );
      expect(first).toEqual(ordered);
    }
  });

  test("a shuffled chain produces the same legs", () => {
    const context = ctx();
    const shuffled = [...fullChain()].reverse();
    for (const preset of STRATEGY_PRESETS) {
      expect(preset.legs(ctx(shuffled))).toEqual(preset.legs(context));
    }
  });

  test("building does not mutate the caller's chain", () => {
    const rows = fullChain();
    const snapshot = rows.map((r) => r.strike);
    for (const preset of STRATEGY_PRESETS) preset.legs(ctx(rows));
    expect(rows.map((r) => r.strike)).toEqual(snapshot);
  });
});
