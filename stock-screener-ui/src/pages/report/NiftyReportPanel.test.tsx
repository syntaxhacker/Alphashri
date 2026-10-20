// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import {
  NiftyReportPanel,
  buildMarkLines,
  emaSeries,
  resampleCandles,
  getNiftyOiColumns,
  findAtmStrike,
  oiBurstLogHeight,
  fetchSensexWithTimeout,
  SensexTimeoutError,
} from "./NiftyReportPanel";
import * as palette from "@/ui/palette";
import type { NiftyReport } from "@/types/niftyReport";

vi.mock("@/api/reportNifty", () => ({
  fetchLiveNifty: vi.fn(),
  fetchLiveSensex: vi.fn(),
  fetchNiftyByDate: vi.fn(),
  fetchNiftyExpiries: vi.fn().mockResolvedValue([]),
  fetchNiftyReplay: vi.fn(),
  fetchNiftyReplayDates: vi.fn(),
  fetchNiftyTape: vi.fn(),
  fetchNiftyBursts: vi.fn(),
  snapshotNifty: vi.fn(),
}));

// Market clock is mocked so the suite behaves the same at 11:00 and at 23:00
// IST: open by default, closed only in the tests that assert the auto-EOD path.
const { marketOpenMock } = vi.hoisted(() => ({ marketOpenMock: vi.fn(() => true) }));
vi.mock("./marketClock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./marketClock")>();
  return { ...actual, isMarketOpenIst: marketOpenMock };
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

import {
  fetchLiveNifty,
  fetchLiveSensex,
  fetchNiftyByDate,
  fetchNiftyReplay,
  fetchNiftyReplayDates,
  fetchNiftyTape,
  fetchNiftyBursts,
  snapshotNifty,
} from "@/api/reportNifty";
import type { NiftyReplay } from "@/types/niftyReport";

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

