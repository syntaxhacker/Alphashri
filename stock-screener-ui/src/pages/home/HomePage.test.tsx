// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { UserConfig } from "../../api/userConfigs";
import type { CanvasSize } from "../../components/window/layout";
import type { WindowLayout, WindowState } from "../../components/window/types";
import type { SavedConfigTransport } from "../../state/savedConfig";
import { __resetCatalystStore } from "../../state/catalystStore";
import { HomePage } from "./HomePage";
import { HOME_PANELS, normalizeHomeConfig, type HomeWindowConfig } from "./homePanels";

const CANVAS: CanvasSize = { w: 1280, h: 800 };

/** Path + query are the contract: a wrong universe or cap would no longer match. */
const SNAPSHOT_URL = /\/api\/market\/snapshot\?universe=all_equity&limit=4000$/;
const CHAIN_URL = /\/api\/options\/chain\//;
/** The options panels now pick an expiry from the real listing instead of a text field. */
const EXPIRIES_URL = /\/api\/(reports\/nifty\/expiries|options\/expiries\/)/;
/** Sector windows are real registered panels now, so they fetch on mount. */
const SECTOR_URL = /\/api\/sector\?market=india$/;
/** The Monitor is the default surface; the feed always sends the sector explicitly. */
const CATALYST_URL = /\/api\/catalysts\/today\?market=india&sector=all$/;
const NEWS_URL = /\/api\/news\?limit=50$/;
const NEWS_SOURCES_URL = /\/api\/news\/sources$/;

const MARKET_SNAPSHOT_PAYLOAD = {
  as_of: "2026-11-19T10:00:00+05:30",
  universe: "all_equity",
  total: 0,
  update_mode: "delayed",
  rows: [],
};
const CHAIN_PAYLOAD = { expiry: "2026-11-26", spot: 24000, chain: [] };
const EXPIRIES_PAYLOAD = { expiries: [{ date: "2026-11-26" }, { date: "2026-12-03" }] };
const SECTOR_PAYLOAD = {
  sectors: [],
  top_stock_movers: [],
  last_updated: "2026-11-19T10:00:00+05:30",
  market: "india",
};
const CATALYST_PAYLOAD = {
  as_of: "2026-11-19T11:13:00+05:30",
  market: {
    nifty: { last: 25304.2, change_pct: 0.3 },
    sensex: { last: 82300, change_pct: 0.4 },
    vix: 16.31,
  },
  sector: {
    id: "all",
    label: "MARKET",
    change_pct: 0.3,
    relative_strength_pct: 0.0,
    breadth: { advancing: 1793, declining: 1698, total: 3586 },
  },
  available_sectors: [
    { id: "all", label: "MARKET", count: 3589 },
    { id: "technology-services", label: "TECHNOLOGY SERVICES", count: 195 },
  ],
  rows: [],
  counts: { high: 2, medium: 1, low: 0, total: 3 },
  warnings: [],
};
const NEWS_PAYLOAD = { items: [] };
const NEWS_SOURCES_PAYLOAD = { sources: [] };

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/** Write the value outside Solid's tracker, then notify both native listeners. */
function selectOption(el: HTMLElement, value: string) {
  const select = el as HTMLSelectElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  if (setter) setter.call(select, value);
  else select.value = value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Boundary mock: every HTTP call is intercepted here. An unrecognised URL throws
 * instead of reaching localhost:8765, so a new panel that fetches on mount fails
 * its test rather than silently hitting the network.
 */
function makeFetchMock() {
  const unexpected: string[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (SNAPSHOT_URL.test(url)) return jsonResponse(MARKET_SNAPSHOT_PAYLOAD);
    if (EXPIRIES_URL.test(url)) return jsonResponse(EXPIRIES_PAYLOAD);
    if (CHAIN_URL.test(url)) return jsonResponse(CHAIN_PAYLOAD);
    if (SECTOR_URL.test(url)) return jsonResponse(SECTOR_PAYLOAD);
    if (CATALYST_URL.test(url)) return jsonResponse(CATALYST_PAYLOAD);
    if (NEWS_SOURCES_URL.test(url)) return jsonResponse(NEWS_SOURCES_PAYLOAD);
    if (NEWS_URL.test(url)) return jsonResponse(NEWS_PAYLOAD);
    unexpected.push(url);
    throw new Error(`Unexpected network request in HomePage unit test: ${url}`);
  });
  return { mock, unexpected };
}

let fetchMock: ReturnType<typeof makeFetchMock>["mock"];
let unexpectedUrls: string[];

