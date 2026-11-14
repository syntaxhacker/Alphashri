import { appStore, notificationsStore } from "./index";
import type { RootState } from "./index";

/**
 * Solid replacement for the react-redux hooks.
 *
 * `solid-js/store` is deeply reactive, so a store read inside a tracked scope
 * (a JSX expression or a `createMemo`) already subscribes — there is no
 * Provider and no `useStore` (Solid 1.9 has no such export).
 *
 * Both helpers return an **accessor**. Read it as `notifications()` in JSX or
 * inside a memo; calling it once at setup would pin the first snapshot.
 */
export function useAppSelector<T>(selector: (state: RootState) => T): () => T {
  return () => selector({ app: appStore, notifications: notificationsStore });
}

/**
 * The slice modules export plain mutators that write the store themselves and
 * return `void` (`removeNotification(id)` has already applied by the time this
 * is called), so there is nothing left to dispatch. Kept as a no-op so the
 * existing `dispatch(removeNotification(id))` call sites keep working.
 */
export function useAppDispatch(): (action: unknown) => void {
  return () => {};
}