function mockTape() {
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
  vi.mocked(fetchNiftyReplayDates).mockResolvedValue([]);
  vi.mocked(fetchLiveNifty).mockResolvedValue(mockReport());
  vi.mocked(fetchLiveSensex).mockResolvedValue(null as never);
  vi.mocked(fetchNiftyByDate).mockResolvedValue(mockReport({ mode: "eod" }));
  // No replay by default: EOD tests exercise the plain single-snapshot path.
  vi.mocked(fetchNiftyReplay).mockResolvedValue(null as never);
  vi.mocked(fetchNiftyTape).mockResolvedValue(mockTape());
  vi.mocked(fetchNiftyBursts).mockResolvedValue([] as never);
  vi.mocked(snapshotNifty).mockResolvedValue(mockReport());
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
        screen.getByText("SENSEX"),
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
        screen.getByText("SENSEX"),
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

  test("shows coverage and the size of the next hole", async () => {
    const bar = await engageEodWithReplay();
    const coverage = within(bar).getByTestId("nifty-replay-coverage");
    // 3 recorded minutes out of the 375-minute session → 0.8%.
    expect(coverage).toHaveTextContent("Data 0.8%");
    expect(coverage).toHaveTextContent("372m missing");
    // Frame 0 is 09:15 and frame 1 is 10:30 → 74 minutes are skipped.
    expect(within(bar).getByTestId("nifty-replay-gap")).toHaveTextContent("+74m gap");
    expect(within(bar).getByTestId("nifty-replay-coverage-strip")).toBeInTheDocument();
  });

  test("names the recorder's skip reasons when the gap journal exists", async () => {
    const bar = await engageEodWithReplay({ "chain-failed": 41, timeout: 12 });
    const reasons = within(bar).getByTestId("nifty-replay-reasons");
    expect(reasons).toHaveTextContent("chain fetch failed ×41");
    expect(reasons).toHaveTextContent("tick timed out ×12");
  });

  test("falls back to a hole count when the day has no gap journal", async () => {
    const bar = await engageEodWithReplay();
    const reasons = within(bar).getByTestId("nifty-replay-reasons");
    // Frames 09:15, 10:30, 15:29 → two in-session holes (74m and 298m).
    expect(reasons).toHaveTextContent("2 in-session holes");
    expect(reasons).toHaveTextContent("reason not logged");
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
    expect(screen.getByTestId("nifty-chart-view").style.display).toBe("block");
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

  test("shows live Sensex levels beside the Nifty report", async () => {
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
    const panel = await screen.findByTestId("nifty-sensex-panel");
    expect(within(panel).getByTestId("sensex-stat-support")).toHaveTextContent("74,000");
    expect(within(panel).getByTestId("sensex-stat-resistance")).toHaveTextContent("74,500");
    expect(within(panel).getByTestId("sensex-stat-max-pain")).toHaveTextContent("74,200");
  });

  test("live GEX overlay adds flip/support/resistance lines with dedupe", async () => {
    const { buildMarkLines } = await import("./NiftyReportPanel");
    const gex = {
      strikes: [],
      netTotal: 10,
      regime: "long",
      topPositive: [
        { strike: 25800, netGex: 5 },
        { strike: 26100, netGex: 4 },
      ],
      topNegative: [
        { strike: 25700, netGex: -6 },
        { strike: 25300, netGex: -5 },
      ],
      zeroCross: 25650,
    };
    const rep = mockReport({ gex });
    // walls 25800/25900/26000 calls, 25600/25500/25400 puts, pain 25700:
    // 25800 dupes a resistance zone, 26100 is fresh GSUP;
    // 25700 is max pain and therefore not duplicated by GEX.
    const lines = buildMarkLines(rep, true);
    const labels = lines.map((l) => l.label.formatter);
    expect(labels).toContain("FLIP 25650");
    expect(labels).toContain("GSUP 26100");
    expect(labels).toContain("GRES 25300");
    // 25800 dupes the CW line, 25700 dupes MP — skipped, never doubled
    expect(labels.filter((x) => x === "GSUP 25800")).toHaveLength(0);
    expect(labels.filter((x) => x === "GRES 25700")).toHaveLength(0);
    // off without the flag: only walls/max-pain + pivots remain (no GEX)
    expect(buildMarkLines(rep, false).map((l) => l.label.formatter)).not.toContain("FLIP 25650");
    expect(buildMarkLines({ ...rep, gex: undefined }, true)).toHaveLength(10);
  });

  test("OI table windows to ATM ±750 so strike and signals stay visible", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({
        spot: 25750.5,
        strikes: [strikeAt(25700), strikeAt(24000), strikeAt(27500)],
      }),
    );
    r(<NiftyReportPanel />);
    const table = await screen.findByTestId("nifty-oi-table");
    expect(table).toBeInTheDocument();
    expect(within(table).getByText("25,700")).toBeInTheDocument();
    expect(within(table).queryByText("24,000")).not.toBeInTheDocument();
    expect(within(table).queryByText("27,500")).not.toBeInTheDocument();
    // signals still rendered for the visible row
    expect(within(table).getByText("Bullish")).toBeInTheDocument();
    expect(within(table).getByText("Bearish")).toBeInTheDocument();
  });

  test("timeline items and tomorrow's levels render from chain data", async () => {
    r(<NiftyReportPanel />);
    expect(await screen.findByTestId("nifty-timeline-item-0")).toBeInTheDocument();
    expect(screen.getByText("Nifty opened flat")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-tomorrow-panel")).toBeInTheDocument();
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
  });

  test("signal pills show full names with per-side tone", async () => {
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
    expect(within(table).getAllByText("Long Buildup")).toHaveLength(2);
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

  test("live WITH gex shows GEX panel and hides Tomorrow's panel", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(mockReport({ gex: gexBlock() }));
    r(<NiftyReportPanel />);
    expect(await screen.findByTestId("nifty-gex-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-gex-net")).toHaveTextContent("+12.40 Cr/pt");
    expect(screen.getByTestId("nifty-gex-regime")).toHaveTextContent(
      "Dealers LONG gamma — moves dampened",
    );
    expect(screen.getByTestId("nifty-gex-flip")).toHaveTextContent("25,750");
    expect(screen.getByTestId("nifty-gex-sup")).toHaveTextContent("25,700");
    expect(screen.getByTestId("nifty-gex-res")).toHaveTextContent("25,800");
    // verdict combines regime + max-pain pull + PCR verdict
    expect(screen.getByTestId("nifty-gex-verdict")).toHaveTextContent("Dealers LONG gamma");
    expect(screen.getByTestId("nifty-gex-verdict")).toHaveTextContent("max-pain pull");
    expect(screen.getByTestId("nifty-gex-verdict")).toHaveTextContent("PCR-OI 1.12");
    expect(screen.queryByTestId("nifty-tomorrow-panel")).not.toBeInTheDocument();
  });

  test("live WITHOUT gex falls back to Tomorrow's panel", async () => {
    r(<NiftyReportPanel />);
    expect(await screen.findByTestId("nifty-tomorrow-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-gex-panel")).not.toBeInTheDocument();
  });

  test("EOD always shows Tomorrow's panel even when gex present", async () => {
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
    expect(await screen.findByTestId("nifty-tomorrow-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-gex-panel")).not.toBeInTheDocument();
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

  test("an OI burst minute raises the in-app alert with a trade plan (local fallback, via Refresh)", async () => {
    r(<NiftyReportPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
    });
    // history is silent by design — nothing on first load
    expect(screen.queryByTestId("nifty-oi-bursts-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-oi-toasts")).not.toBeInTheDocument();

    // next one-shot reload returns a steady tape plus one huge call-OI minute.
    // fetchNiftyBursts stays [] (backend has nothing / is unavailable), so the
    // client detector is what raises the alert.
    const rows = burstTape();
    vi.mocked(fetchNiftyTape).mockResolvedValue({
      date: "2026-10-12",
      interval_sec: 60,
      rows,
    });

    fireEvent.click(screen.getByTestId("nifty-refresh-button"));
    // 5s budget: this panel is heavy and the full suite runs it in parallel.
    expect(
      await screen.findByTestId("nifty-oi-bursts-panel", undefined, {
        timeout: 5000,
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("nifty-oi-toasts")).toBeInTheDocument();
    // call OI build → fade with puts at the nearest tradeable strike
    expect(screen.getAllByText(/BUY PE 25,700/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/qty/).length).toBeGreaterThan(0);
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
    expect(body).not.toBeVisible();
    // Panels stay mounted behind display:none, so opening is instant and the
    // chart/table state is preserved.
    expect(within(body).getByTestId("nifty-iv-straddle-panel")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(body).toBeVisible());
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
    topPositive: [{ strike: 22600, netGex: 5 }],
    topNegative: [{ strike: 22400, netGex: -5 }],
    zeroCross: 22500,
  };

  test("live with gex shows all six codes with meanings", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(mockReport({ gex: gexBlock }));
    r(<NiftyReportPanel />);
    const legend = await screen.findByTestId("nifty-level-legend");
    for (const code of ["CW", "PW", "MP", "FLIP", "GSUP", "GRES"]) {
      expect(within(legend).getByText(code, { exact: true })).toBeInTheDocument();
    }
    expect(within(legend).getByText(/dealers switch sides/)).toBeInTheDocument();
    expect(within(legend).getByText(/expiry magnet/)).toBeInTheDocument();
  });

  test("live without gex shows only wall codes", async () => {
    r(<NiftyReportPanel />);
    const legend = await screen.findByTestId("nifty-level-legend");
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
    expect(control).toHaveTextContent("CALL WRITERS IN CONTROL");
    expect(control).toHaveTextContent("ΔOI C 55,30,000 P -12,00,000 · skew -2.40");

    // Regime is a headline decision, not a fourth cell in the context row.
    const regime = screen.getByTestId("nifty-stat-regime");
    expect(regime).toHaveTextContent("SELL PREMIUM");
    expect(regime).toHaveTextContent("180 vs ~210 pts · straddle -20.00%");
    expect(screen.queryByTestId("nifty-verdict-regime")).not.toBeInTheDocument();

    const vix = screen.getByTestId("nifty-verdict-vix");
    expect(vix).toHaveTextContent("VIX 13.45 (-2.54%)");
    expect(vix).toHaveTextContent("day 13.20–13.90");

    const strength = screen.getByTestId("nifty-verdict-strength");
    expect(strength).toHaveTextContent("STRONG");
    expect(strength).toHaveTextContent("score 72.5 · RSI 61.3");
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
          rv: null,
          iv: null,
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
      "PUT WRITERS IN CONTROL",
    );
    expect(screen.getByTestId("nifty-stat-regime")).toHaveTextContent(
      "BUY PREMIUM · RV > IV",
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
    ).toHaveTextContent("ΔOI C — P — · skew —");
    expect(screen.getByTestId("nifty-stat-regime-value")).toHaveTextContent(
      /^—$/,
    );
    expect(
      screen.getByTestId("nifty-stat-regime-hint"),
    ).toHaveTextContent("— vs ~— pts · straddle —%");
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
    ).toHaveTextContent("ΔOI C 1,000 P — · skew —");
    expect(screen.getByTestId("nifty-verdict-vix-primary")).toHaveTextContent(
      "VIX 12.50 (—%)",
    );
    expect(screen.getByTestId("nifty-verdict-vix-secondary")).toHaveTextContent(
      "day —–—",
    );
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

  test("chart body uses a fixed pixel height and the OI body fills its column", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({ candles: candles() }),
    );
    r(<NiftyReportPanel />);
    const chartWrap = await screen.findByTestId("nifty-chart-wrap");
    expect(chartWrap).toHaveStyle({ height: "180px" });
    const oiWrap = screen.getByTestId("nifty-oi-wrap");
    expect(oiWrap).toHaveStyle({ height: "100%" });
  });

  test("timeline scrolls inside a capped inner box", async () => {
    r(<NiftyReportPanel />);
    const scroller = await screen.findByTestId("nifty-timeline-scroll");
    expect(scroller).toHaveStyle({ maxHeight: "150px" });
    expect(screen.getByTestId("nifty-timeline-item-0")).toBeInTheDocument();
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
