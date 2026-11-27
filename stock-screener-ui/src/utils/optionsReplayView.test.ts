import { describe, expect, test } from "vitest";

import type { OptionReplayResult } from "../types/optionsPaper";
import {
  frameAtOrBefore,
  optionsReplayViewAt,
  payoffAtSpot,
  replayPath,
  sliceFramesAt,
} from "./optionsReplayView";

const frame = (t: string, netPnl: number, equity = netPnl, priced = true) => ({
  t,
  spot: 82 + netPnl / 100,
  marks: { "82.5:CE": 4.8 },
  priced,
  grossPnl: netPnl + 125,
  netPnl,
  netDebit: 2400,
  equity,
});

const result: OptionReplayResult = {
  positionId: 7,
  underlying: "IRFC",
  expiry: "2026-11-23",
  source: "replay",
  legs: [],
  netDebit: 2400,
  frames: [
    frame("2026-11-17T09:48:00+05:30", -125),
    frame("2026-11-17T09:49:00+05:30", 200),
    frame("2026-11-17T09:50:00+05:30", 75, 75, false),
  ],
  summary: { realized: 0, unrealized: 75, total: 75, maxDrawdown: 125, costs: 125 },
  coverage: { frames: 3, first: "2026-11-17T09:48:00+05:30", last: "2026-11-17T09:50:00+05:30", gaps: 0 },
  payoff: { spots: [80, 85, 90], expiry: [-2400, 100, 2600] },
  breakevens: [84.9],
  maxProfit: 2600,
  maxLoss: 2400,
  skipped: null,
};

describe("options replay view", () => {
  test("frameAtOrBefore never returns a future frame", () => {
    expect(frameAtOrBefore(result.frames, "2026-11-17T09:49:30+05:30")?.t).toBe(
      "2026-11-17T09:49:00+05:30",
    );
    expect(frameAtOrBefore(result.frames, "2026-11-17T09:47:00+05:30")).toBeNull();
  });

  test("sliceFramesAt stops exactly at the playhead", () => {
    expect(sliceFramesAt(result.frames, null)).toHaveLength(3);
    const sliced = sliceFramesAt(result.frames, "2026-11-17T09:49:00+05:30");
    expect(sliced.map((row) => row.t)).toEqual([
      "2026-11-17T09:48:00+05:30",
      "2026-11-17T09:49:00+05:30",
    ]);
    expect(sliceFramesAt(result.frames, "2026-11-17T09:00:00+05:30")).toEqual([]);
  });

  test("view at playhead uses only frames up to that point", () => {
    const view = optionsReplayViewAt(result, "2026-11-17T09:49:00+05:30");
    expect(view.total).toBe(200);
    expect(view.unrealized).toBe(200);
    expect(view.realized).toBe(0);
    expect(view.priced).toBe(true);
    expect(view.coverageFrames).toBe(2);
    expect(view.maxDrawdown).toBe(125);
  });

  test("an unpriced frame is surfaced, never hidden", () => {
    const view = optionsReplayViewAt(result, "2026-11-17T09:50:00+05:30");
    expect(view.priced).toBe(false);
    expect(view.total).toBe(75);
  });

  test("null result yields an empty view", () => {
    const view = optionsReplayViewAt(null, null);
    expect(view.frames).toEqual([]);
    expect(view.current).toBeNull();
    expect(view.total).toBe(0);
  });

  test("replayPath and payoffAtSpot are pure", () => {
    expect(replayPath(result).map((row) => row.pnl)).toEqual([-125, 200, 75]);
    expect(payoffAtSpot(result, 80)).toBe(-2400);
    expect(payoffAtSpot(result, 82.5)).toBe(-1150);
    expect(payoffAtSpot(result, 95)).toBe(2600);
    expect(payoffAtSpot(null, 82)).toBeNull();
  });

  const t48 = "2026-11-17T09:48:00+05:30";
  const t49 = "2026-11-17T09:49:00+05:30";
  const t50 = "2026-11-17T09:50:00+05:30";
  const t51 = "2026-11-17T09:51:00+05:30";
  const staggered: OptionReplayResult = {
    ...result,
    frames: [
      { ...frame(t48, -125), active: { "82.5:CE": true } },
      { ...frame(t51, 400), active: { "82.5:CE": true, "85:CE": true } },
      { ...frame(t49, 200), active: { "82.5:CE": true, "85:CE": false } },
      { ...frame(t50, 75), active: { "82.5:CE": true, "85:CE": true } },
    ],
  };

  test("out-of-order frames still resolve to the latest frame at or before the playhead", () => {
    expect(frameAtOrBefore(staggered.frames, "2026-11-17T09:49:30+05:30")?.t).toBe(t49);
    expect(sliceFramesAt(staggered.frames, t50).map((row) => row.t)).toEqual([t48, t49, t50]);
    const view = optionsReplayViewAt(staggered, t50);
    expect(view.current?.t).toBe(t50);
    expect(view.total).toBe(75);
    expect(view.frames.map((row) => row.t)).toEqual([t48, t49, t50]);
    expect(view.current?.active).toEqual({ "82.5:CE": true, "85:CE": true });
  });

  test("an empty frame list yields an empty view with no NaN", () => {
    const view = optionsReplayViewAt({ ...result, frames: [] }, t48);
    expect(view.current).toBeNull();
    expect(view.total).toBe(0);
    expect(view.maxDrawdown).toBe(0);
    expect(view.coverageFrames).toBe(0);
  });

  test("NaN P&L payloads never leak into rendered totals or the path", () => {
    const bad = {
      ...frame(t48, Number.NaN),
      grossPnl: Number.NaN,
      netPnl: Number.NaN,
      equity: Number.NaN,
    };
    const view = optionsReplayViewAt({ ...result, frames: [bad] }, t48);
    expect(view.total).toBe(0);
    expect(view.gross).toBe(0);
    expect(view.unrealized).toBe(0);
    expect(view.maxDrawdown).toBe(0);
    expect(replayPath({ ...result, frames: [bad] })[0].pnl).toBe(0);
  });

  test("payoff interpolation ignores NaN points, mismatched arrays and a NaN spot", () => {
    expect(payoffAtSpot(result, Number.NaN)).toBeNull();
    expect(payoffAtSpot(result, 85)).toBe(100);
    expect(payoffAtSpot(result, 90)).toBe(2600);

    const withNan = { ...result, payoff: { spots: [80, Number.NaN, 90], expiry: [-2400, 0, 2600] } };
    expect(payoffAtSpot(withNan, 85)).toBe(100);
    expect(payoffAtSpot(withNan, 100)).toBe(2600);

    const mismatched = { ...result, payoff: { spots: [80, 85, 90], expiry: [0] } };
    expect(payoffAtSpot(mismatched, 87)).toBe(0);
  });
});
