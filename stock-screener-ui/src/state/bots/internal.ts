import { createSubscriber } from "../createSubscriber";
import type {
  BotsState,
  BotLoadingKey,
} from "../../types/bots";
import { createLoadingState, setLoading as setLoadingState } from "../../utils/loading";

const initialState: BotsState = {
  bots: [],
  selectedBot: null,
  botStatus: null,
  botTrades: [],
  availableStrategies: [],
  loading: createLoadingState<BotLoadingKey>([
    "list",
    "load",
    "status",
    "strategies",
    "create",
    "update",
    "delete",
    "start",
    "stop",
    "trades",
  ]),
  error: null,
  showCreateModal: false,
  showEditModal: false,
  editingBot: null,
};

let state: BotsState = { ...initialState };

type BotsView = "list" | "status";
let currentViewValue: BotsView = "list";

const { subscribe, notify } = createSubscriber();

function setLoading(key: BotLoadingKey, loading: boolean) {
  state = { ...state, loading: setLoadingState<BotLoadingKey>(state.loading, key, loading) };
  notify();
}

function setError(error: string | null) {
  state = { ...state, error };
  notify();
}

export {
  state,
  subscribe,
  notify,
  getBotsState,
  getCurrentView,
  setCurrentView,
  setLoading,
  setError,
  clearError,
  triggerRerender,
};

function getBotsState(): BotsState {
  return state;
}

function getCurrentView(): BotsView {
  return currentViewValue;
}

function setCurrentView(view: BotsView) {
  currentViewValue = view;
  notify();
}

function clearError(): void {
  setError(null);
}

function triggerRerender() {
  notify();
}
