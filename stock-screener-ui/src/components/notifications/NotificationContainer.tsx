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
      sx={{
        position: "fixed",
        // Bottom-right is the terminal's alert corner. Sit above the chat
        // launcher (bottom 20 + 56) so toasts never cover it.
        bottom: 84,
        right: 16,
        zIndex: 10000,
        display: "flex",
        flexDirection: "column-reverse",
        gap: 1,
        width: "min(360px, calc(100vw - 32px))",
        maxHeight: "calc(100vh - 180px)",
        overflowY: "auto",
        pointerEvents: "auto",
      }}
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
