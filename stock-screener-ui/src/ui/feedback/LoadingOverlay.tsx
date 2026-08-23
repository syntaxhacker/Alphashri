import Backdrop from "@mui/material/Backdrop";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";
import type { UILoadingOverlayProps } from "../types";

export function LoadingOverlay({
  visible,
  loaderProps,
  overlayProps,
  zIndex,
  className,
  style,
  "data-testid": testId,
  id,
  children,
  ...rest
}: UILoadingOverlayProps) {
  if (!visible) return null;

  return (
    <Backdrop
      open={visible}
      className={className}
      style={style}
      id={id}
      data-testid={testId}
      sx={{
        position: "absolute",
        inset: 0,
        zIndex: zIndex as never,
        bgcolor: overlayProps?.color ? (overlayProps.color as string) : "rgba(255,255,255,0.6)",
        opacity: overlayProps?.opacity,
        backdropFilter:
          overlayProps?.blur != null
            ? `blur(${typeof overlayProps.blur === "number" ? `${overlayProps.blur}px` : overlayProps.blur})`
            : undefined,
        borderRadius: "inherit",
      }}
      {...(rest as Record<string, unknown>)}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress size={loaderProps?.size as number | undefined} sx={loaderProps?.color ? { color: loaderProps.color as string } : undefined} />
      </Box>
      {children}
    </Backdrop>
  );
}
