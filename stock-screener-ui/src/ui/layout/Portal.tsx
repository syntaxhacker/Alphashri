import { Portal as MantinePortal } from "@mantine/core";
import type { UIPortalProps } from "../types";

export function Portal({ children, target }: UIPortalProps) {
  return <MantinePortal target={target as any}>{children}</MantinePortal>;
}
