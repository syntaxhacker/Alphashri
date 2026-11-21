// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal, type Accessor } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { DockPanelContext, DockPanelSpec } from "../dock/types";
import type { CanvasSize } from "./layout";
import type { WindowLayout, WindowState } from "./types";
import { WindowManager, type WindowManagerProps } from "./WindowManager";

const ctl = vi.hoisted(() => ({
  sectorFetches: 0,
  chainFetches: 0,
}));

vi.mock("../../api/sector", () => ({
  fetchSectorPerformance: vi.fn(async (market: string) => {
    ctl.sectorFetches += 1;
    return {
      sectors: [{ sector: "Energy", avg_change: 1, stock_count: 2, advances: 1, declines: 1, avg_rsi: 50, avg_adx: 20, top_movers: "X" }],
      top_stock_movers: [{ symbol: "RELIANCE", change: 1, prev_change: 0.5 }],
      last_updated: "2026-11-19T10:00:00Z",
      market,
    };
  }),
}));

vi.mock("../../api/optionsDock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/optionsDock")>();
  return {
    ...actual,
    fetchChain: vi.fn(async () => {
      ctl.chainFetches += 1;
      return null;
    }),
  };
});

vi.mock("../options-dock/OptionChainTable", () => ({
  OptionChainTable: () => <div data-testid="stub-chain-table" />,
}));
vi.mock("../sector/SectorTable", () => ({
  SectorTable: () => <div data-testid="stub-sector-table" />,
}));
vi.mock("../sector/SectorHeatmapView", () => ({
  SectorHeatmapView: () => <div data-testid="stub-sector-heatmap" />,
}));
vi.mock("../sector/IntervalMoversTable", () => ({
  IntervalMoversTable: () => <div data-testid="stub-movers-table" />,
}));
vi.mock("../common/symbolDockContext", () => ({
  useSymbolDock: () => ({ open: vi.fn(), preview: vi.fn(), endPreview: vi.fn() }),
}));
vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: async () => ({
    init: () => ({
      setOption: () => {}, on: () => {}, resize: () => {}, dispose: () => {},
    }),
  }),
}));

const CANVAS: CanvasSize = { w: 1280, h: 800 };
const CONTEXT: Accessor<DockPanelContext> = () => ({
  symbol: "NIFTY",
  market: "india",
  expiry: "2026-11-26",
});

const win = (id: string, type: string, i = 0): WindowState => ({
  id,
  type,
  title: type,
  x: 20 + i * 30,
  y: 20,
  w: 400,
  h: 240,
  z: i + 1,
});

function Desk(props: {
  windows: WindowState[];
  specs: DockPanelSpec[];
  onCommit?: () => void;
  settingsSlot?: WindowManagerProps["settingsSlot"];
}) {
  const [layout, setLayout] = createSignal<WindowLayout>({ windows: props.windows });
  return (
    <WindowManager
      layout={layout()}
      context={CONTEXT}
      onLayoutChange={(next) => {
        setLayout(next);
        props.onCommit?.();
      }}
      canvas={CANVAS}
      specs={props.specs}
      settingsSlot={props.settingsSlot}
    />
  );
}

function stubSpec(id: string): DockPanelSpec {
  return {
    id,
    page: "report",
    title: id,
    size: 1,
    minWidth: 100,
    singleton: false,
    requires: [],
    mount: () => <div data-testid={`body-${id}`} />,
  };
}

