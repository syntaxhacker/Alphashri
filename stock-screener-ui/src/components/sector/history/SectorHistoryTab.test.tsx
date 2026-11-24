// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import { CHART_POSITIVE } from "./visuals/chartPalette";
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
  PersistenceMatrix: (props: { transitionCount?: number }) => (
    <div data-testid="persistence-matrix" data-transition-count={String(props.transitionCount)} />
  ),
}));

vi.mock("./visuals/RotationTimeline", () => ({
  RotationTimeline: () => <div data-testid="rotation-timeline" />,
}));

vi.mock("./visuals/MiniSparkline", () => ({
  MiniSparkline: () => <span data-testid="mini-sparkline" />,
}));

vi.mock("./visuals/RankTransitionSankey", () => ({
  RankTransitionSankey: (props: { showHeader?: boolean }) => (
    <div data-testid="rank-transition-sankey" data-show-header={String(props.showHeader)} />
  ),
}));

vi.mock("./visuals/MonthlyMovers", () => ({
  MonthlyMovers: (props: { showHeader?: boolean }) => (
    <div data-testid="monthly-movers" data-show-header={String(props.showHeader)} />
  ),
}));

vi.mock("./visuals/UnderwaterDrawdown", () => ({
  UnderwaterDrawdown: (props: { sector: string; showHeader?: boolean }) => (
    <div
      data-testid="underwater-drawdown"
      data-sector={props.sector}
      data-show-header={String(props.showHeader)}
    />
  ),
}));

vi.mock("./visuals/SeasonalityRadial", () => ({
  SeasonalityRadial: (props: { sector: string; showHeader?: boolean }) => (
    <div
      data-testid="seasonality-radial"
      data-sector={props.sector}
      data-show-header={String(props.showHeader)}
    />
  ),
}));

vi.mock("./visuals/RelativeStrength", () => ({
  RelativeStrength: (props: { sector: string; showHeader?: boolean }) => (
    <div
      data-testid="relative-strength"
      data-sector={props.sector}
      data-show-header={String(props.showHeader)}
    />
  ),
}));

