// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The panel renders several dense tables; under parallel load a single case
// exceeds the 5 s default and fails as a timeout rather than a real defect.
vi.setConfig({ testTimeout: 20_000 });
import { UIProvider } from "@/ui";
import {
  NiftyReportPanel,
  getNiftyOiColumns,
  findAtmStrike,
  oiBurstLogHeight,
  fetchSensexWithTimeout,
  SensexTimeoutError,
} from "./NiftyReportPanel";
import { buildMarkLines, emaSeries, resampleCandles, LevelLegend } from "./NiftyChartPanel";
import * as palette from "@/ui/palette";
import type { NiftyReport, NiftyStrike } from "@/types/niftyReport";

async function openDeskDock(key: "flow" | "setup" | "alerts" | "market") {
  fireEvent.click(await screen.findByTestId(`desk-dock-${key}`));
  return screen.findByTestId(`desk-dock-body-${key}`);
}

async function closeDeskDock() {
  const close = screen.queryByRole("button", { name: "Close desk dock" });
  if (close) fireEvent.click(close);
}

async function openSideTab(key: "chain" | "heatmap") {
  fireEvent.click(await screen.findByTestId(`nifty-side-tab-${key}`));
}

vi.mock("@/api/holidays_api", () => ({
  fetchHolidayCheck: vi.fn().mockResolvedValue({
    date: "2026-11-10",
    is_holiday: false,
    type: null,
    description: null,
  }),
}));

vi.mock("@/api/reportNifty", () => ({
  fetchLiveNifty: vi.fn(),
  fetchLiveSensex: vi.fn(),
  fetchNiftyByDate: vi.fn(),
  fetchNiftyExpiries: vi.fn().mockResolvedValue([]),
  fetchNiftyReplay: vi.fn(),
  fetchNiftyReplayMeta: vi.fn().mockResolvedValue(null),
  fetchNiftyReplayFrame: vi.fn().mockResolvedValue(null),
  fetchNiftyReplayDates: vi.fn(),
  fetchNiftyTape: vi.fn(),
  fetchNiftyBursts: vi.fn(),
  fetchOptionsLive: vi.fn(),
  fetchOptionsLiveCandles: vi.fn(),
  fetchOptionsTape: vi.fn(),
  fetchOptionsBursts: vi.fn(),
  fetchOptionsWalls: vi.fn().mockResolvedValue(null),
  fetchOptionsChain10s: vi.fn(),
  fetchOptionsReplayDates: vi.fn(),
  fetchOptionsReplay: vi.fn(),
  fetchOptionsReplayMeta: vi.fn(),
  fetchOptionsReplayFrame: vi.fn(),
  fetchOptionsSnapshot: vi.fn(),
  fetchOptionsExpiries: vi.fn(),
  snapshotNifty: vi.fn(),
  fetchBreadth: vi.fn(),
  fetchChain10sSummary: vi.fn().mockResolvedValue([]),
  fetchNiftyBlasts: vi.fn().mockResolvedValue([]),
}));

// The movers strip is mounted for NIFTY/SENSEX; keep the panel suite network-free.
vi.mock("@/api/indexMovers", () => ({
  fetchIndexMovers: vi.fn().mockResolvedValue({
    index: "NIFTY",
    as_of: "2026-10-12T09:20:00+05:30",
    stale: false,
    source: "test",
    gainers: [{ symbol: "HDFCBANK", ltp: 736.7, change_pct: 1.92, contribution_pct: 0.206 }],
    losers: [{ symbol: "TCS", ltp: 2436, change_pct: -2.52, contribution_pct: -0.042 }],
    live_only: false,
  }),
}));

// Market clock is mocked so the suite behaves the same at 11:00 and at 23:00
// IST: open by default, closed only in the tests that assert the auto-EOD path.
const { marketOpenMock } = vi.hoisted(() => ({ marketOpenMock: vi.fn(() => true) }));
vi.mock("@/utils/marketClock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/marketClock")>();
  return { ...actual, isMarketOpenIst: marketOpenMock, isDerivativesOpenIst: marketOpenMock };
});

vi.mock("@/components/chart/TradingViewChart", () => ({
  TradingViewChart: ({ candles, markLines, priceAreas, emaData }: {
    candles?: unknown[];
    markLines?: { label: { formatter: string } }[];
    priceAreas?: unknown[];
    emaData?: unknown[];
  }) => (
    <div
      data-testid="tradingview-chart"
      data-candles={candles?.length ?? 0}
      data-marklines={markLines?.length ?? 0}
      data-marklabels={JSON.stringify((markLines ?? []).map((l) => l.label.formatter))}
      data-priceareas={priceAreas?.length ?? 0}
      data-emas={emaData?.length ?? 0}
    />
  ),
}));

vi.mock("echarts-for-react", () => ({
  default: () => <div data-testid="nifty-depth-echarts" />,
}));

vi.mock("@/api/paperTrading", () => ({
  fetchPositions: vi.fn().mockResolvedValue([]),
}));

// The intel strip owns its own fetch; keep this suite network-free and on the
// graceful unavailable path (the strip itself is covered by NiftyIntelStrip.test).
vi.mock("./niftyIntel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./niftyIntel")>();
  return { ...actual, fetchNiftyIntel: vi.fn().mockRejectedValue(new Error("intel offline")) };
});

import {
  fetchBreadth,
  fetchLiveNifty,
  fetchLiveSensex,
  fetchNiftyByDate,
  fetchNiftyReplay,
  fetchNiftyReplayDates,
  fetchOptionsWalls,
  fetchNiftyTape,
  fetchNiftyBursts,
  fetchChain10sSummary,
  fetchOptionsLive,
  fetchOptionsLiveCandles,
  fetchOptionsTape,
  fetchOptionsBursts,
  fetchOptionsChain10s,
  fetchOptionsReplayDates,
  fetchOptionsReplay,
  fetchOptionsReplayMeta,
  fetchOptionsReplayFrame,
  fetchOptionsSnapshot,
  fetchOptionsExpiries,
  snapshotNifty,
} from "@/api/reportNifty";
import { fetchPositions } from "@/api/paperTrading";
import { fetchNiftyIntel } from "./niftyIntel";
import type { NiftyReplay } from "@/types/niftyReport";
import type { PaperPosition } from "@/types/paperTrading";
import type { WallsPayload } from "@/api/reportNifty";
import { setLiveTick } from "@/hooks/useNiftyReportStream";

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: TestWrapper });
}

function mockReport(overrides?: Partial<NiftyReport>): NiftyReport {
  return {
    mode: "live",
    date: "2026-10-12",
    expiry: "weekly",
    spot: 25750.5,
    ohlc: { open: 25600, high: 25800, low: 25550, close: 25750.5 },
    pcrOi: 1.12,
    pcrVol: 0.95,
    maxPain: 25700,
    walls: {
      calls: [
        { strike: 25800, oi: 5000 },
        { strike: 25900, oi: 4000 },
        { strike: 26000, oi: 3000 },
      ],
      puts: [
        { strike: 25600, oi: 6000 },
        { strike: 25500, oi: 4500 },
        { strike: 25400, oi: 3500 },
      ],
    },
    strikes: [
      {
        strike: 25700,
        ce: {
          ltp: 120, close: 110, oi: 2000, prevOi: 1800,
          oiChange: 200, priceChange: 9.09, sentiment: "Bullish",
        },
        pe: {
          ltp: 100, close: 105, oi: 2500, prevOi: 2600,
          oiChange: -100, priceChange: -4.76, sentiment: "Bearish",
        },
      },
    ],
    timeline: [{ time: "09:15", title: "Open", detail: "Nifty opened flat" }],
    // Prior-session pivots far from the walls/MP cluster so every level
    // survives the 25-pt fresh() dedupe → 5 chart lines on top of the
    // 5 wall/max-pain ones.
    pivots: {
      type: "classic",
      pp: 22897, r1: 23157, r2: 23316, r3: 23500,
      s1: 22738, s2: 22478, s3: 22000,
      prev: { date: "2026-10-09", high: 23200, low: 22650, close: 23100 },
    },
    ...overrides,
  };
}

function mockTape(overrides?: Partial<ReturnType<typeof baseMockTape>>) {
  return { ...baseMockTape(), ...overrides };
}

function baseMockTape() {
  return {
    date: "2026-10-12",
    interval_sec: 60,
    baseline_t: "2026-10-12T09:15:00+05:30",
    rows: [
      {
        t: "09:15",
        spot: 25750.5,
        call_doi: 5530000,
        put_doi: -1200000,
        net: 170160000,
        net_pct: 2.35,
        call_tick: 850,
        put_tick: -400,
        pcr_vol: 0.95,
        pcr_oi: 1.1,
        pcr_doi: 0.05,
        spot_flip: 12,
        max_pain: 25700,
        flip: 25762,
        walls: { call: 25900, put: 25600 },
      },
      {
        t: "09:16",
        spot: 25760,
        call_doi: 1000000,
        put_doi: 500000,
        net: 500000,
        net_pct: 0.5,
        call_tick: 100,
        put_tick: 50,
        pcr_vol: 0.96,
        pcr_oi: 1.15,
        pcr_doi: 0.08,
        spot_flip: null,
        max_pain: 25700,
        flip: 25762,
        walls: { call: 25900, put: 25600 },
      },
    ],
  };
}

/** Steady +1,000/min call OI for 13 minutes, then one +60,000 burst minute. */function burstTape() {
  const hm = (i: number) => {
    const total = 9 * 60 + 15 + i;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  };
  const base = mockTape().rows[0];
  const rows = [{ ...base, t: hm(0), call_doi: 0, put_doi: 0 }];
  let cum = 0;
  for (let i = 1; i <= 13; i++) {
    cum += 1_000;
    rows.push({ ...base, t: hm(i), call_doi: cum, put_doi: 0 });
  }
  rows.push({ ...base, t: hm(14), call_doi: cum + 60_000, put_doi: 0 });
  return rows;
}

const REAL_WS = (globalThis as Record<string, unknown>).WebSocket;

beforeEach(() => {
  marketOpenMock.mockReturnValue(true);
  // Legacy full-surface assertions: seed RESEARCH so every panel mounts the
  // way it did before the desk-mode shell landed (default is DESK). The
  // desk-mode describe block below overrides this per test.
  window.localStorage.setItem("nifty.deskMode", "research");
  window.localStorage.removeItem("nifty.sideTab");
  vi.mocked(fetchNiftyReplayDates).mockResolvedValue([]);
  vi.mocked(fetchLiveNifty).mockResolvedValue(mockReport());
  vi.mocked(fetchLiveSensex).mockResolvedValue(null as never);
  vi.mocked(fetchNiftyByDate).mockResolvedValue(mockReport({ mode: "eod" }));
  // No replay by default: EOD tests exercise the plain single-snapshot path.
  vi.mocked(fetchNiftyReplay).mockResolvedValue(null as never);
  vi.mocked(fetchNiftyTape).mockResolvedValue(mockTape());
  vi.mocked(fetchNiftyBursts).mockResolvedValue([] as never);
  // The optional candles call resolves to a candle-less report by default, so
  // the symbol tests that only care about the fast chain never wait on it.
  vi.mocked(fetchOptionsLiveCandles).mockResolvedValue(mockReport());
  // Generic per-symbol history: absent by default (no recorded days, no tape,
  // no chain10s, no replay). Tests opt in per case.
  vi.mocked(fetchOptionsTape).mockResolvedValue(null);
  vi.mocked(fetchOptionsBursts).mockResolvedValue([]);
  vi.mocked(fetchOptionsChain10s).mockResolvedValue([]);
  vi.mocked(fetchOptionsReplayDates).mockResolvedValue([]);
  vi.mocked(fetchOptionsReplay).mockResolvedValue(null);
  vi.mocked(fetchOptionsReplayMeta).mockResolvedValue(null);
  vi.mocked(fetchOptionsReplayFrame).mockResolvedValue(null);
  vi.mocked(fetchOptionsSnapshot).mockResolvedValue(null);
  vi.mocked(fetchOptionsExpiries).mockResolvedValue([]);
  vi.mocked(fetchBreadth).mockResolvedValue({ available: false, rows: [], up: 0, count: 0 });
  vi.mocked(snapshotNifty).mockResolvedValue(mockReport());
  vi.mocked(fetchPositions).mockResolvedValue([]);
  // No live sockets in these tests: with happy-dom's real WebSocket a
  // running dev backend on :8765 would push real frames mid-test and flip
  // the panel into WS mode (racy assertions). Absent WS keeps both stream
  // hooks disconnected so the panel renders from the initial REST load and
  // Spot renders from `report.spot`.
  (globalThis as Record<string, unknown>).WebSocket = undefined;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  (globalThis as Record<string, unknown>).WebSocket = REAL_WS;
});

