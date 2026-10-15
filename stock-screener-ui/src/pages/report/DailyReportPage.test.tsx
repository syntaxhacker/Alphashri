// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { DailyReportPage } from "./DailyReportPage";
import { fetchDailyReport, fetchReportBreakouts, fetchReportDelivery, fetchReportEvents, fetchReportFollowThrough } from "../../api/report";
import { fetchRecentEvents, fetchRegime, fetchUpcomingEvents } from "../../api/eventWatch";
import { copyToClipboard } from "../../utils/copyCsv";
import { UIProvider } from "@/ui";

vi.mock("../../api/report", () => ({
  fetchDailyReport: vi.fn(),
  fetchReportBreakouts: vi.fn(),
  fetchReportFollowThrough: vi.fn(),
  fetchReportDelivery: vi.fn(),
  fetchReportEvents: vi.fn(),
  todayIST: () => "2026-10-07",
}));

vi.mock("../../api/eventWatch", () => ({
  fetchUpcomingEvents: vi.fn(),
  fetchRecentEvents: vi.fn(),
  fetchRegime: vi.fn(),
}));

vi.mock("../../utils/copyCsv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/copyCsv")>();
  return { ...actual, copyToClipboard: vi.fn().mockResolvedValue(true) };
});

const mockBreadth = {
  total: 500,
  advances: 320,
  declines: 150,
  unchanged: 30,
  new_highs: 25,
  new_lows: 8,
  avg_change: 0.85,
  median_change: 0.42,
  up_volume: 123456789,
  down_volume: 45678901,
};

const mockMoves = {
  gainers: [
    { symbol: "RELIANCE", name: "Reliance Industries", close: 2850.5, change: 3.2, logo: null, sub_value: "3.2x vol", spark: [0.2, 0.5, 0.8] },
  ],
  losers: [
    { symbol: "TCS", name: "TCS Ltd", close: 4100, change: -2.1, logo: null, sub_value: "2.1x vol", spark: [0.8, 0.5, 0.2] },
  ],
  volume_surge: [],
  gap_up: [],
  gap_down: [],
  range_expansion: [],
  new_52w_high: [],
  new_52w_low: [],
  turnover: [
    { symbol: "HDFCBANK", name: "HDFC Bank", close: 1650, change: 0.8, logo: null, sub_value: "₹1.2K Cr", spark: [0.4, 0.5, 0.6] },
  ],
};

const mockBreakoutRows = [
  { symbol: "RELIANCE", name: "Reliance Industries", type: "52w_high", level: 2800, close: 2850.5, pct_above: 1.8, volume_ratio: 2.3, change: 3.2, to_52w_high: 0, sector: "Energy", spark: [0.2, 0.5, 0.8] },
  { symbol: "INFY", name: "Infosys", type: "base_20", level: 1500, close: 1520, pct_above: 1.33, volume_ratio: 1.5, change: 1.1, to_52w_high: -5.2, sector: "IT", spark: [0.3, 0.4, 0.7] },
];

const mockBreakdownRows = [
  { symbol: "TCS", name: "TCS Ltd", type: "base_20", level: 4200, close: 4100, pct_above: -2.38, volume_ratio: 1.8, change: -2.1, to_52w_high: -8.0, sector: "IT", spark: [0.8, 0.5, 0.2] },
];

const mockDaily = {
  date: "2026-10-07",
  universe: "nifty500",
  as_of: "2026-10-07T15:30:00+05:30",
  cached: true,
  age_sec: 120,
  breadth: mockBreadth,
  moves: mockMoves,
  index: { name: "NIFTY 50", change: 0.8, close: 25100.5 },
  sector_leaders: [
    { name: "Energy", change: 2.1, stock_count: 12, advances: 10, declines: 2 },
    { name: "IT", change: -1.4, stock_count: 15, advances: 3, declines: 12 },
  ],
  theme_leaders: [
    { name: "PSU", change: 1.2, stock_count: 20, advances: 14, declines: 6 },
    { name: "Midcap", change: -0.6, stock_count: 25, advances: 8, declines: 17 },
  ],
};

const mockBreakouts = {
  date: "2026-10-07",
  universe: "nifty500",
  as_of: "2026-10-07T15:30:00+05:30",
  cached: false,
  scanned: 500,
  breakouts: {
    count: 2,
    by_type: { "52w_high": 1, base_20: 1 },
    rows: mockBreakoutRows,
  },
  breakdowns: {
    count: 1,
    by_type: { base_20: 1 },
    rows: mockBreakdownRows,
  },
};

