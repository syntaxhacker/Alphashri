import { describe, expect, it } from "vitest";
import {
  BUY_STRATEGIES,
  SELL_STRATEGIES,
  loadSetups,
  markSetup,
  newSetup,
  roundToStep,
  saveSetups,
  stepFor,
} from "./strategies";

describe("strategy templates", () => {
  it("has exact buy template ids/names/sides", () => {
    expect(BUY_STRATEGIES.map((t) => t.id)).toEqual(["long-call", "long-straddle", "bull-call-spread"]);
    expect(BUY_STRATEGIES.map((t) => t.name)).toEqual(["Long Call", "Long Straddle", "Bull Call Spread"]);
    expect(BUY_STRATEGIES.every((t) => t.side === "BUY")).toBe(true);
  });

  it("has exact sell template ids/names/sides", () => {
    expect(SELL_STRATEGIES.map((t) => t.id)).toEqual(["bull-put-spread", "bear-call-spread", "iron-condor"]);
    expect(SELL_STRATEGIES.map((t) => t.name)).toEqual(["Bull Put Spread", "Bear Call Spread", "Iron Condor"]);
    expect(SELL_STRATEGIES.every((t) => t.side === "SELL")).toBe(true);
  });
});

describe("bull-put-spread legs", () => {
  it("sells higher strike put and buys lower strike put", () => {
    const t = SELL_STRATEGIES.find((s) => s.id === "bull-put-spread");
    expect(t).toBeDefined();
    const legs = t!.build(25000, 50);
    expect(legs).toHaveLength(2);
    const sell = legs.find((l) => l.action === "SELL");
    const buy = legs.find((l) => l.action === "BUY");
    expect(sell?.optionType).toBe("PE");
    expect(buy?.optionType).toBe("PE");
    expect(sell?.strike).toBe(25000 - 50);
    expect(buy?.strike).toBe(25000 - 100);
    expect(sell!.strike).toBeGreaterThan(buy!.strike);
    expect(legs[0].action).toBe("BUY");
  });
});

describe("iron condor", () => {
  it("has 4 legs", () => {
    const t = SELL_STRATEGIES.find((s) => s.id === "iron-condor");
    const legs = t!.build(25000, 50);
    expect(legs).toHaveLength(4);
    expect(legs.filter((l) => l.action === "BUY")).toHaveLength(2);
    expect(legs.filter((l) => l.action === "SELL")).toHaveLength(2);
  });
});

describe("newSetup", () => {
  it("returns null for unknown id", () => {
    expect(newSetup("nope", "x", "NIFTY", 25000)).toBeNull();
  });

  it("assigns unique legIds", () => {
    const setup = newSetup("iron-condor", "test", "NIFTY", 25000)!;
    expect(setup).not.toBeNull();
    const ids = setup.legs.map((l) => l.legId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("markSetup", () => {
  it("buy leg gains when ltp > entry", () => {
    const setup = newSetup("long-call", "lc", "NIFTY", 25000)!;
    const legs = setup.legs.map((l) => ({ ...l, entry: 100 }));
    const marked = markSetup({ ...setup, legs }, () => 120);
    expect(marked).toBe(20);
  });

  it("sell leg gains when ltp < entry", () => {
    const setup = newSetup("bear-call-spread", "bcs", "NIFTY", 25000)!;
    const legs = setup.legs.map((l) => ({ ...l, entry: 100 }));
    const marked = markSetup({ ...setup, legs }, () => 80);
    // buy leg: (80-100) = -20, sell leg: (100-80) = +20 → net 0
    expect(marked).toBe(0);
  });

  it("returns null on missing ltp", () => {
    const setup = newSetup("long-straddle", "ls", "NIFTY", 25000)!;
    const marked = markSetup(setup, () => null);
    expect(marked).toBeNull();
  });
});

describe("storage", () => {
  it("corrupt storage returns []", () => {
    localStorage.setItem("premium-paper-setups", "not-json{{{");
    expect(loadSetups()).toEqual([]);
    localStorage.removeItem("premium-paper-setups");
  });

  it("save/load roundtrip", () => {
    const setup = newSetup("long-call", "lc", "NIFTY", 25000)!;
    saveSetups([setup]);
    expect(loadSetups()).toEqual([setup]);
    localStorage.removeItem("premium-paper-setups");
  });
});

describe("stepFor / roundToStep", () => {
  it("stepFor values", () => {
    expect(stepFor("NIFTY")).toBe(50);
    expect(stepFor("BANKNIFTY")).toBe(100);
  });

  it("roundToStep rounds to nearest step", () => {
    expect(roundToStep(25023, 50)).toBe(25000);
    expect(roundToStep(25026, 50)).toBe(25050);
  });
});
