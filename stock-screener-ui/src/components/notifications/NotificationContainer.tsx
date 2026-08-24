import { Box } from "@mui/material";
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
      role="region"
      aria-label="Notifications"
      id="notification-container"
      data-testid="notification-container"
      sx={{ position: "fixed", top: 12, right: 12, zIndex: 10000, display: "flex", flexDirection: "column", gap: 1, maxWidth: 400, pointerEvents: "auto" }}
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