const mockFollowThrough = {
  date: "2026-10-07",
  universe: "nifty500",
  as_of: "2026-10-07T15:30:00+05:30",
  breakouts: {
    count: 2,
    winners: 1,
    losers: 1,
    avg_ret: 0.23,
    rows: [
      { symbol: "RELIANCE", name: "Reliance Industries", type: "52w_high", level: 2800, ref_close: 2800, last_close: 2850, ret_pct: 1.79, max_fav_pct: 2.1, max_adv_pct: 2.5, held: true },
      { symbol: "INFY", name: "Infosys", type: "base_20", level: 1500, ref_close: 1500, last_close: 1480, ret_pct: -1.33, max_fav_pct: 0.5, max_adv_pct: 0.8, held: false },
    ],
  },
  breakdowns: {
    count: 1,
    winners: 0,
    losers: 1,
    avg_ret: -2.0,
    rows: [
      { symbol: "TCS", name: "TCS Ltd", type: "base_20", level: 4200, ref_close: 4200, last_close: 4116, ret_pct: -2.0, max_fav_pct: 0.2, max_adv_pct: 0.4, held: false },
    ],
  },
};

function mockOk() {
  vi.mocked(fetchDailyReport).mockResolvedValue(mockDaily as never);
  vi.mocked(fetchReportBreakouts).mockResolvedValue(mockBreakouts as never);
  vi.mocked(fetchReportFollowThrough).mockResolvedValue(mockFollowThrough as never);
  vi.mocked(fetchReportDelivery).mockResolvedValue({ date: "2026-10-07", universe: "nifty500", as_of: "2026-10-07T15:30:00+05:30", cached: false, source: "nse-bhavcopy", rows: [] } as never);
  vi.mocked(fetchReportEvents).mockResolvedValue({ from: "2026-10-07", to: "2026-10-28", as_of: "2026-10-07T15:30:00+05:30", cached: false, events: [], symbols_covered: 0, symbols_total: 0 } as never);
  vi.mocked(fetchUpcomingEvents).mockResolvedValue({ as_of: "2026-10-07T15:30:00+05:30", events: [] } as never);
  vi.mocked(fetchRecentEvents).mockResolvedValue({ as_of: "2026-10-07T15:30:00+05:30", events: [] } as never);
  vi.mocked(fetchRegime).mockResolvedValue({
    as_of: "2026-10-07T15:30:00+05:30",
    symbol: "^NSEI",
    name: "NIFTY 50",
    close: 25100.5,
    dma20: 24900.25,
    above: true,
    cached: false,
    rule: "regime_long_ok: longs only when Nifty 50 closes above its 20-day moving average",
  } as never);
}

function renderPage(props?: { universe?: string; onOpenSymbol?: (s: string) => void }) {
  return render(
    <UIProvider>
      <DailyReportPage {...props} />
    </UIProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOk();
});

afterEach(() => {
  cleanup();
});

