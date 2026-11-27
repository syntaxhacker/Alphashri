// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { createSignal, type Accessor } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { DockPanelContext, DockPanelSpec } from "../dock/types";
import type { CanvasSize } from "./layout";
import type { WindowState } from "./types";
import { WindowManager } from "./WindowManager";

// The registry defers these modules; load them so their hoisted mocks are ready.
await import("./panels/marketHeatmap");
await import("./panels/optionsChain");
await import("./panels/optionsAnalytics");
await import("./panels/sectorTable");
await import("./panels/sectorRotation");
await import("./panels/sectorCorrelation");

const ctl = vi.hoisted(() => {
  const counts: Record<string, number> = {};
  const bump = (key: string) => {
    counts[key] = (counts[key] ?? 0) + 1;
  };
  const deferred = () => {
    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  return {
    counts,
    bump,
    deferred,
    hidden: false,
    sectorMode: "ok" as "ok" | "reject" | "hang",
    sectorGate: null as ReturnType<typeof deferred> | null,
    snapshotMode: "ok" as "ok" | "hang" | "reject",
    snapshotGate: null as ReturnType<typeof deferred> | null,
    patternsState: {
      timeframes: [{ id: "1D", label: "1 day" }],
      universes: [{ id: "nifty50", label: "Nifty 50" }],
      timeframe: "1D",
      universe: "nifty50",
      results: [],
      total: 0,
      error: null,
      scanning: false,
      filters: { sort: "confidence" },
      dataThrough: null,
      lastScanAsOf: null,
    },
  };
});

vi.mock("@/api/marketScreener", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMarketSnapshot: vi.fn(async (params: { universe?: string }) => {
    ctl.bump("snapshot");
    if (ctl.snapshotGate) return ctl.snapshotGate.promise;
    if (ctl.snapshotMode === "hang") return new Promise(() => {});
    if (ctl.snapshotMode === "reject") throw new Error("401 from snapshot feed");
    return {
      asOf: "2026-11-19T10:00:00Z",
      universe: params?.universe ?? "all_equity",
      total: 0,
      updateMode: "delayed_streaming_600",
      rows: [],
      stale: false,
      ageSec: 1,
      cached: false,
    };
  }),
  readCachedMarketSnapshot: () => null,
  writeCachedMarketSnapshot: () => {},
}));

vi.mock("@/state/holidays", () => ({
  isMarketOpenNow: () => true,
  isMarketClosedToday: () => false,
  getHolidayList: () => [],
}));

vi.mock("@/api/sector", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchSectorPerformance: vi.fn(async (market: string) => {
    ctl.bump("sector");
    if (ctl.sectorGate) return ctl.sectorGate.promise;
    if (ctl.sectorMode === "hang") return new Promise(() => {});
    if (ctl.sectorMode === "reject") throw new Error("401 from sector feed");
    return { sectors: [], top_stock_movers: [], last_updated: "2026-11-19T10:00:00Z", market };
  }),
}));

vi.mock("@/api/sectorCorrelation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchSectorCorrelation: vi.fn(async () => {
    ctl.bump("correlation");
    return { sectors: [], correlation_matrix: [], sector_names: [], last_updated: "2026-11-19T10:00:00Z" };
  }),
}));

vi.mock("@/api/rotation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchRotationOverview: vi.fn(async () => {
    ctl.bump("rotation");
    return { rows: [], last_updated: "2026-11-19T10:00:00Z" };
  }),
}));

vi.mock("@/api/optionsDock", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchChain: vi.fn(async () => {
      ctl.bump("chain");
      return null;
    }),
  };
});

vi.mock("@/api/reportNifty", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchNiftyExpiries: vi.fn(async () => {
    ctl.bump("expiries");
    return [{ date: "2026-11-26" }];
  }),
  fetchOptionsExpiries: vi.fn(async () => {
    ctl.bump("expiries");
    return ["2026-11-26"];
  }),
}));

vi.mock("@/api/upstoxOptions", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPositioning: vi.fn(async () => {
    ctl.bump("positioning");
    return null;
  }),
}));

vi.mock("@/api/news", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchNews: vi.fn(async () => {
    ctl.bump("news");
    return [];
  }),
  fetchNewsSources: vi.fn(async () => {
    ctl.bump("newsSources");
    return [];
  }),
}));

