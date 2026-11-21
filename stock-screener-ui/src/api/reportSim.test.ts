import { beforeEach, describe, expect, test, vi } from "vitest";

import { fetchSimStrategies, runSim } from "./reportSim";
import { fetchWithAuth } from "../state/auth";
import type { SimRunRequest } from "../types/reportSim";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

const STRATEGIES_URL = "http://localhost:8765/api/reports/sim/strategies";
const RUN_URL = "http://localhost:8765/api/reports/sim/run";

const ok = (payload: unknown) =>
  ({ ok: true, status: 200, json: async () => payload }) as unknown as Response;

const httpError = (status: number, body: string) =>
  ({ ok: false, status, text: async () => body }) as unknown as Response;

const request: SimRunRequest = {
  symbol: "NIFTY",
  date: "2026-11-09",
  asOf: "14:25",
  strategies: [
    {
      id: "s1",
      name: "ATM straddle",
      legs: [{ action: "BUY", opt: "CE", strike: "ATM", lots: 1 }],
      exec: {
        entryTime: "09:20",
        slPct: 25,
        tpPct: 50,
        maxHoldMin: 60,
        trailPct: 0,
        eodExit: "15:15",
      },
    },
  ],
  costs: true,
  slippageTicks: 1,
};

const snakeRun = {
  symbol: "NIFTY",
  date: "2026-11-09",
  expiry: "2026-11-12",
  dte: 3,
  as_of: "2026-11-09T14:25:00+05:30",
  spot: 24950.5,
  lot_size: 75,
  lot_verified: true,
  coverage: {
    frames: 312,
    first: "2026-11-09T09:15:00+05:30",
    last: "2026-11-09T14:25:00+05:30",
    gaps: 2,
  },
  tape_lag_sec: 12,
  fill_model: "next-minute close + 1 tick",
  expiry_note: "2026-11-09 was the 0-DTE expiry; the tape recorded 2026-11-17.",
  combined: {
    realized: 1250,
    unrealized: 340,
    total: 1590,
    equity: [
      { t: "2026-11-09T09:20:00+05:30", pnl: 0 },
      ["2026-11-09T10:20:00+05:30", 900],
    ],
  },
  strategies: [
    {
      id: "s1",
      name: "ATM straddle",
      legs: [
        {
          action: "buy",
          opt: "ce",
          strike: 24950,
          lots: 1,
          qty: 75,
          entry_premium: 120.5,
        },
      ],
      net_debit: 25000,
      max_profit: 0,
      max_loss: 25000,
      breakevens: [24700, 25200],
      margin_est: 0,
      realized: 1250,
      unrealized: 340,
      total: 1590,
      stats: {
        trades: 2,
        win_rate: 50,
        profit_factor: 1.8,
        avg_hold_min: 42,
        max_drawdown: -600,
      },
      equity: [{ t: "2026-11-09T09:20:00+05:30", pnl: 1250 }],
      payoff: { spots: [24000, 25000, 26000], expiry: [-500, 0, 500] },
      trades: [
        {
          id: "t1",
          strategy_id: "s1",
          strategy_name: "ATM straddle",
          legs: [
            {
              action: "SELL",
              opt: "PE",
              strike: 24800,
              lots: 1,
              qty: 75,
              entry_premium: 95.25,
            },
          ],
          entry_time: "2026-11-09T09:21:00+05:30",
          exit_time: "2026-11-09T09:59:00+05:30",
          entry_spot: 24940,
          exit_spot: 24990,
          entry_premium: 240.5,
          exit_premium: 265.2,
          lots: 1,
          qty: 75,
          gross_pnl: 1852.5,
          costs: 120,
          net_pnl: 1732.5,
          points: 24.7,
          exit_reason: "TARGET",
          hold_min: 38,
          priced: true,
        },
      ],
      open: [
        {
          strategy_id: "s1",
          strategy_name: "ATM straddle",
          legs: [
            {
              action: "BUY",
              opt: "CE",
              strike: 24950,
              lots: 1,
              qty: 75,
              entry_premium: 120.5,
              mark: 130.2,
              pnl: 727.5,
            },
          ],
          entry_time: "2026-11-09T13:50:00+05:30",
          entry_spot: 24960,
          mark_time: "2026-11-09T14:25:00+05:30",
          mark_spot: 24995,
          entry_premium: 240.5,
          mark_premium: 265.2,
          gross_pnl: 1852.5,
          net_pnl: 1732.5,
          points: 24.7,
          priced: true,
        },
      ],
    },
  ],
};

beforeEach(() => {
  vi.mocked(fetchWithAuth).mockReset();
});

