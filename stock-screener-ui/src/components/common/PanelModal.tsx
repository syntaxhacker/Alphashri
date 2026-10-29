import type { ReactNode } from "react";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import Box from "@mui/material/Box";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import { IconX } from "@tabler/icons-react";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";

export interface PanelModalProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  /**
   * `drawer` docks the shell to the right edge: full viewport height, fixed
   * ~720px rail on desktop, square edge. Used by the gamma/positions read-outs
   * so they read as a side panel rather than a second full-screen dialog.
   */
  variant?: "modal" | "drawer";
  /**
   * Desktop paper width in px. Defaults to the full-width 92vw shell; a
   * compact dialog passes e.g. 1040 to cap a content-hugging panel.
   */
  maxWidth?: number;
  /** Hug the content (height auto) instead of filling 88vh. */
  autoHeight?: boolean;
  /** Cap applied when `autoHeight` is set; defaults to 80vh. */
  maxHeight?: string | number;
}

/**
 * Desk-mode shell: one panel at a time, 92vw × 88vh on desktop, full-screen on
 * phones. `autoHeight` switches to a centered content-hugging dialog (capped
 * by `maxHeight`). `Dialog` owns focus trap + `Esc` (via `onClose`); the body
 * is the only scroller so the title bar never leaves the viewport.
 */
export function PanelModal({
  open,
  title,
  onClose,
  children,
  actions,
  variant = "modal",
  maxWidth,
  autoHeight = false,
  maxHeight = "80vh",
}: PanelModalProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const isDrawer = variant === "drawer";
  const compact = !isDrawer && autoHeight;
  const width = maxWidth != null ? `min(${maxWidth}px, 92vw)` : "92vw";

  return (
    <Dialog
      data-testid="panel-modal"
      data-variant={variant}
      data-compact={compact ? "true" : undefined}
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullScreen={fullScreen}
      sx={
        isDrawer
          ? {
              "& .MuiDialog-container": {
                justifyContent: "flex-end",
                alignItems: "stretch",
                p: 0,
              },
            }
          : undefined
      }
      slotProps={{
        paper: {
          sx: {
            width: isDrawer
              ? { xs: "100%", lg: 720 }
              : compact
                ? { xs: "100%", lg: width }
                : { xs: "100%", lg: "92vw" },
            maxWidth: isDrawer
              ? { lg: 720 }
              : compact && maxWidth != null
                ? { lg: maxWidth }
                : { lg: "92vw" },
            height: isDrawer
              ? { lg: "100%" }
              : compact
                ? "auto"
                : { lg: "88vh" },
            maxHeight: isDrawer
              ? { lg: "100%" }
              : compact
                ? maxHeight
                : { xs: "100%", lg: "88vh" },
            m: isDrawer ? 0 : undefined,
            bgcolor: palette.TERM_BG,
            color: palette.TEXT,
            border: `1px solid ${palette.TERM_BORDER}`,
            borderRight: isDrawer ? "none" : `1px solid ${palette.TERM_BORDER}`,
            borderRadius: isDrawer ? 0 : "4px",
            boxShadow: palette.DIALOG_SHADOW,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          },
        },
      }}
    >
      <Box
        data-testid="panel-modal-titlebar"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          minHeight: 36,
          flexShrink: 0,
          bgcolor: palette.TERM_HEADER,
          borderBottom: `1px solid ${palette.TERM_BORDER}`,
        }}
      >
        <Box
          data-testid="panel-modal-title"
          sx={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {typeof title === "string" ? (
            <Text
              span
              size="xs"
              fw={700}
              style={{
                fontSize: 10,
                lineHeight: 1.2,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: palette.TEXT_MUTED,
              }}
            >
              {title}
            </Text>
          ) : (
            title
          )}
        </Box>
        <IconButton
          data-testid="panel-modal-close"
          aria-label="Close panel"
          size="small"
          onClick={onClose}
          sx={{ p: "2px", color: palette.TEXT_MUTED, "&:hover": { color: palette.TEXT } }}
        >
          <IconX size={14} />
        </IconButton>
      </Box>
      <Box
        data-testid="panel-modal-body"
        sx={{
          flex: compact ? "0 1 auto" : 1,
          minHeight: 0,
          overflow: "auto",
          p: 1,
        }}
      >
        {children}
      </Box>
      {actions ? (
        <Box
          data-testid="panel-modal-actions"
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 1,
            px: 1.5,
            py: 1,
            flexShrink: 0,
            borderTop: `1px solid ${palette.TERM_BORDER}`,
            bgcolor: palette.TERM_HEADER,
          }}
        >
          {actions}
        </Box>
      ) : null}
    </Dialog>
  );
}
