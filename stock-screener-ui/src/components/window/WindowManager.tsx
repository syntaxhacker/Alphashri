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
  const canvas = (): CanvasSize => props.canvas ?? measured();
  const [focusedId, setFocusedId] = createSignal<string | null>(null);
  const [locked, setLocked] = createSignal(props.lockedInitially ?? false);

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
      setMeasured(size);
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

  const patch = (id: string, change: (win: WindowState) => WindowState) =>
    emit(props.layout.windows.map((w) => (w.id === id ? change(w) : { ...w })));

  const updateRect = (id: string, rect: Rect) => patch(id, (w) => ({ ...w, ...rect }));
  const toggleMinimize = (id: string) => patch(id, (w) => ({ ...w, minimized: !w.minimized }));
  const toggleMaximize = (id: string) => {
    const target = props.layout.windows.find((w) => w.id === id);
    emit(
      target?.maximized
        ? restore(props.layout.windows, id)
        : maximize(props.layout.windows, id, canvas()),
    );
  };
  const close = (id: string) =>
    emit(props.layout.windows.filter((w) => w.id !== id).map((w) => ({ ...w })));

  const popOut = (id: string) => {
    const target = props.layout.windows.find((w) => w.id === id);
    if (!target) return;
    openPanelPopOut(byId().get(target.type), target.title, props.context());
  };

  const fitAll = () => emit(fitAllToScreen(props.layout.windows, canvas()));

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
          onClick={() => setLocked((was) => !was)}
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
          {(win) => (
            <Window
              state={win()}
              canvas={canvas()}
              spec={byId().get(win().type)}
              context={props.context}
              focused={focusedId() === win().id}
              locked={locked()}
              settingsSlot={props.settingsSlot?.(win())}
              onFocus={focus}
              onRectChange={updateRect}
              onMinimize={toggleMinimize}
              onMaximize={toggleMaximize}
              onClose={close}
              onPopOut={popOut}
            />
          )}
        </Index>
      </div>
    </div>
  );
}