vi.mock("@/api/catalysts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchCatalystsToday: vi.fn(async () => {
    ctl.bump("catalyst");
    return null;
  }),
}));

vi.mock("@/state/chartPatterns", () => ({
  getChartPatternsState: () => ctl.patternsState,
  subscribe: () => () => {},
  ensureCatalogLoaded: vi.fn(async () => {
    ctl.bump("catalog");
  }),
  selectTimeframe: vi.fn(),
  selectUniverse: vi.fn(),
  triggerScan: vi.fn(),
  resetFilters: vi.fn(),
  forceRefresh: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/state/optionsAnalytics", () => ({
  optionsAnalyticsState: { data: null, refreshing: false },
  refreshAnalytics: vi.fn(),
  loadAnalytics: vi.fn(),
}));

vi.mock("../market/MarketMapView", () => ({ MarketMapView: () => <div data-testid="stub-market-map" /> }));
vi.mock("../news/NewsList", () => ({ NewsList: () => <div data-testid="stub-news-list" /> }));
vi.mock("../options-dock/OptionChainTable", () => ({ OptionChainTable: () => <div data-testid="stub-chain-table" /> }));
vi.mock("../options-dock/analytics/AnalyticsPanel", () => ({ AnalyticsPanel: () => <div data-testid="stub-analytics" /> }));
vi.mock("../options-dock/analytics/AnalyticsTabStrip", () => ({ AnalyticsTabStrip: () => <div data-testid="stub-strip" /> }));
vi.mock("../options/Positioning/PositioningPanel", () => ({ PositioningPanel: () => <div data-testid="stub-positioning" /> }));
vi.mock("../patterns/PatternListView", () => ({ PatternListView: () => <div data-testid="stub-patterns" /> }));
vi.mock("../sector/SectorTable", () => ({ SectorTable: () => <div data-testid="stub-sector-table" /> }));
vi.mock("../sector/SectorHeatmapView", () => ({ SectorHeatmapView: () => <div data-testid="stub-sector-map" /> }));
vi.mock("../sector/IntervalMoversTable", () => ({ IntervalMoversTable: () => <div data-testid="stub-movers" /> }));
vi.mock("../sector/RotationRrg", () => ({ RotationRrg: () => <div data-testid="stub-rrg" /> }));
vi.mock("../sector/SectorCorrelationCharts", () => ({
  CorrelationHeatmap: () => <div data-testid="stub-correlation-heatmap" />,
  SectorBetaChart: () => <div data-testid="stub-beta" />,
}));
vi.mock("../catalyst/CatalystRadarPanel", () => ({ CatalystRadarPanel: () => <div data-testid="stub-catalyst" /> }));
vi.mock("@/components/common/TanStackTable", () => ({ TanStackTable: () => <div data-testid="stub-table" /> }));
vi.mock("@/components/table/columns", () => ({ numColumn: () => ({}), symbolColumn: () => ({}) }));
vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: async () => ({ init: () => ({ setOption: () => {}, on: () => {}, resize: () => {}, dispose: () => {} }) }),
}));
vi.mock("../common/symbolDockContext", () => ({
  useSymbolDock: () => ({ open: vi.fn(), preview: vi.fn(), endPreview: vi.fn() }),
}));

const CANVAS: CanvasSize = { w: 1280, h: 900 };
const CONTEXT: Accessor<DockPanelContext> = () => ({
  symbol: "NIFTY",
  market: "india",
  expiry: "2026-11-26",
});

function Desk(props: { windows: WindowState[]; specs: DockPanelSpec[] }) {
  const [layout, setLayout] = createSignal({ windows: props.windows });
  return (
    <WindowManager
      layout={layout()}
      context={CONTEXT}
      onLayoutChange={(next) => setLayout({ windows: next.windows })}
      canvas={CANVAS}
      specs={props.specs}
    />
  );
}

const windowFor = (spec: DockPanelSpec, i: number): WindowState => ({
  id: spec.id,
  type: spec.id,
  title: spec.id,
  x: 10 + (i % 4) * 300,
  y: 10 + Math.floor(i / 4) * 240,
  w: 280,
  h: 220,
  z: i + 1,
});

