import * as React from "react";
import Backdrop from "@mui/material/Backdrop";
import Box from "@mui/material/Box";
import type { UIOverlayProps } from "../types";

function colorWithOpacity(color: string | undefined, opacity: number | undefined): string | undefined {
  if (!color) return undefined;
  if (opacity == null) return color;
  // If color is hex, convert to rgba via inline style trick: let CSS handle via opacity prop.
  // Instead we set bgcolor to color and also opacity style; MUI Backdrop supports both.
  // Return color as-is; opacity handled separately.
  return color;
}

export function Overlay({
  color,
  opacity,
  blur,
  zIndex,
  fixed,
  center,
  children,
  className,
  style,
  "data-testid": testId,
  ...rest
}: UIOverlayProps) {
  const bgcolor = colorWithOpacity(color as string, opacity);
  return (
    <Backdrop
      open
      className={className}
      style={style}
      data-testid={testId}
      sx={[
        {
          position: fixed ? "fixed" : "absolute",
          inset: 0,
          bgcolor: bgcolor ?? "rgba(0,0,0,0.5)",
          opacity: opacity != null && !color ? opacity : undefined,
          // When color is provided with opacity, MUI's bgcolor alpha is color itself; we also set opacity for overlay blending
          ...(bgcolor && opacity != null ? { opacity } : {}),
          backdropFilter: blur != null ? `blur(${typeof blur === "number" ? `${blur}px` : blur})` : undefined,
          zIndex: zIndex as any,
          display: center ? "flex" : undefined,
          alignItems: center ? "center" : undefined,
          justifyContent: center ? "center" : undefined,
          borderRadius: "inherit",
        },
        ...(Array.isArray(style) ? [] : []),
      ]}
      {...(rest as any)}
    >
      {children ? <Box sx={{ display: center ? "flex" : "block", alignItems: center ? "center" : undefined, justifyContent: center ? "center" : undefined }}>{children}</Box> : null}
    </Backdrop>
  );
}
