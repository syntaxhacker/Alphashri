import { createStore, produce } from "solid-js/store";

export type NotificationType = "success" | "error" | "warning" | "info";

export type Notification = {
  id: string;
  type: NotificationType;
  message: string;
  duration?: number;
  timestamp: number;
};

type NotificationsState = {
  items: Notification[];
};

const initialState: NotificationsState = {
  items: [],
};

/**
 * Toast queue.
 *
 * `produce` keeps the array reference stable for untouched subscribers and
 * only notifies the ones reading `items`.
 */
export const notificationsStore = createStore<NotificationsState>(initialState);

export function addNotification(
  payload: Omit<Notification, "id" | "timestamp">,
): void {
  const notification: Notification = {
    ...payload,
    id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    timestamp: Date.now(),
    duration: payload.duration ?? 5000,
  };
  notificationsStore.setState(
    produce((s) => {
      s.items = [...s.items, notification];
    }),
  );
}

export function removeNotification(id: string): void {
  notificationsStore.setState(
    produce((s) => {
      s.items = s.items.filter((n) => n.id !== id);
    }),
  );
}

export function clearAllNotifications(): void {
  notificationsStore.setState(
    produce((s) => {
      s.items = [];
    }),
  );
}