const setHidden = (hidden: boolean) => {
  ctl.hidden = hidden;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(async () => {
  for (const key of Object.keys(ctl.counts)) delete ctl.counts[key];
  ctl.sectorMode = "ok";
  ctl.sectorGate = null;
  ctl.snapshotMode = "ok";
  ctl.snapshotGate = null;
  setHidden(false);
  const sector = await import("@/state/sector");
  sector.resetSectorState();
  const sectorPanels = await import("./panels/sectorPanelStore");
  sectorPanels.__resetSectorPanelStore?.();
  const correlation = await import("@/state/sectorCorrelation");
  correlation.setMarket("india");
  correlation.setLookbackDays(90);
  correlation.setCorrelationData(null as never);
  correlation.setIsLoading(false);
  correlation.setError(null);
  const hub = await import("./panels/marketSnapshotHub");
  hub.__resetMarketSnapshotHub?.();
  // Panel specs are lazy: warm their modules with real timers before a test
  // switches to fake time, otherwise the Suspense fallback never resolves.
  await Promise.all([
    import("./panels/catalystRadar"),
    import("./panels/marketHeatmap"),
    import("./panels/newsFeed"),
    import("./panels/optionsAnalytics"),
    import("./panels/optionsChain"),
    import("./panels/optionsPositioning"),
    import("./panels/patternResults"),
    import("./panels/sectorCorrelation"),
    import("./panels/sectorDetail"),
    import("./panels/sectorHeatmap"),
    import("./panels/sectorMovers"),
    import("./panels/sectorRotation"),
    import("./panels/sectorTable"),
  ]);
});

async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  }
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setHidden(false);
});

describe("POLL RATE PROBE — 60s of simulated desk time", () => {
  it("measures every panel mounted at once", async () => {
    vi.useFakeTimers();
    const { WINDOW_PANELS } = await import("./panelRegistry");
    render(() => (
      <UIProvider>
        <Desk windows={WINDOW_PANELS.map(windowFor)} specs={WINDOW_PANELS} />
      </UIProvider>
    ));
    await vi.advanceTimersByTimeAsync(20);
    await settle();
    const mount = { ...ctl.counts };
    await vi.advanceTimersByTimeAsync(60_000);
    const after = { ...ctl.counts };
    const perMinute: Record<string, number> = {};
    for (const key of new Set([...Object.keys(mount), ...Object.keys(after)])) {
      perMinute[key] = (after[key] ?? 0) - (mount[key] ?? 0);
    }
    console.log("[POLL RATE]", JSON.stringify({ panels: WINDOW_PANELS.length, mount, perMinute }));
    expect(Object.keys(after).length).toBeGreaterThan(0);
  });
});

async function mountSpecs(ids: string[]) {
  const registry = await import("./panelRegistry");
  const specs = ids.map((id) => registry.getPanelSpec(id)!);
  render(() => (
    <UIProvider>
      <Desk windows={specs.map(windowFor)} specs={specs} />
    </UIProvider>
  ));
  await vi.advanceTimersByTimeAsync(20);
  await settle();
  return specs;
}

const countOf = (key: string) => ctl.counts[key] ?? 0;

