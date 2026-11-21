// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { DockPanelContext } from "../dock/types";
import { DEFAULT_MIN_SIZE, MIN_VISIBLE_X, type CanvasSize } from "./layout";
import { WindowManager, type WindowManagerProps } from "./WindowManager";
import type { WindowLayout, WindowState } from "./types";

const CANVAS: CanvasSize = { w: 1280, h: 800 };
const CONTEXT: () => DockPanelContext = () => ({
  symbol: "NIFTY",
  market: "india",
  timeframe: "1m",
  expiry: "2026-11-26",
});

const win = (over: Partial<WindowState> = {}): WindowState => ({
  id: "a",
  type: "sector.table",
  title: "CHART",
  x: 50,
  y: 50,
  w: 300,
  h: 200,
  z: 1,
  ...over,
});

interface HarnessProps {
  windows: WindowState[];
  onLayout: (next: WindowLayout) => void;
  canvas?: CanvasSize;
  lockedInitially?: boolean;
  settingsSlot?: WindowManagerProps["settingsSlot"];
}

function Harness(props: HarnessProps) {
  const [layout, setLayout] = createSignal<WindowLayout>({ windows: props.windows, name: "Main" });
  const apply = (next: WindowLayout) => {
    setLayout(next);
    props.onLayout(next);
  };
  return (
    <WindowManager
      layout={layout()}
      context={CONTEXT}
      onLayoutChange={apply}
      canvas={props.canvas ?? CANVAS}
      lockedInitially={props.lockedInitially}
      settingsSlot={props.settingsSlot}
    />
  );
}

function renderDesk(windows: WindowState[], opts: Partial<HarnessProps> = {}) {
  let snapshot: WindowLayout = { windows, name: "Main" };
  const onLayout = vi.fn((next: WindowLayout) => {
    snapshot = next;
  });
  render(() => (
    <UIProvider>
      <Harness
        windows={windows}
        onLayout={onLayout}
        canvas={CANVAS}
        lockedInitially={opts.lockedInitially}
        settingsSlot={opts.settingsSlot}
      />
    </UIProvider>
  ));
  const root = (id: string) => screen.getByTestId(`window-${id}`) as HTMLElement;
  const rect = (id: string) => {
    const s = root(id).style;
    return {
      x: Number.parseFloat(s.left),
      y: Number.parseFloat(s.top),
      w: Number.parseFloat(s.width),
      h: Number.parseFloat(s.height),
    };
  };
  return { getLayout: () => snapshot, root, rect, onLayout };
}

beforeEach(() => {
  // Real panel bodies mount here now; keep their sector fetch hermetic.
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve({ sectors: [], top_stock_movers: [], last_updated: "", market: "india" }),
    text: () => Promise.resolve("{}"),
  } as unknown as Response)));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WindowManager — focus and z-order", () => {
  it("(a) pointer-down on a window raises it to max z + 1", () => {
    const a = win({ id: "a", z: 1 });
    const b = win({ id: "b", z: 4, title: "WALLS", type: "sector.movers", x: 400 });
    const { root, getLayout } = renderDesk([a, b]);

    expect(root("a").style.zIndex).toBe("1");
    fireEvent.pointerDown(root("a"), { button: 0, clientX: 60, clientY: 60, pointerId: 1 });

    expect(root("a").style.zIndex).toBe("5");
    expect(root("b").style.zIndex).toBe("4");
    expect(getLayout().windows.find((w) => w.id === "a")!.z).toBe(5);
  });
});

