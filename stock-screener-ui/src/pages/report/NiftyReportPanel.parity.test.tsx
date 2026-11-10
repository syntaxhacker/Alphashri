// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.setConfig({ testTimeout: 20_000 });
import { UIProvider } from "@/ui";
import { NiftyReportPanel } from "./NiftyReportPanel";
import type { NiftyReport } from "@/types/niftyReport";

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

const { marketOpenMock } = vi.hoisted(() => ({ marketOpenMock: vi.fn(() => true) }));
vi.mock("@/utils/marketClock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/marketClock")>();
  return { ...actual, isMarketOpenIst: marketOpenMock, isDerivativesOpenIst: marketOpenMock };
});

vi.mock("@/components/chart/TradingViewChart", () => ({
  TradingViewChart: () => <div data-testid="tradingview-chart" />,
}));

vi.mock("echarts-for-react", () => ({
  default: () => <div data-testid="nifty-depth-echarts" />,
}));

vi.mock("@/api/paperTrading", () => ({
  fetchPositions: vi.fn().mockResolvedValue([]),
}));

vi.mock("./niftyIntel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./niftyIntel")>();
  return { ...actual, fetchNiftyIntel: vi.fn().mockRejectedValue(new Error("intel offline")) };
});

import {
  fetchLiveNifty,
  fetchNiftyReplayDates,
  fetchNiftyTape,
  fetchNiftyBursts,
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
  fetchBreadth,
} from "@/api/reportNifty";
import { fetchPositions } from "@/api/paperTrading";

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: TestWrapper });
}

/** Enriched SENSEX-shaped report: every block the replay frames were dropping. */
function sensexReport(overrides?: Partial<NiftyReport>): NiftyReport {
  return {
    mode: "live",
    date: "2026-10-28",
    expiry: "2026-10-30",
    spot: 84250.75,
    ohlc: { open: 84000, high: 84500, low: 83900, close: 84250.75 },
    pcrOi: 1.05,
    pcrVol: 0.9,
    maxPain: 84200,
    walls: {
      calls: [{ strike: 84500, oi: 5000 }],
      puts: [{ strike: 84000, oi: 6000 }],
    },
    strikes: [],
    timeline: [],
    control: {
      verdict: "put_writers",
      ce_doi: 1_200_000,
      pe_doi: 5_530_000,
      atm_ce_iv: 12.5,
      atm_pe_iv: 13.1,
      skew: -2.4,
      gex_regime: "long",
    },
    regime: {
      verdict: "trend_buy",
      range_pts: 180,
      range_baseline_pts: 210,
      range_pct: 0.7,
      rv: 14.2,
      iv: 11.8,
      straddle_open: 150,
      straddle_now: 120,
      straddle_pct: -20,
      bars: 300,
      warmup: false,
    },
    vix: { ltp: 13.45, prev_close: 13.8, change_pct: -2.54, day_high: 13.9, day_low: 13.2 },
    strength: {
      verdict: "strong",
      score: 72.5,
      ema9: null,
      ema20: 84000,
      ema50: 83800,
      rsi: 61.3,
      pos_in_range: 0.8,
    },
    pivots: {
      type: "classic",
      pp: 84100,
      r1: 84350,
      r2: 84500,
      r3: 84700,
      s1: 83900,
      s2: 83700,
      s3: 83500,
      prev: { date: "2026-10-27", high: 84300, low: 83900, close: 84150 },
    },
    reference: {
      strike: 84200,
      ce_open: 120,
      pe_open: 110,
      ce_ltp: 100.5,
      pe_ltp: 95.25,
      ce_change: -19.5,
      pe_change: -14.75,
      since: "2026-10-28T09:15:00+05:30",
    },
    ...overrides,
  };
}

function baseMockNifty(): NiftyReport {
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
      calls: [{ strike: 25800, oi: 5000 }],
      puts: [{ strike: 25600, oi: 6000 }],
    },
    strikes: [],
    timeline: [],
  };
}

const REAL_WS = (globalThis as Record<string, unknown>).WebSocket;

beforeEach(() => {
  marketOpenMock.mockReturnValue(true);
  window.localStorage.setItem("nifty.deskMode", "research");
  vi.mocked(fetchNiftyReplayDates).mockResolvedValue([]);
  vi.mocked(fetchLiveNifty).mockResolvedValue(baseMockNifty());
  vi.mocked(fetchNiftyTape).mockResolvedValue(null);
  vi.mocked(fetchNiftyBursts).mockResolvedValue([]);
  vi.mocked(fetchOptionsLiveCandles).mockResolvedValue(sensexReport());
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
  vi.mocked(fetchPositions).mockResolvedValue([]);
  (globalThis as Record<string, unknown>).WebSocket = undefined;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  (globalThis as Record<string, unknown>).WebSocket = REAL_WS;
});

async function pickSymbol(user: ReturnType<typeof userEvent.setup>, name: string) {
  const select = screen.getByTestId("report-symbol-select");
  await user.click(within(select).getByRole("combobox"));
  await user.click(await screen.findByRole("option", { name }));
}

