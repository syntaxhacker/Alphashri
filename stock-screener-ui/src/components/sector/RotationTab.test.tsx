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
    rows: [row],
    ...overrides,
  };
}

function renderTab() {
  return render(() => <RotationTab market="india" />, {
    wrapper: ({ children }) => <UIProvider>{children}</UIProvider>,
  });
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

    expect(await screen.findByTestId("rotation-board-table")).toBeInTheDocument();
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

  test("period switch re-sorts the board without refetching", async () => {
    renderTab();
    await screen.findByTestId("rotation-board-table");
    const toolbar = screen.getByTestId("rotation-toolbar");
    fireEvent.click(within(toolbar).getByText("3M"));

    expect(screen.getByText("sorted by 3M")).toBeInTheDocument();
    expect(mockFetchRotationOverview).toHaveBeenCalledTimes(1);
  });

  test("kind switch refetches themes and keeps the detail panel populated", async () => {
    mockFetchRotationOverview.mockResolvedValue(response({ kind: "theme" }));
    renderTab();
    await screen.findByTestId("rotation-board-table");

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

  test("shows an error state when the overview request fails", async () => {
    mockFetchRotationOverview.mockRejectedValue(new Error("rotation down"));
    renderTab();

    expect(await screen.findByTestId("rotation-error")).toHaveTextContent("rotation down");
    expect(screen.getByTestId("rotation-error")).toHaveTextContent("Rotation data unavailable");
  });
});