describe("WindowManager — drag", () => {
  it("(b) dragging the title bar moves the window by the pointer delta", () => {
    const { rect } = renderDesk([win({ x: 100, y: 80 })]);
    const bar = screen.getByTestId("window-title-a");

    fireEvent.pointerDown(bar, { button: 0, clientX: 100, clientY: 80, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 160, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 160, clientY: 120, pointerId: 1 });

    expect(rect("a")).toEqual({ x: 160, y: 120, w: 300, h: 200 });
  });

  it("(perf) a 30-event drag persists once on pointer-up, not per pointer-move", () => {
    const { onLayout, rect } = renderDesk([win({ x: 100, y: 80 })]);
    const bar = screen.getByTestId("window-title-a");

    fireEvent.pointerDown(bar, { button: 0, clientX: 100, clientY: 80, pointerId: 1 });
    const afterFocus = onLayout.mock.calls.length;
    for (let i = 1; i <= 30; i += 1) {
      fireEvent.pointerMove(window, { clientX: 100 + i * 2, clientY: 80 + i, pointerId: 1 });
    }
    expect(onLayout.mock.calls.length).toBe(afterFocus);
    fireEvent.pointerUp(window, { clientX: 160, clientY: 110, pointerId: 1 });

    expect(onLayout.mock.calls.length).toBe(afterFocus + 1);
    expect(rect("a")).toEqual({ x: 160, y: 110, w: 300, h: 200 });
    // Keyboard parity survives the pointer-up commit: geometry comes from the
    // saved state again, not from a stale in-gesture rect.
    fireEvent.keyDown(screen.getByTestId("window-a"), { key: "ArrowRight" });
    expect(rect("a").x).toBe(170);
  });

  it("(perf) a title-bar click with no movement emits no geometry change", () => {
    const { onLayout, rect } = renderDesk([win({ x: 100, y: 80 })]);
    const bar = screen.getByTestId("window-title-a");

    fireEvent.pointerDown(bar, { button: 0, clientX: 100, clientY: 80, pointerId: 1 });
    const afterFocus = onLayout.mock.calls.length;
    fireEvent.pointerUp(window, { clientX: 100, clientY: 80, pointerId: 1 });

    expect(onLayout.mock.calls.length).toBe(afterFocus);
    expect(rect("a")).toEqual({ x: 100, y: 80, w: 300, h: 200 });
  });

  it("(b) dragging far off-canvas still leaves the title bar grabbable", () => {
    const { rect } = renderDesk([win({ x: 0, y: 0 })]);
    const bar = screen.getByTestId("window-title-a");

    fireEvent.pointerDown(bar, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: -5000, clientY: -5000, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: -5000, clientY: -5000, pointerId: 1 });

    const r = rect("a");
    expect(r.x).toBeGreaterThanOrEqual(-(r.w - MIN_VISIBLE_X));
    expect(r.y).toBe(0);
    expect(screen.getByTestId("window-title-a")).toBeInTheDocument();
  });
});

describe("WindowManager — resize", () => {
  it("(c) resizing past the minimum clamps to the floor without inverting w/h", () => {
    const { rect } = renderDesk([win({ x: 400, y: 100 })]);
    const handle = screen.getByTestId("window-resize-a-e");

    fireEvent.pointerDown(handle, { button: 0, clientX: 700, clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: -600, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: -600, clientY: 200, pointerId: 1 });

    expect(rect("a").w).toBe(DEFAULT_MIN_SIZE.w);
    expect(rect("a").h).toBe(200);
  });

  it("(c) the west handle keeps the opposite edge pinned when clamped", () => {
    const { rect } = renderDesk([win({ x: 400, y: 100 })]);
    const handle = screen.getByTestId("window-resize-a-w");

    fireEvent.pointerDown(handle, { button: 0, clientX: 400, clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 1400, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 1400, clientY: 200, pointerId: 1 });

    const r = rect("a");
    expect(r.w).toBe(DEFAULT_MIN_SIZE.w);
    expect(r.x + r.w).toBe(700);
  });
});

