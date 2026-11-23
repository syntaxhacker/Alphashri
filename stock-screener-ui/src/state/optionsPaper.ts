import { createFieldSubscriber } from "./createSubscriber";
import { authState, subscribe as subscribeToAuth } from "./auth";
import type {
  OptionPaperPendingOrder,
  OptionPaperPosition,
  OptionPaperStatus,
  OptionReplayResult,
  ReplaySession,
} from "../types/optionsPaper";

export interface OptionsPaperState {
  positions: OptionPaperPosition[];
  statusFilter: OptionPaperStatus | "all";
  selectedPositionId: number | null;
  replay: OptionReplayResult | null;
  sessions: ReplaySession[];
  loading: boolean;
  replayLoading: boolean;
  error: string | null;
  replayError: string | null;
  /** The dock hands its uncommitted structure to the replay page through here. */
  pendingOrder: OptionPaperPendingOrder | null;
}

export const initialOptionsPaperState: OptionsPaperState = {
  positions: [],
  statusFilter: "open",
  selectedPositionId: null,
  replay: null,
  sessions: [],
  loading: false,
  replayLoading: false,
  error: null,
  replayError: null,
  pendingOrder: null,
};

let state: OptionsPaperState = { ...initialOptionsPaperState };

const { subscribe: _subscribe, subscribeToFields: _subscribeToFields, notify } =
  createFieldSubscriber<keyof OptionsPaperState>();

export const subscribe = _subscribe;
export const subscribeToFields = _subscribeToFields;

export function getOptionsPaperState(): Readonly<OptionsPaperState> {
  return state;
}

function patch(next: Partial<OptionsPaperState>): void {
  const fields = Object.keys(next) as (keyof OptionsPaperState)[];
  state = { ...state, ...next };
  notify(fields);
}

export function setPositions(positions: OptionPaperPosition[]): void {
  const selectedPositionId =
    state.selectedPositionId !== null &&
    positions.some((position) => position.id === state.selectedPositionId)
      ? state.selectedPositionId
      : (positions[0]?.id ?? null);
  const selectionChanged = selectedPositionId !== state.selectedPositionId;
  patch({
    positions,
    selectedPositionId,
    // Frames belong to the position they were computed for. A refresh that
    // moves the selection must not leave the previous position's replay on screen.
    ...(selectionChanged ? { replay: null, replayError: null } : {}),
  });
}

export function upsertPosition(position: OptionPaperPosition): void {
  const exists = state.positions.some((row) => row.id === position.id);
  patch({
    positions: exists
      ? state.positions.map((row) => (row.id === position.id ? position : row))
      : [position, ...state.positions],
    selectedPositionId: position.id,
  });
}

export function setStatusFilter(statusFilter: OptionPaperStatus | "all"): void {
  patch({ statusFilter });
}

export function setSelectedPosition(id: number | null): void {
  patch({ selectedPositionId: id, replay: null, replayError: null });
}

export function setReplay(replay: OptionReplayResult | null): void {
  patch({ replay, replayError: null });
}

export function setSessions(sessions: ReplaySession[]): void {
  patch({ sessions });
}

export function setLoading(loading: boolean): void {
  patch({ loading });
}

export function setReplayLoading(replayLoading: boolean): void {
  patch({ replayLoading });
}

export function setError(error: string | null): void {
  patch({ error });
}

export function setReplayError(replayError: string | null): void {
  patch({ replayError });
}

export function setPendingOrder(pendingOrder: OptionPaperPendingOrder | null): void {
  patch(
    pendingOrder === null
      ? { pendingOrder, replay: null, replayError: null }
      : { pendingOrder },
  );
}

export function resetOptionsPaper(): void {
  state = { ...initialOptionsPaperState };
  notify(Object.keys(initialOptionsPaperState) as (keyof OptionsPaperState)[]);
}

// The book is per-user. Logout/auth refreshes do not visit this module, so a
// user switch would otherwise leave the previous user's positions and replay
// cached here until the next successful fetch.
let authOwner: number | null = authState.user?.id ?? null;
subscribeToAuth(() => {
  const nextOwner = authState.user?.id ?? null;
  if (nextOwner === authOwner) return;
  authOwner = nextOwner;
  resetOptionsPaper();
});
