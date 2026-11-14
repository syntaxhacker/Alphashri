import { For, Show } from "solid-js";
import { Box } from "@/ui";
import { useAppDispatch, useAppSelector } from "../../state/store/hooks";
import { removeNotification } from "../../state/store/notificationsSlice";
import { NotificationItem } from "./Notification";

export function NotificationContainer() {
  const dispatch = useAppDispatch();
  // An accessor: the store is read live, so a notification added later renders.
  const notifications = useAppSelector((state) => state.notifications.items);

  const handleDismiss = (id: string) => {
    dispatch(removeNotification(id));
  };

  return (
    <Show when={notifications().length > 0}>
      <Box
        role="region"
        aria-label="Notifications"
        id="notification-container"
        data-testid="notification-container"
        className="fixed z-[10000] flex flex-col-reverse gap-2 overflow-y-auto pointer-events-auto"
        style={{
          bottom: "84px",
          right: "16px",
          width: "min(360px, calc(100vw - 32px))",
          "max-height": "calc(100vh - 180px)",
        }}
      >
        <For each={notifications()}>
          {(notification) => (
            <NotificationItem
              notification={notification}
              onDismiss={handleDismiss}
            />
          )}
        </For>
      </Box>
    </Show>
  );
}