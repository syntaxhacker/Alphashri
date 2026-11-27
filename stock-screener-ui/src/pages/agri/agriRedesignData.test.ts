// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildDispersionRows,
  buildRankBoard,
  buildSeasonRows,
  buildSparkRows,
  selectDispersionPopulation,
  shortMarketLabel,
  summariseDispersion,
} from "./agriRedesignData";
import type { AgriQuote, AgriSnapshot } from "@/types/agri";

describe("buildRankBoard", () => {
  it("ranks by monthly mean and leaves missing months as gaps", () => {
    const rows = buildRankBoard([
      {
        key: "a",
        label: "A",
        points: [
          { date: "2026-01-15", modal: 100 },
          { date: "2026-01-20", modal: 100 },
          { date: "2026-02-15", modal: 200 },
        ],
      },
      {
        key: "b",
        label: "B",
        points: [
          { date: "2026-01-15", modal: 110 },
          { date: "2026-02-15", modal: 150 },
        ],
      },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0].months).toEqual(["2026-01", "2026-02"]);
    expect(rows[0].ranks).toEqual([2, 1]);
    expect(rows[1].ranks).toEqual([1, 2]);
    expect(rows[0].changePct).toBe(100);
  });

  it("never promotes a missing observation to last place", () => {
    const rows = buildRankBoard([
      { key: "a", label: "A", points: [{ date: "2026-01-15", modal: 100 }] },
      { key: "b", label: "B", points: [{ date: "2026-02-15", modal: 200 }] },
    ]);
    expect(rows[0].ranks).toEqual([1, null]);
    expect(rows[1].ranks).toEqual([null, 1]);
  });

  it("returns nothing for an empty tracked set", () => {
    expect(buildRankBoard([])).toEqual([]);
    expect(buildRankBoard(null)).toEqual([]);
  });
});