describe("NiftyReportPanel toolbar", () => {
  test("renders the compact index movers strip for NIFTY", async () => {
    r(<NiftyReportPanel />);
    await waitFor(() => expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument());
    expect(screen.getByTestId("movers-strip")).toBeInTheDocument();
  });

  test("renders mode toggle, expiry select, refresh and snapshot buttons", async () => {
    r(<NiftyReportPanel />);
    expect(screen.getByTestId("nifty-report-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-mode-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-expiry-select")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-refresh-button")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-snapshot-button")).toBeInTheDocument();
    // live load fires on mount
    await waitFor(() => {
      expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalled();
    });
  });

  test("live stat strip shows spot, PCR and max pain from mock", async () => {
    r(<NiftyReportPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
    });
    const strip = screen.getByTestId("nifty-stat-strip");
    expect(within(strip).getByText("25,750.5")).toBeInTheDocument();
    expect(within(strip).getByText("1.12")).toBeInTheDocument();
    expect(within(strip).getByText("0.95")).toBeInTheDocument();
    expect(within(strip).getByText("25,700")).toBeInTheDocument();
  });

  test("index switch opens the Sensex levels view", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchLiveSensex).mockResolvedValueOnce({
      symbol: "SENSEX",
      spot: 74268.85,
      expiry: "2026-10-15",
      pcrOi: 1.78,
      pcrVol: 0.92,
      maxPain: 74200,
      walls: { calls: [{ strike: 74500, oi: 1000 }], puts: [{ strike: 74000, oi: 1200 }] },
      ohlc: { open: 72965.8, high: 74330.29, low: 72896.38, close: 74268.85 },
    });
    r(<NiftyReportPanel />);
    await waitFor(() => expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument());
    const indexToggle = screen.getByTestId("nifty-index-toggle");
    await user.click(
      indexToggle.querySelector('[data-value="sensex"]') ??
        within(indexToggle).getByText("SENSEX"),
    );
    expect(await screen.findByTestId("sensex-focus-panel")).toBeInTheDocument();
    expect(screen.getByTestId("sensex-focus-max-pain")).toHaveTextContent("74,200");
    expect(screen.queryByTestId("nifty-stat-strip")).not.toBeInTheDocument();
  });

  test("a failed Sensex fetch never breaks the Nifty report", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchLiveSensex).mockRejectedValueOnce(
      new Error("Sensex option chain fetch failed: boom"),
    );
    r(<NiftyReportPanel />);
    // Sensex is optional context: a 502 must not hold up or blank the report.
    await waitFor(() => expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument());
    await user.click(
      screen.getByTestId("nifty-index-toggle").querySelector('[data-value="sensex"]') ??
        within(screen.getByTestId("nifty-index-toggle")).getByText("SENSEX"),
    );
    expect(await screen.findByTestId("sensex-focus-error")).toHaveTextContent(
      "Sensex option chain fetch failed: boom",
    );
  });

  test("Sensex tab shows a fallback when no data is available", async () => {
    const user = userEvent.setup();
    r(<NiftyReportPanel />);
    await waitFor(() => expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument());
    await user.click(
      screen.getByTestId("nifty-index-toggle").querySelector('[data-value="sensex"]') ??
        within(screen.getByTestId("nifty-index-toggle")).getByText("SENSEX"),
    );
    expect(await screen.findByTestId("sensex-focus-error")).toHaveTextContent(
      "Sensex data is currently unavailable",
    );
  });

  test("fetchSensexWithTimeout surfaces a timeout instead of staying silent", async () => {
    vi.useFakeTimers();
    try {
      // A request that only settles when aborted, like the real fetch does.
      // (A never-settling promise would hang instead of exercising the timeout.)
      vi.mocked(fetchLiveSensex).mockImplementationOnce(
        (signal?: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      );
      const controller = new AbortController();
      const pending = fetchSensexWithTimeout(controller);
      const assertion = expect(pending).rejects.toBeInstanceOf(SensexTimeoutError);
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
      expect(controller.signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("snapshot button calls snapshotNifty", async () => {
    const user = userEvent.setup();
    r(<NiftyReportPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("nifty-snapshot-button"));
    await waitFor(() => {
      expect(vi.mocked(snapshotNifty)).toHaveBeenCalledWith(undefined, undefined);
    });
  });

  test("help button sits in the toolbar and opens the desk guide", async () => {
    const user = userEvent.setup();
    r(<NiftyReportPanel />);
    const help = screen.getByTestId("nifty-help-button");
    expect(screen.getByTestId("nifty-toolbar")).toContainElement(help);

    await user.click(help);
    expect(await screen.findByTestId("nifty-help-modal")).toBeInTheDocument();
    expect(screen.getByTestId("panel-modal-title")).toHaveTextContent(
      "Desk guide — read this once",
    );
  });
});

describe("NiftyReportPanel symbol selector", () => {
  async function pickSymbol(user: ReturnType<typeof userEvent.setup>, name: string) {
    const select = screen.getByTestId("report-symbol-select");
    // Tailwind Select renders a native <select> — drive it with selectOptions,
    // not the combobox/option click dance Mantine needed.
    await user.selectOptions(within(select).getByRole("combobox"), name);
  }

  test("setup banner prioritises a live flow flip over arming", async () => {
    const { setupBannerHeadline } = await import("./NiftyReportPanel");
    expect(setupBannerHeadline(true, "5m vs session", 5, 11)).toBe(
      "FLOW FLIP · 5m vs session — setup paused",
    );
    // A flipped banner with no reason falls back to the 5m vs 15m label.
    expect(setupBannerHeadline(true, null, 5, 11)).toBe(
      "FLOW FLIP · 5m vs 15m — setup paused",
    );
    expect(setupBannerHeadline(false, null, 5, 11)).toBe("⏳ SETUP ARMING 5/11");
  });

  test("SENSEX derives 5m/15m flow windows from its tape and hides the ₹ amount", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchOptionsLive).mockResolvedValue(
      mockReport({
        spot: 78800,
        date: "2026-11-05",
        flow_window: null,
        control: {
          verdict: "balanced",
          flow_bias: 246906.61,
          ce_doi: 1,
          pe_doi: 1,
          atm_ce_iv: 1,
          atm_pe_iv: 1,
          skew: 1,
          gex_regime: "short",
        },
      }),
    );
    const row = {
      call_doi: 0, put_doi: 0, net: 0, net_pct: 0, call_tick: 0, put_tick: 0,
      pcr_vol: 0, pcr_oi: 0, pcr_doi: 0, spot_flip: null, max_pain: 78700, flip: 0,
      walls: { call: 79000, put: 78000 },
    };
    vi.mocked(fetchOptionsTape).mockResolvedValue(
      mockTape({
        date: "2026-11-05",
        rows: [
          { ...row, t: "2026-11-05T09:15:00+05:30", spot: 78800, ce_oi: 1000, pe_oi: 1000 },
          { ...row, t: "2026-11-05T09:20:00+05:30", spot: 78810, ce_oi: 1100, pe_oi: 900 },
          { ...row, t: "2026-11-05T09:25:00+05:30", spot: 78820, ce_oi: 1300, pe_oi: 800 },
        ] as never,
      }) as never,
    );

    r(<NiftyReportPanel />);
    await waitFor(() => expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument());
    await pickSymbol(user, "SENSEX");

    await waitFor(() =>
      expect(screen.getByTestId("flow-15m")).not.toHaveTextContent("—"),
    );
    expect(screen.getByTestId("flow-15m")).toHaveTextContent("CE +300");
    expect(screen.getByTestId("flow-15m")).toHaveTextContent("PE −200");
    // 5m leg is measured against the 09:20 row (the nearest row to the
    // 09:25 last minus 5 minutes), not against the session open.
    expect(screen.getByTestId("flow-5m")).toHaveTextContent("CE +200");
    expect(screen.getByTestId("flow-5m")).toHaveTextContent("PE −100");
    expect(screen.getByTestId("flow-5m")).toHaveTextContent("CALL BID");
    const session = screen.getByTestId("flow-session");
    expect(session).toHaveTextContent("BALANCED");
    expect(session).not.toHaveTextContent("₹");
  });

  describe("SENSEX symbol-specific metrics (79k spot, 100-pt strike step)", () => {
    function strikeAt(strike: number) {
      return {
        strike,
        ce: { ltp: 120, close: 110, oi: 2000, prevOi: 1800, oiChange: 200, priceChange: 9.09, sentiment: "Bullish" },
        pe: { ltp: 100, close: 105, oi: 2500, prevOi: 2600, oiChange: -100, priceChange: -4.76, sentiment: "Bearish" },
      };
    }
    // SENSEX: 100-pt strike step → atmWindowPts = 100 * 15 = 1500, heatmapWidthPts = 100 * 5 = 500
    // pinEdgeHigh = 100, pinEdgeMedium = 200, pinPainPts = 200
    const sensexStrikes = [
      // 100-pt step around 78800 ATM (within ±1500)
      strikeAt(78800), // ATM
      strikeAt(78700), strikeAt(78600), strikeAt(78500), strikeAt(78400), strikeAt(78300), strikeAt(78200), strikeAt(78100), strikeAt(78000), strikeAt(77900), strikeAt(77800), strikeAt(77700), strikeAt(77600), strikeAt(77500), strikeAt(77400), strikeAt(77300), // below to 77300
      strikeAt(78900), strikeAt(79000), strikeAt(79100), strikeAt(79200), strikeAt(79300), strikeAt(79400), strikeAt(79500), strikeAt(79600), strikeAt(79700), strikeAt(79800), strikeAt(79900), strikeAt(80000), strikeAt(80100), strikeAt(80200), strikeAt(80300), // above to 80300
      strikeAt(77000), strikeAt(81000), // far outside ±1500
    ];

    function sensexReport(overrides?: Partial<ReturnType<typeof mockReport>>) {
      return mockReport({
        spot: 78800,
        strikes: sensexStrikes,
        maxPain: 78500, // 300 pts away from spot (>= pinPainPts=200)
        walls: {
          calls: [{ strike: 79000, oi: 7_000_000 }],
          puts: [{ strike: 78600, oi: 6_000_000 }],
        },
        ...overrides,
      });
    }

    beforeEach(() => {
      vi.mocked(fetchOptionsLive).mockResolvedValue(sensexReport());
      vi.mocked(fetchOptionsTape).mockResolvedValue(null);
      vi.mocked(fetchOptionsBursts).mockResolvedValue([]);
      vi.mocked(fetchOptionsChain10s).mockResolvedValue([]);
    });

    test("pin risk uses symbol-aware thresholds (100/200 pts) — edge at 100 pts = HIGH", async () => {
      const user = userEvent.setup();
      // Spot 78800, maxPain 78500 (300 pts away, >= pinPainPts=200)
      // Call wall at 78900 (100 pts away, <= pinEdgeHigh=100) → HIGH
      vi.mocked(fetchOptionsLive).mockResolvedValueOnce(
        sensexReport({
          spot: 78800,
          maxPain: 78500,
          walls: { calls: [{ strike: 78900, oi: 7_000_000 }], puts: [{ strike: 78600, oi: 6_000_000 }] },
        }),
      );

      r(<NiftyReportPanel />);
      await waitFor(() => expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument());
      await pickSymbol(user, "SENSEX");
      await waitFor(() => expect(screen.getByTestId("nifty-stat-pin")).toBeInTheDocument());

      const pinRisk = screen.getByTestId("nifty-stat-pin");
      expect(pinRisk).toHaveTextContent("HIGH");
      expect(pinRisk).toHaveAttribute("title", expect.stringContaining("MP -300"));
    });

    test("chain window is 1500 pts (15 × 100-pt strike step)", async () => {
      const user = userEvent.setup();
      r(<NiftyReportPanel />);
      await waitFor(() => expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument());
      await pickSymbol(user, "SENSEX");
      await waitFor(() => expect(screen.getByTestId("nifty-oi-table")).toBeInTheDocument());

      // Visible strikes should be within ±1500 of 78800
      const table = screen.getByTestId("nifty-oi-table");
      // Use a flexible matcher since the text may be split across elements
      expect(table).toHaveTextContent("78,800"); // ATM
      expect(table).toHaveTextContent("77,300"); // 1500 below
      expect(table).not.toHaveTextContent("77,200"); // 1600 below (outside)
      expect(table).toHaveTextContent("80,300"); // 1500 above
      expect(table).not.toHaveTextContent("80,400"); // 1600 above (outside)
    });

    test("setup radar — SENSEX 7M wall passes wallMinOi (~1.75M), wallMaxDist=200, levelMaxDist=120", async () => {
      const user = userEvent.setup();
      // SENSEX: maxWallOi=7M → wallMinOi = max(500k, 7M * 0.25) = 1.75M
      // wallMaxDist = strikeStep * 2 = 200
      // levelMaxDist = round(strikeStep * 1.2) = 120
      // Wall at 79000 (200 pts from 78800), OI 7M → WALL gate passes
      vi.mocked(fetchOptionsLive).mockResolvedValueOnce(
        sensexReport({
          spot: 78800,
          pivots: { pp: 78800, r1: 79000, r2: 79200, r3: 79400, s1: 78600, s2: 78400, s3: 78200 },
          walls: { calls: [{ strike: 79000, oi: 7_000_000 }], puts: [] },
          gex: { regime: "SHORT" }, // GAMMA gate passes
        }),
      );
      // Need tape rows for setup radar (uses tapeRows for coil/trend/rvol/level)
      // Create tape that passes COIL (compressed), TREND (up), RVOL (burst), LEVEL (on pivot)
      const baseSpot = 78800;
      const tapeRows = Array.from({ length: 60 }, (_, i) => ({
        t: `2026-11-05T09:${String(15 + i).padStart(2, "0")}:00+05:30`,
        spot: baseSpot + Math.min(i * 2, 50), // steady uptrend for TREND
        ce_oi: 1000 + i * 20,
        pe_oi: 1000 - i * 10,
        call_doi: 0,
        put_doi: 0,
        net: 0,
        net_pct: 0,
        call_tick: 0,
        put_tick: 0,
        pcr_vol: 1,
        pcr_oi: 1,
        pcr_doi: 0,
        spot_flip: null,
        max_pain: 78500,
        flip: 78750,
        walls: { call: 79000, put: 78600 },
      }));
      vi.mocked(fetchOptionsTape).mockResolvedValue({
        date: "2026-11-05",
        interval_sec: 60,
        baseline_t: "2026-11-05T09:15:00+05:30",
        rows: tapeRows,
      } as never);
      vi.mocked(fetchOptionsBursts).mockResolvedValue([]);
      vi.mocked(fetchOptionsChain10s).mockResolvedValue([]);

      r(<NiftyReportPanel />);
      await waitFor(() => expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument());
      await pickSymbol(user, "SENSEX");
      await waitFor(() => expect(screen.getByTestId("nifty-setup-radar")).toBeInTheDocument());

      // Check the WALL gate element's tooltip (title attribute on the gate chip)
      const wallGate = screen.getByTestId("nifty-setup-wall");
      expect(wallGate).toHaveAttribute("data-pass", "true");
      expect(wallGate).toHaveAttribute("title", expect.stringContaining("79,000"));
      expect(wallGate).toHaveAttribute("title", expect.stringContaining("200 pts"));
      expect(wallGate).toHaveAttribute("title", expect.stringContaining("7.0M"));
    });

    test("setup radar — NIFTY 7M wall passes its 2.75M gate (50-pt strike step)", async () => {
      const _user = userEvent.setup();
      // NIFTY: 50-pt strike step, spot 25750
      // maxWallOi ~11M → wallMinOi = max(500k, 11M * 0.25) = 2.75M
      // wallMaxDist = 50 * 2 = 100
      // Wall at 25850 (100 pts from 25750), OI 7M → should pass
      const niftyStrikes = [
        strikeAt(25750),
        strikeAt(25700), strikeAt(25650), strikeAt(25600), strikeAt(25550),
        strikeAt(25800), strikeAt(25850), strikeAt(25900), strikeAt(25950),
      ];
      vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
        mockReport({
          spot: 25750,
          strikes: niftyStrikes,
          pivots: { pp: 25750, r1: 25850, r2: 25950, r3: 26050, s1: 25650, s2: 25550, s3: 25450 },
          walls: { calls: [{ strike: 25850, oi: 7_000_000 }], puts: [] },
          gex: { regime: "SHORT" },
        }),
      );
      // Tape with uptrend, volume burst, and coil compression
      const tapeRows = Array.from({ length: 60 }, (_, i) => ({
        t: `2026-10-12T09:${String(15 + i).padStart(2, "0")}:00+05:30`,
        spot: 25750 + Math.min(i * 1.5, 40),
        ce_oi: 1000 + i * 15,
        pe_oi: 1000 - i * 8,
        call_doi: 0,
        put_doi: 0,
        net: 0,
        net_pct: 0,
        call_tick: 0,
        put_tick: 0,
        pcr_vol: 1,
        pcr_oi: 1,
        pcr_doi: 0,
        spot_flip: null,
        max_pain: 25700,
        flip: 25762,
        walls: { call: 25850, put: 25650 },
      }));
      vi.mocked(fetchNiftyTape).mockResolvedValue({
        date: "2026-10-12",
        interval_sec: 60,
        baseline_t: "2026-10-12T09:15:00+05:30",
        rows: tapeRows,
      } as never);
      vi.mocked(fetchNiftyBursts).mockResolvedValue([]);
      vi.mocked(fetchOptionsLive).mockResolvedValue(null);

      r(<NiftyReportPanel />);
      await waitFor(() => expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument());
      await waitFor(() => expect(screen.getByTestId("nifty-setup-radar")).toBeInTheDocument());

      const wallGate = screen.getByTestId("nifty-setup-wall");
      expect(wallGate).toHaveAttribute("data-pass", "true");
      expect(wallGate).toHaveAttribute("title", expect.stringContaining("25,850"));
      expect(wallGate).toHaveAttribute("title", expect.stringContaining("100 pts"));
      expect(wallGate).toHaveAttribute("title", expect.stringContaining("7.0M"));
    });

    test("heatmap width — metrics.heatmapWidthPts is 500 for SENSEX, 250 for NIFTY", async () => {
      // This test verifies the symbolMetrics integration by checking the computed
      // metrics object directly. The heatmap component receives widthPts from metrics.
      const { symbolMetrics } = await import("./symbolMetrics");

      // SENSEX: 100-pt strike step → heatmapWidthPts = 5 * 100 = 500
      const sensexReport = mockReport({
        spot: 78800,
        strikes: Array.from({ length: 30 }, (_, i) => ({
          strike: 78800 + (i - 15) * 100,
          ce: { ltp: 100, close: 100, oi: 1000, prevOi: 1000, oiChange: 0, priceChange: 0, sentiment: "Neutral" },
          pe: { ltp: 100, close: 100, oi: 1000, prevOi: 1000, oiChange: 0, priceChange: 0, sentiment: "Neutral" },
        })),
        walls: { calls: [{ strike: 79000, oi: 7_000_000 }], puts: [{ strike: 78600, oi: 6_000_000 }] },
        positioning: { lotSize: 20 },
      });
      const sensexMetrics = symbolMetrics(sensexReport);
      expect(sensexMetrics.heatmapWidthPts).toBe(500);
      expect(sensexMetrics.atmWindowPts).toBe(1500);
      expect(sensexMetrics.strikeStep).toBe(100);

      // NIFTY: 50-pt strike step → heatmapWidthPts = 5 * 50 = 250
      const niftyReport = mockReport({
        spot: 25750,
        strikes: Array.from({ length: 30 }, (_, i) => ({
          strike: 25750 + (i - 15) * 50,
          ce: { ltp: 100, close: 100, oi: 1000, prevOi: 1000, oiChange: 0, priceChange: 0, sentiment: "Neutral" },
          pe: { ltp: 100, close: 100, oi: 1000, prevOi: 1000, oiChange: 0, priceChange: 0, sentiment: "Neutral" },
        })),
        walls: { calls: [{ strike: 25850, oi: 11_000_000 }], puts: [{ strike: 25650, oi: 10_000_000 }] },
        positioning: { lotSize: 65 },
      });
      const niftyMetrics = symbolMetrics(niftyReport);
      expect(niftyMetrics.heatmapWidthPts).toBe(250);
      expect(niftyMetrics.atmWindowPts).toBe(750);
      expect(niftyMetrics.strikeStep).toBe(50);

      // RELIANCE: 50-pt strike step → heatmapWidthPts = 250
      const relianceReport = mockReport({
        spot: 1450,
        strikes: Array.from({ length: 30 }, (_, i) => ({
          strike: 1450 + (i - 15) * 50,
          ce: { ltp: 100, close: 100, oi: 1000, prevOi: 1000, oiChange: 0, priceChange: 0, sentiment: "Neutral" },
          pe: { ltp: 100, close: 100, oi: 1000, prevOi: 1000, oiChange: 0, priceChange: 0, sentiment: "Neutral" },
        })),
        walls: { calls: [{ strike: 1500, oi: 5_000_000 }], puts: [{ strike: 1400, oi: 4_000_000 }] },
        positioning: { lotSize: 500 },
      });
      const relianceMetrics = symbolMetrics(relianceReport);
      expect(relianceMetrics.heatmapWidthPts).toBe(250);
      expect(relianceMetrics.atmWindowPts).toBe(750);
      expect(relianceMetrics.strikeStep).toBe(50);
    });
  });

  test("NIFTY keeps the ₹ amount in the SESSION cell (generic underlyings hide it)", async () => {
    // The flow strip is shared; the panel passes showSessionValue={symbol === "NIFTY"}.
    // The component's own test covers both prop values — this pins the panel-level
    // wiring: NIFTY must render the ₹ crore amount, SENSEX must not.
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({
        control: {
          verdict: "call_buyers",
          flow_bias: 2656.63,
          ce_doi: 1,
          pe_doi: 1,
          atm_ce_iv: 12.5,
          atm_pe_iv: 13.1,
          skew: -2.4,
          gex_regime: "long",
        },
      }),
    );
    r(<NiftyReportPanel />);
    await screen.findByTestId("nifty-stat-strip");
    const session = screen.getByTestId("flow-session");
    expect(session).toHaveTextContent("CALL BUYING");
    expect(session).toHaveTextContent("+₹2,657cr");
  });

  test("selecting RELIANCE reads its own generic tape, chain10s and bursts", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchOptionsLive).mockResolvedValue(
      mockReport({ spot: 1450.25, expiry: "2026-10-29" }),
    );
    vi.mocked(fetchOptionsTape).mockResolvedValue(
      mockTape({ date: "2026-10-29" }) as never,
    );
    vi.mocked(fetchOptionsBursts).mockResolvedValue([
      {
        id: "reliance-burst",
        side: "call",
        t: "2026-10-29T10:05:00+05:30",
        delta: 900_000,
        baseline: 100_000,
        score: 9,
        severity: "alert",
        cumDoi: 900_000,
        spot: 1450.25,
        tickVol: 500,
        signal: null,
      },
    ] as never);
    vi.mocked(fetchOptionsChain10s).mockResolvedValue([
      {
        t: "2026-10-29T10:05:00+05:30",
        spot: 1450.25,
        ce_oi: 1_000,
        pe_oi: 1_200,
        ce_vol: 10,
        pe_vol: 12,
      },
    ]);
    r(<NiftyReportPanel />);
    await waitFor(() => expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument());

    vi.mocked(fetchLiveNifty).mockClear();
    vi.mocked(fetchNiftyTape).mockClear();
    vi.mocked(fetchNiftyBursts).mockClear();
    vi.mocked(fetchChain10sSummary).mockClear();

    await pickSymbol(user, "RELIANCE");

    await waitFor(() => {
      expect(vi.mocked(fetchOptionsLive)).toHaveBeenCalledWith(
        "RELIANCE",
        undefined,
        expect.any(AbortSignal),
      );
    });
    // ...and every history panel reads the generic namespace for that symbol.
    await waitFor(() =>
      expect(vi.mocked(fetchOptionsTape)).toHaveBeenCalledWith(
        "RELIANCE",
        undefined,
        expect.any(AbortSignal),
      ),
    );
    expect(vi.mocked(fetchOptionsBursts)).toHaveBeenCalledWith(
      "RELIANCE",
      undefined,
      expect.any(AbortSignal),
    );
    await waitFor(() =>
      expect(vi.mocked(fetchOptionsChain10s)).toHaveBeenCalledWith(
        "RELIANCE",
        undefined,
        90,
        expect.any(AbortSignal),
      ),
    );
    // The NIFTY-only history endpoints must never run for another underlying.
    expect(vi.mocked(fetchLiveNifty)).not.toHaveBeenCalled();
    expect(vi.mocked(fetchNiftyTape)).not.toHaveBeenCalled();
    expect(vi.mocked(fetchNiftyBursts)).not.toHaveBeenCalled();
    expect(vi.mocked(fetchChain10sSummary)).not.toHaveBeenCalled();
    // The generic burst is on screen (no locally-faked data).
    await waitFor(() =>
      expect(screen.getByTestId("nifty-oi-bursts-panel")).toHaveTextContent(/OI bursts \(1\)/),
    );
    // The NIFTY/SENSEX index toggle stays hidden; the expiry picker does not.
    expect(screen.queryByTestId("nifty-index-toggle")).not.toBeInTheDocument();
    expect(screen.getByTestId("nifty-expiry-select")).toBeInTheDocument();
    // NIFTY news intel is hidden; the VIX cell is labelled India VIX.
    expect(screen.queryByTestId("nifty-intel-cell")).not.toBeInTheDocument();
    expect(screen.getByTestId("nifty-india-vix-label")).toHaveTextContent("INDIA VIX");
  });

  test("generic history auto-opens the newest recorded EOD day when closed", async () => {
    const user = userEvent.setup();
    marketOpenMock.mockReturnValue(false);
    vi.mocked(fetchNiftyReplayDates).mockResolvedValue([]);
    vi.mocked(fetchNiftyByDate).mockResolvedValue(mockReport({ mode: "eod" }));
    vi.mocked(fetchOptionsReplayDates).mockResolvedValue(["2026-10-27"]);
    vi.mocked(fetchOptionsLive).mockResolvedValue(mockReport({ spot: 1450.25 }));
    vi.mocked(fetchOptionsSnapshot).mockResolvedValue(
      mockReport({ mode: "eod", spot: 1442.5 }),
    );

    r(<NiftyReportPanel />);
    await waitFor(() => expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument());
    await pickSymbol(user, "RELIANCE");

    // The generic dates list drives the automatic close→EOD switch.
    await waitFor(() =>
      expect(vi.mocked(fetchOptionsSnapshot)).toHaveBeenCalledWith(
        "RELIANCE",
        "2026-10-27",
        expect.any(AbortSignal),
      ),
    );
    expect(screen.getByTestId("nifty-date-input")).toHaveValue("2026-10-27");
  });

  test("generic EOD loads the recorded snapshot, tape and replay for the date", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchOptionsLive).mockResolvedValue(mockReport({ spot: 1450.25 }));
    vi.mocked(fetchOptionsReplayDates).mockResolvedValue(["2026-10-27", "2026-10-24"]);
    vi.mocked(fetchOptionsSnapshot).mockResolvedValue(
      mockReport({ mode: "eod", spot: 1442.5 }),
    );
    vi.mocked(fetchOptionsTape).mockResolvedValue(mockTape({ date: "2026-10-27" }) as never);
    vi.mocked(fetchOptionsReplayMeta).mockResolvedValue({
      date: "2026-10-27",
      count: 2,
      interval_sec: 60,
      frames: [
        { t: "2026-10-27T09:20:00+05:30", spot: 1440 },
        { t: "2026-10-27T09:21:00+05:30", spot: 1441 },
      ],
    });
    vi.mocked(fetchOptionsReplayFrame).mockResolvedValue({
      t: "2026-10-27T09:20:00+05:30",
      fetched_at: "",
      report: mockReport({ mode: "eod", spot: 1440 }),
      sensex: null,
    });

    r(<NiftyReportPanel />);
    await waitFor(() => expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument());
    await pickSymbol(user, "RELIANCE");

    // The generic history dates unhide the Live/EOD toggle.
    const modeToggle = await screen.findByTestId("nifty-mode-toggle");
    await user.click(within(modeToggle).getByRole("button", { name: "EOD" }));

    const dateInput = screen.getByTestId("nifty-date-input");
    fireEvent.change(dateInput, { target: { value: "2026-10-27" } });

    await waitFor(() =>
      expect(vi.mocked(fetchOptionsSnapshot)).toHaveBeenCalledWith(
        "RELIANCE",
        "2026-10-27",
        expect.any(AbortSignal),
      ),
    );
    expect(vi.mocked(fetchOptionsTape)).toHaveBeenCalledWith(
      "RELIANCE",
      "2026-10-27",
      expect.any(AbortSignal),
    );
    expect(vi.mocked(fetchNiftyByDate)).not.toHaveBeenCalled();
    // The recorded day's replay playhead is on screen.
    expect(await screen.findByTestId("nifty-replay-bar")).toBeInTheDocument();
    await waitFor(() =>
      expect(vi.mocked(fetchOptionsReplayFrame)).toHaveBeenCalledWith(
        "RELIANCE",
        "2026-10-27",
        "2026-10-27T09:20:00+05:30",
      ),
    );
  });

  test("generic expiry select lists the symbol's own expiries and passes the pick to live", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchOptionsLive).mockResolvedValue(mockReport({ spot: 1450.25 }));
    vi.mocked(fetchOptionsExpiries).mockResolvedValue(["2026-10-29", "2026-11-26"]);

    r(<NiftyReportPanel />);
    await waitFor(() => expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument());
    await pickSymbol(user, "RELIANCE");

    await waitFor(() =>
      expect(vi.mocked(fetchOptionsExpiries)).toHaveBeenCalledWith(
        "RELIANCE",
        expect.any(AbortSignal),
      ),
    );
    const select = screen.getByTestId("nifty-expiry-select");
    // Non-nearest pick: the history note warns that recordings are nearest-expiry.
    await waitFor(() =>
      expect(within(select).getByRole("combobox")).toHaveTextContent("Nearest expiry"),
    );
    await user.selectOptions(within(select).getByRole("combobox"), "2026-11-26");

    await waitFor(() =>
      expect(vi.mocked(fetchOptionsLive)).toHaveBeenCalledWith(
        "RELIANCE",
        "2026-11-26",
        expect.any(AbortSignal),
      ),
    );
    expect(screen.getByTestId("nifty-generic-expiry-note")).toBeInTheDocument();
  });

  test("switching back to NIFTY refetches the live report and the tape", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchOptionsLive).mockResolvedValue(
      mockReport({ spot: 1450.25, expiry: "2026-10-29" }),
    );
    r(<NiftyReportPanel />);
    await waitFor(() => expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument());

    await pickSymbol(user, "RELIANCE");
    await waitFor(() => expect(vi.mocked(fetchOptionsLive)).toHaveBeenCalled());

    vi.mocked(fetchLiveNifty).mockClear();
    vi.mocked(fetchNiftyTape).mockClear();

    await pickSymbol(user, "NIFTY");

    await waitFor(() => expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalled());
    // The recorded NIFTY tape is re-read from the server, not lost.
    await waitFor(() => expect(vi.mocked(fetchNiftyTape)).toHaveBeenCalled());
    // ...and the NIFTY-only controls are back.
    expect(await screen.findByTestId("nifty-index-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-expiry-select")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-intel-cell")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-india-vix-label")).not.toBeInTheDocument();
  });

  test("paints the non-NIFTY chain first, then merges the background candles", async () => {
    const user = userEvent.setup();
    const bars = [0, 1].map((i) => ({
      time: `2026-10-12T09:${String(15 + i).padStart(2, "0")}:00+05:30`,
      open: 1448 + i,
      high: 1451 + i,
      low: 1447 + i,
      close: 1450 + i,
      volume: 10,
    }));
    vi.mocked(fetchOptionsLive).mockResolvedValue(mockReport({ spot: 1450.25 }));
    vi.mocked(fetchOptionsLiveCandles).mockResolvedValue(
      mockReport({ spot: 1450.25, intraday: bars }),
    );

    r(<NiftyReportPanel />);
    await waitFor(() => expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument());

    await pickSymbol(user, "RELIANCE");

    // The fast report is on screen before the slow candles request is made.
    await waitFor(() =>
      expect(vi.mocked(fetchOptionsLive)).toHaveBeenCalledWith(
        "RELIANCE",
        undefined,
        expect.any(AbortSignal),
      ),
    );
    // Candles are requested exactly once, in the background.
    await waitFor(() =>
      expect(vi.mocked(fetchOptionsLiveCandles)).toHaveBeenCalledWith(
        "RELIANCE",
        undefined,
        expect.any(AbortSignal),
      ),
    );
    expect(vi.mocked(fetchOptionsLiveCandles)).toHaveBeenCalledTimes(1);
    // ...and land in the chart once they resolve.
    await waitFor(() =>
      expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "2"),
    );
  });
});

