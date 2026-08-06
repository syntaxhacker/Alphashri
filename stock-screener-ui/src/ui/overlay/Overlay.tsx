import { Overlay as MantineOverlay } from "@mantine/core";
import type { UIOverlayProps } from "../types";

export function Overlay({ color, opacity, blur, zIndex, fixed, center, children, className, style, "data-testid": testId, ...rest }: UIOverlayProps) {
  return <MantineOverlay color={color} opacity={opacity} blur={blur} zIndex={zIndex} fixed={fixed} center={center} className={className} style={style} data-testid={testId} {...rest}>{children}</MantineOverlay>;
}
