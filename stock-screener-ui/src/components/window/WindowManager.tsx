import { createMemo, createSignal, Index, onCleanup, onMount } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import { Text } from "@/ui";
import type { DockPanelContext, DockPanelSpec } from "../dock/types";
import {
  DEFAULT_WINDOW_SIZE,
  fitAllToScreen,
  maximize,
  raiseToFront,
  restore,
  type CanvasSize,
  type Rect,
} from "./layout";
import { openPanelPopOut, WINDOW_PANELS } from "./panelRegistry";
import type { WindowLayout, WindowState } from "./types";
import { Window } from "./Window";

export interface WindowManagerProps {
  layout: WindowLayout;
  context: Accessor<DockPanelContext>;
  onLayoutChange: (next: WindowLayout) => void;
  /** Reports the measured canvas so a first-run seed can be sized from the real box. */
  onCanvasChange?: (size: CanvasSize) => void;
  canvas?: CanvasSize;
  specs?: DockPanelSpec[];
  lockedInitially?: boolean;
  settingsSlot?: (win: WindowState) => JSX.Element;
}

/**
 * The canvas is a desktop, not a flex row: windows are absolutely positioned at
 * arbitrary x/y and overlap by z-index. This is an explicit exception to the
 * repo's "no fixed heights in flex panels" rule — that rule governs flex panes,
 * not a coordinate space. The canvas itself never scrolls; off-screen windows
 * are recovered with Fit all, not by scrolling the page.
 */