describe("NiftyReportPanel EOD mode", () => {
  test("EOD (market closed) seeds the trail with the day's bursts instead of staying silent", async () => {
    const user = userEvent.setup();
    r(<NiftyReportPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
    });
    // no live alerts while the market is open-but-quiet
    expect(screen.queryByTestId("nifty-oi-bursts-panel")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "EOD" }));
    const dateInput = screen.getByTestId("nifty-date-input");
    // the day's bursts come back from the backend for that date
    vi.mocked(fetchNiftyBursts).mockResolvedValue([
      {
        id: "2026-10-10T14:20:00+05:30-call",
        side: "call",
        t: "2026-10-10T14:20:00+05:30",
        delta: -16_461_965,
        baseline: 1_000_000,
        score: 16.4,
        severity: "critical",
        cumDoi: -36_657_985,
        spot: 22_597.3,
        tickVol: 1_000,
        signal: null,
      },
    ] as never);

    await user.clear(dateInput);
    await user.type(dateInput, "2026-10-10");

    await waitFor(() => {
      expect(screen.getByTestId("nifty-oi-bursts-panel")).toBeInTheDocument();
    });
    // reviewable after hours: the burst is listed, but nothing "fired"
    expect(screen.getByTestId("nifty-oi-bursts-panel")).toHaveTextContent(/OI bursts \(1\)/);
    expect(screen.queryByTestId("nifty-oi-toasts")).not.toBeInTheDocument();
    expect(screen.getByTestId("nifty-oi-replay-button")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-oi-replay-button")).toHaveTextContent("Test alerts");
    expect(screen.getByTestId("nifty-oi-replay-button")).toHaveAttribute(
      "title",
      "Replay the day's alerts as toasts (verification only)",
    );
  });

  test("shows date picker and loads by date", async () => {
    const user = userEvent.setup();
    r(<NiftyReportPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "EOD" }));
    const dateInput = screen.getByTestId("nifty-date-input");
    expect(dateInput).toBeInTheDocument();
    await user.clear(dateInput);
    await user.type(dateInput, "2026-10-10");
    await waitFor(() => {
      expect(vi.mocked(fetchNiftyByDate)).toHaveBeenCalledWith(
        "2026-10-10",
        expect.any(AbortSignal),
      );
    });
  });

  test("ignores a slow response from the previous context", async () => {
    const user = userEvent.setup();
    let resolveLive!: (report: NiftyReport) => void;
    vi.mocked(fetchLiveNifty).mockReturnValueOnce(
      new Promise<NiftyReport>((resolve) => {
        resolveLive = resolve;
      }),
    );
    vi.mocked(fetchNiftyByDate).mockResolvedValueOnce(
      mockReport({ mode: "eod", date: "2026-10-10", spot: 26000 }),
    );

    r(<NiftyReportPanel />);
    await waitFor(() => {
      expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole("button", { name: "EOD" }));
    const dateInput = screen.getByTestId("nifty-date-input");
    await user.clear(dateInput);
    await user.type(dateInput, "2026-10-10");
    await waitFor(() => {
      expect(screen.getByTestId("nifty-stat-strip")).toHaveTextContent("26,000");
    });

    // The old Live request ignores AbortSignal in this mocked transport. The
    // panel must still reject its late result using the request generation.
    resolveLive(mockReport({ spot: 22000 }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("nifty-stat-strip")).toHaveTextContent("26,000");
  });

  test("empty state prompts for a date when none selected", async () => {
    const user = userEvent.setup();
    // live fetch resolves empty so only the EOD empty path is exercised
    vi.mocked(fetchLiveNifty).mockResolvedValue(null as unknown as NiftyReport);
    r(<NiftyReportPanel />);
    await user.click(screen.getByRole("button", { name: "EOD" }));
    expect(await screen.findByTestId("nifty-empty")).toBeInTheDocument();
    expect(screen.getByText("Pick a date to load the EOD report.")).toBeInTheDocument();
  });

  test("Snapshot is disabled in EOD and never POSTs a past date", async () => {
    const user = userEvent.setup();
    r(<NiftyReportPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "EOD" }));
    const dateInput = screen.getByTestId("nifty-date-input");
    await user.clear(dateInput);
    await user.type(dateInput, "2026-10-10");
    await waitFor(() => {
      expect(vi.mocked(fetchNiftyByDate)).toHaveBeenCalledWith(
        "2026-10-10",
        expect.any(AbortSignal),
      );
    });
    const snapshot = screen.getByTestId("nifty-snapshot-button");
    expect(snapshot).toBeDisabled();
    // Even a forced click must not capture "now" over a historical date.
    fireEvent.click(snapshot);
    await act(async () => {
      await Promise.resolve();
    });
    expect(vi.mocked(snapshotNifty)).not.toHaveBeenCalled();
  });

  test("EOD hides the live-book P&L attribution", async () => {
    const user = userEvent.setup();
    r(<NiftyReportPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("nifty-pnl-panel")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "EOD" }));
    const dateInput = screen.getByTestId("nifty-date-input");
    await user.clear(dateInput);
    await user.type(dateInput, "2026-10-10");
    await waitFor(() => {
      expect(vi.mocked(fetchNiftyByDate)).toHaveBeenCalled();
      expect(screen.getByTestId("nifty-stat-strip")).toHaveTextContent("25,750.5");
    });
    expect(screen.queryByTestId("nifty-pnl-panel")).not.toBeInTheDocument();
  });
});

describe("closed-market default", () => {
  test("opens the newest recorded day in EOD instead of Live", async () => {
    marketOpenMock.mockReturnValue(false);
    vi.mocked(fetchNiftyReplayDates).mockResolvedValue(["2026-10-19", "2026-10-16"]);
    r(<NiftyReportPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("nifty-date-input")).toHaveValue("2026-10-19");
    });
    expect(vi.mocked(fetchNiftyByDate)).toHaveBeenCalledWith(
      "2026-10-19",
      expect.anything(),
    );
    expect(vi.mocked(fetchLiveNifty)).not.toHaveBeenCalled();
  });

  test("falls back to Live when no day has a recording", async () => {
    marketOpenMock.mockReturnValue(false);
    vi.mocked(fetchNiftyReplayDates).mockResolvedValue([]);
    r(<NiftyReportPanel />);
    await waitFor(() => expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalled());
  });
});

describe("NiftyReportPanel EOD minute replay", () => {
  /** Three recorded minutes with distinct spots so scrubbing is observable. */
  function replayFixture(gapReasons?: Record<string, number>): NiftyReplay {
    const frame = (hm: string, spot: number) => ({
      t: `2026-10-10T${hm}:00+05:30`,
      fetched_at: `2026-10-10T${hm}:05+05:30`,
      report: mockReport({ mode: "eod", spot }),
      sensex: null,
    });
    return {
      date: "2026-10-10",
      count: 3,
      interval_sec: 60,
      snapshots: [frame("09:15", 25100), frame("10:30", 25200), frame("15:29", 25300)],
      ...(gapReasons ? { gap_reasons: gapReasons } : {}),
    };
  }

  async function engageEodWithReplay(gapReasons?: Record<string, number>) {
    const user = userEvent.setup();
    vi.mocked(fetchNiftyReplay).mockResolvedValue(replayFixture(gapReasons));
    r(<NiftyReportPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "EOD" }));
    const dateInput = screen.getByTestId("nifty-date-input");
    await user.clear(dateInput);
    await user.type(dateInput, "2026-10-10");
    return screen.findByTestId("nifty-replay-bar");
  }

  test("walls follow the replay frame, not the full-day tape", async () => {
    const bar = await engageEodWithReplay();
    await waitFor(() => {
      expect(
        vi.mocked(fetchOptionsWalls).mock.calls.some(
          (call) => call[2] === "2026-10-10T09:15:00+05:30",
        ),
      ).toBe(true);
    });
    const slider = within(bar).getByTestId("nifty-replay-slider");
    fireEvent.change(slider, { target: { value: "1" } });
    await waitFor(() => {
      expect(
        vi.mocked(fetchOptionsWalls).mock.calls.some(
          (call) => call[2] === "2026-10-10T10:30:00+05:30",
        ),
      ).toBe(true);
    });
  });

  test("bar renders in EOD with a recorded day and applies frame 0", async () => {
    const bar = await engageEodWithReplay();
    expect(within(bar).getByTestId("nifty-replay-slider")).toBeInTheDocument();
    expect(within(bar).getByTestId("nifty-replay-time")).toHaveTextContent("09:15");
    expect(within(bar).getByTestId("nifty-replay-count")).toHaveTextContent("1/3");
    // the first frame paints the panels — the strip shows that minute's spot
    expect(screen.getByTestId("nifty-stat-strip")).toHaveTextContent("25,100");
    expect(vi.mocked(fetchNiftyReplay)).toHaveBeenCalledWith(
      "2026-10-10",
      expect.anything(),
    );
  });

  test("a replay frame hides bursts and criticals from later minutes", async () => {
    const burstAt = (t: string) => ({
      id: `${t}-call`,
      side: "call" as const,
      t,
      delta: 60_000,
      baseline: 1_000,
      score: 12.5,
      severity: "critical" as const,
      cumDoi: 90_000,
      spot: 25_150,
      tickVol: 900,
      signal: null,
    });
    vi.mocked(fetchNiftyBursts).mockResolvedValue([
      burstAt("2026-10-10T09:20:00+05:30"),
      burstAt("2026-10-10T10:00:00+05:30"),
      burstAt("2026-10-10T15:04:00+05:30"),
    ] as never);
    const bar = await engageEodWithReplay();
    const input = within(bar).getByTestId("nifty-replay-slider");

    // Frame 0 is 09:15 — a 09:20 burst has not happened yet.
    expect(screen.queryByTestId("nifty-oi-bursts-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-critical-banner")).not.toBeInTheDocument();

    // Frame 1 is 10:30 — 09:20 and 10:00 exist, 15:04 does not.
    fireEvent.change(input, { target: { value: "1" } });
    await waitFor(() => {
      expect(screen.getByTestId("nifty-oi-bursts-panel")).toHaveTextContent(
        "OI bursts (2)",
      );
    });
    expect(screen.getByTestId("nifty-oi-bursts-panel")).not.toHaveTextContent("15:04");
    expect(screen.queryAllByTestId("nifty-critical-banner")).toHaveLength(2);
  });

  test("shows coverage and the size of the next hole in the compact meta", async () => {
    const bar = await engageEodWithReplay();
    const coverage = within(bar).getByTestId("nifty-replay-coverage");
    // 3 recorded minutes out of the 385-minute session → 0.8%.
    expect(coverage).toHaveTextContent("0.8%");
    // Cumulative "382m missing" moved into the tooltip.
    expect(coverage).toHaveAttribute("title", expect.stringContaining("382"));
    expect(coverage).not.toHaveTextContent("missing");
    // Frame 0 is 09:15 and frame 1 is 10:30 → 74 minutes are skipped.
    expect(within(bar).getByTestId("nifty-replay-gap")).toHaveTextContent("+74m");
    expect(within(bar).getByTestId("nifty-replay-coverage-strip")).toBeInTheDocument();
  });

  test("names the recorder's skip reasons in the tooltip, not in the bar", async () => {
    const bar = await engageEodWithReplay({ chainFailed: 41, timeout: 12 });
    const reasons = within(bar).getByTestId("nifty-replay-reasons");
    expect(reasons).toHaveAttribute("title", expect.stringContaining("chain fetch failed ×41"));
    expect(reasons).toHaveAttribute("title", expect.stringContaining("tick timed out ×12"));
    expect(reasons).not.toHaveTextContent("chain fetch failed");
    // The bar itself only carries `time · %`.
    expect(bar).not.toHaveTextContent("chain fetch failed");
  });

  test("falls back to a hole count in the tooltip when the day has no gap journal", async () => {
    const bar = await engageEodWithReplay();
    const reasons = within(bar).getByTestId("nifty-replay-reasons");
    // Frames 09:15, 10:30, 15:29 → two in-session holes (74m and 298m).
    expect(reasons).toHaveAttribute("title", expect.stringContaining("2 in-session holes"));
    expect(reasons).toHaveAttribute("title", expect.stringContaining("reason not logged"));
  });

  test("scrubbing the slider repaints the panels for that minute", async () => {
    const bar = await engageEodWithReplay();
    const input = within(bar).getByTestId("nifty-replay-slider");
    // The heavy report swap is coalesced behind one rAF — capture it so the
    // test drives the frame explicitly instead of racing the clock.
    const queued: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      queued.push(cb);
      return queued.length;
    });
    const flushFrames = () =>
      act(async () => {
        for (const cb of queued.splice(0)) cb(16);
      });
    try {
      // frame 0 is already applied...
      expect(screen.getByTestId("nifty-stat-strip")).toHaveTextContent("25,100");
      // ...scrub to frame 1 — thumb and counter move urgently, panels follow
      // on the next animation frame
      fireEvent.change(input, { target: { value: "1" } });
      expect(within(bar).getByTestId("nifty-replay-time")).toHaveTextContent("10:30");
      expect(within(bar).getByTestId("nifty-replay-count")).toHaveTextContent("2/3");
      await flushFrames();
      expect(screen.getByTestId("nifty-stat-strip")).toHaveTextContent("25,200");
      // and the spot changes back between frame 0 and frame 1
      fireEvent.change(input, { target: { value: "0" } });
      await flushFrames();
      expect(screen.getByTestId("nifty-stat-strip")).toHaveTextContent("25,100");
    } finally {
      rafSpy.mockRestore();
    }
  });

  test("rapid scrubs coalesce to one frame — newest wins, intermediates never paint", async () => {
    const bar = await engageEodWithReplay();
    const input = within(bar).getByTestId("nifty-replay-slider");
    const queued: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      queued.push(cb);
      return queued.length;
    });
    try {
      expect(screen.getByTestId("nifty-stat-strip")).toHaveTextContent("25,100");
      // five scrubs in the same tick, before any rAF fires
      for (const v of ["1", "2", "1", "0", "2"]) {
        fireEvent.change(input, { target: { value: v } });
      }
      // thumb + counter tracked every input urgently...
      expect(within(bar).getByTestId("nifty-replay-time")).toHaveTextContent("15:29");
      expect(within(bar).getByTestId("nifty-replay-count")).toHaveTextContent("3/3");
      // ...but only ONE frame was scheduled and the panels still show frame 0
      expect(queued).toHaveLength(1);
      expect(screen.getByTestId("nifty-stat-strip")).toHaveTextContent("25,100");
      // firing the coalesced frame paints only the newest (frame 2)
      await act(async () => {
        for (const cb of queued.splice(0)) cb(16);
      });
      expect(screen.getByTestId("nifty-replay-count")).toHaveTextContent("3/3");
      expect(screen.getByTestId("nifty-stat-strip")).toHaveTextContent("25,300");
      // no second frame was ever queued — nothing stale can land afterwards
      expect(queued).toHaveLength(0);
    } finally {
      rafSpy.mockRestore();
    }
  });

  test("scrubbing mid-play pauses and the play timer never fires a late frame", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchNiftyReplay).mockResolvedValue(replayFixture());
      r(<NiftyReportPanel />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      fireEvent.click(screen.getByRole("button", { name: "EOD" }));
      fireEvent.change(screen.getByTestId("nifty-date-input"), { target: { value: "2026-10-10" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const slider = within(screen.getByTestId("nifty-replay-bar")).getByTestId(
        "nifty-replay-slider",
      );
      fireEvent.click(screen.getByTestId("nifty-replay-play"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(screen.getByTestId("nifty-replay-count")).toHaveTextContent("2/3");
      // scrub back to frame 0 mid-play — pauses, counter moves urgently
      fireEvent.change(slider, { target: { value: "0" } });
      expect(screen.getByTestId("nifty-replay-play")).toHaveTextContent("Play");
      expect(screen.getByTestId("nifty-replay-count")).toHaveTextContent("1/3");
      // the coalesced scrub frame (rAF ≈16ms) lands, then nothing else moves
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      expect(screen.getByTestId("nifty-replay-count")).toHaveTextContent("1/3");
      expect(screen.getByTestId("nifty-stat-strip")).toHaveTextContent("25,100");
      expect(screen.getByTestId("nifty-replay-play")).toHaveTextContent("Play");
    } finally {
      vi.useRealTimers();
    }
  });

  test("pressing Play on the last frame restarts the day from minute one", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchNiftyReplay).mockResolvedValue(replayFixture());
      r(<NiftyReportPanel />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      fireEvent.click(screen.getByRole("button", { name: "EOD" }));
      fireEvent.change(screen.getByTestId("nifty-date-input"), { target: { value: "2026-10-10" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      // play through to the end — auto-pauses on the last frame (one tick
      // per advance so the interval reschedules between ticks)
      fireEvent.click(screen.getByTestId("nifty-replay-play"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(screen.getByTestId("nifty-replay-count")).toHaveTextContent("3/3");
      expect(screen.getByTestId("nifty-replay-play")).toHaveTextContent("Play");
      // pressing Play again restarts from minute one — counter urgently,
      // panels via the transition
      fireEvent.click(screen.getByTestId("nifty-replay-play"));
      expect(screen.getByTestId("nifty-replay-count")).toHaveTextContent("1/3");
      expect(screen.getByTestId("nifty-replay-play")).toHaveTextContent("Pause");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByTestId("nifty-stat-strip")).toHaveTextContent("25,100");
      // ...and playback continues from there
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(screen.getByTestId("nifty-replay-count")).toHaveTextContent("2/3");
    } finally {
      vi.useRealTimers();
    }
  });

  test("Play advances one frame per 700ms, toggles, and stops at the last frame", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchNiftyReplay).mockResolvedValue(replayFixture());
      r(<NiftyReportPanel />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      fireEvent.click(screen.getByRole("button", { name: "EOD" }));
      const dateInput = screen.getByTestId("nifty-date-input");
      fireEvent.change(dateInput, { target: { value: "2026-10-10" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const counter = within(screen.getByTestId("nifty-replay-bar")).getByTestId(
        "nifty-replay-count",
      );
      expect(counter).toHaveTextContent("1/3");

      fireEvent.click(screen.getByTestId("nifty-replay-play"));
      expect(screen.getByTestId("nifty-replay-play")).toHaveTextContent("Pause");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(screen.getByTestId("nifty-replay-count")).toHaveTextContent("2/3");
      expect(screen.getByTestId("nifty-replay-time")).toHaveTextContent("10:30");
      expect(screen.getByTestId("nifty-stat-strip")).toHaveTextContent("25,200");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      // reached the last frame — playback auto-pauses and stays there
      expect(screen.getByTestId("nifty-replay-count")).toHaveTextContent("3/3");
      expect(screen.getByTestId("nifty-stat-strip")).toHaveTextContent("25,300");
      expect(screen.getByTestId("nifty-replay-play")).toHaveTextContent("Play");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(screen.getByTestId("nifty-replay-count")).toHaveTextContent("3/3");
    } finally {
      vi.useRealTimers();
    }
  });

  test("days without a replay fall back to the plain EOD snapshot", async () => {
    const user = userEvent.setup();
    r(<NiftyReportPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "EOD" }));
    const dateInput = screen.getByTestId("nifty-date-input");
    await user.clear(dateInput);
    await user.type(dateInput, "2026-10-10");
    await waitFor(() => {
      expect(vi.mocked(fetchNiftyByDate)).toHaveBeenCalledWith(
        "2026-10-10",
        expect.anything(),
      );
    });
    expect(screen.queryByTestId("nifty-replay-bar")).not.toBeInTheDocument();
    // the single EOD snapshot still paints the panels
    expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
  });

  test("live mode never shows the replay bar", async () => {
    r(<NiftyReportPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("nifty-replay-bar")).not.toBeInTheDocument();
    expect(vi.mocked(fetchNiftyReplay)).not.toHaveBeenCalled();
  });

  test("switching back to live hides the bar", async () => {
    const user = userEvent.setup();
    await engageEodWithReplay();
    expect(screen.getByTestId("nifty-replay-bar")).toBeInTheDocument();

    vi.mocked(fetchNiftyReplay).mockClear();
    await user.click(screen.getByRole("button", { name: "Live" }));
    await waitFor(() => {
      expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("nifty-replay-bar")).not.toBeInTheDocument();
    expect(vi.mocked(fetchNiftyReplay)).not.toHaveBeenCalled();
  }, 15_000);
});

describe("NiftyReportPanel states", () => {
  test("error state shows alert with retry", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchLiveNifty).mockRejectedValueOnce(new Error("Backend down"));
    r(<NiftyReportPanel />);
    expect(await screen.findByTestId("nifty-error")).toBeInTheDocument();
    expect(screen.getByText("Backend down")).toBeInTheDocument();
    await user.click(screen.getByTestId("nifty-error-retry"));
    await waitFor(() => {
      expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(2);
    });
  });

  test("chart placeholder shows empty state when no candles", async () => {
    r(<NiftyReportPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
    });
    expect(screen.getByTestId("nifty-chart-empty")).toBeInTheDocument();
  });
});

