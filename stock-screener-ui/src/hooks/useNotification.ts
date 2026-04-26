import { useCallback } from "react";
import { notifications } from "@mantine/notifications";

export function useNotification() {
  const show = useCallback((options: { title: string; message: string; color?: string }) => {
    notifications.show({
      title: options.title,
      message: options.message,
      color: options.color ?? "blue",
    });
  }, []);

  const success = useCallback(
    (title: string, message: string) => show({ title, message, color: "green" }),
    [show],
  );

  const error = useCallback(
    (title: string, message: string) => show({ title, message, color: "red" }),
    [show],
  );

  return { show, success, error };
}
