import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type AppRouteView = "screener" | "backtest" | "paper" | "sector";

type AppState = {
  currentView: AppRouteView;
};

const initialState: AppState = {
  currentView: "screener",
};

const appSlice = createSlice({
  name: "app",
  initialState,
  reducers: {
    setCurrentView(state, action: PayloadAction<AppRouteView>) {
      state.currentView = action.payload;
    },
  },
});

export const { setCurrentView } = appSlice.actions;
export const appReducer = appSlice.reducer;
