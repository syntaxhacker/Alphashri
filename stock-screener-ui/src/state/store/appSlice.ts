import { createStore, produce } from "solid-js/store";

export type AppRouteView = "screener" | "backtest" | "paper" | "sector" | "strategies" | "bots";

export type AppState = {
  currentView: AppRouteView;
};

const initialState: AppState = {
  currentView: "screener",
};

/**
 * App-level UI state.
 *
 * A Solid store (not Redux): `setCurrentView` mutates through `produce`, so
 * subscribers re-run only when the field they read actually changes.
 */
export const [appStore, setAppStore] = createStore<AppState>(initialState);

export function setCurrentView(view: AppRouteView): void {
  setAppStore(
    produce((s) => {
      s.currentView = view;
    }),
  );
}