beforeEach(() => {
  ctl.sectorFetches = 0;
  ctl.chainFetches = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PERF PROBE — desk fan-out", () => {
  it("(3a) two DIFFERENT sector panels (table + heatmap) share one /api/sector request", async () => {
    const { SECTOR_TABLE_PANEL } = await import("./panels/sectorTable");
    const { SECTOR_HEATMAP_PANEL } = await import("./panels/sectorHeatmap");
    render(() => (
      <UIProvider>
        <Desk
          windows={[win("t", "sector.table", 0), win("h", "sector.heatmap", 1)]}
          specs={[SECTOR_TABLE_PANEL, SECTOR_HEATMAP_PANEL]}
        />
      </UIProvider>
    ));
    await Promise.resolve();
    await Promise.resolve();

    console.log("[PERF sector-cross-type]", JSON.stringify({
      windows: 2,
      requests: ctl.sectorFetches,
    }));
    expect(screen.getByTestId("stub-sector-table")).toBeInTheDocument();
    expect(screen.getByTestId("stub-sector-heatmap")).toBeInTheDocument();
    expect(ctl.sectorFetches).toBe(1);
  });

  it("(3b) two chain panels seeded with the same symbol+expiry: fetch count", async () => {
    const { OPTIONS_CHAIN_PANEL } = await import("./panels/optionsChain");
    render(() => (
      <UIProvider>
        <Desk
          windows={[win("c0", "options.chain", 0), win("c1", "options.chain", 1)]}
          specs={[OPTIONS_CHAIN_PANEL]}
        />
      </UIProvider>
    ));
    await Promise.resolve();
    await Promise.resolve();

    console.log("[PERF chain-2-windows]", JSON.stringify({
      windows: 2,
      requests: ctl.chainFetches,
    }));
    expect(screen.getAllByTestId("options-chain-window")).toHaveLength(2);
    expect(ctl.chainFetches).toBe(1);
  });

  it("(2) 8 windows: frame renders on focus commit, rect commit and a panel data refresh", () => {
    const settingsSlot = vi.fn(() => <span />);
    const onCommit = vi.fn();
    const windows = Array.from({ length: 8 }, (_, i) => win(`w${i}`, `probe.${i}`, i));
    render(() => (
      <UIProvider>
        <Desk
          windows={windows}
          specs={windows.map((w) => stubSpec(w.type))}
          onCommit={onCommit}
          settingsSlot={settingsSlot}
        />
      </UIProvider>
    ));
    const afterMount = settingsSlot.mock.calls.length;

    fireEvent.pointerDown(screen.getByTestId("window-title-w0"), { button: 0, clientX: 20, clientY: 20, pointerId: 1 });
    const afterFocus = settingsSlot.mock.calls.length - afterMount;
    fireEvent.pointerMove(window, { clientX: 80, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 80, clientY: 20, pointerId: 1 });
    const afterRect = settingsSlot.mock.calls.length - afterMount - afterFocus;

    const beforeRefresh = settingsSlot.mock.calls.length;
    fireEvent.click(screen.getByTestId("window-fit-all"));
    const afterFit = settingsSlot.mock.calls.length - beforeRefresh;

    console.log("[PERF frame-renders]", JSON.stringify({
      windows: 8,
      framesOnMount: afterMount,
      framesOnFocus: afterFocus,
      framesOnRectCommit: afterRect,
      framesOnFitAll: afterFit,
    }));
    expect(afterMount).toBe(8);
    // One window changes on focus and on a rect commit; the seven siblings keep
    // their WindowState identity and are never re-rendered. Fit-all changes all.
    expect(afterFocus).toBe(1);
    expect(afterRect).toBe(1);
    expect(afterFit).toBe(8);
  });

  it("(2b) one panel's data refresh re-renders no sibling window frame or panel", async () => {
    const settingsSlot = vi.fn(() => <span />);
    const renders: Record<string, number> = {};
    const versions: Record<string, (update: (n: number) => number) => void> = {};
    const refreshSpecs = ["probe.a", "probe.b", "probe.c"].map((id) => {
      const [version, setVersion] = createSignal(0);
      versions[id] = setVersion;
      return {
        ...stubSpec(id),
        mount: () => {
          renders[id] = 0;
          const count = (v: number) => {
            renders[id] += 1;
            return `${renders[id]}:${v}`;
          };
          return (
            <div data-testid={`body-${id}`}>
              <span data-testid={`render-count-${id}`}>{count(version())}</span>
            </div>
          );
        },
      };
    });
    render(() => (
      <UIProvider>
        <Desk
          windows={["a", "b", "c"].map((id, i) => win(`w${id}`, `probe.${id}`, i))}
          specs={refreshSpecs}
          settingsSlot={settingsSlot}
        />
      </UIProvider>
    ));
    const beforeSlots = settingsSlot.mock.calls.length;
    const beforeRenders = { ...renders };
    versions["probe.a"]((n) => n + 1);
    await waitFor(() => expect(screen.getByTestId("render-count-probe.a")).toHaveTextContent(":1"));

    const after = {
      a: renders["probe.a"] - beforeRenders["probe.a"],
      b: renders["probe.b"] - beforeRenders["probe.b"],
      c: renders["probe.c"] - beforeRenders["probe.c"],
    };
    console.log("[PERF data-refresh]", JSON.stringify({
      panels: 3,
      frameRenders: settingsSlot.mock.calls.length - beforeSlots,
      panelRenders: after,
    }));
    expect(settingsSlot.mock.calls.length - beforeSlots).toBe(0);
    expect(after).toEqual({ a: 1, b: 0, c: 0 });
    expect(screen.getByTestId("render-count-probe.a")).toHaveTextContent(":1");
  });

  it("(5) scheduleSave churn: one focus emit + one rect emit per drag gesture", () => {
    const onCommit = vi.fn();
    render(() => (
      <UIProvider>
        <Desk
          windows={[win("w0", "probe.0", 0)]}
          specs={[stubSpec("probe.0")]}
          onCommit={onCommit}
        />
      </UIProvider>
    ));
    fireEvent.pointerDown(screen.getByTestId("window-title-w0"), { button: 0, clientX: 20, clientY: 20, pointerId: 1 });
    const focusEmits = onCommit.mock.calls.length;
    for (let i = 1; i <= 20; i += 1) {
      fireEvent.pointerMove(window, { clientX: 20 + i * 2, clientY: 20 + i, pointerId: 1 });
    }
    fireEvent.pointerUp(window, { clientX: 60, clientY: 40, pointerId: 1 });
    const totalEmits = onCommit.mock.calls.length;

    console.log("[PERF layout-emits]", JSON.stringify({
      focusEmits,
      emitsDuringMoves: 0,
      rectEmitsOnUp: totalEmits - focusEmits,
      totalEmits,
    }));
    expect(totalEmits - focusEmits).toBe(1);
  });
});
