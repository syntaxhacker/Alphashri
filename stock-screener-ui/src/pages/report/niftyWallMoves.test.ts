// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import {
  createWallMoveState,
  nextWallMoveState,
  wallMoveTitle,
} from "./niftyWallMoves";

function fold(
  steps: {
    context?: string;
    call: number | null;
    put: number | null;
    live?: boolean;
  }[],
) {
  let state = createWallMoveState();
  const all: ReturnType<typeof nextWallMoveState>["moves"][] = [];
  for (const step of steps) {
    const result = nextWallMoveState(
      state,
      step.context ?? "NIFTY|nearest|live||live",
      step.call,
      step.put,
      step.live ?? true,
    );
    all.push(result.moves);
    state = result.state;
  }
  return { movesPerStep: all, state };
}

describe("nextWallMoveState", () => {
  test("first payload is a seed, never a move (mount / first load)", () => {
    const { movesPerStep } = fold([{ call: 25_700, put: 25_500 }]);
    expect(movesPerStep[0]).toEqual([]);
  });

  test("a wall strike change in the same live context flashes once", () => {
    const { movesPerStep } = fold([
      { call: 25_700, put: 25_500 },
      { call: 25_800, put: 25_500 },
      { call: 25_800, put: 25_400 },
    ]);
    expect(movesPerStep[1]).toEqual([{ side: "CALL", from: 25_700, to: 25_800 }]);
    expect(movesPerStep[2]).toEqual([{ side: "PUT", from: 25_500, to: 25_400 }]);
  });

  test("dedupes by (side, strike): A → B → A before B again", () => {
    const { movesPerStep } = fold([
      { call: 25_700, put: null },
      { call: 25_800, put: null },
      { call: 25_700, put: null }, // return to A: A was seeded, not flashed → fires
      { call: 25_800, put: null }, // B already flashed → silent
    ]);
    expect(movesPerStep.map((m) => m.map((x) => x.to))).toEqual([[], [25_800], [25_700], []]);
  });

  test("a context switch (symbol / expiry / date / replay frame) re-seeds", () => {
    const { movesPerStep } = fold([
      { context: "NIFTY|nearest|live||live", call: 25_700, put: 25_500 },
      { context: "SENSEX|nearest|live||live", call: 80_000, put: 79_000 },
      { context: "NIFTY|2026-10-01|eod|2026-10-01T09:15", call: 24_000, put: 23_900 },
    ]);
    expect(movesPerStep).toEqual([[], [], []]);
  });

  test("non-live frames never fire (EOD / replay scrubbing is history)", () => {
    const { movesPerStep, state } = fold([
      { call: 25_700, put: 25_500 },
      { call: 25_800, put: 25_400, live: false },
      { call: 25_900, put: 25_300, live: false },
    ]);
    expect(movesPerStep).toEqual([[], [], []]);
    expect(state.call).toBe(25_900);
    expect(state.flashed.size).toBe(0);
  });

  test("null walls never produce a move (and re-seed the comparison)", () => {
    const { movesPerStep } = fold([
      { call: 25_700, put: 25_500 },
      { call: null, put: null },
      { call: 25_800, put: 25_400 },
    ]);
    expect(movesPerStep).toEqual([[], [], []]);
  });
});

describe("wallMoveTitle", () => {
  test("is Indian-grouped with an arrow", () => {
    expect(wallMoveTitle({ side: "CALL", from: 25_700, to: 25_800 })).toBe(
      "CALL WALL 25,700 → 25,800",
    );
  });
});