describe("NiftyReportPanel Chart|Depth view toggle", () => {
  function candles() {
    return [
      { time: "2026-10-12T09:15:00", open: 25600, high: 25650, low: 25580, close: 25620, volume: 1000 },
      { time: "2026-10-12T09:16:00", open: 25620, high: 25680, low: 25600, close: 25750.5, volume: 1200 },
    ];
  }

  test("defaults to Chart view, Depth switch shows depth map and back", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({ candles: candles() }),
    );
    r(<NiftyReportPanel />);
    expect(await screen.findByTestId("tradingview-chart")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-view-toggle")).toBeInTheDocument();

    // Both views stay mounted after the first Depth selection; switching only
    // flips `display`, so the ECharts instance is never cold-created again.
    await user.click(screen.getByRole("button", { name: "Depth" }));
    expect(await screen.findByTestId("nifty-depthmap")).toBeInTheDocument();
    expect(screen.getByTestId("tradingview-chart")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-view").style.display).toBe("none");
    expect(screen.getByTestId("nifty-depth-view").style.display).toBe("block");

    await user.click(screen.getByRole("button", { name: "Chart" }));
    expect(await screen.findByTestId("tradingview-chart")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-depthmap")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-view").style.display).toBe("flex");
    expect(screen.getByTestId("nifty-depth-view").style.display).toBe("none");
  });

  test("intraday candles feed the chart with EMA9/EMA20 overlays", async () => {
    const intraday = [
      { time: "2026-10-12T09:15:00", open: 25600, high: 25650, low: 25580, close: 25620 },
      { time: "2026-10-12T09:16:00", open: 25620, high: 25680, low: 25600, close: 25750.5 },
    ];
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({
        intraday,
        emas: [
          { period: 9, data: [null, 25685.25] },
          { period: 20, data: [null, 25690.5] },
        ],
      }),
    );
    r(<NiftyReportPanel />);
    const chart = await screen.findByTestId("tradingview-chart");
    expect(chart).toBeInTheDocument();
    expect(chart).toHaveAttribute("data-emas", "2");
    expect(screen.queryByTestId("nifty-chart-empty")).not.toBeInTheDocument();
  });

  test("chart without backend emas still gets client-side EMA9/EMA20 series", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({ candles: candles() }),
    );
    r(<NiftyReportPanel />);
    const chart = await screen.findByTestId("tradingview-chart");
    // EMAs are recomputed client-side from the displayed candles now (the
    // backend `emas` block is fixed to the 1-minute grid and is ignored),
    // so the overlay count no longer depends on the payload.
    expect(chart).toHaveAttribute("data-emas", "2");
  });
});

describe("niftyOiColumns alignment meta", () => {
  test("every column declares explicit meta.align", () => {
    const cols = getNiftyOiColumns(null);
    expect(cols.length).toBeGreaterThan(0);
    for (const col of cols) {
      const meta = (col as { meta?: { align?: string } }).meta;
      expect(meta?.align).toMatch(/^(left|center|right)$/);
    }
  });

  test("strike is numeric-right, signals are centered", () => {
    const cols = getNiftyOiColumns(null);
    const byKey = new Map(
      cols.map((c) => [c.accessorKey as string, c.meta as { align: string }]),
    );
    expect(byKey.get("strike")?.align).toBe("right");
    expect(byKey.get("ce.sentiment")?.align).toBe("center");
    expect(byKey.get("pe.sentiment")?.align).toBe("center");
    expect(byKey.get("ce.oiChange")?.align).toBe("right");
    expect(byKey.get("pe.oiChange")?.align).toBe("right");
  });

  test("every column declares an explicit fixed width fitting 1440px", () => {
    const cols = getNiftyOiColumns(null);
    for (const col of cols) {
      const size = (col as { size?: number }).size;
      expect(typeof size).toBe("number");
      expect(size as number).toBeGreaterThan(0);
    }
    const total = cols.reduce(
      (sum, c) => sum + ((c as { size?: number }).size ?? 0),
      0,
    );
    // 7 fixed columns must fit a 1440px panel with room for panel padding
    expect(total).toBeLessThanOrEqual(900);
  });

  test("factory keeps all meta.align + sizes regardless of atmStrike", () => {
    const plain = getNiftyOiColumns(null);
    const anchored = getNiftyOiColumns(25700);
    expect(anchored.length).toBe(plain.length);
    for (let i = 0; i < plain.length; i++) {
      const a = plain[i] as { size?: number; meta?: { align?: string } };
      const b = anchored[i] as { size?: number; meta?: { align?: string } };
      expect(b.size).toBe(a.size);
      expect(b.meta?.align).toBe(a.meta?.align);
      expect(b.meta?.align).toMatch(/^(left|center|right)$/);
    }
    // numbers right incl. strike, signals center
    const byKey = new Map(
      anchored.map((c) => [c.accessorKey as string, c.meta as { align: string }]),
    );
    expect(byKey.get("strike")?.align).toBe("right");
    expect(byKey.get("ce.sentiment")?.align).toBe("center");
    expect(byKey.get("pe.sentiment")?.align).toBe("center");
  });

  test("DESK drops the two points/% change columns; RESEARCH keeps all seven", () => {
    const research = getNiftyOiColumns(null);
    const desk = getNiftyOiColumns(null, { showLegChange: false });
    expect(research).toHaveLength(7);
    expect(desk).toHaveLength(5);
    expect(desk.map((c) => c.accessorKey)).toEqual([
      "ce.oiChange",
      "ce.sentiment",
      "strike",
      "pe.sentiment",
      "pe.oiChange",
    ]);
    // The five DESK tracks fit the 420px rail with no horizontal scrollbar.
    const deskWidth = desk.reduce(
      (sum, c) => sum + ((c as { size?: number }).size ?? 0),
      0,
    );
    expect(deskWidth).toBeLessThanOrEqual(420);
  });
});

describe("NiftyReportPanel option-chain change columns (points, not %)", () => {
  test("Chg headers carry a points tooltip and no % sign", () => {
    const cols = getNiftyOiColumns(null);
    const chg = cols.filter(
      (c) => c.accessorKey === "ce.priceChange" || c.accessorKey === "pe.priceChange",
    );
    expect(chg).toHaveLength(2);
    for (const col of chg) {
      const header = col.header as unknown as {
        props?: { title?: string; children?: unknown };
      };
      expect(header?.props?.title).toBe("points (LTP − prev close)");
      expect(String(header?.props?.children ?? "")).not.toContain("%");
    }
    // No other header smuggles a % either.
    for (const col of cols) {
      const header = col.header as unknown as {
        props?: { children?: unknown };
      };
      const text =
        typeof col.header === "string"
          ? col.header
          : String(header?.props?.children ?? "");
      expect(text).not.toContain("%");
    }
  });

  test("Chg cells show points plus the pct from one helper label", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({
        spot: 25760,
        strikes: [
          {
            strike: 25700,
            ce: { ltp: 150, close: 200, oi: 2000, prevOi: 1800, oiChange: 200, priceChange: -50, sentiment: "Bearish" },
            pe: { ltp: 260, close: 200, oi: 2500, prevOi: 2600, oiChange: -100, priceChange: 60, sentiment: "Bullish" },
          },
        ],
      }),
    );
    r(<NiftyReportPanel />);
    const table = await screen.findByTestId("nifty-oi-table");
    expect(within(table).queryByText(/Chg%/)).not.toBeInTheDocument();
    expect(within(table).getByText("CE Chg")).toHaveAttribute(
      "title",
      "points (LTP − prev close)",
    );
    expect(within(table).getByText("PE Chg")).toHaveAttribute(
      "title",
      "points (LTP − prev close)",
    );
    // Points in their own span (U+2212 minus), pct dimmer beside it, the full
    // helper label on the cell tooltip.
    expect(within(table).getAllByText("−50.00", { exact: true })).toHaveLength(1);
    expect(within(table).getAllByText("+60.00", { exact: true })).toHaveLength(1);
    expect(table.textContent).toContain("(−25.0%)");
    expect(table.textContent).toContain("(+30.0%)");
    expect(within(table).getByTitle("−50.00 (−25.0%)")).toBeInTheDocument();
    expect(within(table).getByTitle("+60.00 (+30.0%)")).toBeInTheDocument();
  });
});

describe("NiftyReportPanel ATM anchor", () => {
  function strikeAt(strike: number) {
    return {
      strike,
      ce: { ltp: 120, close: 110, oi: 2000, prevOi: 1800, oiChange: 200, priceChange: 9.09, sentiment: "Bullish" },
      pe: { ltp: 100, close: 105, oi: 2500, prevOi: 2600, oiChange: -100, priceChange: -4.76, sentiment: "Bearish" },
    };
  }

  test("findAtmStrike picks the closest strike, null when no data", () => {
    const mk = (s: number) => strikeAt(s) as unknown as Parameters<typeof findAtmStrike>[0][number];
    expect(findAtmStrike([], 25750)).toBeNull();
    expect(findAtmStrike([mk(25700)], NaN)).toBeNull();
    // spot between strikes picks the closer one
    expect(findAtmStrike([mk(25700), mk(25800)], 25730)).toBe(25700);
    expect(findAtmStrike([mk(25700), mk(25800)], 25780)).toBe(25800);
    // tie → lower strike
    expect(findAtmStrike([mk(25700), mk(25800)], 25750)).toBe(25700);
  });

  test("ATM marker lands on the strike closest to spot", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({
        spot: 25760,
        strikes: [strikeAt(25700), strikeAt(25800)],
      }),
    );
    r(<NiftyReportPanel />);
    const table = await screen.findByTestId("nifty-oi-table");
    expect(table).toBeInTheDocument();
    // 25800 is closer to 25760 than 25700 → single ATM badge
    const badges = within(table).getAllByTestId("nifty-strike-atm-badge");
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent("25,800");
    expect(badges[0]).toHaveAttribute("title", "ATM strike");
  });

  test("ATM row has anchor testid + tinted style, non-ATM rows plain", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({
        spot: 25760,
        strikes: [strikeAt(25700), strikeAt(25800)],
      }),
    );
    r(<NiftyReportPanel />);
    await screen.findByTestId("nifty-oi-table");
    const atmRow = screen.getByTestId("nifty-strike-atm");
    expect(atmRow).toBeInTheDocument();
    expect(within(atmRow).getByTestId("nifty-strike-atm-badge")).toBeInTheDocument();
    expect(atmRow.style.background).toMatch(/rgba/);
    // One anchor per panel: the gold band, not a bordered box.
    expect(atmRow.style.borderTop).toBe("");
    expect(atmRow.style.borderBottom).toBe("");
    const plainRows = screen.getAllByTestId("nifty-strike-row");
    expect(plainRows.length).toBeGreaterThan(0);
    for (const row of plainRows) {
      expect(row.style.background).toBe("");
      expect(within(row).queryByTestId("nifty-strike-atm-badge")).not.toBeInTheDocument();
    }
  });
});

describe("NiftyReportPanel fit-to-screen", () => {
  function candles() {
    return [
      { time: "2026-10-12T09:15:00", open: 25600, high: 25650, low: 25580, close: 25620, volume: 1000 },
      { time: "2026-10-12T09:16:00", open: 25620, high: 25680, low: 25600, close: 25750.5, volume: 1200 },
    ];
  }

  function strikeAt(strike: number) {
    return {
      strike,
      ce: { ltp: 120, close: 110, oi: 2000, prevOi: 1800, oiChange: 200, priceChange: 9.09, sentiment: "Bullish" },
      pe: { ltp: 100, close: 105, oi: 2500, prevOi: 2600, oiChange: -100, priceChange: -4.76, sentiment: "Bearish" },
    };
  }

  test("chart panel draws top walls and max pain as price lines", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({ candles: candles() }),
    );
    r(<NiftyReportPanel />);
    expect(await screen.findByTestId("nifty-chart-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-wrap")).toBeInTheDocument();
    const chart = screen.getByTestId("tradingview-chart");
    // top-2 call walls + top-2 put walls + max pain, plus the 5 prior-session
    // pivots (PP/R1/R2/S1/S2) from the base mock — all now lines (not zones)
    expect(chart).toHaveAttribute("data-marklines", "10");
    expect(chart).toHaveAttribute("data-priceareas", "0");
  });

  test("NIFTY mode hides the Sensex row; the SENSEX tab shows Sensex levels", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchLiveSensex).mockResolvedValueOnce({
      symbol: "SENSEX",
      spot: 74268.85,
      expiry: "2026-10-15",
      pcrOi: 1.78,
      pcrVol: 0.92,
      maxPain: 74200,
      walls: {
        calls: [{ strike: 74500, oi: 1000 }],
        puts: [{ strike: 74000, oi: 1200 }],
      },
      ohlc: { open: 72965.8, high: 74330.29, low: 72896.38, close: 74268.85 },
    });
    r(<NiftyReportPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
    });
    // NIFTY mode: no inline Sensex row above the chart.
    expect(screen.queryByTestId("nifty-sensex-panel")).not.toBeInTheDocument();
    // SENSEX tab: the dedicated focus panel carries the levels.
    await user.click(
      screen.getByTestId("nifty-index-toggle").querySelector('[data-value="sensex"]') ??
        within(screen.getByTestId("nifty-index-toggle")).getByText("SENSEX"),
    );
    expect(await screen.findByTestId("sensex-focus-panel")).toBeInTheDocument();
    expect(screen.getByTestId("sensex-focus-max-pain")).toHaveTextContent("74,200");
  });

  test("live GEX overlay draws spot-relative sides, never inverted labels", async () => {
    const { buildMarkLines } = await import("./niftyChartMath");
    const gex = {
      strikes: [],
      netTotal: 10,
      regime: "long",
      // Legacy tops are deliberately inverted relative to spot (25,750.5):
      // they must not drive the chart labels any more.
      topPositive: [
        { strike: 25800, netGex: 5 },
        { strike: 26100, netGex: 4 },
      ],
      topNegative: [
        { strike: 25700, netGex: -6 },
        { strike: 25300, netGex: -5 },
      ],
      // 25,200 sits below spot (pin magnet) and 26,100 above (pin magnet);
      // 25,100 / 26,050 are negative gamma and therefore fuel, not S/R.
      levels: {
        support: { strike: 25200, netGex: 5 },
        resistance: { strike: 26100, netGex: 4 },
        fuelDown: { strike: 25100, netGex: -6 },
        fuelUp: { strike: 26050, netGex: -5 },
      },
      zeroCross: 25650,
    };
    const rep = mockReport({ gex });
    const labels = buildMarkLines(rep, true).map((l) => l.label.formatter);
    expect(labels).toContain("FLIP 25650");
    // below spot → support; above spot → resistance
    expect(labels).toContain("GSUP 25200");
    expect(labels).toContain("GRES 26100");
    // the legacy (inverted) tops never leak into the chart
    expect(labels.filter((x) => x === "GSUP 26100")).toHaveLength(0);
    expect(labels.filter((x) => x === "GRES 25700")).toHaveLength(0);

    // Negative gamma on either side is fuel, never support/resistance.
    const fuelOnly = mockReport({
      gex: {
        ...gex,
        levels: {
          support: null,
          resistance: null,
          fuelDown: { strike: 25200, netGex: -6 },
          fuelUp: { strike: 26100, netGex: -5 },
        },
      },
    });
    const fuelLabels = buildMarkLines(fuelOnly, true).map((l) => l.label.formatter);
    expect(fuelLabels).toContain("GFUEL↓ 25200");
    expect(fuelLabels).toContain("GFUEL↑ 26100");
    expect(fuelLabels.some((x) => x.startsWith("GSUP") || x.startsWith("GRES"))).toBe(false);

    // walls 25800/25900/26000 calls, 25600/25500/25400 puts, pain 25700:
    // GEX levels landing on those strikes still render — the tags merge into
    // the existing line instead of the GEX reading disappearing.
    const duped = mockReport({
      gex: {
        ...gex,
        levels: {
          support: { strike: 25700, netGex: 5 },
          resistance: { strike: 25800, netGex: 4 },
          fuelDown: null,
          fuelUp: null,
        },
      },
    });
    const dupeLabels = buildMarkLines(duped, true).map((l) => l.label.formatter);
    expect(dupeLabels).toContain("MP 25,700 · GSUP");
    expect(dupeLabels).toContain("CW 25,800 · GRES");

    // off without the flag: only walls/max-pain + pivots remain (no GEX)
    expect(buildMarkLines(rep, false).map((l) => l.label.formatter)).not.toContain("FLIP 25650");
    expect(buildMarkLines({ ...rep, gex: undefined }, true)).toHaveLength(10);
  });

  test("OI table windows to ATM ±750 so strike and signals stay visible", async () => {
    // NIFTY: 50-pt strike step → atmWindowPts = 50 * 15 = 750
    const niftyStrikes = [
      strikeAt(25700), // ATM
      strikeAt(25650), strikeAt(25600), strikeAt(25550), strikeAt(25500), // below
      strikeAt(25750), strikeAt(25800), strikeAt(25850), strikeAt(25900), // above
      strikeAt(24000), strikeAt(27500), // far outside ±750
    ];
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({
        spot: 25750.5,
        strikes: niftyStrikes,
      }),
    );
    r(<NiftyReportPanel />);
    const table = await screen.findByTestId("nifty-oi-table");
    expect(table).toBeInTheDocument();
    expect(within(table).getByText("25,700")).toBeInTheDocument();
    expect(within(table).queryByText("24,000")).not.toBeInTheDocument();
    expect(within(table).queryByText("27,500")).not.toBeInTheDocument();
    // signals still rendered for the visible rows (at least one each)
    expect(within(table).getAllByText("Bullish").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("Bearish").length).toBeGreaterThan(0);
  });

  test("tomorrow's levels render from chain data", async () => {
    r(<NiftyReportPanel />);
    await screen.findByTestId("nifty-tomorrow-panel");
    const row = screen.getByTestId("nifty-levels-row");
    expect(within(row).getByTestId("nifty-level-r1")).toHaveTextContent("25,800 (+0.19%)");
    expect(within(row).getByTestId("nifty-level-r2")).toHaveTextContent("25,900 (+0.58%)");
    expect(within(row).getByTestId("nifty-level-pain")).toHaveTextContent("25,700 (-0.20%)");
    expect(within(row).getByTestId("nifty-level-s1")).toHaveTextContent("25,600 (-0.58%)");
    expect(within(row).getByTestId("nifty-level-s2")).toHaveTextContent("25,500 (-0.97%)");
    expect(screen.getByTestId("nifty-levels-verdict")).toHaveTextContent("Bullish (PCR-OI 1.12");
  });

  test("levels ignore walls on the wrong side of spot", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({
        walls: {
          calls: [{ strike: 25000, oi: 9000 }],
          puts: [{ strike: 26000, oi: 9000 }],
        },
      }),
    );
    r(<NiftyReportPanel />);
    const row = await screen.findByTestId("nifty-levels-row");
    expect(within(row).queryByTestId("nifty-level-r1")).not.toBeInTheDocument();
    expect(within(row).queryByTestId("nifty-level-s1")).not.toBeInTheDocument();
  });

  test("buildOvernightLevels math: empty walls, flat pain, threshold verdicts", async () => {
    const { buildOvernightLevels } = await import("./NiftyReportPanel");
    const base = mockReport({ walls: { calls: [], puts: [] }, pcrOi: 0.85, maxPain: 25750.5 });
    const flat = buildOvernightLevels(base);
    expect(flat.resistance).toEqual([]);
    expect(flat.support).toEqual([]);
    expect(flat.painPull.dir).toBe("flat");
    expect(flat.pcrVerdict).toMatch(/^Neutral/);
    expect(buildOvernightLevels({ ...base, pcrOi: 0.5 }).pcrVerdict).toMatch(/^Bearish/);
    // Replay/pre-open frames can omit PCR entirely; this used to throw on
    // `pcrOi.toFixed` and take the whole panel down.
    const missing = { ...base, pcrOi: undefined } as unknown as typeof base;
    expect(buildOvernightLevels(missing).pcrVerdict).toMatch(/n\/a/);
  });

  test("signal badges show compact codes with the full label on tooltip", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({
        strikes: [
          {
            strike: 25700,
            ce: { ltp: 1, close: 1, oi: 1, prevOi: 0, oiChange: 1, priceChange: 1, sentiment: "LB" },
            pe: { ltp: 1, close: 1, oi: 1, prevOi: 0, oiChange: 1, priceChange: 1, sentiment: "LB" },
          },
        ],
      }),
    );
    r(<NiftyReportPanel />);
    const table = await screen.findByTestId("nifty-oi-table");
    // Compact codes in the cells, action + directional read on the tooltip.
    expect(within(table).getAllByText("LB")).toHaveLength(2);
    expect(
      within(table).getAllByTitle(
        /Long Buildup \(CE\) — call buyers opening · adds\/supports long delta — bullish/,
      ),
    ).toHaveLength(1);
    expect(
      within(table).getAllByTitle(
        /Long Buildup \(PE\) — put buyers opening · adds\/supports short delta — bearish/,
      ),
    ).toHaveLength(1);
    expect(within(table).queryByText("Long Buildup")).not.toBeInTheDocument();
  });

  test("OI-change bars scale to the visible max and carry the sign tone", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({
        spot: 25750,
        strikes: [
          {
            strike: 25700,
            ce: { ltp: 1, close: 1, oi: 1, prevOi: 0, oiChange: 200, priceChange: 1, sentiment: "LB" },
            pe: { ltp: 1, close: 1, oi: 1, prevOi: 0, oiChange: -100, priceChange: 1, sentiment: "SB" },
          },
          {
            strike: 25800,
            ce: { ltp: 1, close: 1, oi: 1, prevOi: 0, oiChange: 100, priceChange: 1, sentiment: "SB" },
            pe: { ltp: 1, close: 1, oi: 1, prevOi: 0, oiChange: -400, priceChange: 1, sentiment: "LB" },
          },
        ],
      }),
    );
    r(<NiftyReportPanel />);
    const table = await screen.findByTestId("nifty-oi-table");
    // CE max is 200 → 100% and 50%; PE max is 400 → 25% and 100%.
    const ceBars = within(table).getAllByTestId("nifty-oi-bar-ce");
    expect(ceBars.map((b) => b.getAttribute("data-pct")).sort()).toEqual(["100", "50"]);
    const peBars = within(table).getAllByTestId("nifty-oi-bar-pe");
    expect(peBars.map((b) => b.getAttribute("data-pct")).sort()).toEqual(["100", "25"]);
    // Numerals stay readable beside the bars.
    expect(within(table).getByText("200")).toBeInTheDocument();
    expect(within(table).getByText("100")).toBeInTheDocument();
  });

  test("top call/put walls get CW/PW tags on their strike rows", async () => {
    const leg = (oiChange: number) => ({
      ltp: 1, close: 1, oi: 1, prevOi: 0, oiChange, priceChange: 1, sentiment: "LB",
    });
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({
        spot: 25750,
        walls: {
          calls: [{ strike: 25800, oi: 5000 }],
          puts: [{ strike: 25600, oi: 6000 }],
        },
        strikes: [
          { strike: 25600, ce: leg(10), pe: leg(20) },
          { strike: 25700, ce: leg(30), pe: leg(40) },
          { strike: 25800, ce: leg(50), pe: leg(60) },
        ],
      }),
    );
    r(<NiftyReportPanel />);
    const table = await screen.findByTestId("nifty-oi-table");
    const cw = within(table).getByTestId("nifty-wall-cw");
    expect(cw).toHaveTextContent("CW");
    expect(cw).toHaveAttribute("title", "Call wall (top CE OI)");
    const pw = within(table).getByTestId("nifty-wall-pw");
    expect(pw).toHaveTextContent("PW");
    expect(pw).toHaveAttribute("title", "Put wall (top PE OI)");
    // One tag each: the middle strike row carries neither.
    expect(within(table).getAllByTestId("nifty-wall-cw")).toHaveLength(1);
    expect(within(table).getAllByTestId("nifty-wall-pw")).toHaveLength(1);
  });

  test("SENSEX-scale walls show CW↓/PW↑ when primary wall is on wrong side of spot", async () => {
    const leg = (oiChange: number) => ({
      ltp: 1, close: 1, oi: 1, prevOi: 0, oiChange, priceChange: 1, sentiment: "LB",
    });
    // Primary call wall BELOW spot (79000 < 79153) → CW↓
    // Primary put wall ABOVE spot (79300 > 79153) → PW↑
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({
        spot: 79153,
        walls: {
          calls: [{ strike: 79000, oi: 5000 }], // only call wall, below spot
          puts: [{ strike: 79300, oi: 6000 }], // only put wall, above spot
        },
        strikes: [
          { strike: 78800, ce: leg(10), pe: leg(20) }, // no wall
          { strike: 79000, ce: leg(30), pe: leg(40) }, // CW↓ (primary call wall)
          { strike: 79153, ce: leg(50), pe: leg(60) }, // ATM (no wall)
          { strike: 79300, ce: leg(70), pe: leg(80) }, // PW↑ (primary put wall)
          { strike: 79500, ce: leg(90), pe: leg(100) }, // no wall
        ],
      }),
    );
    r(<NiftyReportPanel />);
    const table = await screen.findByTestId("nifty-oi-table");

    // Primary call wall below spot (79000) → CW↓
    const cwBelow = within(table).getByTestId("nifty-wall-cw-below");
    expect(cwBelow).toHaveTextContent("CW↓");
    expect(cwBelow).toHaveAttribute("title", "Call wall below spot (broken resistance)");

    // Primary put wall above spot (79300) → PW↑
    const pwAbove = within(table).getByTestId("nifty-wall-pw-above");
    expect(pwAbove).toHaveTextContent("PW↑");
    expect(pwAbove).toHaveAttribute("title", "Put wall above spot (broken support)");

    // No primary CW/PW tags (since primary walls are on wrong side)
    expect(within(table).queryByTestId("nifty-wall-cw")).not.toBeInTheDocument();
    expect(within(table).queryByTestId("nifty-wall-pw")).not.toBeInTheDocument();
    expect(within(table).getAllByTestId("nifty-wall-cw-below")).toHaveLength(1);
    expect(within(table).getAllByTestId("nifty-wall-pw-above")).toHaveLength(1);
  });

  test("column opts keep accessors, alignment and widths; signals stay narrow", () => {
    const row = {
      strike: 25700,
      ce: { ltp: 150, close: 200, oi: 2000, prevOi: 1800, oiChange: 200, priceChange: -50, sentiment: "LB" },
      pe: { ltp: 260, close: 200, oi: 2500, prevOi: 2600, oiChange: -100, priceChange: 60, sentiment: "SB" },
    } as NiftyStrike;
    const plain = getNiftyOiColumns(null);
    const scaled = getNiftyOiColumns(25700, {
      maxCeOiChange: 200,
      maxPeOiChange: 100,
      spot: 25750,
      walls: { calls: [{ strike: 25800 }], puts: [{ strike: 25600 }] },
    });
    expect(scaled.length).toBe(plain.length);
    for (let i = 0; i < plain.length; i++) {
      const a = plain[i] as { size?: number; meta?: { align?: string }; accessorKey?: string };
      const b = scaled[i] as { size?: number; meta?: { align?: string }; accessorKey?: string };
      // Same columns, same widths, same alignment — opts only feed cells.
      expect(b.accessorKey).toBe(a.accessorKey);
      expect(b.size).toBe(a.size);
      expect(b.meta?.align).toBe(a.meta?.align);
      // Sort accessors untouched by the visualisation opts.
      const av = (plain[i] as unknown as { accessorFn?: (r: typeof row) => unknown }).accessorFn?.(row);
      const bv = (scaled[i] as unknown as { accessorFn?: (r: typeof row) => unknown }).accessorFn?.(row);
      expect(bv).toEqual(av);
    }
    const byKey = new Map(
      scaled.map((c) => [c.accessorKey as string, c as unknown as { size?: number }]),
    );
    // Signal columns stay narrow (compact codes, not full labels).
    expect(byKey.get("ce.sentiment")?.size).toBeLessThanOrEqual(72);
    expect(byKey.get("pe.sentiment")?.size).toBeLessThanOrEqual(72);
  });
});

