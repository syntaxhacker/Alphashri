import { showNotification } from "@/ui";

/**
 * Thin wrapper over the toast host. The callbacks are plain functions —
 * `useCallback` has no meaning in Solid, where a function defined in the
 * component body is already referentially stable.
 */
export function useNotification() {
  const show = (options: { title: string; message: string; color?: string }) => {
    showNotification({
      title: options.title,
      message: options.message,
      color: (options.color ?? "blue") as never,
    });
  };

  const success = (title: string, message: string) => show({ title, message, color: "green" });

  const error = (title: string, message: string) => show({ title, message, color: "red" });

  return { show, success, error };
}