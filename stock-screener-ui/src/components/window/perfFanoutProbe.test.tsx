// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal, type Accessor } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { DockPanelContext, DockPanelSpec } from "../dock/types";
import type { CanvasSize } from "./layout";
import type { WindowLayout, WindowState } from "./types";
import type { WindowProps } from "./Window";
import { WindowManager } from "./WindowManager";

/**
 * A Window frame is "re-rendered" whenever its root reactive effect runs: that
 * effect reads `props.focused` twice, so a per-window delta of that prop is an
 * exact frame-rerun counter. The proxy also counts Window body invocations and
 * panel data accessor calls, so a fix cannot hide fan-out by remounting.
 */
const ctl = vi.hoisted(() => ({
  bodies: 0,
  reads: {} as Record<string, number>,
  perWindow: {} as Record<string, Record<string, number>>,
  dataCalls: {} as Record<string, number>,
  ctxRefs: [] as unknown[],
  specMaps: 0,
  ticks: {} as Record<string, () => void>,
  settingsSlot: null as ReturnType<typeof vi.fn> | null,
}));

vi.mock("./Window", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./Window")>();
  return {
    Window: (props: WindowProps) => {
      ctl.bodies += 1;
      const id = props.state?.id ?? "?";
      const per = (ctl.perWindow[id] ??= {});
      const proxied = new Proxy(props, {
        get(target, key, receiver) {
          if (typeof key === "string") {
            ctl.reads[key] = (ctl.reads[key] ?? 0) + 1;
            per[key] = (per[key] ?? 0) + 1;
          }
          return Reflect.get(target, key, receiver);
        },
      });
      return actual.Window(proxied);
    },
  };
});

const CONTEXT: Accessor<DockPanelContext> = () => ({ symbol: "NIFTY" });

function specFor(id: string): DockPanelSpec {
  const [tick, setTick] = createSignal(0);
  ctl.ticks[id] = () => setTick((n) => n + 1);
  return {
    id,
    page: "report",
    title: id,
    size: 1,
    minWidth: 100,
    singleton: false,
    requires: [],
    data: (ctx) => {
      ctl.dataCalls[id] = (ctl.dataCalls[id] ?? 0) + 1;
      ctl.ctxRefs.push(ctx);
      return { v: tick() };
    },
    mount: () => <div data-testid={`body-${id}`}>{String(tick())}</div>,
  };
}

const win = (i: number): WindowState => ({
  id: `w${i}`,
  type: `probe.${i}`,
  title: `W${i}`,
  x: 40 + i * 30,
  y: 40 + i * 12,
  w: 300,
  h: 200,
  z: i + 1,
  // Exactly one maximized window: on a real canvas resize only this frame may
  // recompute geometry; the seven restore-rect windows must stay untouched.
  ...(i === 5 ? { maximized: true } : {}),
});

const windows = Array.from({ length: 8 }, (_, i) => win(i));

