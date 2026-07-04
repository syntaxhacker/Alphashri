import { notifications } from "@mantine/notifications";
import type { UIThemeNotifyProps } from "./types";

export function showNotification(options: UIThemeNotifyProps) {
  notifications.show({
    title: options.title,
    message: options.message,
    color: options.color as string,
    icon: options.icon as any,
    autoClose: options.autoClose,
    withCloseButton: options.withCloseButton,
  });
}

export function showSuccess(title: string, message: string) {
  notifications.show({ title, message, color: "green" });
}

export function showError(title: string, message: string) {
  notifications.show({ title, message, color: "red" });
}

export { Notifications } from "@mantine/notifications";
