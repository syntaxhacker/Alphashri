import { useAppDispatch } from "../store/hooks";
import { addNotification, clearAllNotifications } from "../store/notificationsSlice";
import type { NotificationType } from "../store/notificationsSlice";

type NotificationOptions = {
  type: NotificationType;
  message: string;
  duration?: number;
};

export function useNotifications() {
  const dispatch = useAppDispatch();

  const notify = (options: NotificationOptions) => {
    dispatch(addNotification(options));
  };

  const success = (message: string, duration?: number) => {
    notify({ type: "success", message, duration });
  };

  const error = (message: string, duration?: number) => {
    notify({ type: "error", message, duration });
  };

  const warning = (message: string, duration?: number) => {
    notify({ type: "warning", message, duration });
  };

  const info = (message: string, duration?: number) => {
    notify({ type: "info", message, duration });
  };

  const clearAll = () => {
    dispatch(clearAllNotifications());
  };

  return {
    notify,
    success,
    error,
    warning,
    info,
    clearAll,
  };
}
