// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import { NiftyReportPanel, getNiftyOiColumns, findAtmStrike, oiBurstLogHeight } from "./NiftyReportPanel";
import * as palette from "@/ui/palette";
import type { NiftyReport } from "@/types/niftyReport";

vi.mock("@/api/reportNifty", () => ({
  fetchLiveNifty: vi.fn(),
  fetchNiftyByDate: vi.fn(),
  fetchNiftyExpiries: vi.fn().mockResolvedValue([]),
  fetchNiftyTape: vi.fn(),
  fetchNiftyBursts: vi.fn(),
  snapshotNifty: vi.fn(),
}));

vi.mock("@/components/chart/TradingViewChart", () => ({
  TradingViewChart: ({ markLines }: { markLines?: unknown[] }) => (
    <div data-testid="tradingview-chart" data-marklines={markLines?.length ?? 0} />
  ),
}));

vi.mock("echarts-for-react", () => ({
  default: () => <div data-testid="nifty-depth-echarts" />,
}));

import {
  fetchLiveNifty,
  fetchNiftyByDate,
  fetchNiftyTape,
  fetchNiftyBursts,
  snapshotNifty,
} from "@/api/reportNifty";

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

/** Steady +1,000/min call OI for 13 minutes, then one +60,000 burst minute. */
function burstTape() {
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

beforeEach(() => {
  vi.mocked(fetchLiveNifty).mockResolvedValue(mockReport());
  vi.mocked(fetchNiftyByDate).mockResolvedValue(mockReport({ mode: "eod" }));
  vi.mocked(fetchNiftyTape).mockResolvedValue(mockTape());
  vi.mocked(fetchNiftyBursts).mockResolvedValue([] as never);
  vi.mocked(snapshotNifty).mockResolvedValue(mockReport());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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

    await user.click(screen.getByRole("button", { name: "Depth" }));
    expect(await screen.findByTestId("nifty-depthmap")).toBeInTheDocument();
    expect(screen.queryByTestId("tradingview-chart")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Chart" }));
    expect(await screen.findByTestId("tradingview-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-depthmap")).not.toBeInTheDocument();
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

  test("ATM badge renders on the strike closest to spot", async () => {
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
    expect(badges[0]).toHaveTextContent("ATM");
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
    const bg = atmRow.style.background;
    expect(bg).toMatch(/rgba/);
    expect(atmRow.style.borderTop).toContain(palette.WARNING);
    expect(atmRow.style.borderBottom).toContain(palette.WARNING);
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

  test("chart panel fills width and wall mark lines are top-2 plus max pain", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({ candles: candles() }),
    );
    r(<NiftyReportPanel />);
    expect(await screen.findByTestId("nifty-chart-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-wrap")).toBeInTheDocument();
    const chart = screen.getByTestId("tradingview-chart");
    // top-2 call walls + top-2 put walls + max-pain line (no gex in mock)
    expect(chart).toHaveAttribute("data-marklines", "5");
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
    // 25800 dupes CW, 25900 dupes CW, 26100 fresh GSUP;
    // 25700 dupes MP, 25900 dupes CW; flip 25650 fresh
    const lines = buildMarkLines(rep, true);
    const labels = lines.map((l) => l.label.formatter);
    expect(labels).toContain("FLIP 25650");
    expect(labels).toContain("GSUP 26100");
    expect(labels).toContain("GRES 25300");
    // 25800 dupes the CW line, 25700 dupes MP — skipped, never doubled
    expect(labels.filter((x) => x === "GSUP 25800")).toHaveLength(0);
    expect(labels.filter((x) => x === "GRES 25700")).toHaveLength(0);
    // off without the flag
    expect(buildMarkLines(rep, false).map((l) => l.label.formatter)).not.toContain("FLIP 25650");
    expect(buildMarkLines({ ...rep, gex: undefined }, true)).toHaveLength(5);
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

describe("NiftyReportPanel live auto-refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function tick(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function renderLive() {
    r(<NiftyReportPanel />);
    await tick(0);
  }

  test("auto-refetch fires on 30s tick in live mode and shows updated-at", async () => {
    await renderLive();
    expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("nifty-updated-at")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-updated-at")).toHaveTextContent(/Updated/);
    expect(screen.getByTestId("nifty-updated-at")).toHaveTextContent(/auto 30s/);
    expect(screen.queryByTestId("nifty-stale-badge")).not.toBeInTheDocument();
    await tick(30_000);
    expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(2);
    await tick(30_000);
    expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(3);
  });

  test("an OI burst minute raises the in-app alert with a trade plan (local fallback)", async () => {
    await renderLive();
    // history is silent by design — nothing on first load
    expect(screen.queryByTestId("nifty-oi-bursts-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-oi-toasts")).not.toBeInTheDocument();

    // next poll returns a steady tape plus one huge call-OI minute.
    // fetchNiftyBursts stays [] (backend has nothing / is unavailable), so the
    // client detector is what raises the alert.
    const rows = burstTape();
    vi.mocked(fetchNiftyTape).mockResolvedValue({
      date: "2026-10-12",
      interval_sec: 60,
      rows,
    });

    await tick(30_000);

    expect(screen.getByTestId("nifty-oi-bursts-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-oi-toasts")).toBeInTheDocument();
    // call OI build → fade with puts at the nearest tradeable strike
    expect(screen.getAllByText(/BUY PE 25,700/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/qty/).length).toBeGreaterThan(0);
  });

  test("backend bursts are used when present and skip local detection", async () => {
    await renderLive();
    expect(screen.queryByTestId("nifty-oi-bursts-panel")).not.toBeInTheDocument();

    // backend reports ONE burst; the tape stays flat so the local detector
    // would find nothing — proving the backend list is the source used.
    const rows = burstTape();
    vi.mocked(fetchNiftyTape).mockResolvedValue({
      date: "2026-10-12",
      interval_sec: 60,
      rows: rows.map((r) => ({ ...r, call_doi: 0, put_doi: 0 })),
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

    await tick(30_000);

    expect(screen.getByTestId("nifty-oi-bursts-panel")).toBeInTheDocument();
    expect(screen.getAllByText(/BUY PE 25,700/).length).toBeGreaterThan(0);
  });

  test("no polling in EOD mode", async () => {
    await renderLive();
    expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "EOD" }));
    await tick(0);
    await tick(120_000);
    expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchNiftyByDate)).not.toHaveBeenCalled();
  });

  test("error backoff keeps last-good stats with stale badge, then recovers", async () => {
    vi.mocked(fetchLiveNifty)
      .mockResolvedValueOnce(mockReport())
      .mockRejectedValue(new Error("Upstox token expired"));
    await renderLive();
    expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
    // t=30s: scheduled poll fails -> backoff shortens to 15s
    await tick(30_000);
    expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(2);
    // t=45s: backoff retry fails -> backoff widens to 30s
    await tick(15_000);
    expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(3);
    // t=75s: fails -> backoff caps at 60s
    await tick(30_000);
    expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(4);
    // t=135s: fails, data now >90s old -> stale badge, stats kept, no full error
    await tick(60_000);
    expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(5);
    expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-stale-badge")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-stale-badge")).toHaveTextContent(/STALE/);
    expect(screen.queryByTestId("nifty-error")).not.toBeInTheDocument();
    // recovery on the next 60s tick clears the stale badge
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(mockReport({ spot: 26000 }));
    await tick(60_000);
    expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(6);
    expect(screen.queryByTestId("nifty-stale-badge")).not.toBeInTheDocument();
    expect(screen.getByTestId("nifty-updated-at")).toHaveTextContent(/auto 30s/);
  });

  test("hidden tab pauses polling and resumes when visible", async () => {
    await renderLive();
    expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    await tick(120_000);
    expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await tick(30_000);
    expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(2);
    delete (document as unknown as Record<string, unknown>)["hidden"];
  });

  test("manual Refresh forces immediate fetch and resets the timer", async () => {
    await renderLive();
    expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(1);
    await tick(10_000);
    fireEvent.click(screen.getByTestId("nifty-refresh-button"));
    await tick(0);
    expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(2);
    await tick(20_000);
    expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(2);
    await tick(10_000);
    expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(3);
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

  test("tape + unusual panels sit in a shared side-by-side row", async () => {
    r(<NiftyReportPanel />);
    const row = await screen.findByTestId("nifty-tape-duo");
    const tapePanel = within(row).getByTestId("nifty-tape-panel");
    const unusualPanel = within(row).getByTestId("nifty-unusual-panel");
    expect(tapePanel).toBeInTheDocument();
    expect(unusualPanel).toBeInTheDocument();
    // tape left, unusual right — same order as the reference terminal
    expect(tapePanel.compareDocumentPosition(unusualPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(tapePanel).getByTestId("nifty-tape-table")).toBeInTheDocument();
    expect(within(unusualPanel).getByTestId("nifty-unusual-table")).toBeInTheDocument();
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

  test("renders four verdicts right under the stat pills", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(withVerdicts());
    r(<NiftyReportPanel />);
    const strip = await screen.findByTestId("nifty-verdict-strip");
    // sits after the spot/PCR stat pills
    const stat = screen.getByTestId("nifty-stat-strip");
    expect(
      stat.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const control = screen.getByTestId("nifty-verdict-control");
    expect(control).toHaveTextContent("CALL WRITERS IN CONTROL");
    expect(control).toHaveTextContent("ΔOI C 55,30,000 P -12,00,000 · skew -2.40");

    const regime = screen.getByTestId("nifty-verdict-regime");
    expect(regime).toHaveTextContent("RANGE · SELL PREMIUM");
    expect(regime).toHaveTextContent("180 vs ~210 pts · straddle -20.00%");

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
    expect(screen.getByTestId("nifty-verdict-regime")).toHaveTextContent(
      "TREND · BUY FAVOURED",
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
    expect(screen.getByTestId("nifty-verdict-regime-primary")).toHaveTextContent(
      /^—$/,
    );
    expect(
      screen.getByTestId("nifty-verdict-regime-secondary"),
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

  test("chart and OI bodies use fixed pixel heights, never vh", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({ candles: candles() }),
    );
    r(<NiftyReportPanel />);
    const chartWrap = await screen.findByTestId("nifty-chart-wrap");
    expect(chartWrap).toHaveStyle({ height: "180px" });
    const oiWrap = screen.getByTestId("nifty-oi-wrap");
    expect(oiWrap).toHaveStyle({ height: "180px" });
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
