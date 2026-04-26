import { Box } from "@mantine/core";
import { useAppDispatch, useAppSelector } from "../../state/store/hooks";
import { removeNotification } from "../../state/store/notificationsSlice";
import { NotificationItem } from "./Notification";

export function NotificationContainer() {
  const dispatch = useAppDispatch();
  const notifications = useAppSelector((state) => state.notifications.items);

  const handleDismiss = (id: string) => {
    dispatch(removeNotification(id));
  };

  if (notifications.length === 0) {
    return null;
  }

  return (
    <Box
      className="toast-container"
      role="region"
      aria-label="Notifications"
      id="notification-container"
      data-testid="notification-container"
    >
      {notifications.map((notification) => (
        <NotificationItem
          key={notification.id}
          notification={notification}
          onDismiss={handleDismiss}
        />
      ))}
    </Box>
  );
}
