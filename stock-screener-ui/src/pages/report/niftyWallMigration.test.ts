// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { createElement as h } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { UIProvider } from "@/ui";
import {
  bucketLabel,
  bucketStartMinutes,
  buildWallMigration,
  parseClockMinutes,
  rowScalars,
  topWallsFromChain,
  type WallMigrationRow,
} from "./niftyWallMigration";
import {
  NiftyWallMigration,
  formatWallStrike,
  migrationSeries,
  stepPath,
} from "./NiftyWallMigration";

afterEach(cleanup);

function row(overrides?: Partial<WallMigrationRow>): WallMigrationRow {
  return {
    t: "2026-10-14T09:15:00+05:30",
    spot: 23050,
    atm_strike: 23050,
    max_pain: 23500,
    walls: { call: 23500, put: 23000 },
    ...overrides,
  };
}

/** Chain leg: [ce_ltp, pe_ltp, ce_oi, pe_oi, ce_vol, pe_vol]. */
function leg(ceLtp: number, peLtp: number, ceOi: number, peOi: number): number[] {
  return [ceLtp, peLtp, ceOi, peOi, 0, 0];
}

function TestWrapper({ children }: { children: React.ReactNode }) {
  return h(UIProvider, null, children);
}

function renderMigration(props: { rows: WallMigrationRow[]; bucketMin?: number }) {
  return render(h(TestWrapper, null, h(NiftyWallMigration, props)));
}

describe("parseClockMinutes", () => {
  test("parses bare and ISO clocks to minutes since midnight", () => {
    expect(parseClockMinutes("09:15")).toBe(555);
    expect(parseClockMinutes("13:06:22")).toBe(786);
    expect(parseClockMinutes("2026-10-14T13:06:00+05:30")).toBe(786);
  });
  test("unparseable timestamps yield null", () => {
    expect(parseClockMinutes("")).toBeNull();
    expect(parseClockMinutes("nope")).toBeNull();
    expect(parseClockMinutes(null)).toBeNull();
  });
});

describe("bucket boundaries", () => {
  test("floors timestamps into bucketMin buckets", () => {
    expect(bucketStartMinutes("09:14", 15)).toBe(540);
    expect(bucketStartMinutes("09:15", 15)).toBe(555);
    expect(bucketStartMinutes("09:29", 15)).toBe(555);
    expect(bucketStartMinutes("09:30", 15)).toBe(570);
    expect(bucketLabel(555)).toBe("09:15");
  });
  test("rows split across buckets keep time order", () => {
    const buckets = buildWallMigration(
      [
        row({ t: "09:29", spot: 22700 }),
        row({ t: "09:14", spot: 23050 }),
        row({ t: "09:31", spot: 22800 }),
      ],
      { bucketMin: 15 },
    );
    expect(buckets.map((b) => b.label)).toEqual(["09:00", "09:15", "09:30"]);
    expect(buckets[0].spot).toBe(23050);
    expect(buckets[1].spot).toBe(22700);
    expect(buckets[2].spot).toBe(22800);
  });
});

describe("wall selection", () => {
  test("chain top OI wins over scalar walls", () => {
    const buckets = buildWallMigration([
      row({
        t: "09:15",
        walls: { call: 23500, put: 23000 },
        chain: {
          "23000": leg(10, 50, 100, 900),
          "23500": leg(5, 2, 800, 50),
        },
      }),
    ]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].callWall).toBe(23500);
    expect(buckets[0].putWall).toBe(23000);
  });
  test("topWallsFromChain picks max OI per leg independently", () => {
    const tops = topWallsFromChain({
      "23000": leg(10, 50, 100, 900),
      "23100": leg(9, 40, 500, 100),
    });
    expect(tops.call).toBe(23100);
    expect(tops.put).toBe(23000);
  });
  test("missing chain falls back to scalar walls", () => {
    const buckets = buildWallMigration([row({ t: "09:15", chain: null })]);
    expect(buckets[0].callWall).toBe(23500);
    expect(buckets[0].putWall).toBe(23000);
  });
  test("empty chain with scalar walls still resolves", () => {
    expect(topWallsFromChain({})).toEqual({ call: null, put: null });
    expect(topWallsFromChain(null)).toEqual({ call: null, put: null });
    const scalars = rowScalars(row({ walls: { calls: 23500, puts: 22900 } }));
    expect(scalars.callWall).toBe(23500);
    expect(scalars.putWall).toBe(22900);
  });
});

describe("max-pain / ATM / spot series", () => {
  test("per-bucket last finite value wins", () => {
    const buckets = buildWallMigration([
      row({ t: "09:15", max_pain: 23500, atm_strike: 23050, spot: 23050 }),
      row({ t: "09:20", max_pain: 23000, atm_strike: 22700, spot: 22700 }),
      row({ t: "09:35", max_pain: 23000, atm_strike: 22800, spot: 22800 }),
    ]);
    const series = migrationSeries(buckets);
    const byKey = Object.fromEntries(series.map((s) => [s.key, s.values]));
    expect(byKey.pain).toEqual([23000, 23000]);
    expect(byKey.atm).toEqual([22700, 22800]);
    expect(byKey.spot).toEqual([22700, 22800]);
    expect(series).toHaveLength(5);
  });
  test("empty input yields no buckets", () => {
    expect(buildWallMigration([])).toEqual([]);
    expect(formatWallStrike(null)).toBe("—");
    expect(formatWallStrike(23500)).toBe("23,500");
  });
  test("stepPath moves horizontally then vertically, breaking on gaps", () => {
    const d = stepPath([0, 10, 20], [5, null, 7]);
    expect(d).toContain("M 0.0 5.0");
    expect(d).toContain("M 20.0 7.0");
    expect(d).not.toContain("H 10");
    const solid = stepPath([0, 10], [5, 6]);
    expect(solid).toBe("M 0.0 5.0 H 10.0 V 6.0");
  });
});

describe("NiftyWallMigration render", () => {
  test("plots five series with latest-value labels", () => {
    renderMigration({
      rows: [
        row({ t: "09:15", spot: 23050, atm_strike: 23050, max_pain: 23500 }),
        row({ t: "09:20", spot: 22700, atm_strike: 22700, max_pain: 23000 }),
      ],
    });
    expect(screen.getByTestId("nifty-wall-migration")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-wall-migration-chart")).toBeInTheDocument();
    for (const id of [
      "nifty-wall-migration-call",
      "nifty-wall-migration-put",
      "nifty-wall-migration-pain",
      "nifty-wall-migration-atm",
      "nifty-wall-migration-spot",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId("nifty-wall-migration-spot-label")).toHaveTextContent("22,700");
    expect(screen.getByTestId("nifty-wall-migration-pain-label")).toHaveTextContent("23,000");
    expect(screen.getByTestId("nifty-wall-migration-legend")).toHaveTextContent("Call wall");
  });
  test("empty rows render the empty state", () => {
    renderMigration({ rows: [] });
    expect(screen.getByTestId("nifty-wall-migration-empty")).toBeInTheDocument();
  });
  test("max pain path is dashed, ATM path is dotted", () => {
    renderMigration({ rows: [row({ t: "09:15" }), row({ t: "09:35" })] });
    const panel = screen.getByTestId("nifty-wall-migration");
    expect(within(panel).getByTestId("nifty-wall-migration-pain").getAttribute("stroke-dasharray")).toBe("5 3");
    expect(within(panel).getByTestId("nifty-wall-migration-atm").getAttribute("stroke-dasharray")).toBe("2 3");
  });
});
