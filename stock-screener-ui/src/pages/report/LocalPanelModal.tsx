/**
 * Local Solid-native twin of src/components/common/PanelModal.tsx (still
 * React). Same props API and data-* contract (panel-modal, panel-modal-panel,
 * panel-modal-title, panel-modal-close, panel-modal-body, panel-modal-actions,
 * data-variant, data-compact) so call sites and tests carry over unchanged.
 */
import { createEffect, onCleanup, Show } from "solid-js";
import type { JSX } from "solid-js";
import { Portal } from "@/ui/layout/Portal";
import { IconX } from "@/components/common/Icons";
import * as palette from "@/ui/palette";
import { withAlpha } from "@/utils/color";

export interface LocalPanelModalProps {
  open: boolean;
  title: JSX.Element;
  onClose: () => void;
  children: JSX.Element;
  actions?: JSX.Element;
  variant?: "modal" | "drawer";
  drawerWidth?: number;
  maxWidth?: number;
  autoHeight?: boolean;
  maxHeight?: string | number;
}

export function LocalPanelModal(props: LocalPanelModalProps) {
  const variant = () => props.variant ?? "modal";
  const isDrawer = () => variant() === "drawer";
  const compact = () => !isDrawer() && (props.autoHeight ?? false);
  const drawerWidth = () => props.drawerWidth ?? 720;
  const maxHeight = () => props.maxHeight ?? "80vh";

  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) props.onClose();
  };

  createEffect(() => {
    if (!props.open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
  });

  const drawerPanelStyle: Record<string, string> = {
    position: "absolute",
    top: "0",
    right: "0",
    width: "100%",
    "max-width": `min(${drawerWidth()}px, 74vw)`,
    height: "100%",
    overflow: "hidden",
    "background-color": palette.TERM_BG,
    color: palette.TEXT,
    border: `1px solid ${palette.TERM_BORDER}`,
    "border-right": "none",
    "box-shadow": palette.DIALOG_SHADOW,
    display: "flex",
    "flex-direction": "column",
  };

  const modalPanelStyle = (): Record<string, string> => {
    const width = props.maxWidth != null ? `min(${props.maxWidth}px, 92vw)` : "92vw";
    const m: Record<string, string> = {
      position: "absolute",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      width: width,
      "background-color": palette.TERM_BG,
      color: palette.TEXT,
      border: `1px solid ${palette.TERM_BORDER}`,
      "border-radius": "4px",
      "box-shadow": palette.DIALOG_SHADOW,
      display: "flex",
      "flex-direction": "column",
      overflow: "hidden",
    };
    if (compact()) {
      m.width = "100%";
      m["max-width"] = width;
      m["max-height"] = typeof maxHeight() === "number" ? `${maxHeight()}px` : (maxHeight() as string);
      m.height = "auto";
    } else {
      m["max-height"] = "88vh";
      m.height = "88vh";
    }
    return m;
  };

  return (
    <Show when={props.open}>
      <Portal>
        <div
          data-testid="panel-modal"
          data-variant={variant()}
          data-compact={compact() ? "true" : undefined}
          style={{
            position: "fixed",
            inset: "0",
            "z-index": 50,
            display: "flex",
            "justify-content": isDrawer() ? "flex-end" : "center",
            "align-items": isDrawer() ? "stretch" : "center",
            padding: isDrawer() ? "0" : "16px",
            "background-color": withAlpha(palette.BG, isDrawer() ? 0.18 : 0.5),
          }}
          onClick={handleBackdropClick}
          onKeyDown={(e) => {
            if (e.key === "Escape") props.onClose();
          }}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
        >
          <div
            data-testid="panel-modal-panel"
            style={isDrawer() ? drawerPanelStyle : modalPanelStyle()}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              data-testid="panel-modal-titlebar"
              style={{
                display: "flex",
                "align-items": "center",
                gap: "8px",
                padding: "12px 16px",
                "min-height": "36px",
                "flex-shrink": 0,
                "background-color": palette.TERM_HEADER,
                "border-bottom": `1px solid ${palette.TERM_BORDER}`,
              }}
            >
              <div
                data-testid="panel-modal-title"
                style={{
                  flex: "1",
                  "min-width": 0,
                  overflow: "hidden",
                  "text-overflow": "ellipsis",
                  "white-space": "nowrap",
                }}
              >
                {typeof props.title === "string" ? (
                  <span
                    class="text-[10px] font-bold uppercase leading-[1.2] tracking-[0.08em]"
                    style={{ color: palette.TEXT_MUTED }}
                  >
                    {props.title}
                  </span>
                ) : (
                  props.title
                )}
              </div>
              <button
                type="button"
                data-testid="panel-modal-close"
                aria-label="Close panel"
                onClick={() => props.onClose()}
                style={{
                  padding: "2px",
                  color: palette.TEXT_MUTED,
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                }}
              >
                <IconX size={14} />
              </button>
            </div>
            <div
              data-testid="panel-modal-body"
              style={{
                flex: compact() ? "0 1 auto" : "1",
                "min-height": 0,
                overflow: "auto",
                padding: "8px",
              }}
            >
              {props.children}
            </div>
            <Show when={props.actions}>
              <div
                data-testid="panel-modal-actions"
                style={{
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "flex-end",
                  gap: "8px",
                  padding: "12px 16px",
                  "flex-shrink": 0,
                  "border-top": `1px solid ${palette.TERM_BORDER}`,
                  "background-color": palette.TERM_HEADER,
                }}
              >
                {props.actions}
              </div>
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
