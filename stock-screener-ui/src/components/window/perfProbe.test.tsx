// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal, onCleanup, onMount, type Accessor } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { DockPanelContext, DockPanelSpec } from "../dock/types";
import type { CanvasSize } from "./layout";
import type { WindowLayout, WindowState } from "./types";
import { WindowManager, type WindowManagerProps } from "./WindowManager";

const CANVAS: CanvasSize = { w: 1280, h: 800 };
const CONTEXT: Accessor<DockPanelContext> = () => ({ symbol: "NIFTY" });

const probe = vi.hoisted(() => ({
  mounts: 0,
  cleanups: 0,
  pollTicks: 0,
}));

function specFor(id: string): DockPanelSpec {
  return {
    id,
    page: "report",
    title: id,
    size: 1,
    minWidth: 100,
    singleton: false,
    requires: [],
    mount: () => {
      probe.mounts += 1;
      onMount(() => {
        probe.pollTicks += 1;
        const timer = setInterval(() => {
          probe.pollTicks += 1;
        }, 1000);
        onCleanup(() => {
          clearInterval(timer);
          probe.cleanups += 1;
        });
      });
      return <div data-testid={`body-${id}`} />;
    },
  };
}

const win = (i: number): WindowState => ({
  id: `w${i}`,
  type: `probe.${i}`,
  title: `W${i}`,
  x: 40 + i * 20,
  y: 40 + i * 12,
  w: 300,
  h: 200,
  z: i + 1,
});

function Desk(props: {
  windows: WindowState[];
  onCommit: () => void;
  settingsSlot?: WindowManagerProps["settingsSlot"];
}) {
  const specs = props.windows.map((w) => specFor(w.type));
  const [layout, setLayout] = createSignal<WindowLayout>({ windows: props.windows });
  const onLayout = (next: WindowLayout) => {
    setLayout(next);
    props.onCommit();
  };
  return (
    <WindowManager
      layout={layout()}
      context={CONTEXT}
      onLayoutChange={onLayout}
      canvas={CANVAS}
      specs={specs}
      settingsSlot={props.settingsSlot}
    />
  );
}

