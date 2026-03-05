import { configureStore } from "@reduxjs/toolkit";
import { appReducer } from "./appSlice";
import { notificationsReducer } from "./notificationsSlice";

export const store = configureStore({
  reducer: {
    app: appReducer,
    notifications: notificationsReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