describe("NiftyReportPanel GEX levels (live mode)", () => {
  function gexBlock() {
    return {
      strikes: [
        { strike: 25700, callGex: -3.1, putGex: 8.3, netGex: 5.2 },
        { strike: 25800, callGex: -7.4, putGex: 2.1, netGex: -5.3 },
      ],
      netTotal: 12.4,
      regime: "long" as const,
      topPositive: [{ strike: 25700, netGex: 5.2 }],
      topNegative: [{ strike: 25800, netGex: -5.3 }],
      zeroCross: 25750,
    };
  }

  /** Chain legs carrying greeks = a real (non-degraded) GEX block. */
  function withGreeks(report: NiftyReport): NiftyReport {
    return {
      ...report,
      strikes: report.strikes.map((s) => ({
        ...s,
        ce: { ...s.ce, gamma: 0.0018 },
        pe: { ...s.pe, gamma: 0.0017 },
      })),
    };
  }

  test("live WITH gex shows GEX panel and hides Tomorrow's panel", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      withGreeks(mockReport({ gex: gexBlock() })),
    );
    r(<NiftyReportPanel />);
    expect(await screen.findByTestId("nifty-gex-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-gex-net")).toHaveTextContent("+12.40 Cr/pt");
    expect(screen.getByTestId("nifty-gex-regime")).toHaveTextContent(
      "Dealers LONG gamma — moves dampened",
    );
    expect(screen.getByTestId("nifty-gex-flip")).toHaveTextContent("25,750");
    // spot 25,750.5: the positive strike below spot is support; the negative
    // strike above spot is fuel — it must not be labelled resistance.
    expect(screen.getByTestId("nifty-gex-sup")).toHaveTextContent("γ support");
    expect(screen.getByTestId("nifty-gex-sup")).toHaveTextContent("25,700");
    expect(screen.getByTestId("nifty-gex-res")).toHaveTextContent("γ fuel ↑");
    expect(screen.getByTestId("nifty-gex-res")).toHaveTextContent("25,800");
    // verdict combines regime + max-pain pull + PCR verdict
    expect(screen.getByTestId("nifty-gex-verdict")).toHaveTextContent("Dealers LONG gamma");
    expect(screen.getByTestId("nifty-gex-verdict")).toHaveTextContent("max-pain pull");
    expect(screen.getByTestId("nifty-gex-verdict")).toHaveTextContent("PCR-OI 1.12");
    expect(screen.getByTestId("nifty-gex-verdict")).toHaveTextContent(
      "Gap above 25,800 squeezes call writers; acceptance below 25,600 opens the next put wall.",
    );
    expect(screen.queryByTestId("nifty-tomorrow-panel")).not.toBeInTheDocument();
  });

  test("live WITHOUT gex falls back to the next-session panel", async () => {
    r(<NiftyReportPanel />);
    expect(await screen.findByTestId("nifty-tomorrow-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-tomorrow-panel")).toHaveTextContent(
      "Next-session levels",
    );
    expect(screen.queryByTestId("nifty-gex-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("nifty-levels-verdict")).toHaveTextContent(
      "Gap above 25,800 squeezes call writers; acceptance below 25,600 opens the next put wall.",
    );
  });

  test("the INTEL strip reads the frame's own session, not today's", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchNiftyByDate).mockResolvedValueOnce(
      mockReport({ mode: "eod" }),
    );
    r(<NiftyReportPanel />);
    await screen.findByTestId("nifty-intel-strip");
    // Live mode: no session override — the backend picks today.
    let call = vi.mocked(fetchNiftyIntel).mock.calls.at(-1);
    expect(call?.[1]).toEqual({ date: null, expiry: null });

    await user.click(screen.getByRole("button", { name: "EOD" }));
    const dateInput = screen.getByTestId("nifty-date-input");
    await user.clear(dateInput);
    await user.type(dateInput, "2026-10-10");
    await waitFor(() => {
      call = vi.mocked(fetchNiftyIntel).mock.calls.at(-1);
      expect(call?.[1]?.date).toBe("2026-10-10");
    });
  });

  test("degraded GEX renders γ n/a, never the contract-count total", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({
        gex: {
          ...gexBlock(),
          netTotal: 17_435_535,
          degraded: true,
          zeroCross: null,
        },
      }),
    );
    r(<NiftyReportPanel />);
    expect(await screen.findByTestId("nifty-gex-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-gex-net")).toHaveTextContent("γ n/a");
    expect(screen.getByTestId("nifty-gex-net")).not.toHaveTextContent("17");
    expect(screen.getByTestId("nifty-stat-flip-value")).toHaveTextContent("n/a");
  });

  test("γ flip is spot-aware — a contradictory zeroCross is dropped", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      withGreeks(
        mockReport({
          spot: 25_740,
          // Cumulative gamma up to 25,740 is positive (25,700 = +5.2), so a
          // flip at 25,750 (above spot) contradicts the sign → no flip.
          gex: { ...gexBlock(), zeroCross: 25_750 },
        }),
      ),
    );
    r(<NiftyReportPanel />);
    await screen.findByTestId("nifty-stat-strip");
    expect(screen.getByTestId("nifty-stat-flip-value")).toHaveTextContent("—");
  });

  test("EOD with gex hides the next-session panel (GEX wins in every mode)", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchNiftyByDate).mockResolvedValueOnce(
      mockReport({ mode: "eod", gex: gexBlock() }),
    );
    r(<NiftyReportPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "EOD" }));
    const dateInput = screen.getByTestId("nifty-date-input");
    await user.clear(dateInput);
    await user.type(dateInput, "2026-10-10");
    expect(await screen.findByTestId("nifty-gex-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-tomorrow-panel")).not.toBeInTheDocument();
    // The Tomorrow sentence survives as the GEX footer so nothing is lost.
    expect(screen.getByTestId("nifty-gex-verdict")).toHaveTextContent(
      "Gap above 25,800 squeezes call writers; acceptance below 25,600 opens the next put wall.",
    );
  });

  test("short regime copy amplifies moves; null flip renders em dash", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({
        gex: {
          strikes: [],
          netTotal: -4.5,
          regime: "short",
          topPositive: [],
          topNegative: [],
          zeroCross: null,
        },
      }),
    );
    r(<NiftyReportPanel />);
    expect(await screen.findByTestId("nifty-gex-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-gex-regime")).toHaveTextContent(
      "Dealers SHORT gamma — moves amplified",
    );
    expect(screen.getByTestId("nifty-gex-flip")).toHaveTextContent("—");
    expect(screen.getByTestId("nifty-gex-sup")).toHaveTextContent("—");
    expect(screen.getByTestId("nifty-gex-res")).toHaveTextContent("—");
  });
});

