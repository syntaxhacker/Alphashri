import { describe, expect, test } from "vitest";
import { detectSectorAlerts, detectIntervalMovers, buildTreemapData } from "./SectorPage";
import type { SectorItem, StockMover } from "../../types/sector";

function makeSector(overrides: Partial<SectorItem> = {}): SectorItem {
  return {
    sector: "IT",
    avg_change: 1.5,
    stock_count: 50,
    advances: 30,
    declines: 20,
    avg_rsi: 55,
    avg_adx: 22,
    top_movers: "TCS, INFY",
    ...overrides,
  };
}

describe("detectSectorAlerts", () => {
  test("detects surging alert when delta >= 0.3", () => {
    const sectors = [makeSector({ sector: "IT", avg_change: 2.0 })];
    const prevData = { IT: 1.5 };
    const alerts = detectSectorAlerts(sectors, prevData);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].direction).toBe("SURGING");
    expect(alerts[0].sector).toBe("IT");
    expect(alerts[0].delta).toBeCloseTo(0.5);
  });

  test("detects dropping alert when delta <= -0.3", () => {
    const sectors = [makeSector({ sector: "Banking", avg_change: 0.5 })];
    const prevData = { Banking: 1.0 };
    const alerts = detectSectorAlerts(sectors, prevData);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].direction).toBe("DROPPING");
    expect(alerts[0].delta).toBeCloseTo(-0.5);
  });

  test("ignores changes below threshold", () => {
    const sectors = [makeSector({ sector: "IT", avg_change: 1.6 })];
    const prevData = { IT: 1.5 };
    const alerts = detectSectorAlerts(sectors, prevData);
    expect(alerts).toHaveLength(0);
  });

  test("ignores sectors with no previous data", () => {
    const sectors = [makeSector({ sector: "IT", avg_change: 5.0 })];
    const alerts = detectSectorAlerts(sectors, {});
    expect(alerts).toHaveLength(0);
  });

  test("handles empty sectors array", () => {
    expect(detectSectorAlerts([], {})).toEqual([]);
  });

  test("handles multiple alerts", () => {
    const sectors = [
      makeSector({ sector: "IT", avg_change: 2.0 }),
      makeSector({ sector: "Banking", avg_change: -1.0 }),
      makeSector({ sector: "Pharma", avg_change: 0.5 }),
    ];
    const prevData = { IT: 1.5, Banking: -0.2, Pharma: 0.5 };
    const alerts = detectSectorAlerts(sectors, prevData);
    expect(alerts).toHaveLength(2);
    expect(alerts[0].sector).toBe("IT");
    expect(alerts[1].sector).toBe("Banking");
  });

  test("detects exactly at threshold boundary", () => {
    const sectors = [makeSector({ sector: "IT", avg_change: 1.8 })];
    const prevData = { IT: 1.5 };
    const alerts = detectSectorAlerts(sectors, prevData);
    expect(alerts).toHaveLength(1);
  });

  test("each alert has a timestamp", () => {
    const sectors = [makeSector({ sector: "IT", avg_change: 2.0 })];
    const prevData = { IT: 1.5 };
    const alerts = detectSectorAlerts(sectors, prevData);
    expect(alerts[0].timestamp).toBeTruthy();
  });
});

