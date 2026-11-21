// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalystToday } from "@/api/catalysts";
import { HomeMonitorView } from "./HomeMonitorView";

const store = vi.hoisted(() => ({
  data: null as unknown,
  loading: false,
  error: null as string | null,
  refresh: vi.fn(),
}));

const registry = vi.hoisted(() => ({
  specs: new Map<string, unknown>(),
  catalystMounts: 0,
}));

vi.mock("@/state/catalystStore", () => ({
  useCatalystToday: () => ({
    data: () => store.data,
    loading: () => store.loading,
    error: () => store.error,
    sector: () => "auto",
    sectors: () => [],
    setSector: () => {},
    refresh: store.refresh,
  }),
}));

vi.mock("@/components/window/panelRegistry", () => ({
  getPanelSpec: (id: string) => registry.specs.get(id),
}));

function snapshot(overrides: Partial<CatalystToday> = {}): CatalystToday {
  return {
    as_of: "2026-11-19T11:13:00+05:30",
    market: {
      nifty: { last: 25304.2, change_pct: 0.3 },
      sensex: { last: 82300, change_pct: 0.4 },
      vix: 16.31,
    },
    sector: {
      id: "auto",
      label: "NIFTY AUTO",
      change_pct: 3.75,
      relative_strength_pct: 3.45,
      breadth: { advancing: 12, declining: 3, total: 15 },
    },
    available_sectors: [
      { id: "auto", label: "NIFTY AUTO", count: 15 },
      { id: "it", label: "NIFTY IT", count: 10 },
    ],
    rows: [],
    counts: { high: 2, medium: 1, low: 0, total: 3 },
    warnings: [],
    ...overrides,
  };
}

function spec(id: string, title: string, counter: "catalystMounts") {
  return {
    id,
    page: "report",
    title,
    size: 1,
    minWidth: 320,
    singleton: true,
    requires: [],
    mount: () => {
      registry[counter] += 1;
      return <div data-testid={`${id}-panel`}>{title}</div>;
    },
  };
}