beforeEach(() => {
  const net = makeFetchMock();
  fetchMock = net.mock;
  unexpectedUrls = net.unexpected;
  vi.stubGlobal("fetch", fetchMock);
  // The snapshot hook persists rows in sessionStorage; start every test cold.
  sessionStorage.clear();
  __resetCatalystStore();
});

function envelope(
  config: Record<string, unknown>,
  saved: boolean,
): UserConfig<Record<string, unknown>> {
  return {
    scope: "window.home",
    version: 1,
    saved,
    updated_at: "rev-0",
    config,
  };
}

const win = (over: Partial<WindowState>): WindowState => ({
  id: "w",
  type: "sector.table",
  title: "CHART",
  x: 24,
  y: 24,
  w: 420,
  h: 260,
  z: 1,
  ...over,
});

function config(layouts: WindowLayout[], active: string): Record<string, unknown> {
  return { v: 1, active, layouts };
}

function makeTransport(saved?: Record<string, unknown>) {
  const get = vi.fn<SavedConfigTransport["get"]>().mockResolvedValue(
    envelope(saved ?? {}, saved != null),
  );
  const put = vi.fn<SavedConfigTransport["put"]>().mockImplementation(async (_scope, cfg) =>
    envelope(cfg as Record<string, unknown>, true),
  );
  const del = vi.fn<SavedConfigTransport["del"]>().mockResolvedValue({ scope: "window.home", deleted: true });
  return { transport: { get, put, del }, get, put, del };
}

function mountHome(transport: SavedConfigTransport, canvas: CanvasSize = CANVAS) {
  return render(() => (
    <UIProvider>
      <HomePage transport={transport} canvas={canvas} />
    </UIProvider>
  ));
}

/** Monitor is the default surface; desk tests opt in explicitly. */
function goDesk() {
  fireEvent.click(screen.getByTestId("home-view-desk"));
}

const VIEWPORT = { w: window.innerWidth, h: window.innerHeight };
/** Live shell: the viewport is larger than the window canvas (sidebar + toolbar). */
function stubViewport(w: number, h: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: w });
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: h });
}

const box = (id: string) => screen.getByTestId(`window-${id}`) as HTMLElement;
const left = (id: string) => Number.parseFloat(box(id).style.left);
const requestedUrls = () => fetchMock.mock.calls.map(([url]) => String(url));

afterEach(() => {
  cleanup();
  __resetCatalystStore();
  stubViewport(VIEWPORT.w, VIEWPORT.h);
  vi.unstubAllGlobals();
  expect(unexpectedUrls, `unexpected network calls: ${unexpectedUrls.join(", ")}`).toEqual([]);
});

