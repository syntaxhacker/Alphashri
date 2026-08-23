import MuiPortal from "@mui/material/Portal";
import type { UIPortalProps } from "../types";

export function Portal({ children, target }: UIPortalProps) {
  const container = typeof target === "string" ? (typeof document !== "undefined" ? document.querySelector(target) : undefined) : (target as HTMLElement | undefined);
  return <MuiPortal container={container as never}>{children}</MuiPortal>;
}
