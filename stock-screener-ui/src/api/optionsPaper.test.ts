import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  addOptionPaperLeg,
  closeOptionPaperPosition,
  fetchChainAt,
  fetchOptionPaperPositions,
  fetchReplayFrames,
  fetchReplaySessions,
  normalizeOptionPaperPosition,
  placeOptionPaperOrder,
  previewOptionPaperOrder,
} from "./optionsPaper";
import { fetchWithAuth } from "../state/auth";
import type { OptionPaperOrderRequest } from "../types/optionsPaper";

vi.mock("../state/auth", () => ({ fetchWithAuth: vi.fn() }));

const mockedFetch = vi.mocked(fetchWithAuth);
const BASE = "http://localhost:8765/api/options-paper";

const ok = (payload: unknown) =>
  ({ ok: true, status: 200, json: async () => payload }) as unknown as Response;
const httpError = (status: number, body: string) =>
  ({ ok: false, status, text: async () => body }) as unknown as Response;

const request: OptionPaperOrderRequest = {
  underlying: "IRFC",
  expiry: "2026-11-23",
  source: "replay",
  entryTs: "2026-11-17T09:47:00+05:30",
  legs: [
    { action: "BUY", opt: "CE", strike: 82.5, lots: 1 },
    { action: "SELL", opt: "CE", strike: 85, lots: 1 },
  ],
  slippageTicks: 0,
  name: "IRFC bull call spread",
};

const positionPayload = {
  id: 7,
  uuid: "pos-7",
  user_id: 1,
  source: "replay",
  status: "open",
  underlying: "IRFC",
  expiry: "2026-11-23",
  name: "IRFC bull call spread",
  entry_ts: "2026-11-17T09:47:00+05:30",
  entry_spot: 82.4,
  lots: 1,
  net_debit: 2400,
  costs_est: 125,
  max_profit: 2600,
  max_loss: 2400,
  breakevens: [84.9],
  realized_pnl: 0,
  close_reason: null,
  closed_at: null,
  notes: "",
  legs: [
    {
      id: 11,
      position_id: 7,
      action: "BUY",
      opt_type: "CE",
      strike: 82.5,
      lots: 1,
      qty: 500,
      instrument_key: "NSE_FO|123",
      entry_premium: 4.8,
      mark_premium: 5.1,
      mark_ts: "2026-11-22T10:00:00+05:30",
      exit_premium: null,
    },
    {
      id: 12,
      position_id: 7,
      action: "SELL",
      opt_type: "CE",
      strike: 85,
      lots: 1,
      qty: 500,
      instrument_key: "NSE_FO|124",
      entry_premium: 0,
      mark_premium: 0.1,
      mark_ts: "2026-11-22T10:00:00+05:30",
      exit_premium: null,
    },
  ],
  unrealized_pnl: 150,
  mark_spot: 83.1,
  mark_ts: "2026-11-22T10:00:00+05:30",
  dte: 1,
  created_at: "2026-11-17T09:47:00+05:30",
  updated_at: "2026-11-22T10:00:00+05:30",
};

const replayPayload = {
  position_id: 7,
  underlying: "IRFC",
  expiry: "2026-11-23",
  source: "replay",
  frames: [
    {
      t: "2026-11-17T09:48:00+05:30",
      spot: 82.5,
      marks: { "82.5:CE": 4.8, "85:CE": 0 },
      priced: true,
      gross_pnl: 0,
      net_pnl: -125,
      net_debit: 2400,
      equity: -125,
    },
  ],
  summary: { realized: 0, unrealized: 150, total: 25, max_drawdown: 125, costs: 125 },
  coverage: { frames: 1, first: "2026-11-17T09:48:00+05:30", last: "2026-11-17T09:48:00+05:30", gaps: 2 },
  payoff: { spots: [80, 85, 90], expiry: [-2400, 100, 2600] },
  breakevens: [84.9],
  max_profit: 2600,
  max_loss: 2400,
  skipped: null,
};

