/**
 * Pure state machine for the CW/PW tab-title alert.
 *
 * The panel loads walls for a context (symbol + expiry + mode + date + replay
 * frame). Three rules keep the flash honest:
 *
 * 1. **Seed, never fire.** The first payload of a context — mount, symbol
 *    switch, expiry switch, EOD switch, replay frame — only records the
 *    current walls. It is not a "wall moved" event.
 * 2. **Live only.** EOD/replay walls are history; scrubbing the playhead must
 *    never flash the tab title.
 * 3. **Dedupe by (side, strike).** A wall that moves A → B → A alerts once per
 *    side+strike, so oscillation cannot spam the title.
 *
 * Pure (no refs, no DOM) so the rules are unit-testable without mounting the
 * 5k-line report panel.
 */

export type WallSide = "CALL" | "PUT";

export interface WallMove {
  side: WallSide;
  from: number;
  to: number;
}

export interface WallMoveState {
  /** Identity of the symbol/mode/date/frame the values belong to. */
  context: string | null;
  call: number | null;
  put: number | null;
  /** `${side}:${strike}` pairs already flashed in this context. */
  flashed: Set<string>;
}

/** Cap: a session can only visit so many strikes; never grow unbounded. */
export const MAX_FLASHED_WALLS = 200;

export function createWallMoveState(): WallMoveState {
  return { context: null, call: null, put: null, flashed: new Set() };
}

/**
 * Fold one walls payload into the previous state.
 *
 * Returns the moves that should flash (possibly none) and the next state.
 * `live=false` always seeds, so EOD/replay can call this harmlessly.
 */
export function nextWallMoveState(
  prev: WallMoveState,
  context: string,
  call: number | null,
  put: number | null,
  live: boolean,
  maxFlashed: number = MAX_FLASHED_WALLS,
): { moves: WallMove[]; state: WallMoveState } {
  // Context switch (or a non-live frame): re-seed, clear the dedupe set.
  if (!live || prev.context !== context) {
    return {
      moves: [],
      state: { context, call, put, flashed: new Set() },
    };
  }

  const moves: WallMove[] = [];
  const flashed =
    prev.flashed.size > maxFlashed ? new Set<string>() : new Set(prev.flashed);
  const consider = (side: WallSide, from: number | null, to: number | null) => {
    if (from == null || to == null || from === to) return;
    const key = `${side}:${to}`;
    if (flashed.has(key)) return;
    flashed.add(key);
    moves.push({ side, from, to });
  };
  consider("CALL", prev.call, call);
  consider("PUT", prev.put, put);

  return { moves, state: { context, call, put, flashed } };
}

/** Title text for one move (`CALL WALL 25,700 → 25,800`). */
export function wallMoveTitle(move: WallMove): string {
  return `${move.side} WALL ${move.from.toLocaleString("en-IN")} → ${move.to.toLocaleString("en-IN")}`;
}
