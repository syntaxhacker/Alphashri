import { useCallback, useEffect } from "react";
import { Portal } from "@/ui/layout/Portal";
import { IconX } from "@tabler/icons-react";
import * as palette from "@/ui/palette";
import { withAlpha } from "@/utils/color";
import { Box, Text } from "@/ui";

export interface PanelModalProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  /** `drawer` docks the shell to the right edge: full viewport height, rail
   *  pinned to `drawerWidth` (capped at 74vw) on desktop, square edge. Used by
   *  the gamma/positions read-outs so they read as a side panel rather than a
   *  second full-screen dialog. */
  variant?: "modal" | "drawer";
  /** Desktop drawer width in px. Defaults to 720; the paper is capped at
   *  `min(drawerWidth, 74vw)` so the report stays visible beside the drawer. */
  drawerWidth?: number;
  /** Desktop paper width in px. Defaults to the full-width 92vw shell; a
   *  compact dialog passes e.g. 1040 to cap a content-hugging panel. */
  maxWidth?: number;
  /** Hug the content (height auto) instead of filling 88vh. */
  autoHeight?: boolean;
  /** Cap applied when `autoHeight` is set; defaults to 80vh. */
  maxHeight?: string | number;
}

const DIALOG_SHADOW = palette.DIALOG_SHADOW;

/**
 * Desk-mode shell: one panel at a time, 92vw × 88vh on desktop, full-screen on
 * phones. `autoHeight` switches to a centered content-hugging dialog (capped
 * by `maxHeight`). The body is the only scroller so the title bar never leaves
 * the viewport.
 */
export function PanelModal({
  open,
  title,
  onClose,
  children,
  actions,
  variant = "modal",
  maxWidth,
  drawerWidth,
  autoHeight = false,
  ["max-height"] = "80vh",
}: PanelModalProps) {
  const isDrawer = variant === "drawer";
  const compact = !isDrawer && autoHeight;
  const width = maxWidth != null ? `min(${maxWidth}px, 92vw)` : "92vw";

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [open, handleKeyDown]);

  if (!open) return null;

  const drawerPanelStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    right: 0,
    width: "100%",
    "max-width": `min(${drawerWidth ?? 720}px, 74vw)`,
    height: "100%",
    "max-height": "100%",
    "background-color": palette.TERM_BG,
    color: palette.TEXT,
    border: `1px solid ${palette.TERM_BORDER}`,
    borderRight: "none",
    "border-radius": 0,
    "box-shadow": DIALOG_SHADOW,
    display: "flex",
    "flex-direction": "column",
    overflow: "hidden",
  };

  const modalPanelStyle: React.CSSProperties = {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: compact ? "100%" : width,
    "max-width": compact ? width : undefined,
    "max-height": compact ? (typeof ["max-height"] === "number" ? `${maxHeight}px` : maxHeight) : "88vh",
    height: compact ? "auto" : "88vh",
    "background-color": palette.TERM_BG,
    color: palette.TEXT,
    border: `1px solid ${palette.TERM_BORDER}`,
    "border-radius": "4px",
    "box-shadow": DIALOG_SHADOW,
    display: "flex",
    "flex-direction": "column",
    overflow: "hidden",
  };

  const backdropStyle: React.CSSProperties = isDrawer
    ? { "background-color": withAlpha(palette.BG, 0.18) }
    : { "background-color": withAlpha(palette.BG, 0.5) };

  const titlebarStyle: React.CSSProperties = {
    display: "flex",
    "align-items": "center",
    gap: 8,
    padding: "12px 16px",
    "min-height": 36,
    "flex-shrink": 0,
    "background-color": palette.TERM_HEADER,
    borderBottom: `1px solid ${palette.TERM_BORDER}`,
  };

  const titleStyle: React.CSSProperties = {
    flex: 1,
    "min-width": 0,
    overflow: "hidden",
    "text-overflow": "ellipsis",
    "white-space": "nowrap",
  };

  const bodyStyle: React.CSSProperties = {
    flex: compact ? "0 1 auto" : 1,
    "min-height": 0,
    overflow: "auto",
    padding: 8,
  };

  const actionsStyle: React.CSSProperties = {
    display: "flex",
    "align-items": "center",
    "justify-content": "flex-end",
    gap: 8,
    padding: "12px 16px",
    "flex-shrink": 0,
    borderTop: `1px solid ${palette.TERM_BORDER}`,
    "background-color": palette.TERM_HEADER,
  };

  const closeButtonStyle: React.CSSProperties = {
    padding: "2px",
    color: palette.TEXT_MUTED,
    border: "none",
    background: "none",
    "border-radius": 0,
    cursor: "pointer",
  };

  const titleText = typeof title === "string" ? (
    <Text
      span
      size="xs"
      fw={700}
      style={{
        "font-size": 10,
        "line-height": 1.2,
        "letter-spacing": "0.08em",
        "text-transform": "uppercase",
        color: palette.TEXT_MUTED,
      }}
    >
      {title}
    </Text>
  ) : (
    title
  );

  return (
    <Portal>
      <div
        data-testid="panel-modal"
        data-variant={variant}
        data-compact={compact ? "true" : undefined}
        style={{
          position: "fixed",
          inset: 0,
          "z-index": 50,
          display: "flex",
          "justify-content": isDrawer ? "flex-end" : "center",
          "align-items": isDrawer ? "stretch" : "center",
          padding: isDrawer ? 0 : 16,
          ...backdropStyle,
        }}
        onClick={handleBackdropClick}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <div
          data-testid="panel-modal-panel"
          style={isDrawer ? drawerPanelStyle : modalPanelStyle}
          className="flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <Box
            data-testid="panel-modal-titlebar"
            style={titlebarStyle}
          >
            <Box
              data-testid="panel-modal-title"
              style={titleStyle}
            >
              {titleText}
            </Box>
            <button
              type="button"
              data-testid="panel-modal-close"
              aria-label="Close panel"
              onClick={onClose}
              style={closeButtonStyle}
            >
              <IconX size={14} />
            </button>
          </Box>
          <Box
            data-testid="panel-modal-body"
            style={bodyStyle}
          >
            {children}
          </Box>
          {actions ? (
            <Box
              data-testid="panel-modal-actions"
              style={actionsStyle}
            >
              {actions}
            </Box>
          ) : null}
        </div>
      </div>
    </Portal>
  );
}