export function WindowManager(props: WindowManagerProps) {
  let canvasEl: HTMLDivElement | undefined;
  const [measured, setMeasured] = createSignal<CanvasSize>(
    props.canvas ?? DEFAULT_WINDOW_SIZE,
  );
  const rawCanvas = (): CanvasSize => props.canvas ?? measured();
  // A ResizeObserver can report the same box repeatedly (layout thrash, polyfills).
  // Preserve the object identity when the numbers agree: every frame used to see
  // a fresh canvas and re-run its geometry/style effects on every notification.
  const canvas = createMemo<CanvasSize, CanvasSize>((prev) => {
    const size = rawCanvas();
    return prev && prev.w === size.w && prev.h === size.h ? prev : size;
  }, rawCanvas());
  // One stable accessor for all panels, even if the host swaps its own later.
  const context: Accessor<DockPanelContext> = () => props.context();
  const [focusedId, setFocusedId] = createSignal<string | null>(null);
  const [locked, setLocked] = createSignal(props.lockedInitially ?? false);
  const [liveMessage, setLiveMessage] = createSignal("");
  const announce = (message: string) => setLiveMessage(message);
  const titleOf = (id: string) => props.layout.windows.find((w) => w.id === id)?.title ?? id;

  onMount(() => {
    if (props.canvas) {
      props.onCanvasChange?.(props.canvas);
      return;
    }
    const update = () => {
      const size = {
        w: canvasEl?.clientWidth || (typeof window !== "undefined" ? window.innerWidth : 0) || 1280,
        h: canvasEl?.clientHeight || (typeof window !== "undefined" ? window.innerHeight : 0) || 800,
      };
      const prev = measured();
      if (prev.w !== size.w || prev.h !== size.h) setMeasured(size);
      props.onCanvasChange?.(size);
    };
    update();
    if (typeof ResizeObserver !== "undefined" && canvasEl) {
      const observer = new ResizeObserver(update);
      observer.observe(canvasEl);
      onCleanup(() => observer.disconnect());
    }
  });

  const byId = createMemo(() => new Map((props.specs ?? WINDOW_PANELS).map((s) => [s.id, s])));
  const emit = (windows: WindowState[]) =>
    props.onLayoutChange({ ...props.layout, windows });

  const focus = (id: string) => {
    setFocusedId(id);
    emit(raiseToFront(props.layout.windows, id));
  };

  // Untouched windows keep their object identity. A focus or a single rect commit
  // then re-renders one frame instead of all of them: every sibling's `state` prop
  // stays referentially equal, so Solid skips its reactive updates.
  const patch = (id: string, change: (win: WindowState) => WindowState) =>
    emit(props.layout.windows.map((w) => (w.id === id ? change(w) : w)));

  const updateRect = (id: string, rect: Rect) => patch(id, (w) => ({ ...w, ...rect }));
  /**
   * A panel settings patch goes through the same `emit` as a rect commit, so it
   * inherits the one debounced PUT in the saved-config store. Sibling windows
   * keep their object identity; only the target window gets a new bag.
   */
  const updateSettings = (id: string, patchBag: Record<string, unknown>) =>
    patch(id, (w) => ({ ...w, settings: { ...w.settings, ...patchBag } }));
  const toggleMinimize = (id: string) => {
    const title = titleOf(id);
    const wasMinimized = props.layout.windows.find((w) => w.id === id)?.minimized === true;
    patch(id, (w) => ({ ...w, minimized: !w.minimized }));
    announce(`${title} ${wasMinimized ? "restored" : "minimized"}`);
  };
  const toggleMaximize = (id: string) => {
    const title = titleOf(id);
    const wasMaximized = props.layout.windows.find((w) => w.id === id)?.maximized === true;
    emit(
      wasMaximized
        ? restore(props.layout.windows, id)
        : maximize(props.layout.windows, id, canvas()),
    );
    announce(`${title} ${wasMaximized ? "restored down" : "maximized"}`);
  };
  const close = (id: string) => {
    const title = titleOf(id);
    emit(props.layout.windows.filter((w) => w.id !== id));
    announce(`${title} closed`);
  };

  const popOut = (id: string) => {
    const target = props.layout.windows.find((w) => w.id === id);
    if (!target) return;
    openPanelPopOut(byId().get(target.type), target.title, context());
  };

  const fitAll = () => {
    emit(fitAllToScreen(props.layout.windows, canvas()));
    announce("All windows fitted to screen");
  };

  return (
    <div data-testid="window-manager" class="flex h-full min-h-0 w-full flex-col">
      <div
        data-testid="window-manager-toolbar"
        class="flex h-8 shrink-0 items-center gap-2 border-b border-fin-border px-2"
      >
        <Text size="xs" fw={700}>
          DESK
        </Text>
        <button
          type="button"
          data-testid="window-fit-all"
          title="Fit all windows to current screen"
          class="rounded-sm border border-fin-border px-2 text-[11px] text-fin-text hover:bg-fin-surface-alt"
          onClick={fitAll}
        >
          Fit all windows
        </button>
        <button
          type="button"
          data-testid="window-lock-toggle"
          aria-pressed={locked()}
          title="Lock or unlock window positions"
          class="rounded-sm border border-fin-border px-2 text-[11px] text-fin-text hover:bg-fin-surface-alt"
          onClick={() => {
            const next = !locked();
            setLocked(next);
            announce(`Window positions ${next ? "locked" : "unlocked"}`);
          }}
        >
          {locked() ? "Unlock" : "Lock"}
        </button>
      </div>

      <div
        ref={(element) => (canvasEl = element)}
        data-testid="window-manager-canvas"
        data-locked={locked()}
        class="relative min-h-0 w-full flex-1 overflow-hidden"
      >
        <Index each={props.layout.windows}>
          {(win) => {
            // A raw `props.settingsSlot?.(win())` in JSX is a getter re-evaluated
            // by both `<Show>` and the child span, so one window render invoked
            // the host's factory twice. The memo calls it once per real change.
            const slot = createMemo(() => props.settingsSlot?.(win()));
            // All eight memos evaluate the cheap comparison on a focus change,
            // but only the two whose boolean flips notify their Window frame.
            const focused = createMemo(() => focusedId() === win().id);
            return (
              <Window
                state={win()}
                canvas={canvas}
                spec={byId().get(win().type)}
                context={context}
                focused={focused()}
                locked={locked()}
                settingsSlot={slot()}
                onSettingsChange={updateSettings}
                onFocus={focus}
                onRectChange={updateRect}
                onMinimize={toggleMinimize}
                onMaximize={toggleMaximize}
                onClose={close}
                onPopOut={popOut}
                onAnnounce={announce}
              />
            );
          }}
        </Index>
      </div>

      <div
        data-testid="window-manager-live"
        class="sr-only"
        aria-live="polite"
        aria-atomic="true"
      >
        {liveMessage()}
      </div>
    </div>
  );
}