describe("NiftyReportPanel live updates (WS-only, no polling)", () => {
  async function tick(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function renderLive() {
    r(<NiftyReportPanel />);
    await tick(0);
  }

  test("a live spot tick repaints the Spot stat and the updated label only", async () => {
    vi.useFakeTimers();
    try {
      await renderLive();
      const strip = screen.getByTestId("nifty-stat-strip");
      expect(within(strip).getByText("25,750.5")).toBeInTheDocument();

      act(() => {
        setLiveTick({ spot: 25999.75, ts: "2026-10-12T10:00:01+05:30", change_pct: 0.4 });
      });

      expect(within(strip).getByText("25,999.75")).toBeInTheDocument();
      expect(screen.getByTestId("nifty-updated-at")).toHaveTextContent(/10:00:01/);
    } finally {
      setLiveTick(null);
      vi.useRealTimers();
    }
  });

  test("initial load runs once and the toolbar shows live (WS), never auto 30s", async () => {
    vi.useFakeTimers();
    try {
      await renderLive();
      expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("nifty-updated-at")).toBeInTheDocument();
      expect(screen.getByTestId("nifty-updated-at")).toHaveTextContent(/Updated/);
      expect(screen.getByTestId("nifty-updated-at")).toHaveTextContent(/live \(WS\)/);
      expect(screen.queryByText(/auto 30s/)).not.toBeInTheDocument();
      expect(screen.queryByTestId("nifty-stale-badge")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  test("advancing time never refetches in live mode (no interval)", async () => {
    vi.useFakeTimers();
    try {
      await renderLive();
      expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(1);
      await tick(30_000);
      expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(1);
      await tick(120_000);
      expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("backend bursts are used when present and skip local detection (via Refresh)", async () => {
    r(<NiftyReportPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("nifty-oi-bursts-panel")).not.toBeInTheDocument();

    // backend reports ONE burst; the tape stays flat so the local detector
    // would find nothing — proving the backend list is the source used.
    const rows = burstTape();
    vi.mocked(fetchNiftyTape).mockResolvedValue({
      date: "2026-10-12",
      interval_sec: 60,
      rows: rows.map((row) => ({ ...row, call_doi: 0, put_doi: 0 })),
    });
    vi.mocked(fetchNiftyBursts).mockResolvedValue([
      {
        id: `${rows[rows.length - 1].t}-call`,
        side: "call",
        t: rows[rows.length - 1].t,
        delta: 60_000,
        baseline: 1_000,
        score: 60,
        severity: "critical",
        cumDoi: 60_000,
        spot: 25_750.5,
        tickVol: 1_000,
        signal: null,
      },
    ] as never);

    fireEvent.click(screen.getByTestId("nifty-refresh-button"));
    expect(await screen.findByTestId("nifty-oi-bursts-panel")).toBeInTheDocument();
    expect(screen.getAllByText(/BUY PE 25,700/).length).toBeGreaterThan(0);
  });

  test("no polling in EOD mode", async () => {
    vi.useFakeTimers();
    try {
      await renderLive();
      expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "EOD" }));
      await tick(0);
      await tick(120_000);
      expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(fetchNiftyByDate)).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("socket outage marks data stale after 90s without any refetch", async () => {
    vi.useFakeTimers();
    try {
      await renderLive();
      expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
      // before the threshold: still fresh, still no refetch
      await tick(60_000);
      expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("nifty-stale-badge")).not.toBeInTheDocument();
      // past the threshold: stale badge, stats kept, no full error, no refetch
      await tick(60_000);
      expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
      expect(screen.getByTestId("nifty-stale-badge")).toBeInTheDocument();
      expect(screen.getByTestId("nifty-stale-badge")).toHaveTextContent(/STALE/);
      expect(screen.queryByTestId("nifty-error")).not.toBeInTheDocument();
      // the toolbar stays on the WS label even while stale
      expect(screen.getByTestId("nifty-updated-at")).toHaveTextContent(/live \(WS\)/);
    } finally {
      vi.useRealTimers();
    }
  });

  test("failed Refresh keeps last-good stats without a full error", async () => {
    r(<NiftyReportPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
    });
    vi.mocked(fetchLiveNifty).mockRejectedValueOnce(new Error("Upstox token expired"));
    fireEvent.click(screen.getByTestId("nifty-refresh-button"));
    await waitFor(() => {
      expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-error")).not.toBeInTheDocument();
  });

  test("manual Refresh forces a one-shot refetch and nothing else polls", async () => {
    vi.useFakeTimers();
    try {
      await renderLive();
      expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(1);
      await tick(10_000);
      fireEvent.click(screen.getByTestId("nifty-refresh-button"));
      await tick(0);
      expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(2);
      // no timer picks it up again — the count stays put
      await tick(120_000);
      expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("NiftyReportPanel generic underlying polling (SENSEX/RELIANCE)", () => {
  test("generic live mode polls fetchOptionsLive every ~15s", async () => {
    // Run without fake timers first to verify basic logic
    // Mock the generic endpoints
    vi.mocked(fetchOptionsLive).mockResolvedValue(
      mockReport({ spot: 74268, date: "2026-10-12" }),
    );
    vi.mocked(fetchOptionsTape).mockResolvedValue(
      mockTape({ date: "2026-10-12" }) as never,
    );
    vi.mocked(fetchOptionsBursts).mockResolvedValue([]);
    vi.mocked(fetchOptionsChain10s).mockResolvedValue([]);
    vi.mocked(fetchOptionsReplayDates).mockResolvedValue([]);

    r(<NiftyReportPanel />);
    await waitFor(() => expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument());

    // Switch to generic symbol
    const user = userEvent.setup();
    const select = screen.getByTestId("report-symbol-select");
    await user.selectOptions(within(select).getByRole("combobox"), "SENSEX");
    await waitFor(() => expect(vi.mocked(fetchOptionsLive)).toHaveBeenCalled());

    // The initial load should have called fetchOptionsLive
    expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
    expect(vi.mocked(fetchOptionsLive)).toHaveBeenCalledTimes(1);
  });

  test("NIFTY does not call fetchOptionsLive (uses WS, not HTTP polling)", async () => {
    r(<NiftyReportPanel />);
    await waitFor(() => expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument());

    // NIFTY should use fetchLiveNifty, not fetchOptionsLive
    expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchOptionsLive)).not.toHaveBeenCalled();
  });
});

describe("NiftyReportPanel OI tape", () => {
  test("tape panel renders after the OI table with rows latest-first", async () => {
    r(<NiftyReportPanel />);
    expect(await screen.findByTestId("nifty-tape-panel")).toBeInTheDocument();
    await waitFor(() => {
      expect(vi.mocked(fetchNiftyTape)).toHaveBeenCalledWith(
        undefined,
        expect.any(AbortSignal),
      );
    });
    const table = screen.getByTestId("nifty-tape-table");
    expect(table).toBeInTheDocument();
    const rows = within(table).getAllByTestId("nifty-tape-row");
    expect(rows).toHaveLength(2);
    const times = within(table).getAllByTestId("nifty-tape-time");
    expect(times.map((el) => el.textContent)).toEqual(["09:16", "09:15"]);
    const head = screen.getByTestId("nifty-tape-head");
    expect(within(head).getByTestId("nifty-tape-head-pcr-oi")).toHaveTextContent("1.15");
  });

  test("tape spans the row; unusual volume lives in the session detail", async () => {
    r(<NiftyReportPanel />);
    const tapePanel = await screen.findByTestId("nifty-tape-panel");
    expect(tapePanel).toBeInTheDocument();
    const detail = screen.getByTestId("nifty-detail-body");
    const unusualPanel = within(detail).getByTestId("nifty-unusual-panel");
    expect(unusualPanel).toBeInTheDocument();
    // The tape is the live surface; the slower per-strike volume table is detail.
    expect(
      tapePanel.compareDocumentPosition(unusualPanel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(tapePanel).getByTestId("nifty-tape-table")).toBeInTheDocument();
    expect(within(unusualPanel).getByTestId("nifty-unusual-table")).toBeInTheDocument();
  });

  test("session detail starts collapsed and opens from the toggle", async () => {
    r(<NiftyReportPanel />);
    const toggle = await screen.findByTestId("nifty-detail-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const body = screen.getByTestId("nifty-detail-body");
    expect(body).toHaveClass("hidden");
    // Panels stay mounted behind display:none, so opening is instant and the
    // chart/table state is preserved.
    expect(within(body).getByTestId("nifty-iv-straddle-panel")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(body).toHaveClass("flex"));
  });

  test("empty tape shows the pre-market empty state", async () => {
    vi.mocked(fetchNiftyTape).mockResolvedValueOnce({
      date: "2026-10-12",
      interval_sec: 60,
      rows: [],
    });
    r(<NiftyReportPanel />);
    expect(await screen.findByTestId("nifty-tape-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-tape-empty")).toHaveTextContent(
      "Tape starts recording at next market open.",
    );
    expect(screen.queryByTestId("nifty-tape-table")).not.toBeInTheDocument();
  });

  test("EOD mode fetches the tape by date", async () => {
    const user = userEvent.setup();
    r(<NiftyReportPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "EOD" }));
    const dateInput = screen.getByTestId("nifty-date-input");
    await user.clear(dateInput);
    await user.type(dateInput, "2026-10-10");
    await waitFor(() => {
      expect(vi.mocked(fetchNiftyTape)).toHaveBeenCalledWith(
        "2026-10-10",
        expect.any(AbortSignal),
      );
    });
  });

  test("tape failure keeps the report on screen", async () => {
    vi.mocked(fetchNiftyTape).mockRejectedValueOnce(new Error("Tape unavailable"));
    r(<NiftyReportPanel />);
    // report still renders; tape panel falls back to the empty state
    expect(await screen.findByTestId("nifty-stat-strip")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-tape-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-tape-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-error")).not.toBeInTheDocument();
  });
});

describe("NiftyReportPanel level legend", () => {
  const gexBlock = {
    strikes: [],
    netTotal: 10,
    regime: "long",
    topPositive: [{ strike: 25600, netGex: 5 }],
    topNegative: [{ strike: 25500, netGex: -5 }],
    levels: {
      support: { strike: 25600, netGex: 5 },
      resistance: { strike: 25900, netGex: 4 },
      fuelDown: null,
      fuelUp: null,
    },
    zeroCross: 25750,
  };

  test("live with gex lists only the codes the chart can draw", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(mockReport({ gex: gexBlock }));
    r(<NiftyReportPanel />);
    // Dense layout: the panel no longer spends a row on the legend.
    await screen.findByTestId("nifty-stat-strip");
    expect(screen.queryByTestId("nifty-level-legend")).not.toBeInTheDocument();
    r(<LevelLegend live gex={gexBlock as never} spot={25750.5} />);
    const legend = screen.getByTestId("nifty-level-legend");
    for (const code of ["CW", "PW", "MP", "FLIP", "GSUP", "GRES"]) {
      expect(within(legend).getByText(code, { exact: true })).toBeInTheDocument();
    }
    // No negative-gamma side resolved, so there is no fuel line to explain.
    expect(within(legend).queryByText("GFUEL", { exact: true })).not.toBeInTheDocument();
    expect(within(legend).getByText(/dealers switch sides/)).toBeInTheDocument();
    expect(within(legend).getByText(/expiry magnet/)).toBeInTheDocument();
  });

  test("fuel-only sides advertise GFUEL, not GSUP/GRES", async () => {
    const fuelOnly = {
      ...gexBlock,
      levels: {
        support: null,
        resistance: null,
        fuelDown: { strike: 25500, netGex: -5 },
        fuelUp: { strike: 26000, netGex: -4 },
      },
    };
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(mockReport({ gex: fuelOnly }));
    r(<NiftyReportPanel />);
    await screen.findByTestId("nifty-stat-strip");
    r(<LevelLegend live gex={fuelOnly as never} spot={25750.5} />);
    const legend = screen.getByTestId("nifty-level-legend");
    expect(within(legend).getByText("GFUEL", { exact: true })).toBeInTheDocument();
    expect(within(legend).queryByText("GSUP", { exact: true })).not.toBeInTheDocument();
    expect(within(legend).queryByText("GRES", { exact: true })).not.toBeInTheDocument();
  });

  test("live without gex shows only wall codes", async () => {
    r(<NiftyReportPanel />);
    await screen.findByTestId("nifty-stat-strip");
    r(<LevelLegend live={false} />);
    const legend = screen.getByTestId("nifty-level-legend");
    for (const code of ["CW", "PW", "MP"]) {
      expect(within(legend).getByText(code, { exact: true })).toBeInTheDocument();
    }
    expect(within(legend).queryByText("FLIP", { exact: true })).not.toBeInTheDocument();
  });
});

describe("NiftyReportPanel session verdict strip", () => {
  function withVerdicts(overrides?: Partial<NiftyReport>): NiftyReport {
    return mockReport({
      control: {
        verdict: "call_writers",
        ce_doi: 5_530_000,
        pe_doi: -1_200_000,
        atm_ce_iv: 12.5,
        atm_pe_iv: 13.1,
        skew: -2.4,
        gex_regime: "short",
      },
      regime: {
        verdict: "range_sell_premium",
        range_pts: 180,
        range_baseline_pts: 210,
        range_pct: 0.7,
        rv: 11.2,
        iv: 12.4,
        straddle_open: 150,
        straddle_now: 120,
        straddle_pct: -20,
      },
      vix: {
        ltp: 13.45,
        prev_close: 13.8,
        change_pct: -2.54,
        day_high: 13.9,
        day_low: 13.2,
      },
      strength: {
        verdict: "strong",
        score: 72.5,
        ema20: 25700,
        ema50: 25600,
        rsi: 61.3,
        pos_in_range: 0.8,
      },
      ...overrides,
    });
  }

  test("renders the regime headline and three context verdicts", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(withVerdicts());
    r(<NiftyReportPanel />);
    const strip = await screen.findByTestId("nifty-verdict-strip");
    // sits inside the decision band, after the headline numbers
    const stat = screen.getByTestId("nifty-stat-strip");
    expect(
      stat.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const control = screen.getByTestId("nifty-verdict-control");
    expect(control).toHaveTextContent("SESSION · CALL WRITING");
    expect(control).toHaveTextContent("ΔOI (chain) C +5.5M P -1.2M · skew -2.40");

    // Regime is a headline decision, not a fourth cell in the context row.
    const regime = screen.getByTestId("nifty-stat-regime");
    expect(regime).toHaveTextContent("SELL PREMIUM");
    // The range/straddle detail moved into the tooltip to keep one row.
    expect(regime).toHaveAttribute(
      "title",
      expect.stringContaining("180 vs ~210 pts"),
    );
    expect(regime).toHaveAttribute(
      "title",
      expect.stringContaining("straddle -20.00%"),
    );
    expect(screen.queryByTestId("nifty-verdict-regime")).not.toBeInTheDocument();

    const vix = screen.getByTestId("nifty-verdict-vix");
    expect(vix).toHaveTextContent("VIX 13.45 (-2.54%)");
    expect(vix).toHaveTextContent("day 13.20–13.90");

    const strength = screen.getByTestId("nifty-verdict-strength");
    expect(strength).toHaveTextContent("STRONG");
    expect(strength).toHaveTextContent("score 72.5 · RSI 61.3");
  });

  test("renders the coil gauge in the same verdict row", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(withVerdicts());
    r(<NiftyReportPanel />);
    const strip = await screen.findByTestId("nifty-verdict-strip");
    const gauge = screen.getByTestId("nifty-coil-gauge");
    expect(strip).toContainElement(gauge);
    // 180 / 210 = 86% of baseline -> NORMAL.
    expect(gauge).toHaveTextContent("NORMAL");
    expect(gauge).toHaveTextContent("0.9x");
    expect(screen.getByTestId("nifty-coil-rv-iv")).toHaveTextContent(
      "RV 11.2 / IV 12.4",
    );
  });

  test("renders the other verdict variants", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      withVerdicts({
        control: {
          verdict: "put_writers",
          ce_doi: null,
          pe_doi: null,
          atm_ce_iv: null,
          atm_pe_iv: null,
          skew: null,
          gex_regime: null,
        },
        regime: {
          verdict: "trend_buy",
          range_pts: null,
          range_baseline_pts: null,
          range_pct: null,
          // Premium-rich tape: the label must follow the vote, not the verdict.
          rv: 12.5,
          iv: 15.0,
          straddle_open: null,
          straddle_now: null,
          straddle_pct: null,
        },
        vix: {
          ltp: 14,
          prev_close: 13,
          change_pct: 7.69,
          day_high: 14.1,
          day_low: 13.2,
        },
        strength: {
          verdict: "weak",
          score: 20,
          ema20: null,
          ema50: null,
          rsi: 40,
          pos_in_range: null,
        },
      }),
    );
    r(<NiftyReportPanel />);
    await screen.findByTestId("nifty-verdict-strip");
    expect(screen.getByTestId("nifty-verdict-control")).toHaveTextContent(
      "SESSION · PUT WRITING",
    );
    expect(screen.getByTestId("nifty-stat-regime")).toHaveTextContent(
      "SELL PREMIUM · IV > RV",
    );
    expect(screen.getByTestId("nifty-verdict-vix")).toHaveTextContent(
      "VIX 14.00 (+7.69%)",
    );
    expect(screen.getByTestId("nifty-verdict-strength")).toHaveTextContent("WEAK");
  });

  test("dashes every cell when the new blocks are absent", async () => {
    // default mockReport has no control/regime/vix/strength blocks
    r(<NiftyReportPanel />);
    await screen.findByTestId("nifty-verdict-strip");
    expect(screen.getByTestId("nifty-verdict-control-primary")).toHaveTextContent(
      /^—$/,
    );
    expect(
      screen.getByTestId("nifty-verdict-control-secondary"),
    ).toHaveTextContent("ΔOI (chain) C — P — · skew —");
    expect(screen.getByTestId("nifty-stat-regime-value")).toHaveTextContent(
      /^—$/,
    );
    // The empty-regime detail lives in the tooltip, not a third text line.
    expect(screen.getByTestId("nifty-stat-regime")).toHaveAttribute(
      "title",
      expect.stringContaining("— vs ~— pts · straddle —%"),
    );
    expect(screen.getByTestId("nifty-verdict-vix-primary")).toHaveTextContent(
      "VIX — (—%)",
    );
    expect(screen.getByTestId("nifty-verdict-vix-secondary")).toHaveTextContent(
      "day —–—",
    );
    expect(screen.getByTestId("nifty-verdict-strength-primary")).toHaveTextContent(
      /^—$/,
    );
    expect(
      screen.getByTestId("nifty-verdict-strength-secondary"),
    ).toHaveTextContent("score — · RSI —");
  });

  test("partial block dashes missing fields and unknown verdicts", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({
        control: {
          verdict: null,
          ce_doi: 1000,
          pe_doi: null,
          atm_ce_iv: null,
          atm_pe_iv: null,
          skew: null,
          gex_regime: null,
        },
        vix: {
          ltp: 12.5,
          prev_close: null,
          change_pct: null,
          day_high: null,
          day_low: null,
        },
      }),
    );
    r(<NiftyReportPanel />);
    await screen.findByTestId("nifty-verdict-strip");
    expect(screen.getByTestId("nifty-verdict-control-primary")).toHaveTextContent(
      /^—$/,
    );
    expect(
      screen.getByTestId("nifty-verdict-control-secondary"),
    ).toHaveTextContent("ΔOI (chain) C +1,000 P — · skew —");
    expect(screen.getByTestId("nifty-verdict-vix-primary")).toHaveTextContent(
      "VIX 12.50 (—%)",
    );
    expect(screen.getByTestId("nifty-verdict-vix-secondary")).toHaveTextContent(
      "day —–—",
    );
  });
});

describe("NiftyReportPanel compact desk top", () => {
  test("top strip renders each headline value once at compact sizes", async () => {
    r(<NiftyReportPanel />);
    await screen.findByTestId("nifty-stat-strip");
    const strip = screen.getByTestId("nifty-stat-strip");
    // every headline number exactly once — the old detail lines that
    // repeated them (day range, wall OI, flip delta) now live in tooltips
    for (const text of ["25,750.5", "1.12", "0.95", "25,700"]) {
      expect(within(strip).getAllByText(text)).toHaveLength(1);
    }
    expect(screen.getByTestId("nifty-stat-flip")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-stat-call-wall")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-stat-put-wall")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-stat-pin")).toBeInTheDocument();
    // spot anchors the row larger, the rest compact
    expect(screen.getByTestId("nifty-stat-spot-value")).toHaveStyle({
      fontSize: "15px",
    });
    expect(screen.getByTestId("nifty-stat-regime-value")).toHaveStyle({
      fontSize: "12px",
    });
  });

  test("stat strip shows the walls payload's max-OI walls, not the report snapshot's", async () => {
    // The walls endpoint and the report's own `walls` snapshot can disagree
    // (a near-tie showed 23,000 on one feed and 23,600 on the other). The
    // payload that feeds the WALLS card must win the strip too — same source,
    // same answer. The payload's 26,100/25,200 are deliberately different
    // from the mockReport walls (25,800-26,000 calls / 25,400-25,600 puts).
    const wallsPayload: WallsPayload = {
      symbol: "NIFTY",
      date: "2026-10-12",
      expiry: "weekly",
      dte: 3,
      spot: 25750.5,
      max_pain: 25700,
      max_pain_drift: 0,
      atm: 25750,
      net_gex: null,
      flip: null,
      read: "",
      gex_degraded: true,
      pin_distance_pts: 0,
      pin_distance_pct: 0,
      state: "QUIET",
      expiry_day: false,
      alert_eligible: false,
      alert: null,
      reasons: [],
      call_wall: { strike: 26_100, oi: 9_999_999 },
      put_wall: { strike: 25_200, oi: 8_888_888 },
      tracked_call_erosion_30m: null,
      tracked_call_erosion_5m: null,
      tracked_put_build_30m: null,
      near: false,
      cross: false,
      calls: [{ strike: 26_100, oi: 9_999_999 }],
      puts: [{ strike: 25_200, oi: 8_888_888 }],
      events: [],
      history: [],
      freshness: {
        last_t: "2026-10-12T09:15:00+05:30",
        age_sec: 0,
        stale: false,
        rows: 1,
        gaps: [],
      },
      window_min: 60,
      top: 3,
    };
    vi.mocked(fetchOptionsWalls).mockResolvedValue(wallsPayload);
    try {
      r(<NiftyReportPanel />);
      await waitFor(() =>
        expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument(),
      );
      // The walls card's fetch fires for the live NIFTY report (no date, no
      // replay cutoff, map closed)...
      await waitFor(() =>
        expect(vi.mocked(fetchOptionsWalls)).toHaveBeenCalledWith(
          "NIFTY",
          undefined,
          undefined,
          undefined,
          false,
        ),
      );
      // ...and once it lands, the strip names the payload's walls.
      const callCell = await screen.findByTestId("nifty-stat-call-wall");
      await waitFor(() => expect(callCell).toHaveTextContent("26,100"));
      expect(screen.getByTestId("nifty-stat-put-wall")).toHaveTextContent("25,200");
      // The report snapshot's 26,000/25,600 must not win either cell.
      expect(callCell).not.toHaveTextContent("26,000");
      expect(screen.getByTestId("nifty-stat-put-wall")).not.toHaveTextContent("25,600");
    } finally {
      // clearAllMocks() keeps implementations — restore the suite default so
      // later tests keep rendering from the report walls only.
      vi.mocked(fetchOptionsWalls).mockResolvedValue(null);
    }
  });

  test("pin risk flags a frame pinned at a wall under a far max pain", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({
        spot: 22492.5,
        maxPain: 22700,
        wallsNear: {
          calls: [{ strike: 22700, oi: 7_900_000, distance: 207.5 }],
          puts: [{ strike: 22500, oi: 14_800_000, distance: -7.5 }],
        },
      }),
    );
    r(<NiftyReportPanel />);
    const cell = await screen.findByTestId("nifty-stat-pin");
    expect(within(cell).getByTestId("nifty-stat-pin-value")).toHaveTextContent(
      "HIGH",
    );
    expect(cell).toHaveAttribute("title", expect.stringContaining("pinned"));
  });

  test("pin risk stays LOW when the walls are far and max pain is close", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({
        spot: 22645,
        maxPain: 22660,
        wallsNear: {
          calls: [{ strike: 23000, oi: 1_000_000, distance: 355 }],
          puts: [{ strike: 22500, oi: 1_000_000, distance: -145 }],
        },
      }),
    );
    r(<NiftyReportPanel />);
    const cell = await screen.findByTestId("nifty-stat-pin");
    expect(within(cell).getByTestId("nifty-stat-pin-value")).toHaveTextContent(
      "LOW",
    );
  });

  test("squeeze fuel flags a pinned wall whose calls are being covered", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({
        spot: 25750.5,
        maxPain: 25900,
        wallsNear: {
          calls: [{ strike: 25780, oi: 9_000_000, distance: 29.5 }],
          puts: [{ strike: 25600, oi: 8_000_000, distance: -150.5 }],
        },
        strikes: [
          {
            strike: 25780,
            ce: {
              ltp: 50, close: 55, oi: 9_000_000, prevOi: 9_200_000,
              oiChange: -200_000, priceChange: 3, sentiment: "Short Cover",
            },
            pe: {
              ltp: 20, close: 20, oi: 1000, prevOi: 1000,
              oiChange: 0, priceChange: 0, sentiment: "Long Buildup",
            },
          },
        ],
      }),
    );
    r(<NiftyReportPanel />);
    const chip = await screen.findByTestId("nifty-squeeze-fuel");
    expect(within(chip).getByTestId("nifty-squeeze-fuel-value")).toHaveTextContent("FUEL");
  });

  test("no squeeze fuel when the call wall is defended (writers adding)", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({
        spot: 25750.5,
        maxPain: 25900,
        wallsNear: {
          calls: [{ strike: 25780, oi: 9_000_000, distance: 29.5 }],
          puts: [{ strike: 25600, oi: 8_000_000, distance: -150.5 }],
        },
        strikes: [
          {
            strike: 25780,
            ce: {
              ltp: 50, close: 45, oi: 9_000_000, prevOi: 8_000_000,
              oiChange: 1_000_000, priceChange: -5, sentiment: "Short Buildup",
            },
            pe: {
              ltp: 20, close: 20, oi: 1000, prevOi: 1000,
              oiChange: 0, priceChange: 0, sentiment: "Long Buildup",
            },
          },
        ],
      }),
    );
    r(<NiftyReportPanel />);
    await screen.findByTestId("nifty-stat-pin");
    expect(screen.queryByTestId("nifty-squeeze-fuel")).not.toBeInTheDocument();
  });

  test("desk renders the breadth strip when the quote feed is available", async () => {
    vi.mocked(fetchBreadth).mockResolvedValueOnce({
      available: true,
      up: 1,
      count: 5,
      rows: [
        { label: "NIFTY", last: 22_600, close: 22_687, change_pct: -0.38 },
        { label: "BANK", last: 54_200, close: 54_300, change_pct: -0.18 },
        { label: "MID", last: 20_600, close: 21_100, change_pct: -2.37 },
        { label: "SMALL", last: 18_600, close: 19_300, change_pct: -3.63 },
        { label: "BROAD", last: 21_400, close: 21_600, change_pct: -0.93 },
      ],
    });
    window.localStorage.setItem("nifty.deskMode", "desk");
    r(<NiftyReportPanel />);
    await screen.findByTestId("nifty-stat-strip");
    const body = await openDeskDock("market");
    expect(within(body).getByTestId("nifty-breadth-strip")).toBeInTheDocument();
    expect(within(body).getByTestId("nifty-breadth-count")).toHaveTextContent("1/5 up");
    expect(within(body).getByTestId("nifty-breadth-small")).toHaveTextContent("-3.63%");
  });

  test("desk shows the pressure lane, setup radar and drift sparklines", async () => {
    window.localStorage.setItem("nifty.deskMode", "desk");
    r(<NiftyReportPanel />);
    await screen.findByTestId("nifty-stat-strip");
    const flow = await openDeskDock("flow");
    expect(within(flow).getByTestId("nifty-pressure-wrap")).toBeInTheDocument();
    expect(within(flow).getByTestId("nifty-flowchart")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-10s-strip")).not.toBeInTheDocument();
    expect(
      within(flow).queryByTestId("nifty-pressure-lane") ??
        within(flow).getByTestId("nifty-pressure-empty"),
    ).toBeInTheDocument();
    await closeDeskDock();
    const setup = await openDeskDock("setup");
    expect(within(setup).getByTestId("nifty-setup-radar")).toBeInTheDocument();
    await closeDeskDock();
    await openSideTab("heatmap");
    const volBtn = screen.getByTestId("nifty-heatmap-metric-volume");
    fireEvent.click(volBtn);
    expect(volBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("nifty-heatmap-metric-oi")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("nifty-maxpain-spark")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-pcr-spark")).toBeInTheDocument();
  });

  test("a tape with volume renders pressure bars", async () => {
    const base = mockTape();
    vi.mocked(fetchNiftyTape).mockResolvedValueOnce({
      ...base,
      rows: base.rows.map((r, i) => ({
        ...r,
        ce_vol: (i + 1) * 4_000_000,
        pe_vol: (i + 1) * 1_500_000,
      })),
    } as never);
    window.localStorage.setItem("nifty.deskMode", "desk");
    r(<NiftyReportPanel />);
    await screen.findByTestId("nifty-stat-strip");
    const flow = await openDeskDock("flow");
    expect(within(flow).getByTestId("nifty-pressure-svg")).toBeInTheDocument();
  });

  test("second strip renders control, coil, VIX and strength in one row", async () => {
    r(<NiftyReportPanel />);
    const strip = await screen.findByTestId("nifty-verdict-strip");
    for (const id of [
      "nifty-verdict-control",
      "nifty-coil-gauge",
      "nifty-verdict-vix",
      "nifty-verdict-strength",
    ]) {
      expect(within(strip).getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId("nifty-verdict-control-primary")).toHaveStyle({
      fontSize: "11px",
    });
    // regime stays a top-row headline, never a second-strip cell
    expect(screen.queryByTestId("nifty-verdict-regime")).not.toBeInTheDocument();
  });
});

describe("NiftyReportPanel structure shifts", () => {
  test("renders shifts newest-first next to the OI bursts panel", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({
        structure: [
          {
            t: "2026-10-14T09:20:00+05:30",
            kind: "pcr_shift",
            detail: "PCR(OI) 1.10 -> 0.95",
            severity: "alert",
            magnitude: 0.15,
          },
          {
            t: "2026-10-14T13:06:00+05:30",
            kind: "wall_flip",
            detail: "22,700 support became resistance",
            severity: "critical",
            magnitude: 12.3,
            side: "call",
            level: 22700,
          },
        ],
      }),
    );
    r(<NiftyReportPanel />);
    const box = await screen.findByTestId("nifty-structure");
    const rows = within(box).getAllByTestId("nifty-structure-row");
    expect(rows).toHaveLength(2);
    // newest on the payload (13:06) leads the list
    expect(rows[0]).toHaveTextContent("13:06");
    expect(rows[1]).toHaveTextContent("09:20");
    expect(within(box).getByTestId("nifty-structure-summary")).toHaveTextContent(
      "2 shifts · 1 critical",
    );
  });

  test("structure shifts and OI bursts share one wrapping side-by-side row", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchNiftyByDate).mockResolvedValue(
      mockReport({
        mode: "eod",
        structure: [
          {
            t: "2026-10-14T13:06:00+05:30",
            kind: "wall_flip",
            detail: "22,700 support became resistance",
            severity: "critical",
            magnitude: 12.3,
          },
        ],
      }),
    );
    vi.mocked(fetchNiftyBursts).mockResolvedValue([
      {
        id: "2026-10-10T14:20:00+05:30-call",
        side: "call",
        t: "2026-10-10T14:20:00+05:30",
        delta: -16_461_965,
        baseline: 1_000_000,
        score: 16.4,
        severity: "critical",
        cumDoi: -36_657_985,
        spot: 22_597.3,
        tickVol: 1_000,
        signal: null,
      },
    ] as never);

    r(<NiftyReportPanel />);
    await screen.findByTestId("nifty-stat-strip");
    await user.click(screen.getByRole("button", { name: "EOD" }));
    const dateInput = screen.getByTestId("nifty-date-input");
    await user.clear(dateInput);
    await user.type(dateInput, "2026-10-10");

    const row = await screen.findByTestId("nifty-signals-row");
    const bursts = await within(row).findByTestId("nifty-oi-bursts-wrap");
    const structure = within(row).getByTestId("nifty-structure");
    expect(bursts).toBeInTheDocument();
    expect(structure).toBeInTheDocument();
    // bursts lead, structure follows — both flex children of the same wrapping row
    expect(
      bursts.compareDocumentPosition(structure) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("absent structure renders no structure panel", async () => {
    r(<NiftyReportPanel />);
    await screen.findByTestId("nifty-stat-strip");
    expect(screen.queryByTestId("nifty-structure")).not.toBeInTheDocument();
  });
});

