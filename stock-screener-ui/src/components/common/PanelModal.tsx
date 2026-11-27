import { Show, type JSX } from "solid-js";
import { Box, Modal, Text, typeSize } from "@/ui";
import * as palette from "@/ui/palette";
import { withAlpha } from "@/utils/color";

type CSSProperties = JSX.CSSProperties;

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

/**
 * Panel chrome over @/ui Modal. The overlay, focus cycle, Escape, backdrop and
 * background inertness all belong to Modal; this component only adds the
 * title/body/actions layout and the drawer sizing the report desk needs.
 */
export function PanelModal(props: PanelModalProps) {
  const isDrawer = () => props.variant === "drawer";
  const compact = () => !isDrawer() && (props.autoHeight ?? false);
  const maxHeightValue = () => props.maxHeight ?? "80vh";
  const panelWidth = () =>
    props.maxWidth != null ? `min(${props.maxWidth}px, 92vw)` : "92vw";

  const panelStyle = (): CSSProperties => ({
    "background-color": palette.TERM_BG,
    color: palette.TEXT,
    border: `1px solid ${palette.TERM_BORDER}`,
    "box-shadow": palette.DIALOG_SHADOW,
    display: "flex",
    "flex-direction": "column",
    overflow: "hidden",
    ...(isDrawer()
      ? {
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: "100%",
          "max-width": `min(${props.drawerWidth ?? 720}px, 74vw)`,
          height: "100%",
          "max-height": "100%",
          "border-right": "none",
          "border-radius": 0,
        }
      : {
          width: compact() ? "100%" : panelWidth(),
          "max-width": compact() ? panelWidth() : undefined,
          height: compact() ? "auto" : "88vh",
          "max-height": compact()
            ? typeof maxHeightValue() === "number"
              ? `${maxHeightValue()}px`
              : (maxHeightValue() as string)
            : "88vh",
          "border-radius": "4px",
        }),
  });

  const titleStyle: CSSProperties = {
    flex: 1,
    "min-width": 0,
    overflow: "hidden",
    "text-overflow": "ellipsis",
    "white-space": "nowrap",
  };

  const bodyStyle = (): CSSProperties => ({
    flex: compact() ? "0 1 auto" : 1,
    "min-height": 0,
    overflow: "auto",
    padding: "8px",
  });

  const actionsStyle: CSSProperties = {
    display: "flex",
    "align-items": "center",
    "justify-content": "flex-end",
    gap: "8px",
    padding: "12px 16px",
    "flex-shrink": 0,
    "border-top": `1px solid ${palette.TERM_BORDER}`,
    "background-color": palette.TERM_HEADER,
  };

  // One stable node: Modal reads `title` several times, and re-creating this
  // wrapper on every read would move the caller's title node out of the slot.
  const titleNode: JSX.Element = (
    <div
      data-testid="panel-modal-titlebar"
      class="flex min-h-9 items-center gap-2"
    >
      <div data-testid="panel-modal-title" style={titleStyle}>
        <Show when={typeof props.title === "string"} fallback={props.title}>
          <Text
            span
            size="xs"
            fw={700}
            style={{
              "font-size": `${typeSize("micro")}px`,
              "line-height": 1.2,
              "letter-spacing": "0.08em",
              "text-transform": "uppercase",
              color: palette.TEXT_MUTED,
            }}
          >
            {props.title as string}
          </Text>
        </Show>
      </div>
    </div>
  );

  return (
    <Modal
      opened={props.open}
      onClose={props.onClose}
      data-testid="panel-modal"
      {...({
        "data-variant": props.variant ?? "modal",
        "data-compact": compact() ? "true" : undefined,
      } as Record<string, unknown>)}
      title={titleNode}
      padding={0}
      overlayProps={{ color: withAlpha(palette.BG, isDrawer() ? 0.18 : 0.5) }}
      style={panelStyle()}
      className={isDrawer() ? "justify-end items-stretch" : undefined}
    >
      <div
        data-testid="panel-modal-panel"
        class="flex min-h-0 flex-col"
        style={{ height: "100%" }}
      >
        <Box data-testid="panel-modal-body" style={bodyStyle()}>
          {props.children}
        </Box>
        <Show when={props.actions}>
          <Box data-testid="panel-modal-actions" style={actionsStyle}>
            {props.actions}
          </Box>
        </Show>
      </div>
    </Modal>
  );
}
