import * as React from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import type { UIModalProps } from "../types";

const sizeMap: Record<string, "xs" | "sm" | "md" | "lg" | "xl"> = {
  xs: "xs",
  sm: "sm",
  md: "md",
  lg: "lg",
  xl: "xl",
};

export function Modal({
  children,
  opened,
  onClose,
  title,
  size,
  fullScreen,
  centered,
  withCloseButton = true,
  closeOnClickOutside = true,
  closeOnEscape = true,
  overlayProps,
  padding,
  transitionProps,
  className,
  style,
  "data-testid": testId,
  ...rest
}: UIModalProps) {
  const maxWidth =
    typeof size === "string" && sizeMap[size] ? sizeMap[size] : sizeMap.md;
  // numeric/string custom sizes are handled via sx maxWidth; for xs-xl use maxWidth prop
  const isPresetSize = typeof size === "string" && size in sizeMap;
  const customMaxWidth =
    !isPresetSize && size != null ? (typeof size === "number" ? `${size}px` : String(size)) : undefined;

  const handleClose = (_e: unknown, reason: string) => {
    if (reason === "backdropClick" && !closeOnClickOutside) return;
    if (reason === "escapeKeyDown" && !closeOnEscape) return;
    onClose();
  };

  return (
    <Dialog
      open={opened}
      onClose={handleClose}
      maxWidth={isPresetSize ? maxWidth : false}
      fullScreen={!!fullScreen}
      fullWidth
      className={className}
      style={style}
      data-testid={testId}
      disableEscapeKeyDown={!closeOnEscape}
      slotProps={{
        backdrop: overlayProps
          ? {
              sx: {
                bgcolor: overlayProps.color
                  ? overlayProps.color
                  : undefined,
                opacity: overlayProps.opacity,
                backdropFilter:
                  overlayProps.blur != null
                    ? `blur(${typeof overlayProps.blur === "number" ? `${overlayProps.blur}px` : overlayProps.blur})`
                    : undefined,
              },
            }
          : undefined,
        paper: {
          sx: {
            ...(customMaxWidth ? { maxWidth: customMaxWidth } : {}),
            ...(centered
              ? { m: "auto" }
              : {}),
            ...(padding != null
              ? { p: typeof padding === "number" ? `${padding}px` : padding }
              : {}),
          },
        },
      }}
      sx={{
        ...(centered ? { "& .MuiDialog-container": { alignItems: "center" } } : {}),
      }}
      {...(rest as any)}
    >
      {(title || withCloseButton) && (
        <DialogTitle
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            pr: withCloseButton ? 5 : undefined,
          }}
        >
          <span>{title}</span>
          {withCloseButton && (
            <IconButton
              aria-label="close"
              onClick={onClose}
              size="small"
              sx={{ position: "absolute", right: 8, top: 8 }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          )}
        </DialogTitle>
      )}
      <DialogContent
        dividers={!!title}
        sx={{
          ...(padding != null
            ? { p: typeof padding === "number" ? `${padding}px` : padding }
            : {}),
        }}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}
