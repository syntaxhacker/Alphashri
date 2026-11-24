// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import type { SectorHistoryResponse } from "../../../types/sectorHistory";
import { SectorHistoryTab } from "./SectorHistoryTab";

const { mockFetchSectorHistory } = vi.hoisted(() => ({
  mockFetchSectorHistory: vi.fn(),
}));

vi.mock("../../../api/sectorHistory", () => ({
  fetchSectorHistory: (...args: unknown[]) => mockFetchSectorHistory(...args),
}));

vi.mock("./visuals/SectorRankHeatmap", () => ({
  SectorRankHeatmap: (props: { months: string[] }) => (
    <div data-testid="sector-rank-heatmap">{props.months.length} months</div>
  ),
}));

vi.mock("./visuals/SeasonalityHeatmap", () => ({
  SeasonalityHeatmap: () => <div data-testid="seasonality-heatmap" />,
}));

vi.mock("./visuals/PersistenceMatrix", () => ({
  PersistenceMatrix: () => <div data-testid="persistence-matrix" />,
}));

vi.mock("./visuals/RotationTimeline", () => ({
  RotationTimeline: () => <div data-testid="rotation-timeline" />,
}));

vi.mock("./visuals/MiniSparkline", () => ({
  MiniSparkline: () => <span data-testid="mini-sparkline" />,
}));

function response(overrides: Partial<SectorHistoryResponse> = {}): SectorHistoryResponse {
  return {
    market: "india",
    years: 5,
    cached: false,
    months: ["2026-01", "2026-02", "2026-03"],
    as_of: "2026-03-31",
    last_updated: "2026-04-01T09:00:00+05:30",
    source: "yfinance",
    disclaimer: "Past performance is not indicative of future results.",
    universe: ["Technology", "Banking"],
    series: [
      {
        name: "Technology",
        is_benchmark: false,
        monthly_returns: [2.1, -1.2, 3.4],
        ranks: [1, 3, 2],
      },
      {
        name: "Banking",
        is_benchmark: false,
        monthly_returns: [-0.5, 1.1, null],
        ranks: [2, 1, 3],
      },
      {
        name: "NIFTY 50",
        is_benchmark: true,
        monthly_returns: [0.8, 0.4, 1.2],
        ranks: [null, null, null],
      },
    ],
    risk: [
      {
        name: "Technology",
        max_drawdown: -18.4,
        current_drawdown: -2.1,
        recovery_days: 96,
        sharpe: 0.84,
        volatility: 21.3,
      },
      {
        name: "Banking",
        max_drawdown: -12.2,
        current_drawdown: 0,
        recovery_days: null,
        sharpe: null,
        volatility: null,
      },
    ],
    seasonality: [{ name: "Technology", month: 1, avg_return: 1.8, hit_rate: 66.7, n: 10 }],
    persistence: {
      by_sector: [
        {
          name: "Technology",
          top3_months: 24,
          top3_stayed: 15,
          top3_persistence_pct: 62.5,
          avg_next_rank: 3.4,
        },
      ],
      transition_matrix: [
        [0.6, 0.4],
        [0.2, 0.8],
      ],
    },
    ...overrides,
  };
}

function renderTab(market: "india" | "america" = "india") {
  return renderWithProviders(() => <SectorHistoryTab market={market} />);
}

function marketSelect() {
  return within(screen.getByTestId("sector-history-market")).getByRole("combobox");
}

function yearsSelect() {
  return within(screen.getByTestId("sector-history-years")).getByRole("combobox");
}

