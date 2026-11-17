import { createStore, produce } from "solid-js/store";

export type NotificationType = "success" | "error" | "warning" | "info";

export type Notification = {
  id: string;
  type: NotificationType;
  message: string;
  duration?: number;
  timestamp: number;
};

export type NotificationsState = {
  items: Notification[];
  /** Number of today's surge alerts acknowledged by the user (panel opened). */
  seenSurgeCount: number;
  /** IST day key the acknowledgement belongs to; a new day resets unread. */
  seenSurgeDay: string;
};

const initialState: NotificationsState = {
  items: [],
  seenSurgeCount: 0,
  seenSurgeDay: "",
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Day key in IST, matching the backend's `config.IST` "today" boundary. */
export function currentIstDayKey(now: number = Date.now()): string {
  const d = new Date(now + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

/**
 * Toast queue.
 *
 * `produce` keeps the array reference stable for untouched subscribers and
 * only notifies the ones reading `items`.
 */
export const [notificationsStore, setNotificationsStore] =
  createStore<NotificationsState>(initialState);

export function addNotification(
  payload: Omit<Notification, "id" | "timestamp">,
): void {
  const notification: Notification = {
    ...payload,
    id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    timestamp: Date.now(),
    duration: payload.duration ?? 5000,
  };
  setNotificationsStore(
    produce((s) => {
      s.items = [...s.items, notification];
    }),
  );
}

export function removeNotification(id: string): void {
  setNotificationsStore(
    produce((s) => {
      s.items = s.items.filter((n) => n.id !== id);
    }),
  );
}

export function clearAllNotifications(): void {
  setNotificationsStore(
    produce((s) => {
      s.items = [];
    }),
  );
}

/** Mark today's currently-known surge alerts as read (called on panel open). */
export function acknowledgeSurgeAlerts(todayCount: number): void {
  const bounded = Number.isFinite(todayCount) ? Math.max(0, Math.trunc(todayCount)) : 0;
  setNotificationsStore(
    produce((s) => {
      s.seenSurgeCount = bounded;
      s.seenSurgeDay = currentIstDayKey();
    }),
  );
}

/** Unread = today's alerts minus what the user has already seen. Never all-time. */
export function unreadSurgeCount(todayCount: number): number {
  const bounded = Number.isFinite(todayCount) ? Math.max(0, Math.trunc(todayCount)) : 0;
  if (notificationsStore.seenSurgeDay !== currentIstDayKey()) return bounded;
  return Math.max(0, bounded - notificationsStore.seenSurgeCount);
}

/** Test/utility hook: forget the acknowledgement so a fresh session is simulated. */
export function resetSurgeAcknowledgement(): void {
  setNotificationsStore(
    produce((s) => {
      s.seenSurgeCount = 0;
      s.seenSurgeDay = "";
    }),
  );
}
