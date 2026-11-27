import { describe, expect, test } from "vitest";
import type { SimAction, SimStrategySpec } from "@/types/reportSim";
import {
  SIM_TEMPLATES,
  buildLadder,
  defaultExec,
  leg,
  legLabel,
  nearestStrike,
  newStrategy,
  nextStrategyId,
  resolvePreviewStrike,
  structureKind,
  validateStrategy,
} from "./simSpec";

function ladder50(): number[] {
  return buildLadder(
    Array.from({ length: 9 }, (_, i) => 24800 + i * 50),
  );
}

function ladder25(): number[] {
  return buildLadder([24750, 24752.5, 24755, 24757.5, 24760]);
}

describe("resolvePreviewStrike", () => {
  test("resolves ATM to the nearest 50-point strike", () => {
    const ladder = ladder50();
    expect(nearestStrike(ladder, 24987)).toBe(25000);
    expect(resolvePreviewStrike("ATM", 24987, ladder)).toBe(25000);
  });

  test("ATM+n moves n steps up the ladder", () => {
    const ladder = ladder50();
    expect(resolvePreviewStrike("ATM+2", 24987, ladder)).toBe(25100);
    expect(resolvePreviewStrike("ATM-2", 24987, ladder)).toBe(24900);
    expect(resolvePreviewStrike("atm + 1", 24987, ladder)).toBe(25050);
  });

  test("ties resolve to the lower strike", () => {
    const ladder = ladder50();
    expect(nearestStrike(ladder, 24975)).toBe(24950);
    expect(resolvePreviewStrike("ATM", 24975, ladder)).toBe(24950);
  });

  test("works on a 2.5-point ladder", () => {
    const ladder = ladder25();
    expect(nearestStrike(ladder, 24753.75)).toBe(24752.5);
    expect(resolvePreviewStrike("ATM", 24753.75, ladder)).toBe(24752.5);
    expect(resolvePreviewStrike("ATM+2", 24753.75, ladder)).toBe(24757.5);
    expect(resolvePreviewStrike("ATM-1", 24753.75, ladder)).toBe(24750);
  });

  test("absolute strikes must exist in the ladder", () => {
    const ladder = ladder50();
    expect(resolvePreviewStrike("25050", 24987, ladder)).toBe(25050);
    expect(resolvePreviewStrike("25,050", 24987, ladder)).toBe(25050);
    expect(resolvePreviewStrike("25025", 24987, ladder)).toBeNull();
  });

  test("out-of-range offsets and empty ladders return null", () => {
    const ladder = ladder50();
    expect(resolvePreviewStrike("ATM+99", 24987, ladder)).toBeNull();
    expect(resolvePreviewStrike("ATM", 24987, [])).toBeNull();
    expect(resolvePreviewStrike("nonsense", 24987, ladder)).toBeNull();
  });
});

describe("buildLadder", () => {
  test("accepts numbers and strike objects, sorts, dedupes, drops invalid", () => {
    expect(buildLadder([{ strike: 25100 }, { strike: 25000 }, { strike: 25000 }, { strike: 0 }])).toEqual([
      25000, 25100,
    ]);
    expect(buildLadder([25100, 25000, 25000, 0, -5, NaN, Infinity])).toEqual([
      25000, 25100,
    ]);
  });
});

describe("templates", () => {
  test("all templates validate cleanly and have unique ids", () => {
    const ids = new Set<string>();
    for (const t of SIM_TEMPLATES) {
      expect(validateStrategy(t)).toEqual([]);
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
      expect(t.legs.length).toBeGreaterThan(0);
      expect(t.blurb.length).toBeGreaterThan(0);
    }
    expect(SIM_TEMPLATES.length).toBeGreaterThanOrEqual(8);
    expect(ids).toContain("iron-condor");
  });

  test("leg helper builds a leg", () => {
    expect(leg("SELL", "PE", "ATM-2", 3)).toEqual({
      action: "SELL",
      opt: "PE",
      strike: "ATM-2",
      lots: 3,
    });
  });

  test("defaultExec is a fresh copy with the documented defaults", () => {
    const a = defaultExec();
    const b = defaultExec();
    expect(a).toEqual({
      entryTime: "09:35",
      slPct: 30,
      tpPct: 60,
      maxHoldMin: 60,
      trailPct: 0,
      eodExit: "15:10",
    });
    a.slPct = 99;
    expect(b.slPct).toBe(30);
  });
});

