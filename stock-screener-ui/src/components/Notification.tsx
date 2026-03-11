import { useEffect } from "react";
import type { Notification } from "../store/notificationsSlice";

type NotificationItemProps = {
  notification: Notification;
  onDismiss: (id: string) => void;
};

const typeConfig = {
  success: {
    icon: "✓",
    className: "toast-success",
  },
  error: {
    icon: "✕",
    className: "toast-error",
  },
  warning: {
    icon: "⚠",
    className: "toast-warning",
  },
  info: {
    icon: "ℹ",
    className: "toast-info",
  },
};

export function NotificationItem({ notification, onDismiss }: NotificationItemProps) {
  const config = typeConfig[notification.type];

  useEffect(() => {
    if (notification.duration && notification.duration > 0) {
      const timer = setTimeout(() => {
        onDismiss(notification.id);
      }, notification.duration);

      return () => clearTimeout(timer);
    }
  }, [notification.id, notification.duration, onDismiss]);

  return (
    <div
      className={`toast-item ${config.className}`}
      role="alert"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="toast-icon" aria-hidden="true">
        {config.icon}
      </span>
      <span className="toast-message">{notification.message}</span>
      <button
        className="toast-dismiss"
        onClick={() => onDismiss(notification.id)}
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  );
}
