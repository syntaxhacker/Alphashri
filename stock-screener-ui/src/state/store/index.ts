import { appStore, type AppState } from "./appSlice";
import { notificationsStore, type NotificationsState } from "./notificationsSlice";

/**
 * Root state.
 *
 * Both slices stay as separate Solid stores so a tick on one does not
 * invalidate subscribers of the other. `appStore` and `notificationsStore` are
 * the single source of truth; `store` is kept as a facade for call sites that
 * want both.
 */
export const store = {
  app: appStore,
  notifications: notificationsStore,
};

export type RootState = {
  app: AppState;
  notifications: NotificationsState;
};

export { appStore, notificationsStore };
