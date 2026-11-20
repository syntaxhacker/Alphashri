// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import { BG, PRIMARY, SURFACE, SURFACE_ALT } from "@/ui/palette";
import { contrastRatio } from "@/utils/contrast";
import type { DockPanelContext } from "../dock/types";
import {
  DEFAULT_MIN_SIZE,
  MIN_VISIBLE_X,
  TITLE_BAR_H,
  type CanvasSize,
} from "./layout";
import { WindowManager } from "./WindowManager";
import type { WindowLayout, WindowState } from "./types";

const CANVAS: CanvasSize = { w: 1280, h: 800 };

/** DOM order of focusable controls — the sequence user-event's `tab()` walked. */
const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const tabbables = () => Array.from(document.querySelectorAll<HTMLElement>(TABBABLE));
function focusNext(from: HTMLElement): HTMLElement {
  const order = tabbables();
  const next = order[order.indexOf(from) + 1];
  if (!next) throw new Error("No next tabbable element");
  next.focus();
  return next;
}
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

function Harness(props: { windows: WindowState[]; onLayout: (next: WindowLayout) => void }) {
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
      canvas={CANVAS}
    />
  );
}

function renderDesk(windows: WindowState[]) {
  let snapshot: WindowLayout = { windows, name: "Main" };
  const onLayout = vi.fn((next: WindowLayout) => {
    snapshot = next;
  });
  render(() => (
    <UIProvider>
      <Harness windows={windows} onLayout={onLayout} />
    </UIProvider>
  ));
  const root = (id: string) => screen.getByTestId(`window-${id}`) as HTMLElement;
  const rect = (id: string) => {
    const style = root(id).style;
    return {
      x: Number.parseFloat(style.left),
      y: Number.parseFloat(style.top),
      w: Number.parseFloat(style.width),
      h: Number.parseFloat(style.height),
    };
  };
  return { getLayout: () => snapshot, root, rect };
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

describe("desk keyboard access", () => {
  it("(a) Tab from a focused window reaches every title-bar button", async () => {
    renderDesk([win()]);
    const root = screen.getByTestId("window-a");
    root.focus();
    expect(document.activeElement).toBe(root);

    let focused = root;
    for (const id of [
      "window-popout-a",
      "window-minimize-a",
      "window-maximize-a",
      "window-close-a",
    ]) {
      focused = focusNext(focused);
      expect(document.activeElement, `Tab reaches ${id}`).toBe(screen.getByTestId(id));
    }
  });

  it("(b) arrow keys move/resize inside minimumSize and canvas bounds and announce the move", () => {
    const { rect } = renderDesk([win()]);
    const root = screen.getByTestId("window-a");
    root.focus();

    fireEvent.keyDown(root, { key: "ArrowRight" });
    expect(rect("a").x).toBe(60);
    const live = screen.getByTestId("window-manager-live");
    expect(live).toHaveTextContent(/CHART moved to x 60, y 50/);

    for (let i = 0; i < 100; i += 1) fireEvent.keyDown(root, { key: "ArrowLeft", shiftKey: true });
    expect(rect("a").w).toBe(DEFAULT_MIN_SIZE.w);
    for (let i = 0; i < 100; i += 1) fireEvent.keyDown(root, { key: "ArrowUp", shiftKey: true });
    expect(rect("a").h).toBe(DEFAULT_MIN_SIZE.h);

    for (let i = 0; i < 300; i += 1) fireEvent.keyDown(root, { key: "ArrowRight" });
    expect(rect("a").x).toBeLessThanOrEqual(CANVAS.w - MIN_VISIBLE_X);
    expect(rect("a").y).toBeGreaterThanOrEqual(0);
    expect(rect("a").y).toBeLessThanOrEqual(CANVAS.h - TITLE_BAR_H);
  });

  it("(c) each window is a labelled region with a non-colour focused indicator", () => {
    const { root } = renderDesk([
      win(),
      win({ id: "b", title: "WALLS", type: "sector.movers", x: 400, z: 2 }),
    ]);
    expect(screen.getByRole("region", { name: "CHART" })).toBe(root("a"));
    expect(screen.getByRole("region", { name: "WALLS" })).toBe(root("b"));

    fireEvent.pointerDown(root("a"), { button: 0, clientX: 60, clientY: 60, pointerId: 1 });
    expect(root("a")).toHaveAttribute("data-focused");
    // A thicker border is a shape cue, not only a hue swap.
    expect(root("a")).toHaveClass("border-2");
    expect(root("a")).toHaveClass("focus-visible:outline-2");
  });

  it("(d) minimise / maximise / restore / close / fit-all announce state politely", () => {
    const { root } = renderDesk([
      win(),
      win({ id: "b", title: "WALLS", type: "sector.movers", x: 400, z: 2 }),
    ]);
    const live = screen.getByTestId("window-manager-live");
    expect(live).toHaveAttribute("aria-live", "polite");

    fireEvent.click(screen.getByTestId("window-minimize-a"));
    expect(live).toHaveTextContent("CHART minimized");
    expect(screen.getByTestId("window-minimize-a")).toHaveAttribute("aria-label", "Restore CHART");
    fireEvent.click(screen.getByTestId("window-minimize-a"));
    expect(live).toHaveTextContent("CHART restored");

    fireEvent.click(screen.getByTestId("window-maximize-a"));
    expect(live).toHaveTextContent("CHART maximized");
    expect(screen.getByTestId("window-maximize-a")).toHaveAttribute("aria-label", "Restore down CHART");
    fireEvent.click(screen.getByTestId("window-maximize-a"));
    expect(live).toHaveTextContent("CHART restored down");

    fireEvent.click(screen.getByTestId("window-fit-all"));
    expect(live).toHaveTextContent(/fit/i);

    fireEvent.click(screen.getByTestId("window-close-a"));
    expect(live).toHaveTextContent("CHART closed");
    expect(root("b")).toBeInTheDocument();
  });

  it("(g) the focus ring clears 3:1 against every adjacent desk surface", () => {
    expect(contrastRatio(PRIMARY, SURFACE)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(PRIMARY, SURFACE_ALT)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(PRIMARY, BG)).toBeGreaterThanOrEqual(3);
  });
});
