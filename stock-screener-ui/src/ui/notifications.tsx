import { showToast, ToastProvider, Toaster } from "solid-notifications";
import type { JSX } from "solid-js";
import type { UIThemeNotifyProps } from "./types";

type ToastType = "default" | "success" | "error" | "warning" | "info";

function mapColorToVariant(color?: string): ToastType {
  if (!color) return "default";
  const c = String(color).toLowerCase();
  if (c === "success") return "success";
  if (c === "error" || c === "danger") return "error";
  if (c === "warning") return "warning";
  if (c === "primary" || c === "info") return "info";
  return "default";
}

/** Bottom-right stack, matching the old notistack anchor. */
const POSITION = { positionX: "right", positionY: "bottom" } as const;

export function showNotification(options: UIThemeNotifyProps) {
  showToast(options.message, {
    type: mapColorToVariant(options.color as string),
    duration:
      typeof options.autoClose === "number" ? options.autoClose : options.autoClose === false ? false : 4000,
    ...POSITION,
  });
}

export function showSuccess(title: string, message: string) {
  showToast(message || title, { type: "success", duration: 4000, ...POSITION });
}

export function showError(title: string, message: string) {
  showToast(message || title, { type: "error", duration: 5000, ...POSITION });
}

/**
 * Toast host. Mounted once at the app root — `ToastProvider` carries the
 * queue, `Toaster` renders it.
 */
export function Notifications(props: { children?: JSX.Element }) {
  return (
    <ToastProvider>
      <Toaster />
      {props.children}
    </ToastProvider>
  );
}