const snapshot = (commits: ReturnType<typeof vi.fn>, settings: ReturnType<typeof vi.fn>) => ({
  commits: commits.mock.calls.length,
  settings: settings.mock.calls.length,
  mounts: probe.mounts,
  cleanups: probe.cleanups,
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PERF PROBE — floating window manager", () => {
  it("(1/6) 60 pointer-move drag persists once on pointer-up, not per move", () => {
    probe.mounts = 0;
    probe.cleanups = 0;
    const onCommit = vi.fn();
    const settingsSlot = vi.fn(() => <span />);
    const windows = Array.from({ length: 8 }, (_, i) => win(i));
    render(() => (
      <UIProvider>
        <Desk windows={windows} onCommit={onCommit} settingsSlot={settingsSlot} />
      </UIProvider>
    ));

    const bar = screen.getByTestId("window-title-w0");
    fireEvent.pointerDown(bar, { button: 0, clientX: 60, clientY: 60, pointerId: 1 });
    const afterFocus = snapshot(onCommit, settingsSlot);

    const t0 = performance.now();
    for (let i = 1; i <= 60; i += 1) {
      fireEvent.pointerMove(window, { clientX: 60 + i * 3, clientY: 60 + i * 2, pointerId: 1 });
    }
    const elapsed = performance.now() - t0;
    const afterMoves = snapshot(onCommit, settingsSlot);

    fireEvent.pointerUp(window, { clientX: 240, clientY: 180, pointerId: 1 });
    const afterUp = snapshot(onCommit, settingsSlot);

    const rows = {
      moves: 60,
      elapsedMs: Number(elapsed.toFixed(2)),
      eventsPerSec: Math.round((60_000 / Math.max(elapsed, 0.01))),
      commitsPerMove: Number(((afterMoves.commits - afterFocus.commits) / 60).toFixed(2)),
      commitsDuringMoves: afterMoves.commits - afterFocus.commits,
      windowRendersDuringMoves: afterMoves.settings - afterFocus.settings,
      mountsDuringMoves: afterMoves.mounts - afterFocus.mounts,
      commitsOnPointerUp: afterUp.commits - afterMoves.commits,
      totalMounts: probe.mounts,
    };
    console.log("[PERF drag-move]", JSON.stringify(rows));

    expect(rows.commitsDuringMoves).toBe(0);
    expect(rows.windowRendersDuringMoves).toBe(0);
    expect(rows.mountsDuringMoves).toBe(0);
    expect(rows.commitsOnPointerUp).toBe(1);
    expect(rows.totalMounts).toBe(8);
  });

  it("(1b) 60 pointer-move resize: commits, sibling re-renders, remounts", () => {
    probe.mounts = 0;
    const onCommit = vi.fn();
    const settingsSlot = vi.fn(() => <span />);
    const windows = Array.from({ length: 8 }, (_, i) => win(i));
    render(() => (
      <UIProvider>
        <Desk windows={windows} onCommit={onCommit} settingsSlot={settingsSlot} />
      </UIProvider>
    ));

    const handle = screen.getByTestId("window-resize-w0-e");
    fireEvent.pointerDown(handle, { button: 0, clientX: 340, clientY: 140, pointerId: 1 });
    const afterFocus = snapshot(onCommit, settingsSlot);

    const t0 = performance.now();
    for (let i = 1; i <= 60; i += 1) {
      fireEvent.pointerMove(window, { clientX: 340 + i * 3, clientY: 140, pointerId: 1 });
    }
    const elapsed = performance.now() - t0;
    const afterMoves = snapshot(onCommit, settingsSlot);

    fireEvent.pointerUp(window, { clientX: 520, clientY: 140, pointerId: 1 });
    const afterUp = snapshot(onCommit, settingsSlot);

    const rows = {
      moves: 60,
      elapsedMs: Number(elapsed.toFixed(2)),
      eventsPerSec: Math.round((60_000 / Math.max(elapsed, 0.01))),
      commitsDuringMoves: afterMoves.commits - afterFocus.commits,
      windowRendersDuringMoves: afterMoves.settings - afterFocus.settings,
      mountsDuringMoves: afterMoves.mounts - afterFocus.mounts,
      commitsOnPointerUp: afterUp.commits - afterMoves.commits,
      totalMounts: probe.mounts,
    };
    console.log("[PERF drag-resize]", JSON.stringify(rows));

    expect(rows.commitsDuringMoves).toBe(0);
    expect(rows.windowRendersDuringMoves).toBe(0);
    expect(rows.mountsDuringMoves).toBe(0);
    expect(rows.commitsOnPointerUp).toBe(1);
    expect(rows.totalMounts).toBe(8);
  });

  it("(3) focus / z-order / sibling move never remount a panel", () => {
    probe.mounts = 0;
    render(() => (
      <UIProvider>
        <Desk windows={[win(0), win(1)]} onCommit={() => {}} />
      </UIProvider>
    ));
    const afterMount = probe.mounts;

    fireEvent.pointerDown(screen.getByTestId("window-title-w1"), { button: 0, pointerId: 2 });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 300, pointerId: 2 });
    fireEvent.pointerUp(window, { clientX: 400, clientY: 300, pointerId: 2 });
    fireEvent.keyDown(screen.getByTestId("window-w0"), { key: "ArrowRight" });

    console.log("[PERF remount]", JSON.stringify({ afterMount, afterInteractions: probe.mounts }));
    expect(afterMount).toBe(2);
    expect(probe.mounts).toBe(2);
  });

  it("(4) minimize tears down the panel's poll; restore remounts exactly once", async () => {
    vi.useFakeTimers();
    probe.pollTicks = 0;
    probe.cleanups = 0;
    probe.mounts = 0;
    render(() => (
      <UIProvider>
        <Desk windows={[win(0)]} onCommit={() => {}} />
      </UIProvider>
    ));

    vi.advanceTimersByTime(3100);
    const ticksBefore = probe.pollTicks;
    fireEvent.click(screen.getByTestId("window-minimize-w0"));
    expect(screen.queryByTestId("body-probe.0")).not.toBeInTheDocument();
    const cleanupsAfterMin = probe.cleanups;
    vi.advanceTimersByTime(20_000);
    const ticksWhileMinimized = probe.pollTicks - ticksBefore;

    fireEvent.click(screen.getByTestId("window-minimize-w0"));
    expect(screen.getByTestId("body-probe.0")).toBeInTheDocument();

    console.log(
      "[PERF minimized]",
      JSON.stringify({
        ticksBefore,
        ticksWhileMinimized,
        cleanupsAfterMin,
        mountsAfterRestore: probe.mounts,
      }),
    );
    expect(cleanupsAfterMin).toBe(1);
    expect(ticksWhileMinimized).toBe(0);
    expect(probe.mounts).toBe(2);
  });
});
