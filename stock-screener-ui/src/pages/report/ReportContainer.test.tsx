// @vitest-environment happy-dom
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { ReportContainer } from "./ReportContainer";
import { fetchSymbolChart, fetchTimeframes } from "@/api/chartPatterns";

vi.mock("../../api/report", () => ({
  fetchDailyReport: vi.fn(),
  fetchReportBreakouts: vi.fn(),
  fetchReportFollowThrough: vi.fn(),
  fetchReportDelivery: vi.fn(),
  fetchReportEvents: vi.fn(),
  todayIST: () => "2026-10-07",
}));

vi.mock("@/api/chartPatterns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/chartPatterns")>();
  return {
    ...actual,
    fetchSymbolChart: vi.fn(),
    fetchTimeframes: vi.fn(),
  };
});

// The real fullscreen mounts lightweight-charts (no canvas in happy-dom);
// stub it like the Patterns page tests do and assert the wiring instead.
vi.mock("@/components/patterns/PatternFullscreenView", () => ({
  PatternFullscreenView: ({ opened, onClose, hit, hits = [], onSelectHit }: any) => {
    if (!opened) return null;
    return (
      <div data-testid="patterns-fullscreen-modal">
        <div data-testid="patterns-fullscreen-active-hit">{hit?.pattern_name}</div>
        {(hits as any[]).map((h: any, i: number) => (
          <button
            key={i}
            data-testid={`patterns-fullscreen-list-item-${i}`}
            onClick={() => onSelectHit?.(h)}
          >
            {h.pattern_name}
          </button>
        ))}
        <button data-testid="patterns-fullscreen-close" onClick={onClose}>
          Close
        </button>
      </div>
    );
  },
}));

import {
  fetchDailyReport,
  fetchReportBreakouts,
  fetchReportFollowThrough,
  fetchReportDelivery,
  fetchReportEvents,
} from "../../api/report";

const mockDaily = {
  date: "2026-10-07",
  universe: "nifty500",
  as_of: "2026-10-07T15:30:00+05:30",
  cached: false,
  age_sec: 0,
  breadth: {
    total: 500, advances: 320, declines: 150, unchanged: 30,
    new_highs: 25, new_lows: 8, avg_change: 0.85, median_change: 0.42,
    up_volume: 123, down_volume: 45,
  },
  moves: {
    gainers: [
      { symbol: "RELIANCE", name: "Reliance", close: 2850.5, change: 3.2, logo: null, sub_value: "3.2x vol", spark: [0.2, 0.5, 0.8] },
    ],
    losers: [], volume_surge: [], gap_up: [], gap_down: [],
    range_expansion: [], new_52w_high: [], new_52w_low: [], turnover: [],
  },
};

const mockEmpty = {
  date: "2026-10-07", universe: "nifty500", as_of: "2026-10-07T15:30:00+05:30",
  cached: false, scanned: 0,
  breakouts: { count: 0, by_type: {}, rows: [] },
  breakdowns: { count: 0, by_type: {}, rows: [] },
};

function renderContainer() {
  return render(
    <MemoryRouter initialEntries={["/report"]}>
      <UIProvider>
        <ReportContainer />
      </UIProvider>
    </MemoryRouter>,
  );
}

describe("ReportContainer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchDailyReport).mockResolvedValue(mockDaily as never);
    vi.mocked(fetchReportBreakouts).mockResolvedValue(mockEmpty as never);
    vi.mocked(fetchReportFollowThrough).mockResolvedValue(mockEmpty as never);
    vi.mocked(fetchReportDelivery).mockResolvedValue({ rows: [] } as never);
    vi.mocked(fetchReportEvents).mockResolvedValue({ events: [] } as never);
    vi.mocked(fetchTimeframes).mockResolvedValue([{ id: "1D", label: "1D" }] as never);
    vi.mocked(fetchSymbolChart).mockResolvedValue({ candles: [], hits: [], trend_lines: [] } as never);
  });

  afterEach(() => cleanup());

  test("row click opens the Patterns fullscreen chart for that symbol", async () => {
    const user = userEvent.setup();
    renderContainer();
    await user.click(await screen.findByTestId("report-tab-moves"));
    await screen.findByTestId("report-moves-gainers");
    await user.click(screen.getByTestId("report-move-row-RELIANCE"));
    await waitFor(() =>
      expect(vi.mocked(fetchSymbolChart)).toHaveBeenCalledWith(
        "RELIANCE",
        "1D",
        expect.objectContaining({ detectPatterns: true }),
      ),
    );
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
  }, 30_000);

  test("closing the fullscreen returns to the report", async () => {
    const user = userEvent.setup();
    renderContainer();
    await user.click(await screen.findByTestId("report-tab-moves"));
    await screen.findByTestId("report-moves-gainers");
    await user.click(screen.getByTestId("report-move-row-RELIANCE"));
    await screen.findByTestId("patterns-fullscreen-modal");
    await user.click(screen.getByTestId("patterns-fullscreen-close"));
    await waitFor(() =>
      expect(screen.queryByTestId("patterns-fullscreen-modal")).not.toBeInTheDocument(),
    );
  }, 30_000);
});
