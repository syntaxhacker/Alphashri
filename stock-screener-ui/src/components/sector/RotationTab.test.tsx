// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor, within, fireEvent } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import type { RotationOverviewResponse, RotationRow } from "../../types/rotation";
import { RotationTab } from "./RotationTab";

const { mockFetchRotationOverview, mockFetchThemeDetail } = vi.hoisted(() => ({
  mockFetchRotationOverview: vi.fn(),
  mockFetchThemeDetail: vi.fn(),
}));

vi.mock("../../api/rotation", () => ({
  fetchRotationOverview: (...args: unknown[]) => mockFetchRotationOverview(...args),
  fetchThemeDetail: (...args: unknown[]) => mockFetchThemeDetail(...args),
}));

const returns = {
  "1D": 1.2,
  "1W": 3.8,
  "1M": 8.8,
  "3M": 14.2,
  "6M": 19.1,
  YTD: 24.8,
  "1Y": 30.2,
};

const row: RotationRow = {
  id: "sector:technology",
  name: "Technology",
  kind: "sector",
  category: "Technology",
  members: 88,
  covered: 88,
  returns,
  rs_1m: 9.1,
  rs_1w: 3.2,
  rs_pct: 82,
  mom_pct: 74,
  rank: 1,
  rank_delta: 4,
  breadth: 72,
  rel_volume: 1.8,
  quadrant: "leading",
  status: "booming",
  top_movers: [
    { symbol: "TCS", change: 2.4 },
    { symbol: "INFY", change: 1.8 },
  ],
};

const financialsRow: RotationRow = {
  ...row,
  id: "sector:financials",
  name: "Financials",
  category: "Financials",
  returns: {
    "1D": -0.4,
    "1W": -1.2,
    "1M": 2.1,
    "3M": 9.4,
    "6M": 11,
    YTD: 15.2,
    "1Y": 18,
  },
  rs_1m: 2.4,
  rs_1w: -0.8,
  rs_pct: 64,
  mom_pct: 58,
  rank: 2,
  rank_delta: -3,
  breadth: 48,
  rel_volume: 0.9,
  quadrant: "improving",
  status: "heating",
  top_movers: [{ symbol: "HDFCBANK", change: 1.1 }],
};

const energyRow: RotationRow = {
  ...row,
  id: "sector:energy",
  name: "Energy",
  category: "Energy",
  returns: {
    "1D": 0.6,
    "1W": 2.2,
    "1M": 12.4,
    "3M": 6.4,
    "6M": 8.1,
    YTD: 10.3,
    "1Y": 12.6,
  },
  rs_1m: 4.2,
  rs_1w: 1.4,
  rs_pct: 71,
  mom_pct: 61,
  rank: 3,
  rank_delta: 0,
  breadth: 58,
  rel_volume: 1.1,
  quadrant: "weakening",
  status: "cooling",
  top_movers: [],
};

const rows = [row, financialsRow, energyRow];

const flatRow: RotationRow = {
  ...row,
  id: "sector:flat",
  name: "Flat",
  category: "Flat",
  returns: {
    "1D": 0,
    "1W": 0,
    "1M": 0,
    "3M": 0,
    "6M": 0,
    YTD: 0,
    "1Y": 0,
  },
  rs_1m: 0,
  rs_1w: 0,
  rs_pct: 50,
  mom_pct: 50,
  rank: 1,
  rank_delta: 0,
  breadth: 50,
  rel_volume: 1,
  quadrant: "leading",
  status: "neutral",
  top_movers: [],
};

function response(overrides: Partial<RotationOverviewResponse> = {}): RotationOverviewResponse {
  return {
    market: "india",
    kind: "sector",
    period: "1M",
    benchmark: "NIFTY 50",
    last_updated: "2026-10-26T10:00:00+05:30",
    regime: {
      benchmark: "NIFTY 50",
      benchmark_change: -0.39,
      benchmark_1m: -3.22,
      vix: 16.86,
      vix_change: 6.96,
      breadth: 10.8,
      label: "RISK-OFF",
    },
    counts: { booming: 1, heating: 2, cooling: 1, dumping: 1, neutral: 0 },
    rows,
    ...overrides,
  };
}