vi.mock("./visuals/RelativeStrengthTrail", () => ({
  RelativeStrengthTrail: (props: { sector: string; showHeader?: boolean }) => (
    <div
      data-testid="relative-strength-trail"
      data-sector={props.sector}
      data-show-header={String(props.showHeader)}
    />
  ),
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

function switchHistoryView(label: "Overview" | "Rotation Lab") {
  fireEvent.click(within(screen.getByTestId("sector-history-view-toggle")).getByText(label));
}

function panelTitle(testId: string) {
  return within(screen.getByTestId(testId)).getByTestId("history-panel-title");
}

function panelDescription(testId: string) {
  return within(screen.getByTestId(testId)).getByTestId("status");
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
    const loading = screen.getByTestId("sector-history-loading");
    expect(loading).toHaveTextContent("Loading sector history");
    expect(loading).toHaveTextContent(
      "Fetching monthly sector ranks, seasonality and risk metrics.",
    );
    expect(screen.queryByTestId("sector-history-empty")).not.toBeInTheDocument();
  });

  test("renders the header, charts, risk table and disclaimer on success", async () => {
    mockFetchSectorHistory.mockResolvedValue(response());
    renderTab();

    expect(await screen.findByTestId("sector-rank-heatmap")).toBeInTheDocument();
    expect(screen.getByTestId("seasonality-heatmap")).toBeInTheDocument();
    expect(screen.getByTestId("persistence-matrix")).toBeInTheDocument();
    expect(screen.getByTestId("persistence-matrix")).toHaveAttribute("data-transition-count", "4");
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
    expect(within(table).getByText("Cumulative return")).toBeInTheDocument();
    expect(screen.getByTestId("sector-history-risk-spark-Technology")).toHaveAttribute(
      "title",
      "Cumulative return +4.3%",
    );
    expect(screen.getByTestId("sector-history-risk-spark-Technology")).toHaveTextContent("+4.3%");
    const cumulative = screen.getByTestId("sector-history-risk-cumulative-Technology");
    expect(cumulative).toHaveStyle({ color: CHART_POSITIVE });
    expect(cumulative).not.toHaveClass("text-fin-positive");
  });

  test("renders one header and description for every panel", async () => {
    mockFetchSectorHistory.mockResolvedValue(response());
    renderTab();
    await screen.findByTestId("sector-rank-heatmap");

    const panels = [
      ["sector-history-rank-panel", "Sector Rank History", "2 sectors · monthly rank"],
      ["sector-history-seasonality-panel", "Seasonality", "avg return by calendar month"],
      ["sector-history-persistence-panel", "Persistence", "top-3 rank stickiness"],
      ["sector-history-rotation-panel", "Rotation Timeline", "rank trajectory over time"],
      ["sector-history-risk-panel", "Risk", "drawdown · Sharpe · volatility"],
    ];

    for (const [testId, title, description] of panels) {
      const panel = screen.getByTestId(testId);
      expect(within(panel).getByText(title)).toBeInTheDocument();
      expect(within(panel).getByText(description)).toBeInTheDocument();
      expect(within(panel).getByTestId("status")).toHaveClass("text-ui-micro");
    }
  });

  test("exposes labelled keyboard scroll regions with a hint for every chart", async () => {
    mockFetchSectorHistory.mockResolvedValue(response());
    renderTab();
    await screen.findByTestId("sector-rank-heatmap");

    const regions: Array<[string, RegExp]> = [
      ["sector-history-rank-scroll", /Sector rank history/],
      ["sector-history-seasonality-scroll", /Seasonality heatmap/],
      ["sector-history-persistence-scroll", /Rank persistence matrix/],
    ];

    for (const [testId, label] of regions) {
      const region = screen.getByTestId(testId);
      expect(region).toHaveAttribute("role", "region");
      expect(region).toHaveAttribute("tabindex", "0");
      expect(region.getAttribute("aria-label")).toMatch(label);
      const hint = screen.getByTestId(`${testId}-hint`);
      expect(hint).toHaveTextContent("Scroll →");
      expect(hint).not.toHaveClass("sm:hidden");
      expect(region).not.toContainElement(hint);
    }
  });

  test("pins the risk sector column and exposes the table scrollport as a region", async () => {
    mockFetchSectorHistory.mockResolvedValue(response());
    renderTab();
    await screen.findByTestId("sector-history-risk-table");

    const panel = screen.getByTestId("sector-history-risk-panel");
    const scroller = panel.querySelector<HTMLElement>(".paper-tanstack-scroll")!;
    expect(scroller).not.toBeNull();
    await waitFor(() => {
      expect(scroller).toHaveAttribute("role", "region");
    });
    expect(scroller).toHaveAttribute("tabindex", "0");
    expect(scroller).toHaveAttribute(
      "aria-label",
      "Sector history risk metrics, scroll sideways for all columns",
    );
    const hint = within(panel).getByTestId("sector-history-risk-scroll-hint");
    expect(hint).toHaveTextContent("Scroll →");
    expect(hint).not.toHaveClass("sm:hidden");
    expect(scroller).not.toContainElement(hint);
    const sticky = within(panel).getByTestId("sector-history-risk-sticky-style");
    expect(sticky.textContent).toContain("td:first-child");
    expect(sticky.textContent).toContain("position: sticky");
    expect(sticky.textContent).toContain("height: 20px");
    expect(sticky.textContent).toContain("padding-top: 1px");
    const table = screen.getByTestId("sector-history-risk-table");
    expect(table.style.getPropertyValue("--tbl-row-h")).toBe("18px");
    expect(table.style.getPropertyValue("--tbl-cell-pad")).toBe("1px 6px");
    const spark = screen.getByTestId("sector-history-risk-spark-Technology");
    expect(spark).toHaveClass("flex");
    expect(spark).not.toHaveClass("inline-flex");
  });

  test("Rotation Lab shows all six advanced panels", async () => {
    mockFetchSectorHistory.mockResolvedValue(response());
    renderTab();
    await screen.findByTestId("sector-rank-heatmap");

    switchHistoryView("Rotation Lab");

    const titles: Array<[string, string]> = [
      ["sector-history-lab-sankey-panel", "Rank transitions"],
      ["sector-history-lab-movers-panel", "Monthly movers"],
      ["sector-history-lab-drawdown-panel", "Monthly drawdown · Technology"],
      ["sector-history-lab-seasonality-panel", "Seasonality · Technology"],
      ["sector-history-lab-rs-panel", "Relative strength · Technology vs NIFTY 50"],
      ["sector-history-lab-trail-panel", "RS momentum trail · Technology"],
    ];
    for (const [testId, title] of titles) {
      expect(panelTitle(testId)).toHaveTextContent(title);
    }

    const descriptions: Array<[string, string]> = [
      [
        "sector-history-lab-sankey-panel",
        "where sectors move by rank band · monthly counts · n=4 monthly transitions · 5Y",
      ],
      ["sector-history-lab-movers-panel", "rank change over the latest month"],
      ["sector-history-lab-drawdown-panel", "monthly closes · risk table uses daily closes"],
      [
        "sector-history-lab-seasonality-panel",
        "avg return by month · hit rate in tooltip · n=10 per month",
      ],
      [
        "sector-history-lab-rs-panel",
        "indexed to 100 at first common month · above 100 = outperform · below 100 = lag",
      ],
      [
        "sector-history-lab-trail-panel",
        "last 12 months · descriptive, not JdK RRG · RS > 100 = outperform · momentum > 0 = improving",
      ],
    ];
    for (const [testId, description] of descriptions) {
      expect(panelDescription(testId)).toHaveTextContent(description);
    }

    for (const testId of [
      "rank-transition-sankey",
      "monthly-movers",
      "underwater-drawdown",
      "seasonality-radial",
      "relative-strength",
      "relative-strength-trail",
    ]) {
      const visual = screen.getByTestId(testId);
      expect(visual).toBeInTheDocument();
      expect(visual).toHaveAttribute("data-show-header", "false");
    }
  });

  test("Seasonality description derives the observation range per month", async () => {
    mockFetchSectorHistory.mockResolvedValue(
      response({
        seasonality: [
          { name: "Technology", month: 1, avg_return: 1.8, hit_rate: 66.7, n: 4 },
          { name: "Technology", month: 2, avg_return: 2.1, hit_rate: 54.2, n: 5 },
        ],
      }),
    );
    renderTab();
    await screen.findByTestId("sector-rank-heatmap");
    switchHistoryView("Rotation Lab");

    expect(panelDescription("sector-history-lab-seasonality-panel")).toHaveTextContent(
      "avg return by month · hit rate in tooltip · n=4–5 per month",
    );
  });

  test("Rank transitions description tracks the lookback and transition count", async () => {
    mockFetchSectorHistory.mockResolvedValue(response());
    renderTab();
    await screen.findByTestId("sector-rank-heatmap");
    switchHistoryView("Rotation Lab");

    expect(panelDescription("sector-history-lab-sankey-panel")).toHaveTextContent(
      "n=4 monthly transitions · 5Y",
    );

    fireEvent.input(yearsSelect(), { target: { value: "10" } });

    await waitFor(() => {
      expect(panelDescription("sector-history-lab-sankey-panel")).toHaveTextContent(
        "n=4 monthly transitions · 10Y",
      );
    });
  });

  test("Rank transitions description hides the count without a month pair", async () => {
    const base = response();
    const shortSeries = base.series.map((item) => ({
      ...item,
      monthly_returns: item.monthly_returns.slice(0, 1),
      ranks: item.ranks.slice(0, 1),
    }));
    mockFetchSectorHistory.mockResolvedValue(
      response({ months: ["2026-01"], series: shortSeries }),
    );
    renderTab();
    await screen.findByTestId("sector-rank-heatmap");
    switchHistoryView("Rotation Lab");

    const description = panelDescription("sector-history-lab-sankey-panel");
    expect(description).toHaveTextContent("where sectors move by rank band · monthly counts · 5Y");
    expect(description).not.toHaveTextContent("n=");
  });

  test("lab sector selector updates the sector-specific panel titles", async () => {
    mockFetchSectorHistory.mockResolvedValue(response());
    renderTab();
    await screen.findByTestId("sector-rank-heatmap");

    switchHistoryView("Rotation Lab");
    const select = within(screen.getByTestId("sector-history-lab-sector")).getByRole("combobox");
    fireEvent.input(select, { target: { value: "Banking" } });

    await waitFor(() => {
      expect(panelTitle("sector-history-lab-drawdown-panel")).toHaveTextContent(
        "Monthly drawdown · Banking",
      );
    });
    expect(panelTitle("sector-history-lab-seasonality-panel")).toHaveTextContent(
      "Seasonality · Banking",
    );
    expect(panelTitle("sector-history-lab-rs-panel")).toHaveTextContent(
      "Relative strength · Banking vs NIFTY 50",
    );
    expect(panelTitle("sector-history-lab-trail-panel")).toHaveTextContent(
      "RS momentum trail · Banking",
    );
    expect(panelDescription("sector-history-lab-seasonality-panel")).toHaveTextContent(
      "avg return by month · hit rate in tooltip",
    );
    expect(panelDescription("sector-history-lab-seasonality-panel")).not.toHaveTextContent("n=");
    expect(screen.getByTestId("underwater-drawdown")).toHaveAttribute("data-sector", "Banking");
    expect(screen.getByTestId("relative-strength")).toHaveAttribute("data-sector", "Banking");
    expect(screen.getByTestId("relative-strength-trail")).toHaveAttribute("data-sector", "Banking");
  });

  test("lab resets the sector to the latest leader when the market changes", async () => {
    mockFetchSectorHistory.mockResolvedValueOnce(response()).mockResolvedValueOnce(
      response({
        market: "america",
        series: [
          {
            name: "Technology",
            is_benchmark: false,
            monthly_returns: [1, 1, 1],
            ranks: [2, 2, 2],
          },
          {
            name: "Banking",
            is_benchmark: false,
            monthly_returns: [1, 1, 1],
            ranks: [1, 1, 1],
          },
          {
            name: "S&P 500",
            is_benchmark: true,
            monthly_returns: [1, 1, 1],
            ranks: [null, null, null],
          },
        ],
      }),
    );

    renderTab();
    await screen.findByTestId("sector-rank-heatmap");
    switchHistoryView("Rotation Lab");
    expect(panelTitle("sector-history-lab-drawdown-panel")).toHaveTextContent(
      "Monthly drawdown · Technology",
    );

    fireEvent.input(marketSelect(), { target: { value: "america" } });

    await waitFor(() => {
      expect(panelTitle("sector-history-lab-drawdown-panel")).toHaveTextContent(
        "Monthly drawdown · Banking",
      );
    });
  });

  test("Rotation Lab keeps the empty state for a malformed payload", async () => {
    mockFetchSectorHistory.mockResolvedValue({});
    renderTab();
    await screen.findByTestId("sector-history-empty");

    switchHistoryView("Rotation Lab");

    expect(screen.getByTestId("sector-history-empty")).toBeInTheDocument();
    expect(screen.queryByText("Rank transitions")).not.toBeInTheDocument();
  });

  test("switching back to Overview restores the five original panels", async () => {
    mockFetchSectorHistory.mockResolvedValue(response());
    renderTab();
    await screen.findByTestId("sector-rank-heatmap");

    switchHistoryView("Rotation Lab");
    switchHistoryView("Overview");

    for (const testId of [
      "sector-history-rank-panel",
      "sector-history-seasonality-panel",
      "sector-history-persistence-panel",
      "sector-history-rotation-panel",
      "sector-history-risk-panel",
    ]) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
    expect(screen.queryByText("Rank transitions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rank-transition-sankey")).not.toBeInTheDocument();
  });

  test("maps a raw unavailable code to human copy and retries", async () => {
    mockFetchSectorHistory
      .mockRejectedValueOnce(new Error("sector_history_unavailable"))
      .mockResolvedValue(response());

    renderTab();

    const error = await screen.findByTestId("sector-history-error");
    expect(error).toHaveTextContent("Sector history is temporarily unavailable. Try again.");
    expect(within(error).getByTestId("sector-history-error-code")).toHaveTextContent(
      "sector_history_unavailable",
    );
    expect(within(error).getByTestId("sector-history-retry")).toBeInTheDocument();

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

    const empty = await screen.findByTestId("sector-history-empty");
    expect(empty).toHaveTextContent("No sector history");
    expect(empty).toHaveTextContent("No history is available for India over 5Y.");
    expect(within(empty).getByTestId("sector-history-empty-refresh")).toBeInTheDocument();
  });

  test("maps a generic fetch failure to the same human copy", async () => {
    mockFetchSectorHistory.mockRejectedValueOnce(new Error("Failed to fetch sector history"));
    renderTab();

    const error = await screen.findByTestId("sector-history-error");
    expect(error).toHaveTextContent("Sector history is temporarily unavailable. Try again.");
  });

  test("empty state refresh reissues the request", async () => {
    mockFetchSectorHistory
      .mockResolvedValueOnce(
        response({ months: [], universe: [], series: [], risk: [], seasonality: [] }),
      )
      .mockResolvedValue(response());

    renderTab();

    const empty = await screen.findByTestId("sector-history-empty");
    fireEvent.click(within(empty).getByTestId("sector-history-empty-refresh"));

    expect(await screen.findByTestId("sector-rank-heatmap")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockFetchSectorHistory).toHaveBeenCalledTimes(2);
    });
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