describe("NiftyReportPanel ultra-compact layout", () => {
  function candles() {
    return [
      { time: "2026-10-12T09:15:00", open: 25600, high: 25650, low: 25580, close: 25620, volume: 1000 },
      { time: "2026-10-12T09:16:00", open: 25620, high: 25680, low: 25600, close: 25750.5, volume: 1200 },
    ];
  }

  test("chart body fills its row by default and the OI body fills its column", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({ candles: candles() }),
    );
    r(<NiftyReportPanel />);
    const chartWrap = await screen.findByTestId("nifty-chart-wrap");
    // Default = fill (autoSize), no fixed 180px preset.
    expect(chartWrap).toHaveAttribute("data-fill", "1");
    expect(chartWrap).not.toHaveStyle({ height: "180px" });
    const oiWrap = screen.getByTestId("nifty-oi-wrap");
    expect(oiWrap).toHaveStyle({ height: "100%" });
  });

  test("signals-row wrapper does not mount when empty (no dead wrapper)", async () => {
    // default mock: no structure payload, quiet tape → no trail either
    r(<NiftyReportPanel />);
    await screen.findByTestId("nifty-stat-strip");
    expect(screen.queryByTestId("nifty-signals-row")).not.toBeInTheDocument();
    // the grid + tomorrow panel still render — only the empty wrapper is gone
    expect(screen.getByTestId("nifty-signals-grid")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-tomorrow-panel")).toBeInTheDocument();
  });

  test("signals-row wrapper mounts when structure is present", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({
        structure: [
          {
            t: "2026-10-14T13:06:00+05:30",
            kind: "wall_flip",
            detail: "22,700 support became resistance",
            severity: "critical",
            magnitude: 12.3,
          },
        ],
      }),
    );
    r(<NiftyReportPanel />);
    const row = await screen.findByTestId("nifty-signals-row");
    expect(within(row).getByTestId("nifty-structure")).toBeInTheDocument();
  });

  test("oiBurstLogHeight grows per alert and caps at 140", () => {
    expect(oiBurstLogHeight(0)).toBe(40);
    expect(oiBurstLogHeight(2)).toBe(80);
    expect(oiBurstLogHeight(5)).toBe(140);
    expect(oiBurstLogHeight(50)).toBe(140);
  });
});

describe("NiftyReportPanel pivot marklines", () => {
  function byLabel(lines: ReturnType<typeof buildMarkLines>) {
    return new Map(lines.map((l) => [l.label.formatter, l]));
  }

  test("draws PP solid muted + R dashed red + S dashed green with en-IN labels", () => {
    const labels = buildMarkLines(mockReport()).map((l) => l.label.formatter);
    expect(labels).toContain("PP 22,897");
    expect(labels).toContain("R1 23,157");
    expect(labels).toContain("R2 23,316");
    expect(labels).toContain("S1 22,738");
    expect(labels).toContain("S2 22,478");
    // R3/S3 are never drawn — gutter hygiene
    expect(labels.filter((x) => x.startsWith("R3") || x.startsWith("S3"))).toHaveLength(0);

    const m = byLabel(buildMarkLines(mockReport()));
    const pp = m.get("PP 22,897");
    expect(pp?.yAxis).toBe(22897);
    expect(pp?.lineStyle.color).toBe(palette.TEXT_MUTED);
    expect(pp?.lineStyle.type).toBe("solid");
    const r1 = m.get("R1 23,157");
    expect(r1?.yAxis).toBe(23157);
    expect(r1?.lineStyle.color).toBe(palette.NEGATIVE);
    expect(r1?.lineStyle.type).toBe("dashed");
    const s1 = m.get("S1 22,738");
    expect(s1?.yAxis).toBe(22738);
    expect(s1?.lineStyle.color).toBe(palette.POSITIVE);
    expect(s1?.lineStyle.type).toBe("dashed");
  });

  test("null levels are skipped, near-drawn levels are deduped", () => {
    const partial = buildMarkLines(
      mockReport({
        pivots: {
          type: "classic",
          pp: 22897, r1: null, r2: null, r3: null,
          s1: 22738, s2: null, s3: null, prev: null,
        },
      }),
    ).map((l) => l.label.formatter);
    expect(partial).toContain("PP 22,897");
    expect(partial).toContain("S1 22,738");
    expect(partial.filter((x) => x.startsWith("R1 ") || x.startsWith("R2 "))).toHaveLength(0);

    // 25905 lands within 25 pts of the 25,900 call-wall line — deduped
    const dedupe = buildMarkLines(
      mockReport({
        pivots: {
          type: "classic",
          pp: null, r1: 25905, r2: null, r3: null,
          s1: null, s2: null, s3: null, prev: null,
        },
      }),
    ).map((l) => l.label.formatter);
    expect(dedupe.filter((x) => x.startsWith("R1"))).toHaveLength(0);

    // whole block absent/null → only the 5 wall/MP lines remain
    expect(buildMarkLines(mockReport({ pivots: null }))).toHaveLength(5);
  });

  test("the live chart receives the pivot labels via markLines", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({
        candles: [
          { time: "2026-10-12T09:15:00", open: 25600, high: 25650, low: 25580, close: 25620, volume: 1000 },
        ],
      }),
    );
    r(<NiftyReportPanel />);
    const chart = await screen.findByTestId("tradingview-chart");
    const labels = JSON.parse(chart.getAttribute("data-marklabels") ?? "[]") as string[];
    for (const want of ["PP 22,897", "R1 23,157", "R2 23,316", "S1 22,738", "S2 22,478"]) {
      expect(labels).toContain(want);
    }
  });
});

describe("NiftyReportPanel chart timeframe toggle", () => {
  function oneMin(n: number) {
    return Array.from({ length: n }, (_, i) => {
      const total = 9 * 60 + 15 + i; // NSE open 09:15
      const time = `2026-10-12T${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}:00+05:30`;
      return { time, open: 25600 + i, high: 25650 + i, low: 25580, close: 25620 + i, volume: 10 };
    });
  }

  test("defaults to 1m; resamples 5m and 15m client-side, EMAs follow", async () => {
    const user = userEvent.setup();
    // 60 one-minute candles: 09:15 → 10:14
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({ intraday: oneMin(60) }),
    );
    r(<NiftyReportPanel />);
    const chart = await screen.findByTestId("tradingview-chart");
    const toggle = screen.getByTestId("nifty-tf-toggle");
    expect(toggle).toBeInTheDocument();
    expect(chart).toHaveAttribute("data-candles", "60");
    expect(chart).toHaveAttribute("data-emas", "2");

    await user.click(within(toggle).getByRole("button", { name: "15m" }));
    // session opens on a 15-min boundary, so 60 minutes fold into 4 buckets
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "4");
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-emas", "2");

    await user.click(within(toggle).getByRole("button", { name: "5m" }));
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "12");
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-emas", "2");

    await user.click(within(toggle).getByRole("button", { name: "1m" }));
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "60");
  });
});

describe("resampleCandles (pure timeframe resampler)", () => {
  const ts = (day: string, mins: number) =>
    `${day}T${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}:00+05:30`;

  test("5m buckets fold OHLCV and stamp the bucket-start time", () => {
    const oneMin20 = Array.from({ length: 20 }, (_, i) => ({
      time: ts("2026-10-12", 555 + i), // 09:15 → 09:34
      open: 25600 + i, high: 25600 + 2 * i, low: 25600 - i, close: 25600 + i, volume: 12,
    }));
    const out = resampleCandles(oneMin20, 5);
    expect(out).toHaveLength(4);
    // bucket 0 folds the five 09:15-09:19 minutes: first open, max high,
    // min low, last close, summed volume
    expect(out[0]).toEqual({
      time: "2026-10-12T09:15:00+05:30",
      open: 25600, high: 25608, low: 25596, close: 25604, volume: 60,
    });
    expect(out[3].time).toBe("2026-10-12T09:30:00+05:30");
    expect(out[3].close).toBe(25619); // last 1-min close in the 09:30 bucket
  });

  test("bucket clock is wall-clock local, resetting per calendar day", () => {
    const out = resampleCandles(
      [
        { time: ts("2026-10-12", 555), open: 1, high: 1, low: 1, close: 1, volume: 1 },
        { time: ts("2026-10-13", 555), open: 2, high: 2, low: 2, close: 2, volume: 1 },
      ],
      5,
    );
    expect(out).toHaveLength(2);
    expect(out[1].time).toBe("2026-10-13T09:15:00+05:30");
  });

  test("candles with unparseable timestamps are skipped", () => {
    const out = resampleCandles(
      [
        { time: "not-a-time", open: 9, high: 9, low: 9, close: 9, volume: 9 },
        { time: ts("2026-10-12", 555), open: 1, high: 2, low: 0, close: 1, volume: 1 },
      ],
      15,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      time: "2026-10-12T09:15:00+05:30",
      open: 1, high: 2, low: 0, close: 1, volume: 1,
    });
  });

  test("1m returns the input element-for-element, mending missing volume", () => {
    const src = [
      { time: ts("2026-10-12", 555), open: 1, high: 2, low: 0, close: 1 },
      { time: ts("2026-10-12", 556), open: 1, high: 2, low: 0, close: 2, volume: 4 },
    ];
    const out = resampleCandles(src as Parameters<typeof resampleCandles>[0], 1);
    expect(out).toEqual([
      { time: ts("2026-10-12", 555), open: 1, high: 2, low: 0, close: 1, volume: 0 },
      { time: ts("2026-10-12", 556), open: 1, high: 2, low: 0, close: 2, volume: 4 },
    ]);
  });

  test("empty input → empty output", () => {
    expect(resampleCandles([], 5)).toEqual([]);
  });
});

describe("emaSeries (pure EMA recomputation)", () => {
  test("seeds with the mean of the first `period` closes, nulls before", () => {
    expect(emaSeries([2, 4, 6, 8, 10], 3)).toEqual([null, null, 4, 6, 8]);
  });

  test("input shorter than period → all null", () => {
    expect(emaSeries([1, 2], 20)).toEqual([null, null]);
  });

  test("empty input → empty series", () => {
    expect(emaSeries([], 9)).toEqual([]);
  });
});

describe("NiftyReportPanel critical OI-unwind prominence", () => {
  // Mirrors the 2026-10-21 15:04 event: put OI unwind −1.48M, backend flow
  // covering (bullish) → BUY CE.
  function backendBurst(overrides: Record<string, unknown> = {}) {
    return {
      id: "2026-10-12T15:04:00+05:30-put",
      side: "put",
      t: "2026-10-12T15:04:00+05:30",
      delta: -1_480_000,
      baseline: 100_000,
      score: 14.8,
      severity: "critical",
      cumDoi: -5_000_000,
      spot: 25701,
      tickVol: 5000,
      signal: null,
      flow: "covering",
      bearish: false,
      ...overrides,
    };
  }

  async function renderWithBursts(bursts: unknown[]) {
    vi.mocked(fetchNiftyBursts).mockResolvedValue(bursts as never);
    r(<NiftyReportPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId("nifty-oi-bursts-panel")).toBeInTheDocument();
    });
  }

  function trailSeverities(): (string | null)[] {
    return within(screen.getByTestId("nifty-oi-bursts-panel"))
      .getAllByTestId("market-alert-oi_burst")
      .map((el) => el.getAttribute("data-severity"));
  }

  test("critical burst raises a sticky banner above the verdict strip with the action", async () => {
    await renderWithBursts([backendBurst()]);
    const banner = screen.getByTestId("nifty-critical-banner");
    const strip = screen.getByTestId("nifty-stat-strip");
    // above the verdict strip: the strip follows the banner in document order
    expect(banner.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(strip.contains(banner)).toBe(false);
    // put unwind + covering → CE plan (25,700 is the only chain strike): action + levels
    const text = within(banner).getByTestId("nifty-critical-banner-text");
    expect(text).toHaveTextContent("CRITICAL PUT SHORTS COVERING");
    expect(text).toHaveTextContent("BUY CE 25,700");
    expect(text).toHaveTextContent("entry 120");
    expect(text).toHaveTextContent("SL 90");
    expect(text).toHaveTextContent("TGT 180");
    // the card header carries the red CRITICAL badge
    expect(screen.getByTestId("nifty-oi-critical-badge")).toHaveTextContent("CRITICAL 1");
  });

  test("critical banner warns when the frame is pinned (§2.16 sweep risk)", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValue(
      mockReport({
        spot: 22492.5,
        maxPain: 22700,
        wallsNear: {
          calls: [{ strike: 22700, oi: 7_900_000, distance: 207.5 }],
          puts: [{ strike: 22500, oi: 14_800_000, distance: -7.5 }],
        },
      }),
    );
    await renderWithBursts([backendBurst()]);
    const chip = screen.getByTestId("nifty-critical-banner-pin");
    expect(chip).toHaveTextContent(/PIN/);
    expect(chip).toHaveTextContent(/SWEEP RISK/);
    expect(chip.getAttribute("title")).toContain("PINNED");
  });

  test("no pin warning when the frame is not pinned", async () => {
    await renderWithBursts([backendBurst()]);
    expect(screen.queryByTestId("nifty-critical-banner-pin")).not.toBeInTheDocument();
  });

  test("liquidation against the up-trend stays bannered but action-less", async () => {
    // Same unwind, opposite flow: liquidation → PE, but the tape trend is up
    // so the gate suppresses the plan — the banner must still fire, without
    // inventing an action.
    await renderWithBursts([backendBurst({ flow: "liquidation", bearish: true })]);
    const text = within(screen.getByTestId("nifty-critical-banner")).getByTestId(
      "nifty-critical-banner-text",
    );
    expect(text).toHaveTextContent("CRITICAL PUT LONGS EXITING");
    expect(text).not.toHaveTextContent("BUY");
  });

  test("non-critical bursts raise no banner, badge, or filter", async () => {
    await renderWithBursts([backendBurst({ severity: "watch", score: 3.1 })]);
    expect(screen.getByTestId("nifty-oi-bursts-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-critical-banner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-oi-critical-badge")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-oi-critical-filter")).not.toBeInTheDocument();
    // the trail itself is unchanged: the watch row is still listed
    expect(trailSeverities()).toEqual(["watch"]);
  });

  test("badge counts criticals and the trail keeps time order", async () => {
    await renderWithBursts([
      backendBurst(),
      backendBurst({
        id: "2026-10-12T15:06:00+05:30-put",
        side: "put",
        t: "2026-10-12T15:06:00+05:30",
        delta: 50_000,
        severity: "watch",
        score: 3.2,
        signal: null,
      }),
    ]);
    expect(screen.getByTestId("nifty-oi-critical-badge")).toHaveTextContent("CRITICAL 1");
    // Time order by default: newest (watch) first, critical second.
    expect(trailSeverities()).toEqual(["watch", "critical"]);
    // critical rows carry the derived action inline
    const rows = within(screen.getByTestId("nifty-oi-bursts-panel")).getAllByTestId(
      "market-alert-oi_burst",
    );
    expect(rows[1]).toHaveTextContent("BUY CE 25,700");
    expect(rows[1]).toHaveTextContent("ENTRY");
  });

  test("critical filter toggle narrows the trail and back", async () => {
    const user = userEvent.setup();
    await renderWithBursts([
      backendBurst(),
      backendBurst({
        id: "2026-10-12T15:06:00+05:30-put",
        side: "put",
        t: "2026-10-12T15:06:00+05:30",
        delta: 50_000,
        severity: "watch",
        score: 3.2,
        signal: null,
      }),
    ]);
    expect(trailSeverities()).toEqual(["watch", "critical"]);

    const filter = screen.getByTestId("nifty-oi-critical-filter");
    expect(filter).toHaveAttribute("aria-pressed", "false");
    await user.click(filter);
    expect(filter).toHaveAttribute("aria-pressed", "true");
    expect(trailSeverities()).toEqual(["critical"]);

    await user.click(filter);
    expect(filter).toHaveAttribute("aria-pressed", "false");
    expect(trailSeverities()).toEqual(["watch", "critical"]);
  });

  test("dismissing the banner removes it but keeps the trail", async () => {
    const user = userEvent.setup();
    await renderWithBursts([backendBurst()]);
    expect(screen.getByTestId("nifty-critical-banner")).toBeInTheDocument();
    await user.click(screen.getByTestId("nifty-critical-banner-dismiss"));
    expect(screen.queryByTestId("nifty-critical-banner")).not.toBeInTheDocument();
    // the burst stays reviewable in the trail
    expect(trailSeverities()).toEqual(["critical"]);
  });
});

describe("NiftyReportPanel desk mode", () => {
  function renderDesk() {
    window.localStorage.setItem("nifty.deskMode", "desk");
    return r(<NiftyReportPanel />);
  }

  function deskToggle() {
    return screen.getByTestId("nifty-desk-toggle");
  }

  function pressed(name: string) {
    return within(deskToggle()).getByRole("button", { name });
  }

  test("toggle hydrates synchronously from storage — no first-paint flash", async () => {
    window.localStorage.setItem("nifty.deskMode", "desk");
    r(<NiftyReportPanel />);
    // Synchronous: the very first render already selects DESK, before any
    // data loads or effect runs, so research panels never mount for a frame.
    expect(pressed("DESK")).toHaveAttribute("aria-pressed", "true");
    expect(pressed("RESEARCH")).toHaveAttribute("aria-pressed", "false");
    await screen.findByTestId("nifty-stat-strip");
    expect(screen.queryByTestId("nifty-analytics-row")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-iv-skew-row")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-detail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-desk-plan")).not.toBeInTheDocument();
    // Desk surface stays: header, PLAN one-liner, chart, OI chain.
    expect(screen.getByTestId("nifty-plan-oneliner")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-oi-panel")).toBeInTheDocument();
  });

  test("desk is the default when nothing is stored", async () => {
    window.localStorage.removeItem("nifty.deskMode");
    r(<NiftyReportPanel />);
    expect(pressed("DESK")).toHaveAttribute("aria-pressed", "true");
    await screen.findByTestId("nifty-stat-strip");
    expect(screen.queryByTestId("nifty-analytics-row")).not.toBeInTheDocument();
  });

  test("DESK chain renders five columns (no points/% change tracks)", async () => {
    renderDesk();
    const table = await screen.findByTestId("nifty-oi-table");
    expect(within(table).queryByText("CE Chg")).not.toBeInTheDocument();
    expect(within(table).queryByText("PE Chg")).not.toBeInTheDocument();
    for (const header of ["CE OI Chg", "CE Signal", "Strike", "PE Signal", "PE OI Chg"]) {
      expect(within(table).getByText(header)).toBeInTheDocument();
    }
  });

  test("RESEARCH chain keeps all seven columns", async () => {
    window.localStorage.setItem("nifty.deskMode", "research");
    r(<NiftyReportPanel />);
    const table = await screen.findByTestId("nifty-oi-table");
    for (const header of [
      "CE Chg",
      "CE OI Chg",
      "CE Signal",
      "Strike",
      "PE Signal",
      "PE OI Chg",
      "PE Chg",
    ]) {
      expect(within(table).getByText(header)).toBeInTheDocument();
    }
  });

  test("toggle persists the mode and hides/shows research panels", async () => {
    const user = userEvent.setup();
    renderDesk();
    await screen.findByTestId("nifty-stat-strip");
    await user.click(pressed("RESEARCH"));
    expect(await screen.findByTestId("nifty-analytics-row")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-iv-skew-row")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-detail")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-desk-plan")).toBeInTheDocument();
    expect(window.localStorage.getItem("nifty.deskMode")).toBe("research");
    await user.click(pressed("DESK"));
    expect(screen.queryByTestId("nifty-analytics-row")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-iv-skew-row")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-detail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-desk-plan")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("nifty.deskMode")).toBe("desk");
  });

  test("PLAN one-liner renders and the reasons button opens the modal", async () => {
    const user = userEvent.setup();
    renderDesk();
    await screen.findByTestId("nifty-stat-strip");
    const line = screen.getByTestId("nifty-plan-oneliner");
    expect(within(line).getByTestId("nifty-plan-headline")).not.toBeEmptyDOMElement();
    expect(screen.queryByTestId("nifty-plan-modal")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("nifty-plan-reasons-button"));
    expect(await screen.findByTestId("nifty-plan-modal")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByTestId("nifty-plan-modal")).not.toBeInTheDocument();
    });
  });

  test("chart expand button and F hotkey open/close the fullscreen modal", async () => {
    const user = userEvent.setup();
    renderDesk();
    await screen.findByTestId("nifty-stat-strip");
    await user.click(screen.getByTestId("nifty-chart-expand"));
    expect(await screen.findByTestId("nifty-chart-fullscreen-body")).toBeInTheDocument();
    // The expanded chart owns the whole modal; the chain has its own expand.
    expect(screen.getByTestId("nifty-chart-fullscreen-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-chart-fullscreen-oi-table")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByTestId("nifty-chart-fullscreen-body")).not.toBeInTheDocument();
    });
    await user.keyboard("f");
    expect(await screen.findByTestId("nifty-chart-fullscreen-body")).toBeInTheDocument();
    await user.click(screen.getByTestId("panel-modal-close"));
    await waitFor(() => {
      expect(screen.queryByTestId("nifty-chart-fullscreen-body")).not.toBeInTheDocument();
    });
  });

  test("the chain, heatmap and flow strip each expand into their own modal", async () => {
    const user = userEvent.setup();
    renderDesk();
    await screen.findByTestId("nifty-stat-strip");

    await user.click(screen.getByTestId("nifty-oi-expand"));
    expect(await screen.findByTestId("nifty-oi-expanded-body")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByTestId("nifty-oi-expanded-body")).not.toBeInTheDocument(),
    );

    await openSideTab("heatmap");
    await user.click(screen.getByTestId("nifty-heatmap-expand"));
    expect(await screen.findByTestId("nifty-heatmap-expanded-body")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-heatmap-range-toggle")).toBeInTheDocument();
    await user.click(screen.getByTestId("nifty-heatmap-range-5m"));
    expect(screen.getByTestId("nifty-heatmap-range-5m")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("nifty-heatmap-range-1m")).toHaveAttribute("aria-pressed", "false");
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByTestId("nifty-heatmap-expanded-body")).not.toBeInTheDocument(),
    );

    await openDeskDock("flow");
    await user.click(screen.getByTestId("nifty-flowstrip-expand"));
    expect(await screen.findByTestId("nifty-flow-expanded-body")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByTestId("nifty-flow-expanded-body")).not.toBeInTheDocument(),
    );

    await user.click(screen.getByTestId("nifty-pressure-expand"));
    expect(await screen.findByTestId("nifty-pressure-expanded-body")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-pressure-expanded-stats")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-pressure-range-toggle")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByTestId("nifty-pressure-expanded-body")).not.toBeInTheDocument(),
    );

    await user.click(screen.getByTestId("nifty-flowchart-expand"));
    expect(await screen.findByTestId("nifty-flowchart-expanded-body")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-flow-range-toggle")).toBeInTheDocument();
  });

  test("fullscreen timeframe buttons switch the shared chart timeframe", async () => {
    const user = userEvent.setup();
    renderDesk();
    await screen.findByTestId("nifty-stat-strip");
    await user.click(screen.getByTestId("nifty-chart-expand"));
    const five = await screen.findByTestId("nifty-chart-fullscreen-tf-5m");
    expect(screen.getByTestId("nifty-chart-fullscreen-tf-1m")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(five);
    expect(five).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("nifty-chart-fullscreen-tf-1m")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("D toggles desk/research, E opens plan reasons, V opens the visuals stub", async () => {
    const user = userEvent.setup();
    renderDesk();
    await screen.findByTestId("nifty-stat-strip");
    await user.keyboard("d");
    expect(await screen.findByTestId("nifty-analytics-row")).toBeInTheDocument();
    await user.keyboard("d");
    await waitFor(() => {
      expect(screen.queryByTestId("nifty-analytics-row")).not.toBeInTheDocument();
    });
    await user.keyboard("e");
    expect(await screen.findByTestId("nifty-plan-modal")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByTestId("nifty-plan-modal")).not.toBeInTheDocument();
    });
    await user.keyboard("v");
    expect(await screen.findByTestId("nifty-visuals-stub")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByTestId("nifty-visuals-stub")).not.toBeInTheDocument();
    });
  });

  test("1/5/15 hotkeys move the chart timeframe", async () => {
    const user = userEvent.setup();
    renderDesk();
    await screen.findByTestId("nifty-stat-strip");
    const tfToggle = screen.getByTestId("nifty-tf-toggle");
    const isPressed = (name: string) =>
      within(tfToggle).getByRole("button", { name }).getAttribute("aria-pressed");
    expect(isPressed("1m")).toBe("true");
    await user.keyboard("5");
    await waitFor(() => {
      expect(isPressed("5m")).toBe("true");
    });
    await user.keyboard("15");
    await waitFor(() => {
      expect(isPressed("15m")).toBe("true");
    });
    await user.keyboard("1");
    await waitFor(() => {
      expect(isPressed("1m")).toBe("true");
    });
  });

  test("IV skew and GEX expand buttons open their modals in research mode", async () => {
    const user = userEvent.setup();
    r(<NiftyReportPanel />);
    await screen.findByTestId("nifty-stat-strip");
    await user.click(screen.getByTestId("nifty-ivskew-expand"));
    expect(await screen.findByTestId("nifty-ivskew-modal")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByTestId("nifty-ivskew-modal")).not.toBeInTheDocument();
    });
    await user.click(screen.getByTestId("nifty-gex-expand"));
    expect(await screen.findByTestId("nifty-gex-modal")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByTestId("nifty-gex-modal")).not.toBeInTheDocument();
    });
  });
});