describe("POLL LIFECYCLE — hidden / in-flight / failure / sharing", () => {
  it("(a) a hidden document stops every panel poll, and one fetch fires on resume", async () => {
    vi.useFakeTimers();
    await mountSpecs(["market.heatmap", "sector.table"]);
    const visibleRun = { snapshot: countOf("snapshot"), sector: countOf("sector") };
    await vi.advanceTimersByTimeAsync(60_000);
    expect(countOf("snapshot")).toBeGreaterThan(visibleRun.snapshot);
    expect(countOf("sector")).toBeGreaterThan(visibleRun.sector);

    setHidden(true);
    const atHide = { snapshot: countOf("snapshot"), sector: countOf("sector") };
    await vi.advanceTimersByTimeAsync(180_000);
    expect(countOf("snapshot")).toBe(atHide.snapshot);
    expect(countOf("sector")).toBe(atHide.sector);

    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(countOf("snapshot")).toBe(atHide.snapshot + 1);
    expect(countOf("sector")).toBe(atHide.sector + 1);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(countOf("snapshot")).toBe(atHide.snapshot + 1);
  });

  it("(b1) a slow sector request never stacks a second poll", async () => {
    vi.useFakeTimers();
    const gate = ctl.deferred();
    ctl.sectorGate = gate;
    await mountSpecs(["sector.table"]);
    expect(countOf("sector")).toBe(1);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(countOf("sector")).toBe(1);

    gate.resolve({ sectors: [], top_stock_movers: [], last_updated: "x", market: "india" });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(countOf("sector")).toBe(2);
  });

  it("(b2) a slow snapshot request never stacks a second poll", async () => {
    vi.useFakeTimers();
    ctl.snapshotMode = "hang";
    await mountSpecs(["market.heatmap"]);
    expect(countOf("snapshot")).toBe(1);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(countOf("snapshot")).toBe(1);
  });

  it("(c1) repeated sector failures back off instead of polling every 60s", async () => {
    vi.useFakeTimers();
    ctl.sectorMode = "reject";
    await mountSpecs(["sector.table"]);
    await vi.advanceTimersByTimeAsync(600_000);
    console.log("[BACKOFF sector]", JSON.stringify({ requestsOver10Min: countOf("sector") }));
    expect(countOf("sector")).toBeLessThan(9);
  });

  it("(c2) repeated snapshot failures back off instead of polling every 5s", async () => {
    vi.useFakeTimers();
    ctl.snapshotMode = "reject";
    await mountSpecs(["market.heatmap"]);
    await vi.advanceTimersByTimeAsync(60_000);
    console.log("[BACKOFF snapshot]", JSON.stringify({ requestsOver1Min: countOf("snapshot") }));
    expect(countOf("snapshot")).toBeLessThan(12);
  });

  it("(d1) a chain and an analytics window on the same key share one fetch", async () => {
    vi.useFakeTimers();
    await mountSpecs(["options.chain", "options.analytics"]);
    console.log("[SHARE chain+analytics]", JSON.stringify({ chainFlights: countOf("chain") }));
    expect(countOf("chain")).toBe(1);
  });

  it("(d2) two rotation windows of the same key share one fetch", async () => {
    vi.useFakeTimers();
    await mountSpecs(["sector.rotation", "sector.rotation"]);
    expect(countOf("rotation")).toBe(1);
  });

  it("(d3) two correlation windows share one fetch", async () => {
    vi.useFakeTimers();
    await mountSpecs(["sector.correlation", "sector.correlation"]);
    expect(countOf("correlation")).toBe(1);
  });

  it("(d4) two heatmaps share one snapshot flight", async () => {
    vi.useFakeTimers();
    await mountSpecs(["market.heatmap", "market.heatmap"]);
    const atMount = countOf("snapshot");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(atMount).toBe(1);
    expect(countOf("snapshot") - atMount).toBe(12);
  });

  it("(d5) two sector windows share one poll", async () => {
    vi.useFakeTimers();
    await mountSpecs(["sector.table", "sector.heatmap"]);
    const atMount = countOf("sector");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(atMount).toBe(1);
    expect(countOf("sector") - atMount).toBe(1);
  });

  it("(e) a visible focused panel keeps its documented cadence", async () => {
    vi.useFakeTimers();
    await mountSpecs(["market.heatmap"]);
    const atMount = countOf("snapshot");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(countOf("snapshot") - atMount).toBe(12);

    await import("./panels/marketSnapshotHub");
    await import("@/state/sector");
  });

  it("(f) minimizing every window stops all poll loops", async () => {
    vi.useFakeTimers();
    const specs = await mountSpecs([
      "market.heatmap",
      "sector.table",
      "sector.correlation",
      "sector.rotation",
      "patterns.results",
      "options.analytics",
      "options.positioning",
      "news.feed",
      "options.chain",
    ]);
    for (const spec of specs) fireEvent.click(document.querySelector(`[data-testid="window-minimize-${spec.id}"]`)!);
    const atMinimize = { ...ctl.counts };
    await vi.advanceTimersByTimeAsync(180_000);
    expect(countOf("snapshot")).toBe(atMinimize.snapshot);
    expect(countOf("sector")).toBe(atMinimize.sector);
  });
});