describe("fetchSimStrategies", () => {
  test("normalizes a snake_case template list", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(
      ok({
        templates: [
          {
            id: "straddle",
            name: "ATM straddle",
            blurb: "Buy the ATM CE and PE",
            legs: [
              { action: "buy", opt: "ce", strike: "ATM", lots: 1 },
              { action: "BUY", opt: "pe", strike: "ATM", lots: 1 },
            ],
            exec: {
              entry_time: "09:20",
              sl_pct: 25,
              tp_pct: 50,
              max_hold_min: 60,
              trail_pct: 0,
              eod_exit: "15:15",
            },
          },
        ],
      }),
    );

    const templates = await fetchSimStrategies();

    expect(fetchWithAuth).toHaveBeenCalledWith(STRATEGIES_URL, {
      signal: undefined,
    });
    expect(templates).toHaveLength(1);
    expect(templates[0]).toEqual({
      id: "straddle",
      name: "ATM straddle",
      blurb: "Buy the ATM CE and PE",
      legs: [
        { action: "BUY", opt: "CE", strike: "ATM", lots: 1 },
        { action: "BUY", opt: "PE", strike: "ATM", lots: 1 },
      ],
      exec: {
        entryTime: "09:20",
        slPct: 25,
        tpPct: 50,
        maxHoldMin: 60,
        trailPct: 0,
        eodExit: "15:15",
      },
    });
  });

  test("accepts a bare array and camelCase keys", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(
      ok([
        {
          id: "iron",
          name: "Iron condor",
          blurb: "",
          legs: [],
          exec: { entryTime: "10:00", slPct: 30, eodExit: "15:00" },
        },
      ]),
    );

    const templates = await fetchSimStrategies();

    expect(templates[0].exec.entryTime).toBe("10:00");
    expect(templates[0].exec.slPct).toBe(30);
    expect(templates[0].exec.tpPct).toBe(0);
  });

  test("passes the abort signal through", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(ok({ templates: [] }));
    const controller = new AbortController();

    await fetchSimStrategies(controller.signal);

    expect(fetchWithAuth).toHaveBeenCalledWith(STRATEGIES_URL, {
      signal: controller.signal,
    });
  });

  test("throws with status and a body slice on non-2xx", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(
      httpError(503, '{"detail":"sim engine unavailable"}'),
    );

    await expect(fetchSimStrategies()).rejects.toThrow(
      'Failed to fetch sim strategies (HTTP 503): {"detail":"sim engine unavailable"}',
    );
  });

  test("degrades a partial template payload to safe defaults", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(ok({ templates: [{}] }));

    const templates = await fetchSimStrategies();

    expect(templates[0]).toEqual({
      id: "",
      name: "",
      blurb: "",
      legs: [],
      exec: {
        entryTime: "",
        slPct: 0,
        tpPct: 0,
        maxHoldMin: 0,
        trailPct: 0,
        eodExit: "",
      },
    });
  });
});

