import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Component } from "solid-js";
import { MemoryRouter, Route } from "@solidjs/router";
import { Notifications } from "@/ui";
import { AuthContext } from "@/components/auth/AuthProvider2";
import appSource from "../App.tsx?raw";
import { renderWithProviders } from "../test-utils/renderWithProviders";

const chartStub = () => ({
  setOption: () => {},
  resize: () => {},
  dispose: () => {},
  on: () => {},
  off: () => {},
  getOption: () => ({}),
  showLoading: () => {},
  hideLoading: () => {},
  getZr: () => ({ on: () => {}, off: () => {}, setCursorStyle: () => {} }),
  getWidth: () => 800,
  getHeight: () => 400,
  convertToPixel: () => [0, 0],
  dispatchAction: () => {},
});

const seriesStub = () => ({
  setData: () => {},
  update: () => {},
  applyOptions: () => {},
  setMarkers: () => {},
  createPriceLine: () => ({ applyOptions: () => {} }),
  removePriceLine: () => {},
  priceScale: () => ({ applyOptions: () => {} }),
  setVisible: () => {},
  moveToTop: () => {},
});

const lwChartStub = () => ({
  addSeries: () => seriesStub(),
  addLineSeries: () => seriesStub(),
  addCandlestickSeries: () => seriesStub(),
  addBarSeries: () => seriesStub(),
  addAreaSeries: () => seriesStub(),
  addHistogramSeries: () => seriesStub(),
  addBaselineSeries: () => seriesStub(),
  applyOptions: () => {},
  resize: () => {},
  remove: () => {},
  timeScale: () => ({
    fitContent: () => {},
    setVisibleLogicalRange: () => {},
    setVisibleRange: () => {},
    scrollToRealTime: () => {},
    subscribeVisibleLogicalRangeChange: () => {},
    unsubscribeVisibleLogicalRangeChange: () => {},
    timeToCoordinate: () => null,
    coordinateToTime: () => null,
  }),
  priceScale: () => ({ applyOptions: () => {} }),
  subscribeCrosshairMove: () => {},
  unsubscribeCrosshairMove: () => {},
  subscribeClick: () => {},
  unsubscribeClick: () => {},
  takeScreenshot: () => document.createElement("canvas"),
});

vi.mock("@/ui/notifications", () => ({
  showNotification: () => {},
  showSuccess: () => {},
  showError: () => {},
  Notifications: (props: { children?: unknown }) => props.children,
}));

vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: async () => ({ init: chartStub, use: () => {}, registerTheme: () => {}, graphic: {} }),
}));

vi.mock("echarts", () => ({
  init: chartStub,
  use: () => {},
  registerTheme: () => {},
  graphic: {},
  default: { init: chartStub, use: () => {}, registerTheme: () => {}, graphic: {} },
}));

vi.mock("lightweight-charts", () => {
  const api = {
    createChart: lwChartStub,
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
    ColorType: { Solid: "solid" },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    PriceScaleMode: { Normal: 0, Logarithmic: 1 },
    TickMarkType: { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 },
    LineSeries: class {},
    CandlestickSeries: class {},
    BarSeries: class {},
    AreaSeries: class {},
    BaselineSeries: class {},
    HistogramSeries: class {},
    createSeriesMarkers: () => ({ setMarkers: () => {} }),
  };
  return { ...api, default: api };
});

vi.mock("@/api/reportNifty", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const mocked: Record<string, unknown> = { ...actual };
  for (const [key, value] of Object.entries(actual)) {
    if (typeof value !== "function") continue;
    if (!/^(fetch|snapshot)/.test(key)) continue;
    mocked[key] = vi.fn(async () => ({}));
  }
  return mocked;
});

const mockAuth = {
  user: {
    id: 1,
    email: "qa@example.com",
    display_name: "QA",
    initial_capital: 100000,
    created_at: "2026-01-01T00:00:00",
    is_admin: true,
  },
  isAuthenticated: true,
  loading: false,
  error: null,
  login: async () => ({ success: true }),
  register: async () => ({ success: true }),
  logout: async () => {},
  getAccessToken: () => "test-token",
  fetchWithAuth: (url: string, options?: RequestInit) => fetch(url, options),
  clearError: () => {},
};

const PAGES: { specifier: string; exportName?: string }[] = Array.from(
  appSource.matchAll(
    /lazy\(\(\)\s*=>\s*import\("([^"]+)"\)(?:\.then\(m\s*=>\s*\(\{\s*default:\s*m\.(\w+)\s*\}\)\))?/g,
  ),
).map((match) => ({ specifier: match[1], exportName: match[2] }));

const SKIP: { specifier: string; reason: string }[] = [];

const PAGE_SUFFIXES = ["Page", "Container", "Panel"];