describe("newStrategy / nextStrategyId", () => {
  test("creates a strategy from a template without sharing leg objects", () => {
    const s = newStrategy(3, "bull-call-spread");
    expect(s.id).toBe("sc-3");
    expect(s.name).toBe("Bull call spread");
    expect(s.legs).toHaveLength(2);
    s.legs[0].lots = 9;
    const template = SIM_TEMPLATES.find((t) => t.id === "bull-call-spread");
    expect(template?.legs[0].lots).toBe(1);
  });

  test("falls back to a generated name when the template is unknown", () => {
    const s = newStrategy(4);
    expect(s.id).toBe("sc-4");
    expect(s.name).toBe("Strategy 4");
    expect(s.legs).toEqual([]);
    expect(s.exec).toEqual(defaultExec());
  });

  test("nextStrategyId is one above the highest suffix", () => {
    const existing: SimStrategySpec[] = [
      newStrategy(1, "long-call"),
      newStrategy(7, "long-put"),
    ];
    expect(nextStrategyId(existing)).toBe("sc-8");
    expect(nextStrategyId([])).toBe("sc-1");
  });
});

describe("validateStrategy", () => {
  const base = () => newStrategy(1, "long-call");

  test("empty legs", () => {
    const errors = validateStrategy({ ...base(), legs: [] });
    expect(errors).toContain("Add at least one leg.");
  });

  test("too many legs", () => {
    const one = base().legs[0];
    const legs = Array.from({ length: 13 }, () => ({ ...one }));
    expect(validateStrategy({ ...base(), legs })).toContain(
      "Too many legs (maximum 12).",
    );
  });

  test("invalid side and option", () => {
    const s = base();
    s.legs[0] = { ...s.legs[0], action: "HOLD" as unknown as SimAction };
    expect(validateStrategy(s)).toContain("Leg 1: side must be BUY or SELL.");
    s.legs[0] = { ...s.legs[0], opt: "XX" as unknown as "CE" };
    expect(validateStrategy(s)).toContain("Leg 1: option must be CE or PE.");
  });

  test("lots outside 1..50", () => {
    const s = base();
    s.legs[0].lots = 0;
    expect(validateStrategy(s)).toContain("Leg 1: lots must be between 1 and 50.");
    s.legs[0].lots = 51;
    expect(validateStrategy(s)).toContain("Leg 1: lots must be between 1 and 50.");
  });

  test("bad times", () => {
    const s = base();
    s.exec.entryTime = "9:5";
    s.exec.eodExit = "25:00";
    const errors = validateStrategy(s);
    expect(errors).toContain("Entry time must be HH:MM.");
    expect(errors).toContain("EOD exit must be HH:MM.");
  });

  test("sl/tp and max hold bounds", () => {
    const s = base();
    s.exec.slPct = -1;
    s.exec.tpPct = 501;
    s.exec.maxHoldMin = 401;
    const errors = validateStrategy(s);
    expect(errors).toContain("Stop loss must be between 0 and 500%.");
    expect(errors).toContain("Target must be between 0 and 500%.");
    expect(errors).toContain("Max hold must be between 0 and 400 minutes.");
  });

  test("duplicate legs are allowed", () => {
    const s = base();
    s.legs = [{ ...s.legs[0] }, { ...s.legs[0] }];
    expect(validateStrategy(s)).toEqual([]);
  });

  test("a valid template passes", () => {
    expect(validateStrategy(base())).toEqual([]);
  });
});

describe("legLabel", () => {
  test("renders action, option, strike and lots", () => {
    expect(legLabel(leg("BUY", "CE", "ATM+2", 1))).toBe("BUY CE ATM+2 ×1");
    expect(legLabel(leg("SELL", "PE", "ATM-2", 4))).toBe("SELL PE ATM-2 ×4");
  });
});

describe("structureKind", () => {
  test("classifies the built-in templates", () => {
    const kind = (id: string) =>
      structureKind(SIM_TEMPLATES.find((t) => t.id === id)!.legs);
    expect(kind("long-call")).toBe("Single leg");
    expect(kind("long-straddle")).toBe("Straddle");
    expect(kind("bull-call-spread")).toBe("Debit spread");
    expect(kind("bear-put-spread")).toBe("Debit spread");
    expect(kind("bull-put-spread")).toBe("Credit spread");
    expect(kind("bear-call-spread")).toBe("Credit spread");
    expect(kind("iron-condor")).toBe("Credit spread");
  });

  test("same-side multi-leg structures are Multi-leg", () => {
    expect(
      structureKind([leg("BUY", "CE", "ATM"), leg("BUY", "PE", "ATM-2")]),
    ).toBe("Multi-leg");
    expect(structureKind([])).toBe("Multi-leg");
  });
});