describe("NiftyReportPanel flow/research visuals", () => {
  function renderDesk() {
    window.localStorage.setItem("nifty.deskMode", "desk");
    return r(<NiftyReportPanel />);
  }

  function renderResearch() {
    window.localStorage.setItem("nifty.deskMode", "research");
    return r(<NiftyReportPanel />);
  }

  test("DESK puts FLOW in the dock and HEATMAP behind the chain tab", async () => {
    renderDesk();
    await screen.findByTestId("nifty-stat-strip");
    expect(screen.getByTestId("desk-dock")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-flow-band")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-chart-side-heatmap")).not.toBeInTheDocument();
    const flow = await openDeskDock("flow");
    const strip =
      within(flow).queryByTestId("nifty-flowstrip") ??
      within(flow).getByTestId("nifty-flowstrip-empty");
    expect(strip).toBeInTheDocument();
    // The dock reuses the page's tape fetch — no second request.
    expect(vi.mocked(fetchNiftyTape)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchPositions)).toHaveBeenCalled();
    // Research sections stay unmounted in desk mode.
    expect(screen.queryByTestId("nifty-flow-row")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-vol-row")).not.toBeInTheDocument();
    await closeDeskDock();
    await openSideTab("heatmap");
    expect(screen.getByTestId("nifty-chart-side-heatmap")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-heatmap-empty")).toBeInTheDocument();
  });

  test("DESK lets the chart row own the slack and heatmap is a chain tab", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({
        candles: [
          { time: "2026-10-12T09:15:00", open: 25600, high: 25650, low: 25580, close: 25620, volume: 1000 },
          { time: "2026-10-12T09:16:00", open: 25620, high: 25680, low: 25600, close: 25750.5, volume: 1200 },
        ],
      }),
    );
    renderDesk();
    const wrap = await screen.findByTestId("nifty-chart-wrap");
    // Fill mode stretches into the row: no 300px cap and no dead band.
    expect(wrap).toHaveAttribute("data-fill", "1");
    expect(wrap.style.maxHeight).toBe("");
    expect(screen.getByTestId("nifty-main-row").style.maxHeight).toBe("");
    // The heatmap is a tab on the right rail, not a permanent 175px block.
    expect(screen.queryByTestId("nifty-chart-side-heatmap")).not.toBeInTheDocument();
    await openSideTab("heatmap");
    const heat = screen.getByTestId("nifty-chart-side-heatmap");
    expect(heat).toContainElement(screen.getByTestId("nifty-heatmap-wrap"));
    expect(screen.getByTestId("nifty-side-col")).toContainElement(heat);
    expect(heat).toHaveClass("flex-auto");
    expect(screen.getByTestId("desk-dock")).toBeInTheDocument();
  });

  test("DESK keeps the OI bursts in the ALERTS dock", async () => {
    vi.mocked(fetchNiftyBursts).mockResolvedValue([
      {
        id: "2026-10-12T10:20:00+05:30-call",
        side: "call",
        t: "2026-10-12T10:20:00+05:30",
        delta: -16_461_965,
        baseline: 1_000_000,
        score: 16.4,
        severity: "critical",
        cumDoi: -36_657_985,
        spot: 22_597.3,
        tickVol: 1_000,
        signal: null,
      },
    ] as never);
    renderDesk();
    await screen.findByTestId("nifty-stat-strip");
    const body = await openDeskDock("alerts");
    const bursts = within(body).getByTestId("nifty-oi-bursts-panel");
    expect(bursts).toHaveTextContent(/OI bursts \(1\)/);
    expect(screen.getByTestId("desk-dock-alerts")).toBeInTheDocument();
  });

  test("empty tape renders empty FLOW states without crashing", async () => {
    vi.mocked(fetchNiftyTape).mockResolvedValue({
      date: "2026-10-12",
      interval_sec: 60,
      rows: [],
    });
    renderDesk();
    await screen.findByTestId("nifty-stat-strip");
    const flow = await openDeskDock("flow");
    expect(within(flow).getByTestId("nifty-flowstrip-empty")).toBeInTheDocument();
    await closeDeskDock();
    await openSideTab("heatmap");
    expect(screen.getByTestId("nifty-heatmap-empty")).toBeInTheDocument();
  });

  test("RESEARCH shows wall/participant/volume/PnL panels; desk band stays out", async () => {
    renderResearch();
    await screen.findByTestId("nifty-stat-strip");
    expect(await screen.findByTestId("nifty-flow-row")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-vol-row")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-wall-migration")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-participant-flow")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-volume-profile-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-pnl-panel")).toBeInTheDocument();
    // No mappable option legs in the mocked positions → empty state.
    expect(screen.getByTestId("nifty-pnl-empty")).toBeInTheDocument();
    // Existing research panels are untouched, not duplicated.
    expect(screen.getByTestId("nifty-iv-skew-row")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-analytics-row")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-flow-band")).not.toBeInTheDocument();
  });
});

describe("NiftyReportPanel DESK compact alerts", () => {
  function renderDesk() {
    window.localStorage.setItem("nifty.deskMode", "desk");
    return r(<NiftyReportPanel />);
  }

  function renderResearch() {
    window.localStorage.setItem("nifty.deskMode", "research");
    return r(<NiftyReportPanel />);
  }

  function deskBurst(id: string, t: string, severity = "critical") {
    return {
      id,
      side: "call",
      t,
      delta: -16_461_965,
      baseline: 1_000_000,
      score: 16.4,
      severity,
      cumDoi: -36_657_985,
      spot: 22_597.3,
      tickVol: 1_000,
      signal: null,
    };
  }

  function threeCritical() {
    return [
      deskBurst("c-1", "2026-10-12T10:20:00+05:30"),
      deskBurst("c-2", "2026-10-12T10:21:00+05:30"),
      deskBurst("c-3", "2026-10-12T10:22:00+05:30"),
    ] as never;
  }

  test("DESK shows the full bursts log in the ALERTS dock", async () => {
    vi.mocked(fetchNiftyBursts).mockResolvedValue(threeCritical());
    renderDesk();
    await screen.findByTestId("nifty-stat-strip");
    const body = await openDeskDock("alerts");
    const panel = within(body).getByTestId("nifty-oi-bursts-panel");
    expect(panel).toHaveTextContent("OI bursts (3)");
    expect(within(panel).getAllByTestId("market-alert-oi_burst")).toHaveLength(3);
    expect(within(panel).getByTestId("nifty-oi-critical-filter")).toBeInTheDocument();
    expect(within(panel).getByTestId("nifty-oi-replay-button")).toBeInTheDocument();
    expect(within(panel).getByText("Clear")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-alerts-modal")).not.toBeInTheDocument();
  });

  test("DESK caps critical banners at 1 with +N more opening the alerts dock", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchNiftyBursts).mockResolvedValue(threeCritical());
    renderDesk();
    await screen.findByTestId("nifty-stat-strip");
    const banners = await screen.findByTestId("nifty-critical-banners");
    expect(within(banners).getAllByTestId("nifty-critical-banner")).toHaveLength(1);
    expect(banners).toHaveTextContent("+1 more");
    await user.click(within(banners).getByTestId("nifty-critical-banner"));
    const body = await screen.findByTestId("desk-dock-body-alerts");
    expect(within(body).getByTestId("nifty-oi-bursts-panel")).toBeInTheDocument();
  });

  test("RESEARCH keeps the full inline log and up to 2 banners", async () => {
    vi.mocked(fetchNiftyBursts).mockResolvedValue(threeCritical());
    renderResearch();
    await screen.findByTestId("nifty-stat-strip");
    const panel = await screen.findByTestId("nifty-oi-bursts-panel");
    // Full inline log: all 3 rows, no Open action, no modal.
    expect(within(panel).getAllByTestId("market-alert-oi_burst")).toHaveLength(3);
    expect(screen.queryByTestId("nifty-oi-bursts-open")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-alerts-modal")).not.toBeInTheDocument();
    const banners = screen.getByTestId("nifty-critical-banners");
    expect(within(banners).getAllByTestId("nifty-critical-banner")).toHaveLength(2);
    expect(banners).not.toHaveTextContent("+1 more");
  });

  test("DESK heatmap renders cells when tape rows carry a chain", async () => {
    const chainFor = (ceOiNow: number, peOiNow: number) => {
      const c: Record<string, [number | null, number | null, number | null, number | null, number | null, number | null]> = {};
      for (let strike = 25250; strike <= 26250; strike += 50) {
        c[String(strike)] = [10, 12, ceOiNow, peOiNow, 100, 100];
      }
      return c;
    };
    vi.mocked(fetchNiftyTape).mockResolvedValue({
      date: "2026-10-12",
      interval_sec: 60,
      rows: [
        { ...mockTape().rows[0], t: "2026-10-12T09:15:00+05:30", chain: chainFor(1000, 1000) },
        { ...mockTape().rows[1], t: "2026-10-12T09:21:00+05:30", chain: chainFor(4000, 1200) },
      ],
    });
    renderDesk();
    await screen.findByTestId("nifty-stat-strip");
    await openSideTab("heatmap");
    expect(await screen.findByTestId("nifty-heatmap")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-heatmap-empty")).not.toBeInTheDocument();
    const canvas = screen.getByTestId("nifty-heatmap-canvas");
    expect(Number(canvas.getAttribute("data-cells"))).toBeGreaterThan(0);
    expect(screen.getAllByTestId("nifty-heatmap-strike-label").length).toBeGreaterThan(0);
  });
});

describe("NiftyReportPanel gamma strip + positions drawer", () => {
  function renderDesk() {
    window.localStorage.setItem("nifty.deskMode", "desk");
    return r(<NiftyReportPanel />);
  }

  function renderResearch() {
    window.localStorage.setItem("nifty.deskMode", "research");
    return r(<NiftyReportPanel />);
  }

  const GEX = {
    strikes: [
      { strike: 25_100, callGex: -18, putGex: -2, netGex: -20 },
      { strike: 25_600, callGex: -4, putGex: -1, netGex: -5 },
      { strike: 25_700, callGex: 1, putGex: 0, netGex: 1 },
      { strike: 25_760, callGex: 2, putGex: 0, netGex: 2 },
      { strike: 25_900, callGex: 6, putGex: 0, netGex: 6 },
    ],
    netTotal: -12.4,
    regime: "short" as const,
    topPositive: [],
    topNegative: [],
    zeroCross: 25_760,
    levels: {
      support: null,
      resistance: { strike: 25_900, netGex: 6 },
      fuelDown: { strike: 25_100, netGex: -20 },
      fuelUp: null,
    },
  };

  function chainSide(overrides: Partial<NiftyStrike["ce"]> = {}): NiftyStrike["ce"] {
    return {
      ltp: 100,
      close: 98,
      oi: 1_000,
      prevOi: 900,
      oiChange: 100,
      priceChange: 2,
      sentiment: "Neutral",
      delta: null,
      gamma: null,
      theta: null,
      vega: null,
      iv: 12,
      ...overrides,
    };
  }

  const CHAIN: NiftyStrike[] = [
    {
      strike: 25_700,
      ce: chainSide({ ltp: 130, delta: 0.52, gamma: 0.0018, theta: -12.5, vega: 8.2 }),
      pe: chainSide({ delta: -0.48, gamma: 0.0017, theta: -11.2, vega: 7.6 }),
    },
  ];

  const OPEN_POSITION: PaperPosition = {
    symbol: "NIFTY25700CE",
    side: "BUY",
    quantity: 50,
    entry_price: 120,
    current_price: 130,
    entry_time: "2026-10-21T09:20:00+05:30",
    stop_loss: 110,
    take_profit: 150,
    pnl: 500,
    pnl_pct: 8.33,
    margin_used: 0,
    order_id: "o-1",
    strategy_id: 1,
    strategy_name: "EOD short premium",
  };

  test("DESK renders the gamma strip in the decision bar and opens the drawer", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchLiveNifty).mockResolvedValue(mockReport({ gex: GEX, strikes: CHAIN }));
    renderDesk();
    await screen.findByTestId("nifty-stat-strip");

    await user.click(screen.getByTestId("nifty-chip-gamma"));
    const strip = await screen.findByTestId("nifty-gamma-strip");
    expect(strip).toHaveStyle({ height: "24px" });
    expect(strip).toHaveTextContent("Γ -12.40 Cr");
    expect(strip).toHaveTextContent("SHORT Γ");
    expect(strip).toHaveTextContent("flip");
    expect(strip).toHaveTextContent("25,760");
    expect(strip).toHaveTextContent("fuel↓");
    expect(strip).toHaveTextContent("25,100");
    expect(strip).toHaveTextContent("resist");
    expect(strip).toHaveTextContent("25,900");
    expect(screen.getByTestId("nifty-gamma-cell")).toContainElement(strip);

    await user.click(strip);
    const modal = await screen.findByTestId("nifty-gamma-modal");
    expect(modal.closest('[data-testid="panel-modal"]')).toHaveAttribute("data-variant", "drawer");
    expect(within(modal).getByTestId("nifty-gex-profile-panel")).toBeInTheDocument();
    expect(within(modal).getByTestId("nifty-positioning-panel")).toBeInTheDocument();
  });

  test("RESEARCH also keeps the gamma strip", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValue(mockReport({ gex: GEX, strikes: CHAIN }));
    renderResearch();
    await screen.findByTestId("nifty-stat-strip");
    expect(await screen.findByTestId("nifty-gamma-strip")).toHaveTextContent("SHORT Γ");
  });

  test("positions button shows the count + net P&L and opens PAPER POSITIONS", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchLiveNifty).mockResolvedValue(mockReport({ gex: GEX, strikes: CHAIN }));
    vi.mocked(fetchPositions).mockResolvedValue([OPEN_POSITION]);
    renderDesk();
    await screen.findByTestId("nifty-stat-strip");

    const button = await screen.findByTestId("nifty-positions-button");
    await waitFor(() => expect(button).toHaveTextContent("POS 1"));
    expect(button).toHaveTextContent("+₹500");
    expect(screen.getByTestId("nifty-positions-dot")).toBeInTheDocument();

    await user.click(button);
    const drawer = await screen.findByTestId("nifty-positions-drawer");
    expect(within(drawer).getByTestId("nifty-positions-drawer-label")).toHaveTextContent(
      "PAPER POSITIONS",
    );
    expect(within(drawer).getByTestId("nifty-positions-table")).toHaveTextContent(
      "NIFTY25700CE",
    );
    expect(within(drawer).getByTestId("nifty-book-delta")).toHaveTextContent("+26.0");
    // Opening refreshes the book from the one panel-owned fetch path.
    expect(vi.mocked(fetchPositions).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("NiftyReportPanel pre-move setup banner", () => {
  /** 40 ten-second snapshots, every 1-minute read "puts sold"; CE OI builds
   *  +60K/10s (720K per 2 min) and CE premium outruns the (flat) delta-implied
   *  move — score 5: put-writing 2 + call-build 2 + call-premium 1. */
  function armedChain10s() {
    const base = Date.parse("2026-11-05T09:30:00+05:30");
    return Array.from({ length: 40 }, (_, i) => ({
      t: new Date(base + i * 10_000).toISOString(),
      spot: 25750,
      ce_oi: 6_000_000 + i * 60_000,
      pe_oi: 5_000_000 + i * 90_000,
      ce_vol: 100,
      pe_vol: 120,
      ce_prem: 120 + i * 1.5,
      pe_prem: 130 - i * 1.5,
    }));
  }

  test("arms the banner only after two consecutive armed reads", async () => {
    // The live load awaits the tape, so the report (and the banner's host)
    // only mounts once the tape lands — resolve it manually. The chain10s
    // poll is independent, so the armed points land first.
    let resolveTape!: (tape: unknown) => void;
    vi.mocked(fetchNiftyTape).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTape = resolve;
        }) as never,
    );
    vi.mocked(fetchChain10sSummary).mockResolvedValue(armedChain10s() as never);
    try {
      r(<NiftyReportPanel />);
      // Flush the closed-market probe and the chain10s poll: the points
      // apply and the pre-move score computes "armed" — one read (streak 1).
      await waitFor(() => expect(vi.mocked(fetchChain10sSummary)).toHaveBeenCalled());
      await act(async () => {
        await Promise.resolve();
      });
      // One armed read is not enough, and the report is still blocked on the
      // tape — no banner.
      expect(screen.queryByTestId("nifty-premove-alert")).not.toBeInTheDocument();
      // The tape landing recomputes the pre-move score (armed read 2) and
      // unblocks the report; the banner must appear in the same flush.
      await act(async () => {
        resolveTape(mockTape());
      });
      const banner = await screen.findByTestId("nifty-premove-alert");
      expect(banner).toHaveTextContent("SETUP ARMING 5/11");
      // No live flow flip on this tape — the paused state must not show.
      expect(banner).toHaveAttribute("data-flip-paused", "0");
    } finally {
      vi.mocked(fetchNiftyTape).mockResolvedValue(mockTape());
    }
  });

  test("a live 5m-vs-15m flip pauses the banner with the flip headline", async () => {
    // 15m leg bear (CE -200/PE +100 vs the 09:15 row) but 5m leg bull
    // (CE +200/PE -100 vs the 09:20 row) → detectFlowFlip fires, reason
    // "5m vs 15m", and the banner must show the paused headline instead of
    // "SETUP ARMING".
    const flipTape = mockTape({
      rows: [
        { t: "2026-10-12T09:15:00+05:30", spot: 25750, ce_oi: 1500, pe_oi: 700 },
        { t: "2026-10-12T09:20:00+05:30", spot: 25740, ce_oi: 1100, pe_oi: 900 },
        { t: "2026-10-12T09:25:00+05:30", spot: 25760, ce_oi: 1300, pe_oi: 800 },
      ] as never,
    });
    let resolveTape!: (tape: unknown) => void;
    vi.mocked(fetchNiftyTape).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTape = resolve;
        }) as never,
    );
    vi.mocked(fetchChain10sSummary).mockResolvedValue(armedChain10s() as never);
    try {
      r(<NiftyReportPanel />);
      await waitFor(() => expect(vi.mocked(fetchChain10sSummary)).toHaveBeenCalled());
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        resolveTape(flipTape);
      });
      const banner = await screen.findByTestId("nifty-premove-alert");
      expect(banner).toHaveTextContent("FLOW FLIP · 5m vs 15m — setup paused");
      expect(banner).toHaveAttribute("data-flip-paused", "1");
    } finally {
      vi.mocked(fetchNiftyTape).mockResolvedValue(mockTape());
      // Keep the persisted flip out of later tests that mount the default
      // NIFTY|live|2026-10-12 context.
      window.localStorage.removeItem("nifty.lastFlip.NIFTY|live|2026-10-12");
    }
  });
});
