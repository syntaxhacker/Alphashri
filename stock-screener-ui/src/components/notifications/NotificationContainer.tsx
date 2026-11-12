import { Box } from "@/ui";
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
      className="fixed z-[10000] flex flex-col-reverse gap-2 overflow-y-auto pointer-events-auto"
      style={{
        bottom: 84,
        right: 16,
        width: "min(360px, calc(100vw - 32px))",
        "max-height": "calc(100vh - 180px)",
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
