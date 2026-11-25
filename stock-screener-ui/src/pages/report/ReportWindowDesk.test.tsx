// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { CanvasSize } from "../../components/window/layout";
import type { WindowLayout } from "../../components/window/types";
import type { SavedConfigTransport } from "../../state/savedConfig";
import { defaultReportLayout, useReportWindowConfig } from "./reportWindowConfig";
import { getReportPreset, resolveReportPreset } from "./reportWindowPresets";
import { ReportWindowDesk } from "./ReportWindowDesk";
import { REPORT_PANEL_FALLBACKS } from "./ReportWindowDesk";
import { REPORT_WINDOW_PANELS } from "./reportWindowPanels";
import type { ReportWindowContext } from "./reportWindowTypes";

const CANVAS: CanvasSize = { w: 1280, h: 800 };

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse({ chain: [], expiries: [], rows: [], sectors: [], top_stock_movers: [] })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mountDesk(layout: WindowLayout, onLayoutChange = vi.fn(), context?: () => ReportWindowContext) {
  return render(() => (
    <UIProvider>
      <ReportWindowDesk
        layout={layout}
        onLayoutChange={onLayoutChange}
        canvas={CANVAS}
        context={context}
      />
    </UIProvider>
  ));
}

describe("report window desk", () => {
  it("renders the shared window canvas plus an empty state when there are no windows", () => {
    mountDesk({ name: "Blank", windows: [] });
    expect(screen.getByTestId("window-manager-canvas")).toBeInTheDocument();
    const empty = screen.getByTestId("report-window-empty");
    expect(empty).toBeInTheDocument();
    expect(empty).toHaveAttribute("role", "status");
    expect(empty).toHaveTextContent(/No report windows open/);
    expect(screen.queryAllByRole("region")).toHaveLength(0);
  });

  it("renders labelled, focusable regions and does not steal focus on mount", () => {
    const layout = defaultReportLayout(CANVAS);
    mountDesk(layout);
    expect(screen.getByTestId("window-manager-canvas")).toBeInTheDocument();
    expect(screen.queryByTestId("report-window-empty")).not.toBeInTheDocument();

    const regions = screen.getAllByRole("region");
    expect(regions).toHaveLength(layout.windows.length);
    for (const win of layout.windows) {
      const region = screen.getByRole("region", { name: win.title });
      expect(region).toHaveAttribute("tabindex", "0");
    }
    expect(document.activeElement).not.toBe(regions[0]);
  });

  it("inherits WindowManager keyboard parity: arrows move the focused frame by 10px", () => {
    const layout = defaultReportLayout(CANVAS);
    const onLayoutChange = vi.fn();
    mountDesk(layout, onLayoutChange);
    const region = screen.getByRole("region", { name: "INDEX CHART" });
    fireEvent.keyDown(region, { key: "ArrowRight" });

    expect(onLayoutChange).toHaveBeenCalled();
    const next = onLayoutChange.mock.lastCall?.[0] as WindowLayout | undefined;
    expect(next?.windows[0].x).toBe(layout.windows[0].x + 10);
    expect(next?.windows[0].y).toBe(layout.windows[0].y);
  });

  it("wires the report store through the context bag for store-dependent panels", () => {
    const [context, setContext] = createSignal<ReportWindowContext>({
      symbol: "NIFTY",
      market: "india",
      reportStore: null,
    });
    const layout = {
      name: "Main",
      windows: [
        {
          id: "chart-1", type: "chart", title: "INDEX CHART",
          x: 8, y: 8, w: 600, h: 400, z: 1,
        },
      ],
    };
    mountDesk(layout, vi.fn(), context);
    expect(screen.getByTestId("chart-empty")).toHaveTextContent(/Report store not connected/);

    setContext({
      symbol: "NIFTY",
      market: "india",
      reportStore: {
        data: { loading: () => false, booted: () => true, report: () => null },
        selection: { mode: () => "live" },
      } as unknown as ReportWindowContext["reportStore"],
    });
    expect(screen.getByTestId("chart-empty")).toHaveTextContent(
      /No report data for this selection/,
    );
  });

  it("exposes the config hook contract used by the shell", () => {
    const transport: SavedConfigTransport = {
      get: vi.fn().mockResolvedValue({
        scope: "window.report",
        version: 1,
        saved: false,
        updated_at: "rev-0",
        config: {},
      }),
      put: vi.fn().mockResolvedValue({
        scope: "window.report",
        version: 1,
        saved: true,
        updated_at: "rev-1",
        config: {},
      }),
      del: vi.fn().mockResolvedValue({ deleted: true }),
    };
    function Probe() {
      const config = useReportWindowConfig({ transport });
      return (
        <div
          data-testid="config-probe"
          data-name={config.layout().name}
          data-count={String(config.layout().windows.length)}
          data-context={String(Boolean(config.context()))}
          data-canvas={String(config.canvas()?.w ?? "none")}
        />
      );
    }
    render(() => <UIProvider><Probe /></UIProvider>);
    const probe = screen.getByTestId("config-probe");
    expect(probe).toHaveAttribute("data-name", "Main");
    expect(probe).toHaveAttribute("data-count", "3");
    expect(probe).toHaveAttribute("data-context", "true");
    expect(probe).toHaveAttribute("data-canvas", "none");
  });

  it("keeps the registry and the lazy fallback set aligned", () => {
    expect(REPORT_WINDOW_PANELS.map((spec) => spec.id).sort()).toEqual(
      Object.keys(REPORT_PANEL_FALLBACKS).sort(),
    );
  });
});