describe("runSim", () => {
  test("POSTs the request as JSON and normalizes the snake_case result", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(ok(snakeRun));

    const result = await runSim(request);

    expect(fetchWithAuth).toHaveBeenCalledWith(
      RUN_URL,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: undefined,
      }),
    );
    expect(result.symbol).toBe("NIFTY");
    expect(result.date).toBe("2026-11-09");
    expect(result.expiry).toBe("2026-11-12");
    expect(result.dte).toBe(3);
    expect(result.asOf).toBe("2026-11-09T14:25:00+05:30");
    expect(result.spot).toBe(24950.5);
    expect(result.lotSize).toBe(75);
    expect(result.lotVerified).toBe(true);
    expect(result.tapeLagSec).toBe(12);
    expect(result.fillModel).toBe("next-minute close + 1 tick");
    expect(result.expiryNote).toContain("0-DTE");
  });

  test("normalizes coverage, combined, strategies, legs and trades", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(ok(snakeRun));

    const result = await runSim(request);

    expect(result.coverage).toEqual({
      frames: 312,
      first: "2026-11-09T09:15:00+05:30",
      last: "2026-11-09T14:25:00+05:30",
      gaps: 2,
    });
    expect(result.combined.realized).toBe(1250);
    expect(result.combined.unrealized).toBe(340);
    expect(result.combined.total).toBe(1590);
    expect(result.combined.equity).toEqual([
      { t: "2026-11-09T09:20:00+05:30", pnl: 0 },
      { t: "2026-11-09T10:20:00+05:30", pnl: 900 },
    ]);

    const strategy = result.strategies[0];
    expect(strategy.id).toBe("s1");
    expect(strategy.name).toBe("ATM straddle");
    expect(strategy.netDebit).toBe(25000);
    expect(strategy.maxLoss).toBe(25000);
    expect(strategy.breakevens).toEqual([24700, 25200]);
    expect(strategy.marginEst).toBe(0);
    expect(strategy.skipped).toBeNull();
    expect(strategy.legs[0]).toEqual({
      action: "BUY",
      opt: "CE",
      strike: 24950,
      lots: 1,
      qty: 75,
      entryPremium: 120.5,
    });

    const trade = strategy.trades[0];
    expect(trade.id).toBe("t1");
    expect(trade.strategyId).toBe("s1");
    expect(trade.strategyName).toBe("ATM straddle");
    expect(trade.legs[0].action).toBe("SELL");
    expect(trade.legs[0].opt).toBe("PE");
    expect(trade.legs[0].entryPremium).toBe(95.25);
    expect(trade.entrySpot).toBe(24940);
    expect(trade.exitSpot).toBe(24990);
    expect(trade.grossPnl).toBe(1852.5);
    expect(trade.netPnl).toBe(1732.5);
    expect(trade.exitReason).toBe("TARGET");
    expect(trade.holdMin).toBe(38);
    expect(trade.priced).toBe(true);

    const open = strategy.open[0];
    expect(open.strategyId).toBe("s1");
    expect(open.markTime).toBe("2026-11-09T14:25:00+05:30");
    expect(open.markSpot).toBe(24995);
    expect(open.markPremium).toBe(265.2);
    expect(open.legs[0].mark).toBe(130.2);
    expect(open.legs[0].pnl).toBe(727.5);
  });

  test("normalizes stats, equity and payoff", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(ok(snakeRun));

    const strategy = (await runSim(request)).strategies[0];

    expect(strategy.stats).toEqual({
      trades: 2,
      winRate: 50,
      profitFactor: 1.8,
      avgHoldMin: 42,
      maxDrawdown: -600,
    });
    expect(strategy.equity).toEqual([
      { t: "2026-11-09T09:20:00+05:30", pnl: 1250 },
    ]);
    expect(strategy.payoff).toEqual({
      spots: [24000, 25000, 26000],
      expiry: [-500, 0, 500],
    });
  });

  test("accepts an already-camelCase payload", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(
      ok({
        symbol: "SENSEX",
        date: "2026-11-09",
        expiry: "2026-11-12",
        dte: 3,
        asOf: "2026-11-09T14:25:00+05:30",
        spot: 82000,
        lotSize: 20,
        lotVerified: false,
        coverage: { frames: 1, first: null, last: null, gaps: 0 },
        strategies: [
          {
            id: "s1",
            name: "x",
            legs: [],
            netDebit: 1,
            maxProfit: 2,
            maxLoss: 3,
            breakevens: [1],
            marginEst: 4,
            trades: [],
            open: [],
            realized: 5,
            unrealized: 6,
            total: 11,
            stats: {
              trades: 0,
              winRate: 0,
              profitFactor: 0,
              avgHoldMin: 0,
              maxDrawdown: 0,
            },
            equity: [],
            payoff: { spots: [], expiry: [] },
          },
        ],
        combined: { realized: 5, unrealized: 6, total: 11, equity: [] },
        tapeLagSec: 0,
        fillModel: "next-minute close",
      }),
    );

    const result = await runSim(request);

    expect(result.symbol).toBe("SENSEX");
    expect(result.lotSize).toBe(20);
    expect(result.lotVerified).toBe(false);
    expect(result.strategies[0].netDebit).toBe(1);
    expect(result.fillModel).toBe("next-minute close");
  });

  test("passes the abort signal through", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(ok(snakeRun));
    const controller = new AbortController();

    await runSim(request, controller.signal);

    expect(fetchWithAuth).toHaveBeenCalledWith(
      RUN_URL,
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  test("throws with status and a short body slice on non-2xx", async () => {
    const body = `{"detail":"${"x".repeat(300)}"}`;
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(httpError(500, body));

    const error = await runSim(request).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain("Sim run failed (HTTP 500)");
    const slice = message.replace(/^Sim run failed \(HTTP 500\): /, "");
    // Exactly 200 body chars plus the truncation marker.
    expect(slice).toHaveLength(201);
    expect(slice.endsWith("…")).toBe(true);
  });

  test("a partial payload degrades to safe defaults, never throws", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(
      ok({ symbol: "NIFTY", strategies: [{}] }),
    );

    const result = await runSim(request);

    expect(result.date).toBe("");
    expect(result.expiry).toBe("");
    expect(result.dte).toBe(0);
    expect(result.asOf).toBeNull();
    expect(result.spot).toBe(0);
    expect(result.lotSize).toBe(0);
    expect(result.lotVerified).toBe(false);
    expect(result.tapeLagSec).toBe(0);
    expect(result.fillModel).toBe("");
    expect(result.coverage).toEqual({
      frames: 0,
      first: null,
      last: null,
      gaps: 0,
    });
    expect(result.combined).toEqual({
      realized: 0,
      unrealized: 0,
      total: 0,
      equity: [],
    });
    expect(result.strategies[0]).toEqual({
      id: "",
      name: "",
      legs: [],
      netDebit: 0,
      maxProfit: 0,
      maxLoss: 0,
      breakevens: [],
      marginEst: 0,
      trades: [],
      open: [],
      realized: 0,
      unrealized: 0,
      total: 0,
      stats: {
        trades: 0,
        winRate: 0,
        profitFactor: 0,
        avgHoldMin: 0,
        maxDrawdown: 0,
      },
      equity: [],
      payoff: { spots: [], expiry: [] },
      skipped: null,
    });
  });

  test("a malformed success body resolves to an empty result", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as Response);

    const result = await runSim(request);

    expect(result.symbol).toBe("");
    expect(result.strategies).toEqual([]);
  });
});
