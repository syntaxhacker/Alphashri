import { enqueueSnackbar } from "notistack";
import { SnackbarProvider } from "notistack";
import type { UIThemeNotifyProps } from "./types";

function mapColorToVariant(color?: string): "default" | "success" | "error" | "warning" | "info" {
  if (!color) return "default";
  const c = String(color).toLowerCase();
  if (c === "green" || c === "success") return "success";
  if (c === "red" || c === "error" || c === "danger") return "error";
  if (c === "orange" || c === "yellow" || c === "warning") return "warning";
  if (c === "blue" || c === "info" || c === "cyan" || c === "teal") return "info";
  return "default";
}

export function showNotification(options: UIThemeNotifyProps) {
  const variant = mapColorToVariant(options.color as string);
  enqueueSnackbar(options.message, {
    variant,
    autoHideDuration: typeof options.autoClose === "number" ? options.autoClose : options.autoClose === false ? null : 4000,
    anchorOrigin: { vertical: "bottom", horizontal: "right" },
  } as any);
  // Title is ignored by notistack; could prepend if present
  if (options.title) {
    // Optionally could show title via custom, but keep simple
  }
}

export function showSuccess(title: string, message: string) {
  enqueueSnackbar(message || title, { variant: "success", autoHideDuration: 4000, anchorOrigin: { vertical: "bottom", horizontal: "right" } } as any);
}

export function showError(title: string, message: string) {
  enqueueSnackbar(message || title, { variant: "error", autoHideDuration: 5000, anchorOrigin: { vertical: "bottom", horizontal: "right" } } as any);
}

export { SnackbarProvider as Notifications };