function renderTab() {
  return render(() => <RotationTab market="india" />, {
    wrapper: ({ children }) => <UIProvider>{children}</UIProvider>,
  });
}

function boardRowTestIds(): (string | null)[] {
  const board = screen.getByTestId("rotation-board");
  return within(board)
    .getAllByRole("button")
    .map((element) => element.getAttribute("data-testid"));
}

describe("RotationTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/sector?tab=rotation");
    mockFetchRotationOverview.mockResolvedValue(response());
  });

  afterEach(() => {
    cleanup();
  });

  test("renders the rotation screen, board, matrix and selected detail", async () => {
    renderTab();

    expect(await screen.findByTestId("rotation-board")).toBeInTheDocument();
    expect(screen.getByTestId("rotation-rrg")).toBeInTheDocument();
    expect(screen.getByTestId("rotation-matrix")).toBeInTheDocument();
    expect(screen.getByTestId("rotation-detail")).toHaveTextContent("Technology");
    expect(screen.getByTestId("rotation-detail")).toHaveTextContent("+8.80%");
    expect(screen.getByTestId("rotation-detail")).toHaveTextContent("TCS");
    expect(screen.getByTestId("rotation-row-sector:technology")).toBeInTheDocument();
    expect(screen.getByTestId("rotation-matrix-row-sector:technology")).toBeInTheDocument();
    expect(screen.getByText("RISK-OFF")).toBeInTheDocument();
    expect(screen.getAllByText("72%").length).toBeGreaterThanOrEqual(1);
  });

  test("replaces both TanStack tables with direct-labeled DOM visuals", async () => {
    renderTab();
    await screen.findByTestId("rotation-board");

    for (const panelId of ["rotation-matrix-panel", "rotation-board-panel"]) {
      const panel = screen.getByTestId(panelId);
      expect(panel.querySelector("table")).toBeNull();
      expect(panel.querySelector('[role="table"]')).toBeNull();
      expect(panel.querySelector('[role="row"]')).toBeNull();
      expect(panel.querySelector("th, td")).toBeNull();
    }
    expect(screen.queryByTestId("rotation-matrix-table")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rotation-board-table")).not.toBeInTheDocument();
  });

  test("period switch re-sorts the board by the selected period without refetching", async () => {
    renderTab();
    await screen.findByTestId("rotation-board");

    expect(boardRowTestIds()).toEqual([
      "rotation-row-sector:energy",
      "rotation-row-sector:technology",
      "rotation-row-sector:financials",
    ]);

    const toolbar = screen.getByTestId("rotation-toolbar");
    fireEvent.click(within(toolbar).getByText("3M"));

    expect(screen.getByText("sorted by 3M")).toBeInTheDocument();
    expect(screen.getByTestId("rotation-board")).toHaveAttribute("data-period", "3M");
    expect(boardRowTestIds()).toEqual([
      "rotation-row-sector:technology",
      "rotation-row-sector:financials",
      "rotation-row-sector:energy",
    ]);
    expect(mockFetchRotationOverview).toHaveBeenCalledTimes(1);
  });

  test("matrix rows sort by 1M and select the matching group", async () => {
    renderTab();
    await screen.findByTestId("rotation-matrix");

    const matrix = screen.getByTestId("rotation-matrix");
    const matrixOrder = within(matrix)
      .getAllByRole("button")
      .map((element) => element.getAttribute("data-testid"));
    expect(matrixOrder).toEqual([
      "rotation-matrix-row-sector:energy",
      "rotation-matrix-row-sector:technology",
      "rotation-matrix-row-sector:financials",
    ]);

    fireEvent.click(screen.getByTestId("rotation-matrix-row-sector:financials"));
    expect(screen.getByTestId("rotation-detail")).toHaveTextContent("Financials");
    expect(mockFetchRotationOverview).toHaveBeenCalledTimes(1);
  });

  test("keeps the 390 layout single-column and free of a fixed matrix width", async () => {
    renderTab();
    await screen.findByTestId("rotation-matrix");

    const grid = screen.getByTestId("rotation-grid");
    expect(grid).toHaveClass("grid-cols-[minmax(0,1fr)]");
    expect(grid).toHaveClass("overflow-x-hidden");

    const matrix = screen.getByTestId("rotation-matrix");
    expect(matrix).toHaveClass("min-w-0");
    expect(matrix).toHaveClass("overflow-hidden");
    expect(matrix.getAttribute("style") ?? "").not.toMatch(/min-width/i);

    const board = screen.getByTestId("rotation-board");
    expect(board).toHaveClass("min-w-0");
    expect(board).toHaveClass("overflow-hidden");
  });

  test("detail period returns carry units and render zero neutrally", async () => {
    mockFetchRotationOverview.mockResolvedValue(response({ rows: [flatRow] }));
    renderTab();
    await screen.findByTestId("rotation-detail");

    const detail = screen.getByTestId("rotation-detail");
    expect(detail).toHaveTextContent("0.00%");
    expect(detail).not.toHaveTextContent("+0.00%");
    expect(detail).not.toHaveTextContent("+0.0%");

    for (const period of ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y"]) {
      const value = screen.getByTestId(`rotation-detail-return-${period}`);
      expect(value).toHaveTextContent("0.0%");
      expect(value).toHaveAttribute("data-zero", "true");
      expect(screen.getByTestId(`rotation-detail-bar-${period}`)).toHaveAttribute(
        "data-zero",
        "true",
      );
    }
  });

  test("kind switch refetches themes and keeps the detail panel populated", async () => {
    mockFetchRotationOverview.mockResolvedValue(response({ kind: "theme" }));
    renderTab();
    await screen.findByTestId("rotation-board");

    const toolbar = screen.getByTestId("rotation-toolbar");
    fireEvent.click(within(toolbar).getByText("Themes"));

    await waitFor(() => {
      expect(mockFetchRotationOverview).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "theme" }),
      );
    });
    // The refetch only commits once its promise resolves — wait for the DOM
    await waitFor(() => expect(screen.getByTestId("rotation-detail")).toHaveTextContent("Technology"));
  });

  test("wraps controls and gives the RRG panel a real mobile height without a fixed inline height", async () => {
    renderTab();
    await screen.findByTestId("rotation-board");

    const toolbar = screen.getByTestId("rotation-toolbar");
    expect(toolbar).toHaveClass("flex-wrap");
    expect(toolbar.className).not.toMatch(/\boverflow-hidden\b/);
    expect(screen.getByTestId("rotation-regime")).toHaveClass("flex-wrap");

    const rrgBody = screen.getByTestId("rotation-rrg-body");
    expect(rrgBody).toHaveClass("min-h-[300px]");
    expect(rrgBody).toHaveClass("lg:min-h-0");
    const rrgPanel = screen.getByTestId("rotation-rrg-panel");
    expect(rrgPanel.getAttribute("style") ?? "").not.toContain("min-height: 300px");
  });

  test("shows an error state when the overview request fails", async () => {
    mockFetchRotationOverview.mockRejectedValue(new Error("rotation down"));
    renderTab();

    expect(await screen.findByTestId("rotation-error")).toHaveTextContent("rotation down");
    expect(screen.getByTestId("rotation-error")).toHaveTextContent("Rotation data unavailable");
  });

  test("keeps the tab root bounded with the panel grid as the mobile scroll owner", async () => {
    renderTab();
    await screen.findByTestId("rotation-board");

    const root = screen.getByTestId("rotation-tab");
    // h-full lets the desktop SectionShell (lg:h-[900px]) size the 2x2 grid;
    // below lg the percentage resolves against an auto-height parent and the
    // panel column grows with the page.
    for (const cls of ["h-full", "min-h-0", "flex-col", "overflow-hidden"]) {
      expect(root).toHaveClass(cls);
    }

    const grid = screen.getByTestId("rotation-grid");
    expect(grid).toHaveClass("flex-1");
    expect(grid).toHaveClass("min-h-0");
    // Below lg the four stacked panels scroll as one column; at lg each panel owns its body.
    expect(grid).toHaveClass("overflow-y-auto");
    expect(grid).toHaveClass("lg:overflow-hidden");
  });
});