describe("SectorHistoryTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  test("shows the loading state while the first request is pending", () => {
    mockFetchSectorHistory.mockReturnValue(new Promise(() => {}));
    renderTab();

    expect(screen.getByText("Sector History")).toBeInTheDocument();
    expect(screen.getByTestId("sector-history-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("sector-history-empty")).not.toBeInTheDocument();
  });

  test("renders the header, charts, risk table and disclaimer on success", async () => {
    mockFetchSectorHistory.mockResolvedValue(response());
    renderTab();

    expect(await screen.findByTestId("sector-rank-heatmap")).toBeInTheDocument();
    expect(screen.getByTestId("seasonality-heatmap")).toBeInTheDocument();
    expect(screen.getByTestId("persistence-matrix")).toBeInTheDocument();
    expect(screen.getByTestId("rotation-timeline")).toBeInTheDocument();
    expect(screen.getByTestId("sector-history-risk-table")).toBeInTheDocument();
    expect(screen.getByTestId("sector-history-asof")).toHaveTextContent("As of 2026-03-31");
    expect(screen.getByTestId("sector-history-cached")).toHaveTextContent("LIVE");
    expect(screen.getByTestId("sector-history-disclaimer")).toHaveTextContent(
      "Past performance is not indicative of future results.",
    );

    const table = screen.getByTestId("sector-history-risk-table");
    expect(within(table).getByText("Technology")).toBeInTheDocument();
    expect(within(table).getByText("-18.4%")).toBeInTheDocument();
    expect(within(table).getByText("96d")).toBeInTheDocument();
    expect(within(table).getByText("0.84")).toBeInTheDocument();
    expect(within(table).getByText("0.0%")).toBeInTheDocument();
    expect(within(table).queryByText("+0.0%")).not.toBeInTheDocument();
    expect(within(table).getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  test("shows an error state and retries the request", async () => {
    mockFetchSectorHistory
      .mockRejectedValueOnce(new Error("history down"))
      .mockResolvedValue(response());

    renderTab();

    expect(await screen.findByTestId("sector-history-error")).toHaveTextContent("history down");
    fireEvent.click(screen.getByTestId("sector-history-retry"));

    expect(await screen.findByTestId("sector-rank-heatmap")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockFetchSectorHistory).toHaveBeenCalledTimes(2);
    });
  });

  test("market and years selects refetch with the new params", async () => {
    mockFetchSectorHistory.mockResolvedValue(response());
    renderTab();
    await screen.findByTestId("sector-rank-heatmap");

    fireEvent.input(marketSelect(), { target: { value: "america" } });

    await waitFor(() => {
      expect(mockFetchSectorHistory).toHaveBeenCalledWith(
        expect.objectContaining({ market: "america", years: 5 }),
      );
    });

    fireEvent.input(yearsSelect(), { target: { value: "10" } });

    await waitFor(() => {
      expect(mockFetchSectorHistory).toHaveBeenCalledWith(
        expect.objectContaining({ market: "america", years: 10 }),
      );
    });
  });

  test("follows the page market when it changes", async () => {
    mockFetchSectorHistory.mockResolvedValue(response());
    const [market, setMarket] = createSignal<"india" | "america">("india");
    renderWithProviders(() => <SectorHistoryTab market={market()} />);
    await screen.findByTestId("sector-rank-heatmap");

    setMarket("america");

    await waitFor(() => {
      expect(mockFetchSectorHistory).toHaveBeenCalledWith(
        expect.objectContaining({ market: "america" }),
      );
    });
  });

  test("shows the empty state when the response has no series", async () => {
    mockFetchSectorHistory.mockResolvedValue(
      response({ months: [], universe: [], series: [], risk: [], seasonality: [] }),
    );
    renderTab();

    expect(await screen.findByTestId("sector-history-empty")).toBeInTheDocument();
  });

  test("shows the empty state for a malformed empty payload without crashing", async () => {
    mockFetchSectorHistory.mockResolvedValue({});
    renderTab();

    expect(await screen.findByTestId("sector-history-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("sector-history-error")).not.toBeInTheDocument();
  });

  test("refresh reissues the request for the current selection", async () => {
    mockFetchSectorHistory.mockResolvedValue(response());
    renderTab();
    await screen.findByTestId("sector-rank-heatmap");
    expect(mockFetchSectorHistory).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("sector-history-refresh"));

    await waitFor(() => {
      expect(mockFetchSectorHistory).toHaveBeenCalledTimes(2);
    });
  });
});