/** `useMediaQuery` resolves each query against this width at mount time. */
function stubWidth(width: number) {
  vi.stubGlobal("matchMedia", ((query: string) => {
    const match = /min-width:\s*(\d+)px/.exec(query);
    const matches = match ? width >= Number(match[1]) : false;
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia);
}

const columns = () => screen.getByTestId("home-monitor-view").getAttribute("data-columns");

beforeEach(() => {
  store.data = snapshot();
  store.loading = false;
  store.error = null;
  store.refresh.mockClear();
  registry.catalystMounts = 0;
  registry.specs.clear();
  registry.specs.set("catalyst.radar", spec("catalyst.radar", "CATALYST RADAR", "catalystMounts"));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HomeMonitorView", () => {
  it("(3 columns) a 1600px monitor renders the radar once with the auto pulse and plan beside it", () => {
    stubWidth(1600);
    render(() => <HomeMonitorView />);

    const view = screen.getByTestId("home-monitor-view");
    expect(columns()).toBe("3");
    expect(view.style.gridTemplateColumns).toContain("42fr");
    expect(view.style.gridTemplateColumns).toContain("34fr");
    expect(view.style.gridTemplateColumns).toContain("24fr");

    expect(screen.getAllByTestId("catalyst.radar-panel")).toHaveLength(1);
    expect(registry.catalystMounts).toBe(1);
    expect(screen.getByTestId("monitor-auto-pulse")).toHaveTextContent("NIFTY AUTO");
    expect(screen.getByTestId("home-session-plan")).toBeInTheDocument();
    expect(screen.getByTestId("monitor-auto-leaders")).toBeInTheDocument();
    expect(screen.getByTestId("monitor-catalyst-news")).toBeInTheDocument();
  });

  it("(2 columns) a 900px monitor collapses to two columns without losing a region", () => {
    stubWidth(900);
    render(() => <HomeMonitorView />);

    expect(columns()).toBe("2");
    expect(screen.getByTestId("catalyst.radar-panel")).toBeInTheDocument();
    expect(screen.getByTestId("monitor-auto-pulse")).toBeInTheDocument();
    expect(screen.getByTestId("home-session-plan")).toBeInTheDocument();
    expect(screen.getByTestId("monitor-catalyst-news")).toBeInTheDocument();
  });

  it("(1 column) a 390px monitor stacks and scrolls vertically without horizontal overflow", () => {
    stubWidth(390);
    render(() => <HomeMonitorView />);

    const view = screen.getByTestId("home-monitor-view");
    expect(columns()).toBe("1");
    expect(view).toHaveClass("overflow-y-auto");
    expect(view).toHaveClass("overflow-x-hidden");
    expect(screen.getByTestId("catalyst.radar-panel")).toBeInTheDocument();
    expect(screen.getByTestId("home-session-plan")).toBeInTheDocument();
  });

  it("(plan) six checks carry values and explicit pass/fail; a missing volume is pending, not a pass", () => {
    stubWidth(1600);
    render(() => <HomeMonitorView />);

    for (const id of ["scheduled", "demand", "positioning", "relative-strength", "breadth", "volume"]) {
      expect(screen.getByTestId(`session-check-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("session-check-demand")).toHaveAttribute("data-status", "pass");
    expect(screen.getByTestId("session-check-demand")).toHaveTextContent("+3.75%");
    expect(screen.getByTestId("session-check-breadth")).toHaveAttribute("data-status", "pass");
    expect(screen.getByTestId("session-check-breadth")).toHaveTextContent("12 / 3 of 15");
    // No row carries rel_volume in this fixture: the plan must say N/A, not green.
    expect(screen.getByTestId("session-check-volume")).toHaveAttribute("data-status", "pending");
    expect(screen.getByTestId("session-check-volume")).toHaveTextContent("—");
  });

  it("(loading) the first load is explicit in the auto pulse and session plan", () => {
    stubWidth(1600);
    store.data = null;
    store.loading = true;
    render(() => <HomeMonitorView />);

    expect(screen.getByTestId("monitor-auto-loading")).toHaveTextContent("Loading sector pulse");
    expect(screen.getByTestId("session-plan-loading")).toHaveTextContent("Loading session plan");
  });

  it("(error) a dead catalyst source shows an explicit retry, not a blank grid", () => {
    stubWidth(1600);
    store.data = null;
    store.error = "Catalyst feed unavailable";
    render(() => <HomeMonitorView />);

    const autoError = screen.getByTestId("monitor-auto-error");
    expect(autoError).toHaveTextContent("Catalyst feed unavailable");
    expect(screen.getByTestId("session-plan-error")).toHaveTextContent("Catalyst feed unavailable");

    fireEvent.click(within(autoError).getByRole("button", { name: "Retry" }));
    expect(store.refresh).toHaveBeenCalledTimes(1);
  });

  it("(empty sector) a snapshot without a sector marks the sector checks pending instead of inventing values", () => {
    stubWidth(1600);
    store.data = snapshot({ sector: null });
    render(() => <HomeMonitorView />);

    expect(screen.getByTestId("monitor-auto-empty")).toHaveTextContent("no sector pulse");
    for (const id of ["demand", "relative-strength", "breadth"]) {
      expect(screen.getByTestId(`session-check-${id}`)).toHaveAttribute("data-status", "pending");
      expect(screen.getByTestId(`session-check-${id}-value`)).toHaveTextContent("—");
    }
  });

  it("(unregistered panel) a missing radar spec is an explicit gap", () => {
    stubWidth(1600);
    registry.specs.delete("catalyst.radar");
    render(() => <HomeMonitorView />);

    expect(screen.getByTestId("monitor-region-catalyst-missing")).toHaveTextContent(
      "CATALYST RADAR panel is not registered",
    );
    expect(screen.queryByTestId("catalyst.radar-panel")).not.toBeInTheDocument();
  });
});
