import { createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import { Text } from "@/ui";
import type { DockPanelApi, DockPanelContext, DockPanelSpec } from "../dock/types";
import {
  clampToCanvas,
  DEFAULT_MIN_SIZE,
  geometryOf,
  KEYBOARD_STEP,
  rectOf,
  RESIZE_DIRS,
  resizeRect,
  sameRect,
  type CanvasSize,
  type MinSize,
  type Rect,
  type ResizeDir,
} from "./layout";
import { getPanelSpec } from "./panelRegistry";
import type { WindowState } from "./types";

export interface WindowProps {
  state: WindowState;
  /** Accessor, not a value: the desk passes one stable reference so a viewport
   * resize cannot invalidate the restore-rect frames that do not use it. */
  canvas: Accessor<CanvasSize>;
  spec?: DockPanelSpec;
  context: Accessor<DockPanelContext>;
  focused: boolean;
  locked: boolean;
  minSize?: MinSize;
  settingsSlot?: JSX.Element;
  onSettingsChange?: (id: string, patch: Record<string, unknown>) => void;
  onFocus: (id: string) => void;
  onRectChange: (id: string, rect: Rect) => void;
  onMinimize: (id: string) => void;
  onMaximize: (id: string) => void;
  onClose: (id: string) => void;
  onPopOut: (id: string) => void;
  onAnnounce?: (message: string) => void;
}

const HANDLE_CLASS: Record<ResizeDir, string> = {
  n: "absolute left-2 right-2 top-0 h-[3px] cursor-ns-resize touch-none",
  s: "absolute bottom-0 left-2 right-2 h-[3px] cursor-ns-resize touch-none",
  e: "absolute bottom-2 right-0 top-2 w-[3px] cursor-ew-resize touch-none",
  w: "absolute bottom-2 left-0 top-2 w-[3px] cursor-ew-resize touch-none",
  ne: "absolute right-0 top-0 h-[10px] w-[10px] cursor-nesw-resize touch-none",
  nw: "absolute left-0 top-0 h-[10px] w-[10px] cursor-nwse-resize touch-none",
  se: "absolute bottom-0 right-0 h-[10px] w-[10px] cursor-nwse-resize touch-none",
  sw: "absolute bottom-0 left-0 h-[10px] w-[10px] cursor-nesw-resize touch-none",
};

/**
 * One absolutely positioned frame. Geometry is rendered from `geometryOf`, so a
 * maximized window keeps its restore rect in state and never loses it on a drag
 * or a save. Pointer capture is paired with window listeners because jsdom-style
 * DOM shims do not implement capture, and capture alone would miss a fast drag.
 */
export function Window(props: WindowProps) {
  // `spec` must be a memo with reference equality: the getter reads `props.state`,
  // which changes on every layout commit (focus, sibling drag, save echo). A plain
  // getter would re-run `{spec().mount(...)}` and rebuild the panel's canvas on
  // each of those commits. Returning the same spec object keeps the panel mounted.
  const spec = createMemo(() => props.spec ?? getPanelSpec(props.state.type));
  const minSize = (): MinSize => props.minSize ?? DEFAULT_MIN_SIZE;
  // A live gesture owns geometry until pointer-up. Updating only this signal keeps
  // a 120 Hz drag to one style write on this frame instead of an onLayoutChange
  // per event (which re-rendered all siblings and re-armed the 800 ms save timer).
  const [dragRect, setDragRect] = createSignal<Rect | null>(null);
  // Only a maximized frame needs the canvas. A restore-rect frame must keep its
  // own reactive dependency set: reading canvas() for all eight windows made a
  // single viewport resize re-run every frame's geometry and style effects.
  const current = createMemo(() => {
    const drag = dragRect();
    if (drag) return drag;
    const state = props.state;
    return state.maximized ? geometryOf(state, props.canvas()) : rectOf(state);
  });
  const data = createMemo(() => spec()?.data?.(props.context));
  // The bag lives on the window state, so it is reactive across a save echo, a
  // late hydration and a tab switch that swaps this window's identity in place.
  const settings = createMemo(() => props.state.settings ?? {});
  const api: DockPanelApi = {
    data,
    commands: spec()?.commands ?? {},
    settings,
    onSettingsChange: (patch) => props.onSettingsChange?.(props.state.id, patch),
  };

  let gesture: {
    mode: "move" | "resize";
    dir: string;
    startX: number;
    startY: number;
    origin: Rect;
    last: Rect | null;
  } | null = null;

  const detach = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };
  const onUp = () => {
    const active = gesture;
    gesture = null;
    detach();
    // One commit for the whole gesture, and none at all for a click that never
    // moved. The parent sees the final rect only after the pointer is released.
    if (active?.last && !sameRect(active.last, active.origin)) {
      props.onRectChange(props.state.id, active.last);
    }
    setDragRect(null);
  };
  const onMove = (event: PointerEvent) => {
    if (!gesture) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    const origin = gesture.origin;
    let next: Rect;
    if (gesture.mode === "move") {
      next = clampToCanvas(
        { x: origin.x + dx, y: origin.y + dy, w: origin.w, h: origin.h },
        props.canvas(),
        minSize(),
      );
    } else {
      next = resizeRect(origin, gesture.dir, dx, dy, props.canvas(), minSize());
    }
    gesture.last = next;
    setDragRect(next);
  };

  const begin = (mode: "move" | "resize", event: PointerEvent, dir = "") => {
    if (props.locked || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    gesture = {
      mode,
      dir,
      startX: event.clientX,
      startY: event.clientY,
      origin: current(),
      last: null,
    };
    setDragRect(null);
    detach();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };
  onCleanup(detach);

  const onKeyDown = (event: KeyboardEvent) => {
    if (props.locked) return;
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    const dx = event.key === "ArrowRight" ? KEYBOARD_STEP
      : event.key === "ArrowLeft" ? -KEYBOARD_STEP : 0;
    const dy = event.key === "ArrowDown" ? KEYBOARD_STEP
      : event.key === "ArrowUp" ? -KEYBOARD_STEP : 0;
    if (dx === 0 && dy === 0) return;
    event.preventDefault();
    // Keyboard always operates on committed layout, never an in-flight drag rect.
    const rect = geometryOf(props.state, props.canvas());
    const next = event.shiftKey
      // Size follows the arrow: Right/Down grow, Left/Up shrink. Using the
      // east/south edges keeps the top-left corner anchored while resizing.
      ? resizeRect(rect, "es", dx, dy, props.canvas(), minSize())
      : clampToCanvas(
        { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h },
        props.canvas(),
        minSize(),
      );
    props.onRectChange(props.state.id, next);
    // The geometry helpers already enforce the floors; say what they produced so
    // a screen-reader user hears the new position instead of only seeing it move.
    props.onAnnounce?.(
      event.shiftKey
        ? `${props.state.title} resized to width ${next.w}, height ${next.h}`
        : `${props.state.title} moved to x ${next.x}, y ${next.y}`,
    );
  };

  const titleButton = (
    testId: string,
    label: () => string,
    glyph: string,
    onClick: () => void,
    danger = false,
  ) => (
    <button
      type="button"
      data-testid={testId}
      aria-label={label()}
      title={label()}
      class={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-sm leading-none text-fin-text-muted hover:bg-fin-border ${
        danger ? "hover:text-fin-negative" : ""
      }`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
    >
      <span aria-hidden="true" class="text-[11px]">{glyph}</span>
    </button>
  );

  // Focus emits a new layout on pointerdown, and `raiseToFront` replaces every
  // WindowState object. A `titleButton(...)` call in a JSX child position is a
  // reactive expression in Solid, so that emit rebuilt all four buttons while the
  // pointer was still down; the browser then synthesised `click` on the common
  // ancestor (the title bar), not the button, so a real mouse click did nothing.
  // Build the nodes once — only the labels read reactive state, updating in place.
  const titleButtons = untrack(() => [
    titleButton(
      `window-popout-${props.state.id}`,
      () => `Pop out ${props.state.title}`,
      "↗",
      () => props.onPopOut(props.state.id),
    ),
    titleButton(
      `window-minimize-${props.state.id}`,
      () => props.state.minimized ? `Restore ${props.state.title}` : `Minimize ${props.state.title}`,
      "−",
      () => props.onMinimize(props.state.id),
    ),
    titleButton(
      `window-maximize-${props.state.id}`,
      () => props.state.maximized ? `Restore down ${props.state.title}` : `Maximize ${props.state.title}`,
      "□",
      () => props.onMaximize(props.state.id),
    ),
    titleButton(
      `window-close-${props.state.id}`,
      () => `Close ${props.state.title}`,
      "×",
      () => props.onClose(props.state.id),
      true,
    ),
  ]);

  return (
    <div
      data-testid={`window-${props.state.id}`}
      data-window-id={props.state.id}
      data-focused={props.focused || undefined}
      data-minimized={props.state.minimized || undefined}
      data-maximized={props.state.maximized || undefined}
      role="region"
      aria-label={props.state.title}
      tabindex="0"
      class={`flex flex-col overflow-hidden bg-fin-surface shadow-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fin-primary ${
        // The width change keeps "which window is active" readable without colour.
        props.focused ? "border-2 border-fin-primary" : "border border-fin-border"
      }`}
      style={{
        position: "absolute",
        left: `${current().x}px`,
        top: `${current().y}px`,
        width: `${current().w}px`,
        height: `${current().h}px`,
        "z-index": String(props.state.z),
      }}
      oncapture:pointerdown={() => props.onFocus(props.state.id)}
      onKeyDown={onKeyDown}
    >
      <div
        data-testid={`window-title-${props.state.id}`}
        class={`flex h-7 shrink-0 items-center gap-1 border-b border-fin-border bg-fin-surface-alt px-2 ${
          props.locked ? "cursor-default" : "cursor-move select-none touch-none"
        }`}
        onPointerDown={(event) => begin("move", event)}
      >
        <Show when={props.settingsSlot}>
          <span data-testid={`window-settings-${props.state.id}`}>{props.settingsSlot}</span>
        </Show>
        <span class="min-w-0 flex-1 truncate text-[11px] font-bold uppercase tracking-wide text-fin-text">
          {props.state.title}
        </span>
        {titleButtons}
      </div>

      <Show when={!props.state.minimized}>
        <div
          data-testid={`window-body-${props.state.id}`}
          class="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto"
        >
          <Show
            when={spec()}
            fallback={
              <div class="flex h-full items-center justify-center p-2">
                <Text size="xs" c="dimmed">
                  Unknown panel: {props.state.type}
                </Text>
              </div>
            }
          >
            {spec()!.mount(props.context, api)}
          </Show>
        </div>
      </Show>

      <Show when={!props.locked}>
        <For each={RESIZE_DIRS}>
          {(dir) => (
            <div
              data-testid={`window-resize-${props.state.id}-${dir}`}
              data-resize-dir={dir}
              class={HANDLE_CLASS[dir]}
              onPointerDown={(event) => begin("resize", event, dir)}
            />
          )}
        </For>
      </Show>
    </div>
  );
}