const routeModules = import.meta.glob("../**/*.{ts,tsx}");

function resolveModule(specifier: string): (() => Promise<Record<string, unknown>>) | undefined {
  const base = specifier.startsWith(".") ? `..${specifier.slice(1)}` : specifier;
  const candidates = [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`];
  const key = candidates.find((candidate) => candidate in routeModules);
  return key ? (routeModules[key] as () => Promise<Record<string, unknown>>) : undefined;
}

function pickComponent(
  mod: Record<string, unknown>,
  exportName?: string,
): Component<Record<string, unknown>> | undefined {
  if (exportName && typeof mod[exportName] === "function") {
    return mod[exportName] as Component<Record<string, unknown>>;
  }
  const functions = Object.entries(mod).filter(([, value]) => typeof value === "function");
  const suffixed = functions.find(([name]) => PAGE_SUFFIXES.some((suffix) => name.endsWith(suffix)));
  if (suffixed) return suffixed[1] as Component<Record<string, unknown>>;
  if (functions.length === 1) return functions[0][1] as Component<Record<string, unknown>>;
  if (typeof mod.default === "function") return mod.default as Component<Record<string, unknown>>;
  return undefined;
}

const IGNORED = [
  "Failed to load resource",
  "not wrapped in act",
  "Maximum update depth",
  "net::ERR",
  "ERR_CONNECTION_REFUSED",
  "ECONNREFUSED",
  "WebSocket",
  "CORS policy",
  "Cross-Origin Request Blocked",
  "NetworkError",
  "socket hang up",
  "Failed to initialize options state",
  "No toasters are currently registered",
];

const noise = (message: string) => IGNORED.some((pattern) => message.includes(pattern));

let consoleErrors: string[] = [];
let windowErrors: string[] = [];
let originalConsoleError: typeof console.error;
let onWindowError: (event: ErrorEvent) => void;
let onUnhandledRejection: (event: PromiseRejectionEvent) => void;

beforeEach(() => {
  consoleErrors = [];
  windowErrors = [];
  originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    const text = args
      .map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : String(arg)))
      .join(" ");
    if (!noise(text)) consoleErrors.push(text);
  };
  onWindowError = (event) => {
    const text = event.message || String(event.error);
    if (!noise(text)) windowErrors.push(text);
  };
  onUnhandledRejection = (event) => {
    const text = String(event.reason);
    if (!noise(text)) windowErrors.push(text);
  };
  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onUnhandledRejection as EventListener);
});

afterEach(() => {
  console.error = originalConsoleError;
  window.removeEventListener("error", onWindowError);
  window.removeEventListener("unhandledrejection", onUnhandledRejection as EventListener);
});

describe("page render smoke", () => {
  it("App.tsx exposes page-level lazy routes", () => {
    expect(PAGES.length).toBeGreaterThan(20);
  });

  it("keeps the explicit skip list at or below three entries", () => {
    expect(SKIP.length).toBe(0);
  });

  it("resolves every lazy route to a component export", async () => {
    const failures: string[] = [];
    for (const page of PAGES) {
      const load = resolveModule(page.specifier);
      if (!load) {
        failures.push(`${page.specifier}: module not found`);
        continue;
      }
      const mod = await load();
      if (!pickComponent(mod, page.exportName)) failures.push(`${page.specifier}: no component export`);
    }
    expect(failures, failures.join("\n")).toEqual([]);
  }, 60000);

  for (const page of PAGES) {
    const skip = SKIP.find((entry) => entry.specifier === page.specifier);
    const label = skip
      ? `${page.specifier} mounts without errors [skipped: ${skip.reason}]`
      : `${page.specifier} mounts without errors`;

    it(
      label,
      async () => {
        if (skip) return;

        const load = resolveModule(page.specifier);
        expect(load, `${page.specifier}: module not found`).toBeTypeOf("function");
        const mod = await load!();
        const Component = pickComponent(mod, page.exportName);
        expect(
          Component,
          `${page.specifier}: no component export (keys: ${Object.keys(mod).join(", ")})`,
        ).toBeTypeOf("function");

        let thrown: string | undefined;
        try {
          renderWithProviders(() => (
            <Notifications>
              <AuthContext.Provider value={mockAuth}>
                <MemoryRouter>
                  <Route path="*" component={() => <Component />} />
                </MemoryRouter>
              </AuthContext.Provider>
            </Notifications>
          ));
        } catch (error) {
          thrown = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        }
        await Promise.resolve();

        const problems = [thrown, ...consoleErrors, ...windowErrors].filter(
          (value): value is string => typeof value === "string" && value.length > 0,
        );
        expect(problems, `${page.specifier} failed to render:\n${problems.join("\n")}`).toEqual([]);
      },
      15000,
    );
  }
});