describe("options paper API client", () => {
  beforeEach(() => mockedFetch.mockReset());

  test("placeOptionPaperOrder posts the order and normalizes the position", async () => {
    mockedFetch.mockResolvedValueOnce(ok({ dry_run: false, position: positionPayload, replay: null }));

    const result = await placeOptionPaperOrder(request);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockedFetch.mock.calls[0];
    expect(url).toBe(`${BASE}/orders`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      underlying: "IRFC",
      source: "replay",
      entryTs: "2026-11-17T09:47:00+05:30",
      legs: [
        { action: "BUY", opt: "CE", strike: 82.5 },
        { action: "SELL", opt: "CE", strike: 85 },
      ],
    });
    expect(result.dryRun).toBe(false);
    expect(result.position?.status).toBe("open");
    expect(result.position?.source).toBe("replay");
    expect(result.position?.legs).toHaveLength(2);
    expect(result.position?.legs[1].optType).toBe("CE");
    expect(result.position?.legs[1].exitPremium).toBeNull();
    expect(result.position?.breakevens).toEqual([84.9]);
  });

  test("previewOptionPaperOrder sends dryRun and returns replay frames", async () => {
    mockedFetch.mockResolvedValueOnce(ok({ dry_run: true, position: null, replay: replayPayload }));

    const preview = await previewOptionPaperOrder(request);

    expect(JSON.parse(String(mockedFetch.mock.calls[0][1]?.body)).dryRun).toBe(true);
    expect(preview.positionId).toBe(7);
    expect(preview.frames[0].netPnl).toBe(-125);
    expect(preview.coverage.gaps).toBe(2);
    expect(preview.payoff.expiry).toEqual([-2400, 100, 2600]);
  });

  test("preview throws a readable error when the backend returns no frames", async () => {
    mockedFetch.mockResolvedValueOnce(ok({ dry_run: true, position: null, replay: null }));
    await expect(previewOptionPaperOrder(request)).rejects.toThrow("no replay frames");
  });

  test("fetchOptionPaperPositions scopes the status query", async () => {
    mockedFetch.mockResolvedValueOnce(ok({ positions: [positionPayload] }));
    const rows = await fetchOptionPaperPositions("open");
    expect(mockedFetch.mock.calls[0][0]).toBe(`${BASE}/positions?status=open`);
    expect(rows).toHaveLength(1);
    expect(rows[0].underlying).toBe("IRFC");
  });

  test("fetchReplayFrames normalizes frames, summary and payoff", async () => {
    mockedFetch.mockResolvedValueOnce(ok(replayPayload));
    const result = await fetchReplayFrames(7);
    expect(mockedFetch.mock.calls[0][0]).toBe(`${BASE}/replay/7`);
    expect(result.summary.maxDrawdown).toBe(125);
    expect(result.frames[0].marks["85:CE"]).toBe(0);
    expect(result.skipped).toBeNull();
  });

  test("addOptionPaperLeg posts a staggered leg with its own entry time", async () => {
    mockedFetch.mockResolvedValueOnce(ok(positionPayload));
    const result = await addOptionPaperLeg(7, {
      action: "SELL",
      opt: "CE",
      strike: 85,
      lots: 1,
      entryTs: "2026-11-19T10:15:00+05:30",
    });

    expect(mockedFetch.mock.calls[0][0]).toBe(`${BASE}/positions/7/legs`);
    expect(JSON.parse(String(mockedFetch.mock.calls[0][1]?.body))).toMatchObject({
      action: "SELL",
      opt: "CE",
      strike: 85,
      entryTs: "2026-11-19T10:15:00+05:30",
    });
    expect(result.id).toBe(7);
  });

  test("closeOptionPaperPosition sends premium overrides", async () => {
    mockedFetch.mockResolvedValueOnce(ok(positionPayload));
    await closeOptionPaperPosition(7, { "82.5:CE": 5.2 });
    expect(mockedFetch.mock.calls[0][0]).toBe(`${BASE}/positions/7/close`);
    expect(JSON.parse(String(mockedFetch.mock.calls[0][1]?.body))).toEqual({
      premiums: { "82.5:CE": 5.2 },
    });
  });

  test("fetchReplaySessions and fetchChainAt read their endpoints", async () => {
    mockedFetch
      .mockResolvedValueOnce(ok({ sessions: [{ underlying: "IRFC", expiry: "2026-11-23", date: "2026-11-17", source: "snapshot", frames: 20 }] }))
      .mockResolvedValueOnce(ok({ t: "2026-11-17T09:47:00+05:30", spot: 82.4, expiry: "2026-11-23", source: "snapshot", rows: [[82.5, 4.8, 100, 0, 0, 50, 0]] }));

    const sessions = await fetchReplaySessions();
    const chain = await fetchChainAt("IRFC", "2026-11-17", "09:47");

    expect(sessions[0].source).toBe("snapshot");
    expect(mockedFetch.mock.calls[1][0]).toContain("underlying=IRFC");
    expect(chain.legs[0].ceLtp).toBe(4.8);
    expect(chain.legs[0].peOi).toBe(50);
  });

  test("HTTP failures surface status and a short body", async () => {
    mockedFetch.mockResolvedValueOnce(httpError(422, "invalid leg: strike unavailable"));
    await expect(placeOptionPaperOrder(request)).rejects.toThrow(
      "Failed to place paper order (HTTP 422): invalid leg: strike unavailable",
    );
  });

  test("an empty order response does not fabricate an all-zero position", async () => {
    mockedFetch.mockResolvedValueOnce(ok(null));
    const empty = await placeOptionPaperOrder(request);
    expect(empty.position).toBeNull();
    expect(empty.replay).toBeNull();

    mockedFetch.mockResolvedValueOnce(ok({ dry_run: false }));
    const bare = await placeOptionPaperOrder(request);
    expect(bare.position).toBeNull();
  });

  test("a preview with zero frames is an error, not an empty replay", async () => {
    mockedFetch.mockResolvedValueOnce(
      ok({ dry_run: true, position: null, replay: { frames: [] } }),
    );
    await expect(previewOptionPaperOrder(request)).rejects.toThrow("no replay frames");
  });

  test("unreadable JSON surfaces a readable error instead of empty data", async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError("Unexpected token"); },
    } as unknown as Response);
    await expect(placeOptionPaperOrder(request)).rejects.toThrow("unreadable response");
  });

  test("malformed scalar fields render as safe values, never NaN or NaN-ish text", () => {
    const position = normalizeOptionPaperPosition({
      underlying: Number.NaN,
      expiry: { nope: true },
      entry_premium: Number.NaN,
      legs: [null, "nope", { action: "BUY", opt_type: "CE", strike: Number.NaN, entry_premium: Number.NaN }],
      breakevens: [Number.NaN, "garbage", 84.9],
    });
    expect(position.underlying).toBe("");
    expect(position.expiry).toBe("");
    expect(position.legs).toHaveLength(3);
    for (const leg of position.legs) {
      expect(Number.isFinite(leg.strike)).toBe(true);
      expect(Number.isFinite(leg.entryPremium)).toBe(true);
      expect(Number.isFinite(leg.markPremium)).toBe(true);
    }
    expect(position.breakevens).toEqual([0, 0, 84.9]);
    expect(JSON.stringify(position)).not.toContain("NaN");
  });
});
