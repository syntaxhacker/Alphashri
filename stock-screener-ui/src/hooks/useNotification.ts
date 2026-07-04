import { useCallback } from "react";
import { showNotification } from "@/ui";

export function useNotification() {
  const show = useCallback((options: { title: string; message: string; color?: string }) => {
    showNotification({
      title: options.title,
      message: options.message,
      color: (options.color ?? "blue") as any,
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
