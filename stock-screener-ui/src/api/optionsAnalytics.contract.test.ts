// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../state/auth", async () => (await import("./apiTestMocks")).fetchWithAuthModuleMock());

import { ANALYTICS_DEFAULT_EXPIRIES } from "../config/optionsAnalytics";
import { fetchWithAuth } from "../state/auth";
import { okResponse } from "./apiTestMocks";
import { fetchAnalytics, normalizeAnalytics } from "./optionsAnalytics";
import { analyticsBody } from "../../tests/mocks/analyticsResponse";

const mockedFetch = vi.mocked(fetchWithAuth);

/** Verified wire shape of `GET /api/options/analytics/{symbol}` (camelCase). */
function backendPayload() {
  return {
    symbol: "NIFTY",
    asOf: "2026-11-16T15:00:00+05:30",
    spot: 25215.7,
    marketState: "closed",
    quotesLive: false,
    sessionDate: "2026-11-16",
    warnings: [
      "quotes_not_live",
      "iv_coverage_below_60pct",
      "thin_chain",
      "gex_degraded",
      "missing_greeks",
    ],
    expiries: [
      {
        date: "2026-11-19",
        dteDays: 3,
        spot: 25215.7,
        atmIv: 12.4,
        iv: [
          {
            strike: 25000,
            ceIv: null,
            peIv: 13.3,
            ceDelta: null,
            peDelta: -0.28,
            ceOi: null,
            peOi: 900,
          },
          {
            strike: 25400,
            ceIv: 12.1,
            peIv: null,
            ceDelta: 0.24,
            peDelta: null,
            ceOi: 1200,
            peOi: null,
          },
          {
            strike: 25200,
            ceIv: 12.4,
            peIv: 12.4,
            ceDelta: 0.5,
            peDelta: -0.5,
            ceOi: 400,
            peOi: 420,
          },
        ],
        metrics: { rr25: 0.8, fly25: 0.5, slope: -0.04, r2: 0.93, n: 24 },
        levels: {
          thin: true,
          call_wall: { strike: 25500, side: "above", strength: 0.42, oi: 12000 },
          put_wall: { strike: 25000, side: "below", strength: 0.38, oi: 9000 },
          max_pain: { strike: 25200, side: null, strength: 0.7, payout: 120 },
          gex: {
            support: { strike: 25000, side: "below", strength: 0.6, net_gex: 12.5 },
            resistance: { strike: 25500, side: "above", strength: 0.5, net_gex: 10.2 },
            fuel_up: null,
            fuel_down: { strike: 24800, side: "below", strength: 0.3, net_gex: -4.1 },
            degraded: true,
          },
        },
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("normalizeAnalytics — real backend wire shape", () => {
  const data = normalizeAnalytics(backendPayload());

  it("reads the top-level camelCase envelope", () => {
    expect(data.symbol).toBe("NIFTY");
    expect(data.spot).toBe(25215.7);
    expect(data.asOf).toBe("2026-11-16T15:00:00+05:30");
    expect(data.quotesLive).toBe(false);
    expect(data.marketState).toBe("closed");
    expect(data.sessionDate).toBe("2026-11-16");
  });

  it("expands each iv row into CE and PE points with log-moneyness", () => {
    expect(data.expiries).toHaveLength(1);
    const expiry = data.expiries[0];
    expect(expiry.points).toHaveLength(6);

    const at25400 = expiry.points.filter((point) => point.strike === 25400);
    expect(at25400).toHaveLength(2);
    expect(at25400.find((point) => point.delta === 0.24)).toMatchObject({
      iv: 12.1,
      oi: 1200,
    });
    // A leg with no greek stays a point with null IV — never a fabricated 0.
    expect(at25400.find((point) => point.delta === null)).toMatchObject({
      iv: null,
      oi: null,
    });
    expect(expiry.points[0].moneyness).toBeCloseTo(Math.log(25000 / 25215.7), 10);
  });

  it("reads dteDays/atmIv and the metrics block (fly25 → bf25, r2 → fitR2)", () => {
    expect(data.expiries[0]).toMatchObject({
      date: "2026-11-19",
      dte: 3,
      atmIv: 12.4,
      rr25: 0.8,
      bf25: 0.5,
      slope: -0.04,
      fitR2: 0.93,
      n: 24,
    });
  });

  it("unwraps the first expiry's rich level objects to their strikes", () => {
    expect(data.levels.callWall).toBe(25500);
    expect(data.levels.putWall).toBe(25000);
    expect(data.levels.maxPain).toBe(25200);
    expect(data.levels.gex).toMatchObject({
      support: 25000,
      resistance: 25500,
      fuelUp: null,
      fuelDown: 24800,
    });
    expect(data.levels.details?.maxPain).toMatchObject({ strike: 25200, strength: 0.7 });
    expect(data.levels.details?.gex?.resistance).toMatchObject({ strike: 25500, side: "above" });
  });

  it("maps bare warning codes to { code, message }", () => {
    expect(data.warnings.map((warning) => warning.code)).toEqual([
      "quotes_not_live",
      "iv_coverage_below_60pct",
      "thin_chain",
      "gex_degraded",
      "missing_greeks",
    ]);
    expect(data.warnings.every((warning) => warning.message.length > 0)).toBe(true);
  });
});

/**
 * Both fixtures mirror the live wire shape: a camelCase envelope but snake_case
 * nested level objects. The normalizer still accepts camelCase *levels*, but
 * that is a legacy cache path — if a fixture drifts back to it, the E2E stops
 * exercising the branch production actually uses. Object.keys keeps these
 * assertions independent of each fixture's inferred value types.
 */
function expectLiveLevelKeys(levels: unknown) {
  const keys = Object.keys(levels as object);
  expect(keys).toEqual(expect.arrayContaining(["call_wall", "put_wall", "max_pain", "gex"]));
  for (const camel of ["callWall", "putWall", "maxPain"]) {
    expect(keys).not.toContain(camel);
  }
  const gexKeys = Object.keys((levels as { gex: object }).gex);
  expect(gexKeys).toEqual(
    expect.arrayContaining(["support", "resistance", "fuel_up", "fuel_down"]),
  );
  for (const camel of ["fuelUp", "fuelDown"]) {
    expect(gexKeys).not.toContain(camel);
  }
}

describe("analytics fixtures stay on the live wire shape", () => {
  const fixtures = [
    ["contract", backendPayload()],
    ["e2e", analyticsBody()],
  ] as const;

  for (const [name, body] of fixtures) {
    it(`${name} fixture carries rr25/fly25 and snake_case level keys`, () => {
      const expiry = body.expiries[0];
      const metricKeys = Object.keys(expiry.metrics as object);
      expect(metricKeys).toEqual(expect.arrayContaining(["rr25", "fly25"]));
      expect(metricKeys).not.toContain("bf25");
      expectLiveLevelKeys(expiry.levels);
    });
  }

  it("the e2e fixture keeps a missing IV null instead of filling it with 0", () => {
    const cells = analyticsBody().expiries.flatMap((expiry) =>
      expiry.iv.flatMap((row) => [row.ceIv, row.peIv]),
    );
    expect(cells.some((cell) => cell === null)).toBe(true);
    expect(cells.every((cell) => cell !== 0)).toBe(true);
  });
});

describe("fetchAnalytics query", () => {
  it("appends the requested expiry count", async () => {
    mockedFetch.mockResolvedValue(okResponse(backendPayload()));

    await fetchAnalytics("nifty", 5);

    expect(mockedFetch.mock.calls[0][0]).toContain(
      "/api/options/analytics/NIFTY?expiries=5",
    );
  });

  it("defaults to three expiries and still accepts (symbol, signal)", async () => {
    mockedFetch.mockResolvedValue(okResponse(backendPayload()));
    const controller = new AbortController();

    await fetchAnalytics("NIFTY", controller.signal);

    expect(mockedFetch.mock.calls[0][0]).toContain(
      `/api/options/analytics/NIFTY?expiries=${ANALYTICS_DEFAULT_EXPIRIES}`,
    );
    expect(mockedFetch.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });
});