describe("detectIntervalMovers", () => {
  test("detects movers with delta >= 0.3", () => {
    const movers: StockMover[] = [
      { symbol: "TCS", change: 3.0 },
      { symbol: "INFY", change: 1.5 },
    ];
    const prevData = { TCS: 2.0, INFY: 1.0 };
    const results = detectIntervalMovers(movers, prevData);
    expect(results).toHaveLength(2);
  });

  test("ignores changes below threshold", () => {
    const movers: StockMover[] = [{ symbol: "TCS", change: 1.2 }];
    const prevData = { TCS: 1.0 };
    const results = detectIntervalMovers(movers, prevData);
    expect(results).toHaveLength(0);
  });

  test("ignores movers with no previous data", () => {
    const movers: StockMover[] = [{ symbol: "TCS", change: 5.0 }];
    const results = detectIntervalMovers(movers, {});
    expect(results).toHaveLength(0);
  });

  test("sorts results by absolute delta descending", () => {
    const movers: StockMover[] = [
      { symbol: "A", change: 2.0 },
      { symbol: "B", change: 1.0 },
      { symbol: "C", change: 3.0 },
    ];
    const prevData = { A: 1.0, B: 0.5, C: 1.5 };
    const results = detectIntervalMovers(movers, prevData);
    expect(results[0].symbol).toBe("C");
    expect(results[1].symbol).toBe("A");
    expect(results[2].symbol).toBe("B");
  });

  test("includes prev_change and delta in results", () => {
    const movers: StockMover[] = [{ symbol: "TCS", change: 3.0 }];
    const prevData = { TCS: 2.0 };
    const results = detectIntervalMovers(movers, prevData);
    expect(results[0].prev_change).toBe(2.0);
    expect(results[0].delta).toBeCloseTo(1.0);
  });

  test("handles empty movers array", () => {
    expect(detectIntervalMovers([], {})).toEqual([]);
  });
});

describe("buildTreemapData", () => {
  test("transforms sector data correctly", () => {
    const sectors = [
      makeSector({
        sector: "IT",
        avg_change: 2.5,
        stock_count: 50,
        advances: 30,
        declines: 20,
        avg_rsi: 55,
        avg_adx: 22,
        top_movers: "TCS",
      }),
      makeSector({
        sector: "Banking",
        avg_change: -1.0,
        stock_count: 40,
        advances: 15,
        declines: 25,
        avg_rsi: 45,
        avg_adx: 18,
        top_movers: "HDFC",
      }),
    ];
    const result = buildTreemapData(sectors);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("IT");
    expect(result[0].avgChange).toBe(2.5);
    expect(result[0].stockCount).toBe(50);
    expect(result[0].value).toBe(2.5);
  });

  test("sorts by absolute avgChange descending", () => {
    const sectors = [
      makeSector({ sector: "IT", avg_change: 1.0 }),
      makeSector({ sector: "Banking", avg_change: -3.0 }),
      makeSector({ sector: "Pharma", avg_change: 2.0 }),
    ];
    const result = buildTreemapData(sectors);
    expect(result[0].name).toBe("Banking");
    expect(result[1].name).toBe("Pharma");
    expect(result[2].name).toBe("IT");
  });

  test("uses absolute value for size with minimum of 0.01", () => {
    const result = buildTreemapData([makeSector({ avg_change: 0 })]);
    expect(result[0].value).toBe(0.01);
  });

  test("handles empty sectors array", () => {
    expect(buildTreemapData([])).toEqual([]);
  });

  test("preserves all sector fields", () => {
    const sectors = [
      makeSector({
        sector: "IT",
        avg_change: 1.5,
        stock_count: 50,
        advances: 30,
        declines: 20,
        avg_rsi: 55,
        avg_adx: 22,
        top_movers: "TCS, INFY",
      }),
    ];
    const result = buildTreemapData(sectors);
    const item = result[0];
    expect(item.name).toBe("IT");
    expect(item.avgChange).toBe(1.5);
    expect(item.stockCount).toBe(50);
    expect(item.advances).toBe(30);
    expect(item.declines).toBe(20);
    expect(item.avgRsi).toBe(55);
    expect(item.avgAdx).toBe(22);
    expect(item.topMovers).toBe("TCS, INFY");
  });

  test("does not mutate original array", () => {
    const sectors = [
      makeSector({ sector: "IT", avg_change: 1.0 }),
      makeSector({ sector: "Banking", avg_change: 2.0 }),
    ];
    const original = sectors.map((s) => s.sector);
    buildTreemapData(sectors);
    expect(sectors.map((s) => s.sector)).toEqual(original);
  });
});
