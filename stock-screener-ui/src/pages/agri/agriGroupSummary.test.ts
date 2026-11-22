import { describe, expect, it } from "vitest";
import type { AgriSnapshot } from "@/types/agri";
import { buildAgriGroupSummaries, groupChangeField } from "./agriGroupSummary";

function row(overrides: Partial<AgriSnapshot> = {}): AgriSnapshot {
  return {
    key: "wheat",
    label: "Wheat",
    group: "cereals",
    date: "2026-11-21",
    modal: 2400,
    min: 2200,
    max: 2600,
    markets: 20,
    chg_1w_pct: null,
    chg_1m_pct: 2,
    chg_6m_pct: 10,
    ...overrides,
  };
}

const groups = [{ key: "cereals" as const }];

const only = (rows: AgriSnapshot[]) => buildAgriGroupSummaries(rows, groups)[0];

describe("groupChangeField", () => {
  it("prefers 6M whenever the group has a 6M observation", () => {
    expect(groupChangeField([row({ chg_6m_pct: 10, chg_1m_pct: 2 })])).toBe("chg_6m_pct");
    expect(groupChangeField([row({ chg_6m_pct: null, chg_1m_pct: 2 }), row({ chg_6m_pct: 9 })])).toBe(
      "chg_6m_pct",
    );
  });

  it("uses 1M only when no row in the group has a 6M observation", () => {
    expect(groupChangeField([row({ chg_6m_pct: null, chg_1m_pct: 2 })])).toBe("chg_1m_pct");
  });

  it("returns null when neither horizon has an observation", () => {
    expect(groupChangeField([row({ chg_6m_pct: null, chg_1m_pct: null })])).toBeNull();
  });
});

describe("buildAgriGroupSummaries", () => {
  it("uses one horizon for index, breadth and best/worst — never a 1M/6M mix", () => {
    const summary = only([
      row({ key: "wheat", chg_6m_pct: 10, chg_1m_pct: 2 }),
      row({ key: "rice", label: "Rice", chg_6m_pct: -4, chg_1m_pct: 9 }),
      row({ key: "maize", label: "Maize", chg_6m_pct: 6, chg_1m_pct: 1 }),
    ]);

    // Sorted 6M changes: -4, 6, 10 → median 6, two of three up.
    expect(summary.index).toBe(106);
    expect(summary.index_chg_pct).toBe(6);
    expect(summary.total_count).toBe(3);
    expect(summary.up_count).toBe(2);
    expect(summary.breadth_pct).toBeCloseTo(200 / 3);
    expect(summary.best).toMatchObject({ key: "wheat", chg_pct: 10 });
    expect(summary.worst).toMatchObject({ key: "rice", chg_pct: -4 });
  });

  it("does not count a row without the chosen horizon as 'not up'", () => {
    const summary = only([
      row({ key: "wheat", chg_6m_pct: 10 }),
      row({ key: "rice", label: "Rice", chg_6m_pct: null, chg_1m_pct: -3 }),
    ]);

    expect(summary.total_count).toBe(1);
    expect(summary.breadth_pct).toBe(100);
    expect(summary.best).toMatchObject({ key: "wheat" });
    expect(summary.worst).toMatchObject({ key: "wheat" });
    expect(summary.mandis).toBe(40);
  });

  it("falls back to 1M for every measurement when the group has no 6M data", () => {
    const summary = only([
      row({ key: "wheat", chg_6m_pct: null, chg_1m_pct: 4 }),
      row({ key: "rice", label: "Rice", chg_6m_pct: null, chg_1m_pct: -2 }),
    ]);

    // Two observations use the lower median, matching the overview's index rule.
    expect(summary.index).toBe(98);
    expect(summary.best).toMatchObject({ key: "wheat", chg_pct: 4 });
    expect(summary.worst).toMatchObject({ key: "rice", chg_pct: -2 });
  });

  it("keeps index, breadth and movers empty when no change is measurable", () => {
    const summary = only([
      row({ chg_6m_pct: Number.NaN, chg_1m_pct: null }),
      row({ key: "rice", chg_6m_pct: null, chg_1m_pct: null }),
    ]);

    expect(summary.index).toBeNull();
    expect(summary.index_chg_pct).toBeNull();
    expect(summary.breadth_pct).toBeNull();
    expect(summary.best).toBeNull();
    expect(summary.worst).toBeNull();
    expect(summary.total_count).toBe(0);
    expect(summary.as_of).toBe("2026-11-21");
  });

  it("ignores rows from other groups and undated rows", () => {
    const summary = buildAgriGroupSummaries(
      [
        row({ key: "wheat", chg_6m_pct: 8, markets: 10, date: "2026-11-21" }),
        row({ key: "onion", group: "vegetables", chg_6m_pct: 99, markets: 5 }),
        row({ key: "rice", chg_6m_pct: 99, markets: 5, date: "" }),
      ],
      groups,
    )[0];

    expect(summary.total_count).toBe(1);
    expect(summary.mandis).toBe(10);
    expect(summary.index).toBe(108);
  });
});
