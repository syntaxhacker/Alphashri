import { Show, createEffect, onCleanup, type CSSProperties, type JSX } from "solid-js";
import { Portal } from "@/ui/layout/Portal";
import { IconX } from "./Icons";
import * as palette from "@/ui/palette";
import { withAlpha } from "@/utils/color";
import { Box, Text } from "@/ui";

export interface PanelModalProps {
  open: boolean;
  title: JSX.Element;
  onClose: () => void;
  children?: JSX.Element;
  actions?: JSX.Element;
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
export function PanelModal(props: PanelModalProps) {
  const isDrawer = () => props.variant === "drawer";
  const compact = () => !isDrawer() && (props.autoHeight ?? false);
  const maxHeight = () => props.maxHeight ?? "80vh";
  const width = () =>
    props.maxWidth != null ? `min(${props.maxWidth}px, 92vw)` : "92vw";

  createEffect(() => {
    if (!props.open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", handler);
    onCleanup(() => document.removeEventListener("keydown", handler));
  });

  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) props.onClose();
  };

  const maxHeightValue = () =>
    typeof maxHeight() === "number" ? `${maxHeight()}px` : (maxHeight() as string);

  const drawerPanelStyle: CSSProperties = {
    position: "absolute",
    top: 0,
    right: 0,
    width: "100%",
    maxWidth: `min(${props.drawerWidth ?? 720}px, 74vw)`,
    height: "100%",
    maxHeight: "100%",
    backgroundColor: palette.TERM_BG,
    color: palette.TEXT,
    border: `1px solid ${palette.TERM_BORDER}`,
    borderRight: "none",
    borderRadius: 0,
    boxShadow: DIALOG_SHADOW,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  };

  const modalPanelStyle: CSSProperties = {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: compact() ? "100%" : width(),
    maxWidth: compact() ? width() : undefined,
    maxHeight: compact() ? maxHeightValue() : "88vh",
    height: compact() ? "auto" : "88vh",
    backgroundColor: palette.TERM_BG,
    color: palette.TEXT,
    border: `1px solid ${palette.TERM_BORDER}`,
    borderRadius: "4px",
    boxShadow: DIALOG_SHADOW,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  };

  const backdropStyle: CSSProperties = isDrawer()
    ? { backgroundColor: withAlpha(palette.BG, 0.18) }
    : { backgroundColor: withAlpha(palette.BG, 0.5) };

  const titlebarStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 16px",
    minHeight: 36,
    flexShrink: 0,
    backgroundColor: palette.TERM_HEADER,
    borderBottom: `1px solid ${palette.TERM_BORDER}`,
  };

  const titleStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  const bodyStyle: CSSProperties = {
    flex: compact() ? "0 1 auto" : 1,
    minHeight: 0,
    overflow: "auto",
    padding: 8,
  };

  const actionsStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    padding: "12px 16px",
    flexShrink: 0,
    borderTop: `1px solid ${palette.TERM_BORDER}`,
    backgroundColor: palette.TERM_HEADER,
  };

  const closeButtonStyle: CSSProperties = {
    padding: "2px",
    color: palette.TEXT_MUTED,
    border: "none",
    background: "none",
    borderRadius: 0,
    cursor: "pointer",
  };

  return (
    <Show when={props.open}>
      {() => (
      <Portal>
        <div
          data-testid="panel-modal"
          data-variant={props.variant ?? "modal"}
          data-compact={compact() ? "true" : undefined}
          style={{
            position: "fixed",
            inset: "0px",
            "z-index": 50,
            display: "flex",
            "justify-content": isDrawer() ? "flex-end" : "center",
            "align-items": isDrawer() ? "stretch" : "center",
            padding: isDrawer() ? 0 : "16px",
            ...backdropStyle,
          }}
          onClick={handleBackdropClick}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
        >
          <div
            data-testid="panel-modal-panel"
            style={isDrawer() ? drawerPanelStyle : modalPanelStyle}
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
                {typeof props.title === "string" ? (
                  <Text
                    span
                    size="xs"
                    fw={700}
                    style={{
                      "font-size": "10px",
                      "line-height": 1.2,
                      "letter-spacing": "0.08em",
                      "text-transform": "uppercase",
                      color: palette.TEXT_MUTED,
                    }}
                  >
                    {props.title as string}
                  </Text>
                ) : (
                  props.title
                )}
              </Box>
              <button
                type="button"
                data-testid="panel-modal-close"
                aria-label="Close panel"
                onClick={props.onClose}
                style={closeButtonStyle}
              >
                <IconX size={14} />
              </button>
            </Box>
            <Box
              data-testid="panel-modal-body"
              style={bodyStyle}
            >
              {props.children}
            </Box>
            <Show when={props.actions}>
              <Box
                data-testid="panel-modal-actions"
                style={actionsStyle}
              >
                {props.actions}
              </Box>
            </Show>
          </div>
        </div>
      </Portal>
      )}
    </Show>
  );
}
