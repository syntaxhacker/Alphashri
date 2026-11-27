import { beforeEach, describe, expect, test, vi } from "vitest";

const authHarness = vi.hoisted(() => ({
  authState: { user: null as { id: number } | null },
  emit: () => {},
}));
vi.mock("./auth", () => ({
  authState: authHarness.authState,
  subscribe: (callback: () => void) => {
    authHarness.emit = callback;
    return () => { authHarness.emit = () => {}; };
  },
}));

import {
  getOptionsPaperState,
  resetOptionsPaper,
  setPendingOrder,
  setPositions,
  setReplay,
  setReplayError,
  setSelectedPosition,
  setStatusFilter,
  subscribeToFields,
  upsertPosition,
} from "./optionsPaper";
import type { OptionPaperPosition, OptionReplayResult } from "../types/optionsPaper";

function position(id: number): OptionPaperPosition {
  return {
    id,
    uuid: `pos-${id}`,
    userId: 1,
    source: "replay",
    status: "open",
    underlying: "IRFC",
    expiry: "2026-11-23",
    name: "bull call spread",
    entryTs: "2026-11-17T09:47:00+05:30",
    entrySpot: 82.4,
    lots: 1,
    netDebit: 2400,
    costsEst: 125,
    maxProfit: 2600,
    maxLoss: 2400,
    breakevens: [84.9],
    realizedPnl: 0,
    closeReason: null,
    closedAt: null,
    notes: "",
    legs: [],
    unrealizedPnl: 0,
    totalPnl: 0,
    markSpot: 82.4,
    markTs: null,
    dte: 1,
    createdAt: "2026-11-17T09:47:00+05:30",
    updatedAt: "2026-11-17T09:47:00+05:30",
  };
}

function replayFor(positionId: number | null): OptionReplayResult {
  return {
    positionId,
    underlying: "IRFC",
    expiry: "2026-11-23",
    source: "replay",
    frames: [],
    legs: [],
    netDebit: 0,
    summary: { realized: 0, unrealized: 0, total: 0, maxDrawdown: 0, costs: 0 },
    coverage: { frames: 0, first: null, last: null, gaps: 0 },
    payoff: { spots: [], expiry: [] },
    breakevens: [],
    maxProfit: 0,
    maxLoss: 0,
    skipped: null,
  };
}

describe("options paper store", () => {
  beforeEach(() => {
    authHarness.authState.user = null;
    authHarness.emit();
    resetOptionsPaper();
  });

  test("setPositions keeps the selection valid and never mutates the previous state", () => {
    const before = getOptionsPaperState();
    setPositions([position(1), position(2)]);
    expect(getOptionsPaperState().selectedPositionId).toBe(1);
    expect(before.positions).toHaveLength(0);

    setPositions([position(2)]);
    expect(getOptionsPaperState().selectedPositionId).toBe(2);
  });

  test("field subscribers only fire for the fields they registered", () => {
    const onPositions = vi.fn();
    const onSessions = vi.fn();
    const offPositions = subscribeToFields(["positions"], onPositions);
    subscribeToFields(["sessions"], onSessions);

    setPositions([position(1)]);
    expect(onPositions).toHaveBeenCalledTimes(1);
    expect(onSessions).not.toHaveBeenCalled();

    offPositions();
    setPositions([position(2)]);
    expect(onPositions).toHaveBeenCalledTimes(1);
  });

  test("upsert replaces by id, appends new rows and selects the written position", () => {
    upsertPosition(position(1));
    upsertPosition({ ...position(1), unrealizedPnl: 120 });
    expect(getOptionsPaperState().positions).toHaveLength(1);
    expect(getOptionsPaperState().positions[0].unrealizedPnl).toBe(120);
    expect(getOptionsPaperState().selectedPositionId).toBe(1);

    upsertPosition(position(2));
    expect(getOptionsPaperState().positions.map((row) => row.id)).toEqual([2, 1]);
  });

  test("status filter and replay are independent slots", () => {
    setStatusFilter("closed");
    const replay = replayFor(1);
    setReplay(replay);
    expect(getOptionsPaperState().statusFilter).toBe("closed");
    expect(getOptionsPaperState().replay).toEqual(replay);
  });

  test("a position refresh that moves the selection drops the old replay cache", () => {
    setPositions([position(1), position(2)]);
    setSelectedPosition(1);
    setReplay(replayFor(1));
    setReplayError("stale error");

    setPositions([position(2)]);

    expect(getOptionsPaperState().selectedPositionId).toBe(2);
    expect(getOptionsPaperState().replay).toBeNull();
    expect(getOptionsPaperState().replayError).toBeNull();
  });

  test("keeping the selected position across a refresh preserves its replay", () => {
    setPositions([position(1), position(2)]);
    setSelectedPosition(1);
    const replay = replayFor(1);
    setReplay(replay);
    setPositions([position(1), { ...position(2), unrealizedPnl: 9 }]);
    expect(getOptionsPaperState().replay).toBe(replay);
  });

  test("clearing the pending order also clears the preview cache from commit/error", () => {
    setPendingOrder({ underlying: "IRFC", expiry: "2026-11-23", source: "replay", legs: [] });
    setReplay(replayFor(null));
    expect(getOptionsPaperState().replay).not.toBeNull();

    setPendingOrder(null);
    expect(getOptionsPaperState().pendingOrder).toBeNull();
    expect(getOptionsPaperState().replay).toBeNull();
    expect(getOptionsPaperState().replayError).toBeNull();
  });

  test("a user switch wipes positions, replay cache and pending work", () => {
    setPositions([position(1)]);
    setSelectedPosition(1);
    setReplay(replayFor(1));
    setPendingOrder({ underlying: "IRFC", expiry: "2026-11-23", source: "replay", legs: [] });

    authHarness.authState.user = { id: 2 };
    authHarness.emit();

    const after = getOptionsPaperState();
    expect(after.positions).toEqual([]);
    expect(after.selectedPositionId).toBeNull();
    expect(after.replay).toBeNull();
    expect(after.pendingOrder).toBeNull();
    expect(after.error).toBeNull();
  });
});