/** Every verdict/VIX/strength cell must show a value, never the missing-data dash. */
function expectNoVerdictDashes() {
  const control = screen.getByTestId("nifty-verdict-control");
  expect(within(control).getByTestId("nifty-verdict-control-primary")).toHaveTextContent(
    "SESSION · PUT WRITING",
  );
  expect(control.textContent ?? "").not.toContain("—");

  // Context mode drops the regime cell from the verdict strip; the decision
  // strip carries the regime headline instead (detail lives in the tooltip).
  const regimeValue = screen.getByTestId("nifty-stat-regime-value");
  expect(regimeValue).toHaveTextContent("BUY PREMIUM");
  expect(regimeValue.textContent ?? "").not.toBe("—");
  expect(screen.getByTestId("nifty-stat-regime").getAttribute("title") ?? "").toContain(
    "RV 14.20 / IV 11.80",
  );

  const vix = screen.getByTestId("nifty-verdict-vix");
  expect(within(vix).getByTestId("nifty-verdict-vix-primary")).toHaveTextContent("13.45");
  expect(within(vix).getByTestId("nifty-verdict-vix-primary")).toHaveTextContent("-2.54");
  expect(within(vix).getByTestId("nifty-verdict-vix-secondary")).toHaveTextContent(
    "day 13.20–13.90",
  );
  expect(vix.textContent ?? "").not.toContain("—");

  const strength = screen.getByTestId("nifty-verdict-strength");
  expect(within(strength).getByTestId("nifty-verdict-strength-primary")).toHaveTextContent(
    "STRONG",
  );
  expect(within(strength).getByTestId("nifty-verdict-strength-secondary")).toHaveTextContent(
    "score 72.5",
  );
  expect(within(strength).getByTestId("nifty-verdict-strength-secondary")).toHaveTextContent(
    "RSI 61.3",
  );
  expect(strength.textContent ?? "").not.toContain("—");

  // India VIX carries its source label beside the value (not a US VIX).
  const label = screen.getByTestId("nifty-india-vix-label");
  expect(label).toHaveTextContent("INDIA VIX");
}

describe("NiftyReportPanel SENSEX parity (enriched live report)", () => {
  test("live SENSEX renders control / regime / RV / IV / VIX / score / RSI, never —", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchOptionsLive).mockResolvedValue(sensexReport());
    r(<NiftyReportPanel />);
    await waitFor(() => expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument());
    await pickSymbol(user, "SENSEX");

    await waitFor(() =>
      expect(vi.mocked(fetchOptionsLive)).toHaveBeenCalledWith(
        "SENSEX",
        undefined,
        expect.any(AbortSignal),
      ),
    );
    await waitFor(() => expect(screen.getByTestId("nifty-verdict-vix")).toBeInTheDocument());
    expectNoVerdictDashes();
  });
});

describe("NiftyReportPanel SENSEX EOD replay parity (enriched frames)", () => {
  test("EOD replay frame renders the same enriched fields, never —", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchOptionsLive).mockResolvedValue(sensexReport());
    vi.mocked(fetchOptionsReplayDates).mockResolvedValue(["2026-10-27", "2026-10-24"]);
    vi.mocked(fetchOptionsSnapshot).mockResolvedValue(
      sensexReport({ mode: "eod", spot: 84100 }),
    );
    vi.mocked(fetchOptionsReplayMeta).mockResolvedValue({
      date: "2026-10-27",
      count: 2,
      interval_sec: 60,
      frames: [
        { t: "2026-10-27T09:20:00+05:30", spot: 84100 },
        { t: "2026-10-27T09:21:00+05:30", spot: 84120 },
      ],
    });
    vi.mocked(fetchOptionsReplayFrame).mockResolvedValue({
      t: "2026-10-27T09:20:00+05:30",
      fetched_at: "",
      report: sensexReport({ mode: "eod", spot: 84100 }),
      sensex: null,
    });

    r(<NiftyReportPanel />);
    await waitFor(() => expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument());
    await pickSymbol(user, "SENSEX");

    const modeToggle = await screen.findByTestId("nifty-mode-toggle");
    await user.click(within(modeToggle).getByRole("button", { name: "EOD" }));
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(screen.getByTestId("nifty-date-input"), {
      target: { value: "2026-10-27" },
    });

    await waitFor(() =>
      expect(vi.mocked(fetchOptionsSnapshot)).toHaveBeenCalledWith(
        "SENSEX",
        "2026-10-27",
        expect.any(AbortSignal),
      ),
    );
    expect(await screen.findByTestId("nifty-replay-bar")).toBeInTheDocument();
    await waitFor(() =>
      expect(vi.mocked(fetchOptionsReplayFrame)).toHaveBeenCalledWith(
        "SENSEX",
        "2026-10-27",
        "2026-10-27T09:20:00+05:30",
      ),
    );
    expectNoVerdictDashes();
  });
});