describe("WindowManager — minimize / maximize / close", () => {
  it("(d) minimize collapses to the title bar and restore returns the exact rect", () => {
    const { rect } = renderDesk([win({ x: 33, y: 77, w: 321, h: 199 })]);
    expect(screen.getByTestId("sector-table-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("window-minimize-a"));
    expect(screen.queryByTestId("sector-table-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("window-title-a")).toBeInTheDocument();
    expect(screen.getByTestId("window-close-a")).toBeInTheDocument();
    expect(screen.getByLabelText(/Restore CHART/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("window-minimize-a"));
    expect(screen.getByTestId("sector-table-panel")).toBeInTheDocument();
    expect(rect("a")).toEqual({ x: 33, y: 77, w: 321, h: 199 });
  });

  it("(e) maximize fills the canvas and restore returns to the exact prior rect", () => {
    const { rect } = renderDesk([win({ x: 33, y: 77, w: 321, h: 199 })]);

    fireEvent.click(screen.getByTestId("window-maximize-a"));
    expect(rect("a")).toEqual({ x: 0, y: 0, w: CANVAS.w, h: CANVAS.h });

    fireEvent.click(screen.getByTestId("window-maximize-a"));
    expect(rect("a")).toEqual({ x: 33, y: 77, w: 321, h: 199 });
  });

  it("close removes the window but keeps the rest of the desk", () => {
    const b = win({ id: "b", type: "sector.movers", title: "WALLS", x: 400, z: 2 });
    const { getLayout } = renderDesk([win(), b]);

    fireEvent.click(screen.getByTestId("window-close-a"));
    expect(screen.queryByTestId("window-a")).not.toBeInTheDocument();
    expect(screen.getByTestId("window-b")).toBeInTheDocument();
    expect(getLayout().windows.map((w) => w.id)).toEqual(["b"]);
  });
});

describe("WindowManager — recovery, lock, keyboard", () => {
  it("(f) 'Fit all windows' brings an off-canvas window back into view", () => {
    const { rect } = renderDesk([win({ x: 5000, y: 4000, z: 9 })]);
    expect(rect("a").x).toBe(5000);

    fireEvent.click(screen.getByTestId("window-fit-all"));

    const r = rect("a");
    expect(r.x).toBeLessThan(CANVAS.w);
    expect(r.y).toBeLessThan(CANVAS.h);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.w).toBeGreaterThanOrEqual(DEFAULT_MIN_SIZE.w);
  });

  it("(i) lock mode disables drag, resize handles and keyboard geometry changes", () => {
    const { rect } = renderDesk([win()]);
    fireEvent.click(screen.getByTestId("window-lock-toggle"));
    expect(screen.getByTestId("window-manager-canvas")).toHaveAttribute("data-locked", "true");
    expect(screen.queryByTestId("window-resize-a-e")).not.toBeInTheDocument();

    const bar = screen.getByTestId("window-title-a");
    fireEvent.pointerDown(bar, { button: 0, clientX: 100, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 400, clientY: 400, pointerId: 1 });

    fireEvent.keyDown(screen.getByTestId("window-a"), { key: "ArrowRight" });
    expect(rect("a")).toEqual({ x: 50, y: 50, w: 300, h: 200 });
  });

  it("(j) keyboard moves with arrows and resizes with Shift+Arrow on a focused window", () => {
    const { rect } = renderDesk([win()]);
    const root = screen.getByTestId("window-a");
    root.focus();

    fireEvent.keyDown(root, { key: "ArrowRight" });
    expect(rect("a").x).toBe(60);
    fireEvent.keyDown(root, { key: "ArrowDown" });
    expect(rect("a").y).toBe(60);

    fireEvent.keyDown(root, { key: "ArrowRight", shiftKey: true });
    expect(rect("a").w).toBe(310);
    fireEvent.keyDown(root, { key: "ArrowDown", shiftKey: true });
    expect(rect("a").h).toBe(210);

    fireEvent.keyDown(root, { key: "ArrowLeft", shiftKey: true });
    expect(rect("a").w).toBe(300);
  });

  it("pop-out opens a real standalone window instead of shipping a dead control", () => {
    const open = vi.fn().mockReturnValue(null);
    vi.stubGlobal("open", open);
    renderDesk([win()]);

    fireEvent.click(screen.getByTestId("window-popout-a"));

    expect(open).toHaveBeenCalledTimes(1);
    expect(String(open.mock.calls[0][0])).toMatch(/blob:|data:text\/html/);
    expect(open.mock.calls[0][1]).toBe("_blank");
  });
});

/**
 * A browser fires pointerdown+mousedown at the node under the cursor when the press
 * starts, then re-targets pointerup/mouseup at whatever is under it on release; `click`
 * lands on the nearest common ancestor of those two targets. Focus used to emit a new
 * layout that rebuilt the button mid-press, so the common ancestor was the title bar
 * and the button's `onClick` never ran. `fireEvent.click` alone hides this — it is
 * exactly why the click-only tests above passed while a real mouse click did nothing.
 */
function realTitleButtonClick(id: string, action: "minimize" | "maximize" | "close") {
  const testId = `window-${action}-${id}`;
  const pressed = screen.getByTestId(testId);
  fireEvent.pointerDown(pressed, { button: 0, clientX: 100, clientY: 50, pointerId: 1 });
  const released = screen.getByTestId(testId);
  fireEvent.mouseDown(pressed, { button: 0 });
  fireEvent.pointerUp(released, { button: 0, pointerId: 1 });
  fireEvent.mouseUp(released, { button: 0 });
  const survived = pressed === released && pressed.isConnected;
  fireEvent.click(survived ? pressed : screen.getByTestId(`window-title-${id}`));
  return survived;
}

describe("WindowManager — a real pointer sequence reaches the title buttons", () => {
  it("minimize: the full pointer sequence toggles data-minimized and keeps focus-on-click", () => {
    const b = win({ id: "b", type: "sector.movers", title: "WALLS", x: 400, z: 4 });
    const { root } = renderDesk([win(), b]);

    const survived = realTitleButtonClick("a", "minimize");

    expect(root("a")).toHaveAttribute("data-minimized");
    expect(root("a").style.zIndex).toBe("5");
    expect(survived).toBe(true);
  });

  it("maximize: the full pointer sequence toggles data-maximized", () => {
    const { root } = renderDesk([win({ x: 33, y: 77, w: 321, h: 199 })]);

    const survived = realTitleButtonClick("a", "maximize");
    expect(root("a")).toHaveAttribute("data-maximized");
    expect(root("a").style).toMatchObject({ left: "0px", top: "0px" });
    expect(survived).toBe(true);
  });

  it("close: the full pointer sequence removes the window", () => {
    const b = win({ id: "b", type: "sector.movers", title: "WALLS", x: 400, z: 2 });
    renderDesk([win(), b]);

    const survived = realTitleButtonClick("a", "close");
    expect(screen.queryByTestId("window-a")).not.toBeInTheDocument();
    expect(screen.getByTestId("window-b")).toBeInTheDocument();
    expect(survived).toBe(true);
  });
});