function Desk(props: { canvas?: CanvasSize }) {
  const [layout, setLayout] = createSignal<WindowLayout>({ windows });
  const specs = windows.map((w) => specFor(w.type));
  // byId() maps over specs only when its memo re-evaluates: count those maps.
  const countedSpecs = new Proxy(specs, {
    get(target, key, receiver) {
      if (key === "map") ctl.specMaps += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  const settingsSlot = vi.fn(() => <span />);
  ctl.settingsSlot = settingsSlot;
  return (
    <WindowManager
      layout={layout()}
      context={CONTEXT}
      onLayoutChange={(next) => setLayout(next)}
      canvas={props.canvas}
      specs={countedSpecs}
      settingsSlot={settingsSlot}
    />
  );
}

class TestRO {
  static cb: ResizeObserverCallback | null = null;
  constructor(cb: ResizeObserverCallback) { TestRO.cb = cb; }
  observe() {}
  disconnect() {}
  unobserve() {}
}

function reset() {
  ctl.bodies = 0;
  ctl.reads = {};
  ctl.perWindow = {};
  ctl.dataCalls = {};
  ctl.ctxRefs = [];
  ctl.specMaps = 0;
  ctl.ticks = {};
  ctl.settingsSlot = null;
  TestRO.cb = null;
}

function snapshot() {
  return {
    reads: { ...ctl.reads },
    perWindow: structuredClone(ctl.perWindow),
    data: { ...ctl.dataCalls },
    bodies: ctl.bodies,
    specMaps: ctl.specMaps,
  };
}

/** Windows whose root frame effect ran at least once in this scenario. */
function framesTouched(before: ReturnType<typeof snapshot>): string[] {
  return Object.entries(ctl.perWindow)
    .filter(([id, reads]) => (reads.focused ?? 0) > (before.perWindow[id]?.focused ?? 0))
    .map(([id]) => id);
}

function dataDelta(before: ReturnType<typeof snapshot>) {
  return Object.fromEntries(
    Object.entries(ctl.dataCalls)
      .filter(([id, n]) => n !== (before.data[id] ?? 0))
      .map(([id, n]) => [id, n - (before.data[id] ?? 0)]),
  );
}

function report(name: string, before: ReturnType<typeof snapshot>) {
  console.log(`[FANOUT ${name}]`, JSON.stringify({
    frames: framesTouched(before),
    focusedReads: (ctl.reads.focused ?? 0) - (before.reads.focused ?? 0),
    canvasReads: (ctl.reads.canvas ?? 0) - (before.reads.canvas ?? 0),
    stateReads: (ctl.reads.state ?? 0) - (before.reads.state ?? 0),
    panelData: dataDelta(before),
    specMaps: ctl.specMaps - before.specMaps,
    slotCalls: (ctl.settingsSlot?.mock.calls.length ?? 0),
  }));
}

beforeEach(() => {
  reset();
  vi.stubGlobal("ResizeObserver", TestRO);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FANOUT PROBE — 8 windows, what still re-renders", () => {
  it("focus A→B re-renders only the two windows whose focused value changed", () => {
    render(() => <UIProvider><Desk canvas={{ w: 1280, h: 800 }} /></UIProvider>);
    fireEvent.pointerDown(screen.getByTestId("window-title-w0"), { button: 0, clientX: 40, clientY: 40, pointerId: 1 });
    const before = snapshot();

    fireEvent.pointerDown(screen.getByTestId("window-title-w1"), { button: 0, clientX: 70, clientY: 52, pointerId: 2 });

    report("focus-A-to-B", before);
    expect(framesTouched(before).sort()).toEqual(["w0", "w1"]);
    expect(dataDelta(before)).toEqual({});
    expect(ctl.specMaps).toBe(1);
    expect(new Set(ctl.ctxRefs).size).toBe(1);
    expect(ctl.bodies).toBe(8);
  });

  it("drag: 20 moves and the rect commit touch only the dragged window", () => {
    render(() => <UIProvider><Desk canvas={{ w: 1280, h: 800 }} /></UIProvider>);
    fireEvent.pointerDown(screen.getByTestId("window-title-w2"), { button: 0, clientX: 100, clientY: 64, pointerId: 3 });
    const beforeMoves = snapshot();
    for (let i = 1; i <= 20; i += 1) {
      fireEvent.pointerMove(window, { clientX: 100 + i * 2, clientY: 64, pointerId: 3 });
    }
    report("drag-moves", beforeMoves);
    expect(framesTouched(beforeMoves)).toEqual(["w2"]);

    const beforeCommit = snapshot();
    fireEvent.pointerUp(window, { clientX: 140, clientY: 64, pointerId: 3 });
    report("drag-commit", beforeCommit);
    expect(framesTouched(beforeCommit)).toEqual(["w2"]);
    expect(dataDelta(beforeCommit)).toEqual({});
    expect(new Set(ctl.ctxRefs).size).toBe(1);
    expect(ctl.bodies).toBe(8);
  });

  it("one panel's data tick touches no window frame or sibling panel", () => {
    render(() => <UIProvider><Desk canvas={{ w: 1280, h: 800 }} /></UIProvider>);
    const before = snapshot();
    ctl.ticks["probe.3"]();

    report("panel-tick", before);
    expect(framesTouched(before)).toEqual([]);
    expect(dataDelta(before)).toEqual({ "probe.3": 1 });
    expect(ctl.specMaps).toBe(1);
    expect(ctl.bodies).toBe(8);
  });

  it("lock toggle touches every frame (handles/cursor change) but no panel", () => {
    render(() => <UIProvider><Desk canvas={{ w: 1280, h: 800 }} /></UIProvider>);
    const before = snapshot();
    fireEvent.click(screen.getByTestId("window-lock-toggle"));

    report("lock", before);
    expect(framesTouched(before).length).toBe(8);
    expect(dataDelta(before)).toEqual({});
    expect(ctl.specMaps).toBe(1);
    expect(ctl.bodies).toBe(8);
  });

  it("a same-size canvas notification touches no window frame", () => {
    render(() => <UIProvider><Desk /></UIProvider>);
    const before = snapshot();
    TestRO.cb?.([], {} as ResizeObserver);

    report("canvas-noop", before);
    expect(framesTouched(before)).toEqual([]);
    expect(dataDelta(before)).toEqual({});
    expect(ctl.bodies).toBe(8);
  });

  it("a real canvas resize touches only the maximized window's frame", () => {
    render(() => <UIProvider><Desk /></UIProvider>);
    const canvasEl = screen.getByTestId("window-manager-canvas");
    Object.defineProperty(canvasEl, "clientWidth", { configurable: true, value: 1600 });
    Object.defineProperty(canvasEl, "clientHeight", { configurable: true, value: 900 });
    const before = snapshot();
    TestRO.cb?.([], {} as ResizeObserver);

    report("canvas-resize", before);
    expect(framesTouched(before)).toEqual(["w5"]);
    expect(dataDelta(before)).toEqual({});
    expect(ctl.specMaps).toBe(1);
    expect(ctl.bodies).toBe(8);
  });

  it("a host that swaps its context accessor does not invalidate any panel", () => {
    const ctxA: Accessor<DockPanelContext> = () => ({ symbol: "A" });
    const ctxB: Accessor<DockPanelContext> = () => ({ symbol: "B" });
    function SwappingDesk() {
      const [swapped, setSwapped] = createSignal(false);
      const [layout] = createSignal<WindowLayout>({ windows });
      return (
        <>
          <button type="button" data-testid="swap-context" onClick={() => setSwapped((v) => !v)}>swap</button>
          <WindowManager
            layout={layout()}
            context={swapped() ? ctxB : ctxA}
            onLayoutChange={() => {}}
            canvas={{ w: 1280, h: 800 }}
            specs={windows.map((w) => specFor(w.type))}
          />
        </>
      );
    }
    render(() => <UIProvider><SwappingDesk /></UIProvider>);
    const before = snapshot();

    fireEvent.click(screen.getByTestId("swap-context"));

    report("context-swap", before);
    expect(framesTouched(before)).toEqual([]);
    expect(dataDelta(before)).toEqual({});
    expect(new Set(ctl.ctxRefs).size).toBe(1);
    expect(ctl.bodies).toBe(8);
  });
});
