import { createPortal } from "react-dom";
import type { UIPortalProps } from "../types";

export function Portal({ children, target }: UIPortalProps) {
  const container = typeof target === "string" ? (typeof document !== "undefined" ? document.querySelector(target) : undefined) : (target as HTMLElement | undefined);
  const targetEl = container ?? document.body;
  return createPortal(<>{children}</>, targetEl);
}