describe("DailyReportPage", () => {
  it("renders title and toolbar controls", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("report-title")).toBeInTheDocument());
    expect(screen.getByTestId("report-date")).toBeInTheDocument();
    expect(screen.getByTestId("report-universe")).toBeInTheDocument();
    expect(screen.getByTestId("report-refresh")).toBeInTheDocument();
    expect(screen.getByTestId("report-copy-csv")).toBeInTheDocument();
    expect(screen.getByTestId("report-copy-symbols")).toBeInTheDocument();
  });

  it("renders breadth strip stats", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("report-breadth")).toBeInTheDocument());
    expect(screen.getByTestId("report-breadth-advances")).toHaveTextContent("320");
    expect(screen.getByTestId("report-breadth-declines")).toHaveTextContent("150");
    expect(screen.getByTestId("report-breadth-unchanged")).toHaveTextContent("30");
    expect(screen.getByTestId("report-breadth-new-highs")).toHaveTextContent("25");
    expect(screen.getByTestId("report-breadth-new-lows")).toHaveTextContent("8");
    expect(screen.getByTestId("report-breadth-avg")).toBeInTheDocument();
    expect(screen.getByTestId("report-breadth-median")).toBeInTheDocument();
    expect(screen.getByTestId("report-breadth-up-volume")).toBeInTheDocument();
    expect(screen.getByTestId("report-breadth-down-volume")).toBeInTheDocument();
  });

  it("renders breakouts table with columns, rows and pct_above desc sort", async () => {
    renderPage();
    const table = await screen.findByTestId("report-breakouts-table");
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent ?? "");
    for (const expected of ["Symbol", "Type", "Level", "Close", "Vol", "Chg", "52W", "Sector"]) {
      expect(headers.some((h) => h.includes(expected))).toBe(true);
    }
    expect(screen.getByTestId("report-breakouts-table-row-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("report-breakouts-table-row-INFY")).toBeInTheDocument();
    // sorted by pct_above desc: RELIANCE (1.8) before INFY (1.33)
    const rows = within(table).getAllByRole("row");
    const symbols = rows.map((r) => r.textContent ?? "");
    const relIdx = symbols.findIndex((t) => t.includes("RELIANCE"));
    const infyIdx = symbols.findIndex((t) => t.includes("INFY"));
    expect(relIdx).toBeGreaterThanOrEqual(0);
    expect(infyIdx).toBeGreaterThanOrEqual(0);
    expect(relIdx).toBeLessThan(infyIdx);
    expect(screen.getByTestId("report-breakouts-table-count")).toHaveTextContent("2");
    expect(screen.getByTestId("report-breakouts-scanned")).toHaveTextContent("500");
  });

  it("filters breakouts by type chip", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("report-breakouts-table-row-RELIANCE");
    await user.click(screen.getByTestId("report-breakouts-table-filter-base_20"));
    expect(screen.queryByTestId("report-breakouts-table-row-RELIANCE")).not.toBeInTheDocument();
    expect(screen.getByTestId("report-breakouts-table-row-INFY")).toBeInTheDocument();
    await user.click(screen.getByTestId("report-breakouts-table-filter-all"));
    expect(screen.getByTestId("report-breakouts-table-row-RELIANCE")).toBeInTheDocument();
  });

  it("renders breakdowns table", async () => {
    renderPage();
    await screen.findByTestId("report-breakdowns-table-row-TCS");
    expect(screen.getByTestId("report-breakdowns-table-count")).toHaveTextContent("1");
  });

  it("renders moves cards for each panel", async () => {
    renderPage();
    for (const panel of ["gainers", "losers", "volume_surge", "gap_up", "gap_down", "range_expansion", "new_52w_high", "new_52w_low", "turnover"]) {
      await waitFor(() => expect(screen.getByTestId(`report-moves-${panel}`)).toBeInTheDocument());
    }
    expect(screen.getByTestId("report-moves-gainers-rows")).toHaveTextContent("RELIANCE");
    expect(screen.getByTestId("report-moves-turnover-rows")).toHaveTextContent("HDFCBANK");
    expect(screen.getByTestId("report-moves-gap_up-empty")).toBeInTheDocument();
  });

  it("shows cached as-of indicator", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("report-asof")).toBeInTheDocument());
    expect(screen.getByTestId("report-cached")).toHaveTextContent("cached");
  });

  it("row click calls onOpenSymbol", async () => {
    const user = userEvent.setup();
    const onOpenSymbol = vi.fn();
    renderPage({ onOpenSymbol });
    await screen.findByTestId("report-breakouts-table-row-RELIANCE");
    await user.click(screen.getByTestId("report-breakouts-table-row-RELIANCE"));
    expect(onOpenSymbol).toHaveBeenCalledWith("RELIANCE");
  });

  it("refetches on date change", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("report-breakouts-table");
    const callsBefore = vi.mocked(fetchDailyReport).mock.calls.length;
    const dateInput = screen.getByTestId("report-date");
    await user.clear(dateInput);
    await user.type(dateInput, "2026-10-06");
    await waitFor(() => expect(vi.mocked(fetchDailyReport).mock.calls.length).toBeGreaterThan(callsBefore));
    expect(vi.mocked(fetchDailyReport)).toHaveBeenLastCalledWith("2026-10-06", expect.anything(), expect.anything());
  });

  it("copies CSV and symbols", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("report-breakouts-table-row-RELIANCE");
    await user.click(screen.getByTestId("report-copy-csv"));
    await waitFor(() => expect(copyToClipboard).toHaveBeenCalled());
    const csvArg = vi.mocked(copyToClipboard).mock.calls[0][0] as string;
    expect(csvArg).toContain("RELIANCE");
    await user.click(screen.getByTestId("report-copy-symbols"));
    await waitFor(() => expect(vi.mocked(copyToClipboard).mock.calls.length).toBeGreaterThanOrEqual(2));
    const symArg = vi.mocked(copyToClipboard).mock.calls[1][0] as string;
    expect(symArg).toContain("RELIANCE");
  });

  it("shows loading then error states", async () => {
    vi.mocked(fetchDailyReport).mockImplementation(() => new Promise(() => {}));
    vi.mocked(fetchReportBreakouts).mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId("report-loading")).toBeInTheDocument();
    cleanup();

    vi.mocked(fetchDailyReport).mockRejectedValue(new Error("boom"));
    vi.mocked(fetchReportBreakouts).mockRejectedValue(new Error("boom"));
    renderPage();
    await waitFor(() => expect(screen.getByTestId("report-error")).toBeInTheDocument());
    expect(screen.getByTestId("report-error")).toHaveTextContent("boom");
  });

  it("shows empty state when nothing qualifies", async () => {
    vi.mocked(fetchDailyReport).mockResolvedValue({ ...mockDaily, moves: {} } as never);
    vi.mocked(fetchReportBreakouts).mockResolvedValue({
      ...mockBreakouts,
      breakouts: { count: 0, by_type: {}, rows: [] },
      breakdowns: { count: 0, by_type: {}, rows: [] },
    } as never);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("report-empty")).toBeInTheDocument());
  });

  it("renders index snapshot at the head of the breadth row", async () => {
    renderPage();
    const index = await screen.findByTestId("report-breadth-index");
    expect(index).toHaveTextContent("NIFTY 50");
    expect(index).toHaveTextContent("+0.80%");
    const breadth = screen.getByTestId("report-breadth");
    const stats = within(breadth).getAllByText(/NIFTY 50|Adv|Dec|Unch|New highs|New lows|Avg|Median|Up vol|Down vol/);
    expect(stats[0]).toHaveTextContent("NIFTY 50");
  });

  it("omits the index snapshot when absent", async () => {
    const { index: _omit, ...dailyWithoutIndex } = mockDaily;
    vi.mocked(fetchDailyReport).mockResolvedValue(dailyWithoutIndex as never);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("report-breadth")).toBeInTheDocument());
    expect(screen.queryByTestId("report-breadth-index")).not.toBeInTheDocument();
  });

  it("renders sector and theme leadership strips", async () => {
    renderPage();
    const sectors = await screen.findByTestId("report-sector-leaders");
    expect(sectors).toHaveTextContent("Energy");
    expect(sectors).toHaveTextContent("+2.10%");
    expect(sectors).toHaveTextContent("IT");
    const themes = await screen.findByTestId("report-theme-leaders");
    expect(themes).toHaveTextContent("PSU");
    expect(themes).toHaveTextContent("Midcap");
  });

  it("renders sector/theme strips from {top,bottom} board shape (backend)", async () => {
    const boardDaily = {
      ...mockDaily,
      sector_leaders: {
        top: [{ name: "Energy", change: 2.1, stock_count: 12, advances: 10, declines: 2 }],
        bottom: [{ name: "IT", change: -1.4, stock_count: 15, advances: 3, declines: 12 }],
      },
      theme_leaders: {
        top: [{ name: "PSU", change: 1.2, stock_count: 20, advances: 14, declines: 6 }],
        bottom: [{ name: "Midcap", change: -0.6, stock_count: 25, advances: 8, declines: 17 }],
      },
    };
    vi.mocked(fetchDailyReport).mockResolvedValue(boardDaily as never);
    renderPage();
    const sectors = await screen.findByTestId("report-sector-leaders");
    expect(sectors).toHaveTextContent("Energy");
    expect(sectors).toHaveTextContent("IT");
  });

  it("omits leadership strips when absent", async () => {
    const { sector_leaders: _s, theme_leaders: _t, ...dailyWithoutLeaders } = mockDaily;
    vi.mocked(fetchDailyReport).mockResolvedValue(dailyWithoutLeaders as never);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("report-breadth")).toBeInTheDocument());
    expect(screen.queryByTestId("report-sector-leaders")).not.toBeInTheDocument();
    expect(screen.queryByTestId("report-theme-leaders")).not.toBeInTheDocument();
  });

  it("renders follow-through tables sorted by ret with winners/losers/avg header", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId("report-tab-followthrough"));
    const table = await screen.findByTestId("report-followthrough-breakouts");
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent ?? "");
    for (const expected of ["Symbol", "Type", "Ref close", "Last", "Ret", "Max fav", "Held"]) {
      expect(headers.some((h) => h.includes(expected))).toBe(true);
    }
    expect(screen.getByTestId("report-followthrough-breakouts-row-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("report-followthrough-breakouts-row-INFY")).toBeInTheDocument();
    const rows = within(table).getAllByRole("row");
    const symbols = rows.map((r) => r.textContent ?? "");
    const relIdx = symbols.findIndex((t) => t.includes("RELIANCE"));
    const infyIdx = symbols.findIndex((t) => t.includes("INFY"));
    expect(relIdx).toBeGreaterThanOrEqual(0);
    expect(infyIdx).toBeGreaterThanOrEqual(0);
    expect(relIdx).toBeLessThan(infyIdx);
    expect(screen.getByTestId("report-followthrough-breakouts-summary")).toHaveTextContent("1W");
    expect(screen.getByTestId("report-followthrough-breakouts-summary")).toHaveTextContent("1L");
    expect(screen.getByTestId("report-followthrough-breakouts-row-RELIANCE")).toHaveTextContent("✓");
    expect(screen.getByTestId("report-followthrough-breakouts-row-INFY")).toHaveTextContent("✗");
    await screen.findByTestId("report-followthrough-breakdowns-row-TCS");
    expect(screen.getByTestId("report-followthrough-breakdowns-summary")).toHaveTextContent("1L");
  });

  it("shows meaningful follow-through summaries for empty and not-yet-elapsed states", async () => {
    const { fetchReportFollowThrough } = await import("../../api/report");
    vi.mocked(fetchReportFollowThrough).mockResolvedValue({
      date: "2026-10-09",
      universe: "nifty500",
      as_of: "2026-10-11T10:00:00+05:30",
      cached: true,
      partial: false,
      breakouts: { count: 0, winners: 0, losers: 0, avg_ret: 0, rows: [] },
      breakdowns: {
        count: 1,
        winners: 0,
        losers: 0,
        avg_ret: 0,
        rows: [
          { symbol: "AAA", name: "AAA", type: "break_20", level: 100, ref_close: 99, last_close: 99, ret_pct: 0, max_fav_pct: 0, max_adv_pct: 0, held: true },
        ],
      },
    } as never);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("report-followthrough-breakouts-summary")).toHaveTextContent(
        "No breakouts on 2026-10-09 to follow",
      ),
    );
    expect(screen.getByTestId("report-followthrough-breakdowns-summary")).toHaveTextContent(
      "Awaiting next session",
    );
  });

  it("keeps follow-through independent when the breakout scan fails", async () => {    vi.mocked(fetchReportBreakouts).mockRejectedValue(new Error("scan boom"));
    renderPage();
    await waitFor(() => expect(screen.getByTestId("report-breakouts-error")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("report-followthrough-breakouts-row-RELIANCE")).toBeInTheDocument());
  });

  it("shows a retryable follow-through error without hiding other sections", async () => {
    vi.mocked(fetchReportFollowThrough).mockRejectedValue(new Error("follow boom"));
    renderPage();
    await waitFor(() => expect(screen.getByTestId("report-followthrough-error")).toBeInTheDocument());
    expect(screen.getByTestId("report-followthrough-error")).toHaveTextContent("follow boom");
    await waitFor(() => expect(screen.getByTestId("report-breakouts-table-row-RELIANCE")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("report-breadth")).toBeInTheDocument());
  });

  it("shifts the date with prev/next archive buttons and refetches", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("report-breakouts-table");
    await user.click(screen.getByTestId("report-date-prev"));
    await waitFor(() =>
      expect(vi.mocked(fetchDailyReport)).toHaveBeenLastCalledWith("2026-10-06", expect.anything(), expect.anything()),
    );
    expect(vi.mocked(fetchReportFollowThrough)).toHaveBeenLastCalledWith(
      "2026-10-06",
      expect.anything(),
      expect.anything(),
    );
    await user.click(screen.getByTestId("report-date-next"));
    await waitFor(() =>
      expect(vi.mocked(fetchDailyReport)).toHaveBeenLastCalledWith("2026-10-07", expect.anything(), expect.anything()),
    );
  });

  it("omits the spark range toggle when no row carries daily closes", async () => {
    renderPage();
    await screen.findByTestId("report-breakouts-table-row-RELIANCE");
    expect(screen.queryByTestId("report-spark-range")).not.toBeInTheDocument();
  });
  it("shows the spark range toggle when rows carry daily closes and keeps rows on switch", async () => {
    const user = userEvent.setup();
    const rowsWithDaily = mockBreakoutRows.map((r) => ({ ...r, daily_closes: [100, 102, 101, 105, 107] }));
    vi.mocked(fetchReportBreakouts).mockResolvedValue({
      ...mockBreakouts,
      breakouts: { ...mockBreakouts.breakouts, rows: rowsWithDaily },
    } as never);
    renderPage();
    const toggle = await screen.findByTestId("report-spark-range");
    expect(toggle).toHaveTextContent("Intraday");
    expect(toggle).toHaveTextContent("5D");
    await user.click(within(toggle).getByText("5D"));
    await waitFor(() => expect(screen.getByTestId("report-breakouts-table-row-RELIANCE")).toBeInTheDocument());
    expect(screen.getByTestId("report-breakouts-table-row-INFY")).toBeInTheDocument();
  });

  it("renders the regime chip when Nifty is above its 20DMA", async () => {
    renderPage();
    const chip = await screen.findByTestId("report-regime");
    expect(chip).toHaveTextContent("Nifty 25,101 · above 20DMA");
  });

  it("renders the regime chip as below when Nifty is under its 20DMA", async () => {
    vi.mocked(fetchRegime).mockResolvedValue({
      as_of: "2026-10-07T15:30:00+05:30",
      symbol: "^NSEI",
      name: "NIFTY 50",
      close: 24500.0,
      dma20: 24900.25,
      above: false,
      cached: false,
    } as never);
    renderPage();
    const chip = await screen.findByTestId("report-regime");
    expect(chip).toHaveTextContent("Nifty 24,500 · below 20DMA");
  });

  it("omits the regime chip when the endpoint is absent or has no data", async () => {
    vi.mocked(fetchRegime).mockResolvedValue(null);
    renderPage();
    await waitFor(() => expect(vi.mocked(fetchRegime)).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("report-regime")).not.toBeInTheDocument();
    // other sections still render independently
    await screen.findByTestId("report-breakouts-table-row-RELIANCE");
  });

  it("omits the regime chip on regime fetch failure without hiding the page", async () => {
    vi.mocked(fetchRegime).mockRejectedValue(new Error("regime boom"));
    renderPage();
    await screen.findByTestId("report-breakouts-table-row-RELIANCE");
    expect(screen.queryByTestId("report-regime")).not.toBeInTheDocument();
  });

  it("renders the tab workspace with Breakouts active by default", async () => {
    renderPage();
    await screen.findByTestId("report-breakouts-table-row-RELIANCE");
    for (const tab of ["scan", "breakouts", "moves", "followthrough", "events"]) {
      expect(screen.getByTestId(`report-tab-${tab}`)).toBeInTheDocument();
      expect(screen.getByTestId(`report-tab-panel-${tab}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("report-tab-breakouts")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("report-tab-scan")).toHaveAttribute("aria-selected", "false");
  });

  it("switches focus when a tab is clicked", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("report-breakouts-table-row-RELIANCE");
    await user.click(screen.getByTestId("report-tab-moves"));
    await waitFor(() =>
      expect(screen.getByTestId("report-tab-moves")).toHaveAttribute("aria-selected", "true"),
    );
    expect(screen.getByTestId("report-tab-breakouts")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("report-moves-gainers")).toBeVisible();
    await user.click(screen.getByTestId("report-tab-scan"));
    await waitFor(() =>
      expect(screen.getByTestId("report-tab-scan")).toHaveAttribute("aria-selected", "true"),
    );
    expect(screen.getByTestId("report-breadth")).toBeVisible();
  });

  it("keeps every section mounted so background tabs retain state", async () => {
    renderPage();
    await screen.findByTestId("report-breakouts-table-row-RELIANCE");
    // Mounted but hidden tabs still expose their testids (keepMounted).
    expect(screen.getByTestId("report-moves-gainers")).toBeInTheDocument();
    expect(screen.getByTestId("report-followthrough-breakouts")).toBeInTheDocument();
  });
});