describe("buildSeasonRows", () => {
  it("deviates from each row's own average and reports hit rate / years", () => {
    const rows = buildSeasonRows([
      {
        key: "a",
        label: "A",
        points: [
          { date: "2025-01-15", modal: 100 },
          { date: "2026-01-15", modal: 120 },
          { date: "2025-02-15", modal: 80 },
          { date: "2026-02-15", modal: 100 },
        ],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells.map((cell) => cell.month)).toEqual([1, 2]);
    expect(rows[0].cells.map((cell) => Math.round(cell.pct))).toEqual([10, -10]);
    expect(rows[0].hitRate).toBe(0.5);
    expect(rows[0].minYears).toBe(2);
  });

  it("dedupes a commodity echoed by the comparison payload", () => {
    const rows = buildSeasonRows([
      { key: "onion", label: "Onion", points: [{ date: "2025-01-15", modal: 100 }] },
      { key: "onion", label: "Onion", points: [{ date: "2026-01-15", modal: 200 }] },
      { key: "wheat", label: "Wheat", points: [{ date: "2025-02-15", modal: 80 }] },
    ]);
    expect(rows.map((row) => row.key)).toEqual(["onion", "wheat"]);
    expect(rows[0].cells[0].avg).toBe(100);
  });

  it("keeps a one-year series visible with its n, without inventing a cycle", () => {
    const rows = buildSeasonRows([
      { key: "a", label: "A", points: [{ date: "2026-01-15", modal: 100 }] },
    ]);
    expect(rows[0].minYears).toBe(1);
    expect(rows[0].cells[0].count).toBe(1);
  });
});

describe("shortMarketLabel", () => {
  it("drops committee suffixes and keeps an axis-safe label", () => {
    expect(shortMarketLabel("Vadakkencherry APMC")).toBe("Vadakkencherry");
    expect(shortMarketLabel("Aralamoodu Market")).toBe("Aralamoodu");
    expect(shortMarketLabel("A very long market name")).toHaveLength(16);
    expect(shortMarketLabel("")).toBe("");
  });
});

describe("buildDispersionRows", () => {
  const quote = (market: string, modal: number, date = "2026-11-17"): AgriQuote => ({
    date,
    state: "MH",
    district: "Nashik",
    market,
    variety: "Onion",
    grade: "A",
    min: modal - 10,
    max: modal + 10,
    modal,
    arrivals_qtl: 100,
  });

  it("uses the newest date, sorts by modal and separates IQR outliers", () => {
    const rows = buildDispersionRows([
      quote("Old", 1, "2026-11-10"),
      quote("C", 120),
      quote("A", 100),
      quote("B", 110),
      quote("D", 130),
      quote("E", 1000),
    ]);
    expect(rows.map((row) => row.market)).toEqual(["A", "B", "C", "D", "E"]);
    expect(rows[0].date).toBe("2026-11-17");
    expect(rows[4].outlier).toBe(true);
    expect(rows.slice(0, 4).every((row) => !row.outlier)).toBe(true);
  });

  it("reports the drawn/population denominator and middle of the quote page", () => {
    const rows = buildDispersionRows([
      quote("A", 100),
      quote("B", 110),
      quote("C", 120),
      quote("D", 130),
      quote("E", 1000),
    ]);
    const summary = summariseDispersion(rows, 8);
    expect(summary.markets).toBe(5);
    expect(summary.shown).toBe(5);
    expect(summary.median).toBe(120);
    expect(summary.outliers).toBe(1);
  });

  it("uses one population for the drawn stats and the halo fence", () => {
    const low = Array.from({ length: 20 }, (_, index) => quote(`L${index}`, 10 + index));
    const high = Array.from({ length: 8 }, (_, index) => quote(`H${index}`, 1000 + index * 10));
    const all = buildDispersionRows([...low, ...high]);
    const population = selectDispersionPopulation(all, 8);
    // The full quote page's fence would flag every top-priced mandi; the
    // drawn-set fence flags none of them because the population is consistent.
    expect(population.rows).toHaveLength(8);
    expect(population.summary.outliers).toBe(0);
    expect(population.rows.every((row) => !row.outlier)).toBe(true);
    expect(population.summary.markets).toBe(28);
    expect(population.summary.fenceLow).toBeLessThan(population.summary.q1 as number);
    expect(population.summary.fenceHigh).toBeGreaterThan(population.summary.q3 as number);
    const summary = summariseDispersion(all, 8);
    expect(summary).toEqual(population.summary);
  });

  it("keeps the IQR/median reference on the mandis the panel draws", () => {
    const rows = buildDispersionRows(
      Array.from({ length: 12 }, (_, index) => quote(`M${index}`, 1000 + index * 500)),
    );
    const summary = summariseDispersion(rows, 8);
    expect(summary.markets).toBe(12);
    expect(summary.shown).toBe(8);
    // Top eight modals are 3,000 … 6,500; the reference must live there, not
    // in the cheap half of the quote page.
    expect(summary.median).toBe(4750);
    expect(summary.q1).toBe(3875);
    expect(summary.q3).toBe(5625);
  });

  it("does not flag outliers from a sample too small for a fence", () => {
    const rows = buildDispersionRows([quote("A", 100), quote("B", 5000)]);
    expect(rows.every((row) => !row.outlier)).toBe(true);
  });
});

describe("buildSparkRows", () => {
  it("merges snapshot prices with real paths and never draws a missing path", () => {
    const snapshot: AgriSnapshot[] = [
      {
        key: "a",
        label: "A",
        group: "g",
        date: "2026-11-17",
        modal: 100,
        min: 90,
        max: 110,
        markets: 2,
        chg_1w_pct: null,
        chg_1m_pct: 5,
        chg_6m_pct: null,
      },
    ];
    const rows = buildSparkRows(
      snapshot,
      [
        { key: "a", label: "A", points: [{ date: "2026-11-01", modal: 90 }, { date: "2026-11-17", modal: 100 }] },
        { key: "b", label: "B", points: [{ date: "2026-11-01", modal: 200 }, { date: "2026-11-17", modal: 220 }] },
      ],
      (key, fallback) => fallback ?? key,
    );
    expect(rows.find((row) => row.key === "a")).toMatchObject({
      modal: 100,
      change: 5,
      points: [90, 100],
    });
    expect(rows.find((row) => row.key === "b")?.points).toEqual([200, 220]);
    expect(rows.find((row) => row.key === "b")?.change).toBeCloseTo(10);
  });

  it("returns no cells with a drawn path when no comparison payload exists", () => {
    const rows = buildSparkRows([], [], (key) => key);
    expect(rows).toEqual([]);
  });
});