/**
 * The window engine is a coordinate canvas: below 620px a 240px-wide frame is
 * unreadable. The stack must be driven by a real `matchMedia` signal so a phone
 * gets six full-width tiles without a second copy of the drag/resize engine.
 */
function narrowMatchMedia(narrow: boolean) {
  const listeners: Array<() => void> = [];
  const mql = {
    matches: narrow,
    media: "(max-width: 619px)",
    onchange: null,
    addListener: vi.fn((fn: () => void) => listeners.push(fn)),
    removeListener: vi.fn((fn: () => void) => {
      const at = listeners.indexOf(fn);
      if (at >= 0) listeners.splice(at, 1);
    }),
    addEventListener: vi.fn((_type: string, fn: () => void) => listeners.push(fn)),
    removeEventListener: vi.fn((_type: string, fn: () => void) => {
      const at = listeners.indexOf(fn);
      if (at >= 0) listeners.splice(at, 1);
    }),
    dispatchEvent: vi.fn(),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => mql));
  return { mql, listeners };
}

describe("report window desk narrow stack", () => {
  it("renders six full-width tiles with one scroll owner below 620px", async () => {
    narrowMatchMedia(true);
    const layout = { name: "Full", windows: resolveReportPreset(getReportPreset("full")!, CANVAS) };
    mountDesk(layout);

    const desk = screen.getByTestId("report-window-desk");
    expect(desk).toHaveAttribute("data-mode", "stack");
    expect(desk.className).toContain("overflow-y-auto");
    expect(desk.className).toContain("overflow-x-hidden");
    // The desktop engine must not paint a second, clipped coordinate canvas.
    expect(screen.queryByTestId("window-manager-canvas")).not.toBeInTheDocument();

    const tiles = layout.windows.map((win) =>
      screen.getByTestId(`report-stack-tile-${win.id}`),
    );
    expect(tiles).toHaveLength(6);
    expect(screen.getAllByRole("region")).toHaveLength(6);

    for (const [index, win] of layout.windows.entries()) {
      const tile = tiles[index];
      expect(tile).toHaveAttribute("role", "region");
      expect(tile).toHaveAttribute("aria-label", win.title);
      // Full width, never an absolutely positioned 240px frame.
      expect(tile.style.width).toBe("100%");
      expect(tile.style.maxWidth).toBe("100%");
      expect(tile.style.position).not.toBe("absolute");
      expect(tile.className).toContain("w-full");

      const header = screen.getByTestId(`report-stack-header-${win.id}`);
      expect(header).toHaveTextContent(win.title);
      const body = screen.getByTestId(`report-stack-body-${win.id}`);
      expect(body.className).toContain("w-full");
      expect(body.className).toContain("overflow-hidden");
      expect(body.className).not.toContain("overflow-y-auto");
      expect(body.style.height).toBe("280px");
    }

    // Only the desk root owns vertical scrolling; tile chrome never does.
    const chrome = [
      desk,
      ...tiles,
      ...layout.windows.map((win) => screen.getByTestId(`report-stack-header-${win.id}`)),
      ...layout.windows.map((win) => screen.getByTestId(`report-stack-body-${win.id}`)),
    ];
    const scrollOwners = chrome.filter((el) =>
      /overflow-(y-)?auto|overflow-y-scroll/.test(el.className),
    );
    expect(scrollOwners).toEqual([desk]);

    // Registered specs still mount their real panels — no fabricated data.
    for (const key of ["chart", "chain", "walls", "flow", "analytics", "movers"]) {
      expect(await screen.findByTestId(`report-${key}-window`)).toBeInTheDocument();
    }
  });

  it("keeps the empty state in narrow mode", () => {
    narrowMatchMedia(true);
    mountDesk({ name: "Blank", windows: [] });
    const empty = screen.getByTestId("report-window-empty");
    expect(empty).toBeInTheDocument();
    expect(empty).toHaveAttribute("role", "status");
    expect(screen.queryAllByRole("region")).toHaveLength(0);
  });

  it("keeps the desktop window engine at 620px and above", () => {
    narrowMatchMedia(false);
    const layout = { name: "Full", windows: resolveReportPreset(getReportPreset("full")!, CANVAS) };
    mountDesk(layout);
    const desk = screen.getByTestId("report-window-desk");
    expect(desk).toHaveAttribute("data-mode", "window");
    expect(screen.getByTestId("window-manager-canvas")).toBeInTheDocument();
    expect(screen.getAllByRole("region")).toHaveLength(layout.windows.length);
  });

  it("subscribes to media changes and detaches the listener on unmount", () => {
    const { mql } = narrowMatchMedia(true);
    const view = mountDesk({ name: "Blank", windows: [] });
    expect(mql.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    view.unmount();
    expect(mql.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });
});
