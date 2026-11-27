// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalystToday } from "@/api/catalysts";
import { __resetCatalystStore } from "@/state/catalystStore";
import { clearHomeDerivedCache } from "./homeDerivedCache";
import { HomeMonitorView } from "./HomeMonitorView";

type Listener = (event: { matches: boolean }) => void;

const media = vi.hoisted(() => ({
  listeners: new Map<string, Set<Listener>>(),
  radarMounts: 0,
}));

/** The radar is a real catalyst subscriber; keep its subscription in the model. */
vi.mock("@/components/window/panelRegistry", async () => {
  const { useCatalystToday } = await import("@/state/catalystStore");
  return {
    getPanelSpec: (id: string) =>
      id === "catalyst.radar"
        ? {
            id,
            page: "report",
            title: "CATALYST RADAR",
            size: 1,
            minWidth: 320,
            singleton: true,
            requires: [],
            mount: () => {
              media.radarMounts += 1;
              useCatalystToday();
              return <div data-testid="radar-panel" />;
            },
          }
        : undefined,
  };
});

const SNAPSHOT: CatalystToday = {
  as_of: "2026-11-22T11:13:00+05:30",
  market: {
    nifty: { last: 25304.2, change_pct: 0.3 },
    sensex: { last: 82300, change_pct: 0.4 },
    vix: 16.31,
  },
  sector: {
    id: "all",
    label: "MARKET",
    change_pct: 0.3,
    relative_strength_pct: 0,
    breadth: { advancing: 1793, declining: 1698, total: 3586 },
  },
  available_sectors: [],
  rows: [],
  counts: { high: 2, medium: 1, low: 0, total: 3 },
  warnings: [],
};

const json = (body: unknown): Response => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(JSON.stringify(body)),
} as unknown as Response);

let width = 1600;
let catalystFetches = 0;

function setWidth(next: number): void {
  width = next;
  for (const [query, handlers] of media.listeners) {
    const matches = width >= Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    for (const handler of handlers) handler({ matches } as MediaQueryListEvent);
  }
}

beforeEach(() => {
  width = 1600;
  catalystFetches = 0;
  media.radarMounts = 0;
  media.listeners.clear();
  clearHomeDerivedCache();
  __resetCatalystStore();

  vi.stubGlobal("matchMedia", ((query: string) => ({
    get matches() {
      return width >= Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, handler: Listener) => {
      const handlers = media.listeners.get(query) ?? new Set<Listener>();
      handlers.add(handler);
      media.listeners.set(query, handlers);
    },
    removeEventListener: (_type: string, handler: Listener) => {
      media.listeners.get(query)?.delete(handler);
    },
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as typeof window.matchMedia);

  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/catalysts/today")) {
      catalystFetches += 1;
      return json(SNAPSHOT);
    }
    return json({});
  }));
});

afterEach(() => {
  cleanup();
  __resetCatalystStore();
  clearHomeDerivedCache();
  vi.unstubAllGlobals();
});

describe("Home Monitor cache lifetime", () => {
  it("reflows the layout without re-fetching the unchanged catalyst snapshot", async () => {
    render(() => <HomeMonitorView />);
    await waitFor(() => expect(catalystFetches).toBe(1));
    expect(screen.getByTestId("home-monitor-view")).toHaveAttribute("data-columns", "3");
    expect(media.radarMounts).toBe(1);

    setWidth(900);
    await waitFor(() =>
      expect(screen.getByTestId("home-monitor-view")).toHaveAttribute("data-columns", "2"),
    );
    setWidth(390);
    await waitFor(() =>
      expect(screen.getByTestId("home-monitor-view")).toHaveAttribute("data-columns", "1"),
    );
    setWidth(1600);
    await waitFor(() =>
      expect(screen.getByTestId("home-monitor-view")).toHaveAttribute("data-columns", "3"),
    );

    // Every reflow unmounts and remounts all five regions (four owned here plus
    // the radar). A stable view-level lease keeps the store's consumer count
    // above zero, so its cached payload and timer survive the swap.
    expect(catalystFetches).toBe(1);
    expect(media.radarMounts).toBe(4);
    expect(screen.getAllByTestId("radar-panel")).toHaveLength(1);
  });
});