describe("HOME window desk", () => {
  it("(seed) first visit shows a non-empty Main desk with named layout tabs", async () => {
    const { transport } = makeTransport();
    mountHome(transport);
    goDesk();

    // The empty state only appears after the mocked snapshot fetch has settled.
    await screen.findByTestId("market-heatmap-panel", {}, { timeout: 5000 });
    await screen.findByTestId("market-heatmap-empty", {}, { timeout: 5000 });
    expect(screen.getByTestId("market-heatmap-panel")).toBeInTheDocument();
    // Every desk window is a lazy chunk with its own boundary, so a settled
    // heatmap says nothing about the options window. Await it on its own or the
    // assertion races the dynamic import on a loaded runner.
    expect(await screen.findByTestId("options-chain-window")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(SNAPSHOT_URL),
      expect.anything(),
    );
    expect(screen.getByTestId("home-layout-tab-main")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("home-layout-tab-blank")).toBeInTheDocument();
    expect(screen.getByTestId("home-layout-tab-macro")).toBeInTheDocument();
    expect(screen.getByTestId("window-manager-canvas")).toBeInTheDocument();
  });

  it("(canvas) the first-run seed is normalised to the real canvas, not the viewport", async () => {
    stubViewport(1920, 950);
    const canvas = { w: 1740, h: 765 };
    const { transport } = makeTransport();
    mountHome(transport, canvas);
    goDesk();

    await screen.findByTestId("market-heatmap-panel");
    for (const id of ["market.heatmap-1", "options.chain-2"]) {
      const el = box(id);
      const right = Number.parseFloat(el.style.left) + Number.parseFloat(el.style.width);
      const bottom = Number.parseFloat(el.style.top) + Number.parseFloat(el.style.height);
      expect(right, `${id} right edge`).toBeLessThanOrEqual(canvas.w);
      expect(bottom, `${id} bottom edge`).toBeLessThanOrEqual(canvas.h);
    }
  });

  it("(add) the picker adds a window at a cascaded offset and persists it", async () => {
    const { transport, put } = makeTransport();
    mountHome(transport);
    goDesk();

    await screen.findByTestId("market-heatmap-panel");
    const seededX = left("options.chain-2");
    selectOption(screen.getByLabelText("Add window"), "sector.detail");

    await screen.findByTestId("sector-detail-panel");
    expect(left("sector.detail-3") - seededX).toBe(24);

    await waitFor(() => expect(put).toHaveBeenCalled(), { timeout: 2000 });
    const [scope, payload] = put.mock.lastCall!;
    expect(scope).toBe("window.home");
    const saved = payload as unknown as HomeWindowConfig;
    expect(saved.active).toBe("Main");
    expect(saved.layouts[0].windows.map((w) => w.type)).toEqual([
      "market.heatmap", "options.chain", "sector.detail",
    ]);
  });

  it("(h) named layout tabs persist and restore their windows separately", async () => {
    const { transport, put } = makeTransport(
      config(
        [
          { name: "Main", windows: [win({ id: "chart", type: "sector.table" })] },
          {
            name: "Blank",
            windows: [win({ id: "walls", type: "sector.movers", title: "WALLS" })],
          },
        ],
        "Main",
      ),
    );
    mountHome(transport);
    goDesk();

    await screen.findByTestId("sector-table-panel");
    expect(screen.queryByTestId("sector-movers-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("home-layout-tab-blank"));
    expect(screen.getByTestId("sector-movers-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("sector-table-panel")).not.toBeInTheDocument();

    selectOption(screen.getByLabelText("Add window"), "sector.detail");
    await screen.findByTestId("sector-detail-panel");

    fireEvent.click(screen.getByTestId("home-layout-tab-main"));
    expect(screen.getByTestId("sector-table-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("sector-detail-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("home-layout-tab-blank"));
    expect(screen.getByTestId("sector-movers-panel")).toBeInTheDocument();
    expect(screen.getByTestId("sector-detail-panel")).toBeInTheDocument();

    await waitFor(() => expect(put).toHaveBeenCalled(), { timeout: 2000 });
    const saved = put.mock.lastCall![1] as unknown as HomeWindowConfig;
    expect(saved.active).toBe("Blank");
    expect(saved.layouts.map((l) => l.name)).toEqual(["Main", "Blank"]);
    expect(saved.layouts[0].windows).toHaveLength(1);
    expect(saved.layouts[1].windows.map((w) => w.type)).toEqual(["sector.movers", "sector.detail"]);
  });

  it("(degrade) saved unknown panel types are dropped and rects are clamped", async () => {
    const { transport } = makeTransport(
      config(
        [
          {
            name: "Main",
            windows: [
              win({ id: "ghost", type: "removed.panel", title: "GONE" }),
              win({ id: "walls", type: "sector.movers", title: "WALLS", x: 9999, y: -9999, w: -5, h: 0 }),
            ],
          },
        ],
        "Main",
      ),
    );
    mountHome(transport);
    goDesk();

    await screen.findByTestId("sector-movers-panel");
    expect(screen.queryByTestId("window-ghost")).not.toBeInTheDocument();
    const el = box("walls");
    expect(Number.parseFloat(el.style.left)).toBeLessThanOrEqual(CANVAS.w - 60);
    expect(el.style.top).toBe("0px");
    expect(Number.parseFloat(el.style.width)).toBeGreaterThanOrEqual(240);
  });

  it("(new screen) 'New screen' creates and switches to a fresh empty workspace", async () => {
    const { transport, put } = makeTransport(
      config([{ name: "Main", windows: [win({ id: "chart", type: "sector.table" })] }], "Main"),
    );
    mountHome(transport);
    goDesk();

    await screen.findByTestId("sector-table-panel");
    fireEvent.click(screen.getByTestId("home-new-screen"));

    expect(screen.getByTestId("home-layout-tab-screen-2")).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("sector-table-panel")).not.toBeInTheDocument();
    await waitFor(() => expect(put).toHaveBeenCalled(), { timeout: 2000 });
    const saved = put.mock.lastCall![1] as unknown as HomeWindowConfig;
    expect(saved.layouts.map((l) => l.name)).toEqual(["Main", "Screen 2"]);
    expect(saved.active).toBe("Screen 2");
    expect(saved.layouts[1].windows).toEqual([]);
  });

  it("(chrome) toolbar has no free-text context inputs and a plain HOME title", () => {
    const { transport } = makeTransport();
    mountHome(transport);
    goDesk();

    const toolbar = screen.getByTestId("home-toolbar");
    expect(toolbar).toHaveTextContent("HOME");
    expect(toolbar).toHaveTextContent("Monitor");
    expect(toolbar).toHaveTextContent("Desk");
    const withinToolbar = within(toolbar);
    expect(withinToolbar.queryByTestId("home-symbol-input")).not.toBeInTheDocument();
    expect(withinToolbar.queryByTestId("home-expiry-input")).not.toBeInTheDocument();
    expect(withinToolbar.queryByLabelText("Symbol")).not.toBeInTheDocument();
    expect(withinToolbar.queryByLabelText("Expiry")).not.toBeInTheDocument();
    // The controls live in the options-chain window body, not the app chrome.
    // The expiry is a picker fed from the exchange listing, so it carries the
    // same testid but a different element type than the old text field.
    expect(screen.getByTestId("options-chain-window")).toHaveTextContent("CHAIN");
    expect(screen.getByTestId("options-chain-symbol-input")).toBeInTheDocument();
    expect(screen.getByTestId("options-chain-expiry-input")).toBeInTheDocument();
  });

  it("(chrome) picker, layout tabs, Fit all and Lock stay present and keyboard reachable", () => {
    const { transport } = makeTransport();
    mountHome(transport);
    goDesk();

    expect(screen.getByLabelText("Add window").tagName).toBe("SELECT");
    for (const id of [
      "home-layout-tab-main",
      "home-layout-tab-blank",
      "home-layout-tab-macro",
      "home-new-screen",
    ]) {
      expect(screen.getByTestId(id).tagName).toBe("BUTTON");
    }

    const fitAll = screen.getByTestId("window-fit-all");
    expect(fitAll.tagName).toBe("BUTTON");
    expect(fitAll).toHaveTextContent("Fit all windows");

    const lock = screen.getByTestId("window-lock-toggle");
    expect(lock.tagName).toBe("BUTTON");
    expect(lock).toHaveTextContent("Lock");
  });

  it("(no context) adding a window still renders the panel with no context input", async () => {
    const { transport } = makeTransport();
    mountHome(transport);
    goDesk();

    await screen.findByTestId("market-heatmap-panel");
    const withinToolbar = within(screen.getByTestId("home-toolbar"));
    expect(withinToolbar.queryByTestId("home-symbol-input")).not.toBeInTheDocument();
    expect(withinToolbar.queryByTestId("home-expiry-input")).not.toBeInTheDocument();
    expect(withinToolbar.queryByLabelText("Symbol")).not.toBeInTheDocument();
    expect(withinToolbar.queryByLabelText("Expiry")).not.toBeInTheDocument();
    // No expiry in HOME context: the chain panel stays empty and never fetches.
    expect(requestedUrls().some((url) => CHAIN_URL.test(url))).toBe(false);

    selectOption(screen.getByLabelText("Add window"), "sector.detail");
    await screen.findByTestId("sector-detail-panel");
    expect(screen.getByTestId("sector-detail-panel")).toHaveTextContent("SECTOR DETAIL");
    expect(screen.getByTestId("sector-detail-panel")).not.toHaveTextContent("2026-11-26");
  });

  it("(registry) HOME panels declare no external context requirements", () => {
    for (const spec of HOME_PANELS) {
      expect(spec.requires, spec.id).toEqual([]);
    }
  });

  it("(picker) the removed report stub panels are no longer offered", async () => {
    const { transport } = makeTransport();
    mountHome(transport);
    goDesk();

    await screen.findByTestId("market-heatmap-panel");
    const optionValues = Array.from(
      (screen.getByLabelText("Add window") as HTMLSelectElement).options,
    ).map((option) => option.value);
    for (const removed of ["report.chart", "report.walls", "report.breadth"]) {
      expect(optionValues, removed).not.toContain(removed);
    }
    // Positive guard so the negative assertion cannot pass on an empty picker.
    expect(optionValues).toContain("sector.table");
    expect(optionValues).toContain("sector.movers");
  });

  it("(degrade) a saved layout naming a removed report stub drops it and keeps the rest", () => {
    const raw = config(
      [
        {
          name: "Main",
          windows: [
            win({ id: "stale-chart", type: "report.chart", title: "CHART" }),
            win({ id: "real", type: "sector.table", title: "SECTOR PERFORMANCE" }),
          ],
        },
      ],
      "Main",
    );

    const normalized = normalizeHomeConfig(raw, CANVAS);
    expect(normalized).not.toBeNull();
    expect(normalized!.layouts[0].windows.map((w) => w.id)).toEqual(["real"]);
    expect(normalized!.layouts[0].windows[0].type).toBe("sector.table");
  });
});

describe("HOME monitor", () => {
  it("(default) Monitor is the first surface: pulse bar, session plan, no window manager", async () => {
    const { transport } = makeTransport();
    mountHome(transport);

    expect(screen.getByTestId("home-monitor-view")).toBeInTheDocument();
    expect(screen.getByTestId("home-pulse-bar")).toBeInTheDocument();
    expect(screen.getByTestId("home-session-plan")).toBeInTheDocument();
    expect(screen.getByTestId("home-view-monitor")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("home-view-desk")).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("window-manager-canvas")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-layout-tabs")).not.toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByTestId("pulse-refresh")).toHaveTextContent("LIVE"),
    );
  });

  it("(toggle) Desk mounts the window manager and Monitor unmounts it", async () => {
    const { transport } = makeTransport();
    mountHome(transport);
    goDesk();

    expect(await screen.findByTestId("window-manager-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("home-layout-tabs")).toBeInTheDocument();
    expect(screen.queryByTestId("home-monitor-view")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-pulse-bar")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("home-view-monitor"));
    expect(screen.getByTestId("home-monitor-view")).toBeInTheDocument();
    expect(screen.queryByTestId("window-manager-canvas")).not.toBeInTheDocument();
  });

  it("(preserve) toggling to Monitor and back keeps the saved desk and writes nothing", async () => {
    const saved = config(
      [{ name: "Main", windows: [win({ id: "chart", type: "sector.table" })] }],
      "Main",
    );
    const { transport, put } = makeTransport(saved);
    mountHome(transport);
    goDesk();

    expect(await screen.findByTestId("sector-table-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("home-view-monitor"));
    expect(screen.queryByTestId("sector-table-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("home-view-desk"));
    expect(await screen.findByTestId("sector-table-panel")).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });

  it("(no writes) Monitor does not persist a window layout it never rendered", async () => {
    const { transport, put } = makeTransport();
    mountHome(transport);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(CATALYST_URL),
        expect.anything(),
      ),
    );
    expect(put).not.toHaveBeenCalled();
  });
});

describe("HOME panel settings persistence", () => {
  const metric = () =>
    screen.getByTestId("market-heatmap-metric").querySelector("select") as HTMLSelectElement;

  it("(e) rapid metric changes produce one debounced save, not one per change", async () => {
    const { transport, put } = makeTransport();
    mountHome(transport);
    goDesk();
    await screen.findByTestId("market-heatmap-panel");

    const before = put.mock.calls.length;
    fireEvent.input(metric(), { target: { value: "rsi" } });
    fireEvent.input(metric(), { target: { value: "pe_ratio" } });
    fireEvent.input(metric(), { target: { value: "pb_ratio" } });

    await waitFor(() => expect(put.mock.calls.length).toBe(before + 1), { timeout: 2500 });
    const saved = put.mock.lastCall![1] as unknown as HomeWindowConfig;
    expect(saved.layouts[0].windows[0].settings?.sizeBy).toBe("pb_ratio");
  });

  it("(f) each tab keeps its own heatmap settings across a tab switch", async () => {
    const saved = config(
      [
        {
          name: "Main",
          windows: [{
            ...win({ id: "hm-main", type: "market.heatmap", title: "HEATMAP" }),
            settings: { sizeBy: "rsi" },
          }],
        },
        {
          name: "Blank",
          windows: [{
            ...win({ id: "hm-blank", type: "market.heatmap", title: "HEATMAP 2" }),
            settings: { sizeBy: "pe_ratio" },
          }],
        },
      ],
      "Main",
    );
    const { transport } = makeTransport(saved);
    mountHome(transport);
    goDesk();

    await screen.findByTestId("market-heatmap-panel");
    expect(metric().value).toBe("rsi");

    fireEvent.click(screen.getByTestId("home-layout-tab-blank"));
    await waitFor(() => expect(metric().value).toBe("pe_ratio"));

    fireEvent.click(screen.getByTestId("home-layout-tab-main"));
    await waitFor(() => expect(metric().value).toBe("rsi"));
  });
});
