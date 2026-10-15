// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import type { ReactElement } from "react";
import type { ScreenerDashboardResponse, ScreenerDashboardRow } from "../../types/screenerDashboard";

const mockFetchScreenerDashboard = vi.fn();

vi.mock("../../api/screenerDashboard", () => ({
  fetchScreenerDashboard: (...args: unknown[]) => mockFetchScreenerDashboard(...args),
}));

import { DashboardView } from "./DashboardView";

const renderWithProvider = (ui: ReactElement) => render(<UIProvider>{ui}</UIProvider>);

function row(overrides: Partial<ScreenerDashboardRow> = {}): ScreenerDashboardRow {
  return {
    symbol: "INDIAGLYCO",
    name: "India Glycols",
    close: 382.7,
    change: 19.99,
    logo: "https://s3-symbol-logo.tradingview.com/xxx.svg",
    sub_label: "Vol vs avg",
    sub_value: "8.4x avg",
    spark: [0.1, 0.3, 0.6, 0.9],
    ...overrides,
  };
}

function payload(): ScreenerDashboardResponse {
  return {
    universe: "nifty500",
    as_of: "2026-10-07T10:00:00+05:30",
    total: 500,
    sections: [
      {
        id: "movers",
        title: "Market Movers",
        panels: [
          {
            id: "gainers",
            title: "Top gainers",
            metric_label: "Stocks · Volume",
            qualify: 204,
            rows: [
              row(),
              row({
                symbol: "RELIANCE",
                name: "Reliance",
                close: 2990.1,
                change: -1.25,
                logo: null,
                sub_label: "Vol vs avg",
                sub_value: "1.2x avg",
                spark: [0.9, 0.7, 0.5, 0.2],
              }),
            ],
          },
          {
            id: "most_active",
            title: "Most active",
            metric_label: "Volume",
            qualify: 88,
            rows: [row({ symbol: "TATAMOTORS", change: 2.5, sub_label: "5.1x avg" })],
          },
        ],
      },
      {
        id: "unusual",
        title: "Unusual Activity",
        panels: [
          {
            id: "volume_surge",
            title: "Volume surge",
            metric_label: "Vol vs avg",
            qualify: 37,
            rows: [row({ symbol: "INFY", change: 0.75, sub_label: "6.2x avg", spark: [] })],
          },
        ],
      },
    ],
  };
}

describe("DashboardView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchScreenerDashboard.mockResolvedValue(payload());
  });

  afterEach(() => {
    cleanup();
  });

  it("fetches on mount with the universe and renders sections and panels", async () => {
    renderWithProvider(<DashboardView universe="nifty500" />);
    await waitFor(() => {
      expect(mockFetchScreenerDashboard).toHaveBeenCalledWith(
        "nifty500",
        expect.anything(),
      );
    });
    expect(await screen.findByTestId("dashboard-section-movers")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-section-unusual")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-card-gainers")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-card-most_active")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-card-volume_surge")).toBeInTheDocument();
    expect(screen.getByText("Market Movers")).toBeInTheDocument();
    expect(screen.getByText("Unusual Activity")).toBeInTheDocument();
  });

  it("renders rows with symbol, LTP, change, sub-metric and sparkline", async () => {
    renderWithProvider(<DashboardView universe="nifty500" />);
    const rowEl = await screen.findByTestId("dashboard-row-gainers-INDIAGLYCO");
    expect(rowEl).toHaveTextContent("INDIAGLYCO");
    expect(rowEl).toHaveTextContent("₹382.70");
    expect(rowEl).toHaveTextContent("+19.99%");
    expect(rowEl).toHaveTextContent("8.4x avg");
    const spark = rowEl.querySelector('[data-testid="sparkline"]');
    expect(spark).not.toBeNull();
    expect(spark).toHaveAttribute("data-positive", "true");
    // negative row is red
    const negRow = screen.getByTestId("dashboard-row-gainers-RELIANCE");
    expect(negRow).toHaveTextContent("-1.25%");
    expect(negRow.querySelector('[data-testid="sparkline"]')).toHaveAttribute(
      "data-positive",
      "false",
    );
    // footer qualify text
    expect(screen.getByTestId("dashboard-card-gainers")).toHaveTextContent(
      "2 of 204 stocks qualify",
    );
  });

  it("renders a flat sparkline when spark is empty", async () => {
    renderWithProvider(<DashboardView universe="nifty500" />);
    const rowEl = await screen.findByTestId("dashboard-row-volume_surge-INFY");
    const spark = rowEl.querySelector('[data-testid="sparkline"]');
    expect(spark).not.toBeNull();
    expect(spark).toHaveAttribute("data-points", "0");
  });

  it("calls onOpenSymbol when a row is clicked", async () => {
    const user = userEvent.setup();
    const onOpenSymbol = vi.fn();
    renderWithProvider(<DashboardView universe="nifty500" onOpenSymbol={onOpenSymbol} />);
    const rowEl = await screen.findByTestId("dashboard-row-gainers-INDIAGLYCO");
    await user.click(rowEl);
    expect(onOpenSymbol).toHaveBeenCalledWith("INDIAGLYCO");
  });

  it("calls onOpenScan with the panel id when Open scan is clicked", async () => {
    const user = userEvent.setup();
    const onOpenScan = vi.fn();
    renderWithProvider(<DashboardView universe="nifty500" onOpenScan={onOpenScan} />);
    await screen.findByTestId("dashboard-card-gainers");
    await user.click(screen.getByTestId("dashboard-open-scan-gainers"));
    expect(onOpenScan).toHaveBeenCalledWith("gainers");
    await user.click(screen.getByTestId("dashboard-open-scan-volume_surge"));
    expect(onOpenScan).toHaveBeenCalledWith("volume_surge");
  });

  it("re-fetches when the universe changes", async () => {
    const { rerender } = renderWithProvider(<DashboardView universe="nifty500" />);
    await screen.findByTestId("dashboard-card-gainers");
    expect(mockFetchScreenerDashboard).toHaveBeenCalledTimes(1);
    rerender(
      <UIProvider>
        <DashboardView universe="nifty200" />
      </UIProvider>,
    );
    await waitFor(() => {
      expect(mockFetchScreenerDashboard).toHaveBeenCalledWith(
        "nifty200",
        expect.anything(),
      );
    });
    expect(mockFetchScreenerDashboard).toHaveBeenCalledTimes(2);
  });

  it("re-fetches when Refresh is clicked", async () => {
    const user = userEvent.setup();
    renderWithProvider(<DashboardView universe="nifty500" />);
    await screen.findByTestId("dashboard-card-gainers");
    expect(mockFetchScreenerDashboard).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId("dashboard-refresh"));
    await waitFor(() => {
      expect(mockFetchScreenerDashboard).toHaveBeenCalledTimes(2);
    });
  });

  it("shows a loading state", () => {
    mockFetchScreenerDashboard.mockReturnValue(new Promise(() => {}));
    renderWithProvider(<DashboardView universe="nifty500" />);
    expect(screen.getByTestId("dashboard-loading")).toBeInTheDocument();
  });

  it("shows an error state", async () => {
    mockFetchScreenerDashboard.mockRejectedValue(new Error("boom"));
    renderWithProvider(<DashboardView universe="nifty500" />);
    await waitFor(() => {
      expect(screen.getByTestId("dashboard-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("dashboard-error")).toHaveTextContent("boom");
    // error path still offers refresh
    expect(screen.getByTestId("dashboard-refresh")).toBeInTheDocument();
  });

  it("shows an empty state when there are no sections", async () => {
    mockFetchScreenerDashboard.mockResolvedValue({ ...payload(), sections: [] });
    renderWithProvider(<DashboardView universe="nifty500" />);
    await waitFor(() => {
      expect(screen.getByTestId("dashboard-empty")).toBeInTheDocument();
    });
  });

  it("does not crash on row interaction without handlers", async () => {
    renderWithProvider(<DashboardView universe="nifty500" />);
    const rowEl = await screen.findByTestId("dashboard-row-gainers-INDIAGLYCO");
    fireEvent.click(rowEl);
    expect(rowEl).toBeInTheDocument();
  });
});

describe("DashboardView round-2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockFetchScreenerDashboard.mockResolvedValue(payload());
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  function richRow(overrides: Partial<ScreenerDashboardRow> = {}): ScreenerDashboardRow {
    return {
      ...row(),
      rsi: 62.4,
      vwap: 375.5,
      atr: 8.25,
      price_52_week_high: 410.0,
      market_cap: 1200,
      rel_volume: 8.4,
      volume: 1500000,
      value: 575000000,
      ...overrides,
    };
  }

  function twoSidedPayload(): ScreenerDashboardResponse {
    const base = payload();
    return {
      ...base,
      sections: [
        {
          id: "movers",
          title: "Market Movers",
          panels: [
            {
              id: "gainers",
              title: "Top gainers",
              metric_label: "Change %",
              qualify: 120,
              rows: [richRow({ symbol: "GAIN1", change: 9.5 })],
            },
            {
              id: "losers",
              title: "Top losers",
              metric_label: "Change %",
              qualify: 80,
              rows: [richRow({ symbol: "LOSE1", change: -7.25 })],
            },
            {
              id: "near_52w_high",
              title: "Near 52W high",
              metric_label: "Off high",
              qualify: 40,
              rows: [richRow({ symbol: "HIGH1", change: 1.1 })],
            },
            {
              id: "near_52w_low",
              title: "Near 52W low",
              metric_label: "Off low",
              qualify: 33,
              rows: [richRow({ symbol: "LOW1", change: -0.9 })],
            },
          ],
        },
      ],
    };
  }

  it("merges gainers+losers into one card with a segmented toggle", async () => {
    const user = userEvent.setup();
    mockFetchScreenerDashboard.mockResolvedValue(twoSidedPayload());
    renderWithProvider(<DashboardView universe="nifty500" />);
    expect(await screen.findByTestId("dashboard-card-gainers_losers")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-card-losers")).not.toBeInTheDocument();
    expect(screen.getByTestId("dashboard-toggle-gainers_losers")).toBeInTheDocument();
    // gainers shown by default
    expect(screen.getByTestId("dashboard-row-gainers-GAIN1")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-row-losers-LOSE1")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Losers" }));
    expect(screen.getByTestId("dashboard-row-losers-LOSE1")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-row-gainers-GAIN1")).not.toBeInTheDocument();
  });

  it("renders a lone gainers panel with no toggle", async () => {
    renderWithProvider(<DashboardView universe="nifty500" />);
    expect(await screen.findByTestId("dashboard-card-gainers")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-toggle-gainers_losers")).not.toBeInTheDocument();
  });

  it("merges 52w high+low into one card with a toggle", async () => {
    const user = userEvent.setup();
    mockFetchScreenerDashboard.mockResolvedValue(twoSidedPayload());
    renderWithProvider(<DashboardView universe="nifty500" />);
    expect(await screen.findByTestId("dashboard-card-near_52w_high_low")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-row-near_52w_high-HIGH1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "52W low" }));
    expect(screen.getByTestId("dashboard-row-near_52w_low-LOW1")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-row-near_52w_high-HIGH1")).not.toBeInTheDocument();
  });

  it("show more refetches with a larger limit and toggles to show less", async () => {
    const user = userEvent.setup();
    renderWithProvider(<DashboardView universe="nifty500" />);
    const more = await screen.findByTestId("dashboard-show-more-gainers");
    expect(more).toHaveTextContent("Show more");
    await user.click(more);
    await waitFor(() => {
      expect(mockFetchScreenerDashboard).toHaveBeenLastCalledWith(
        "nifty500",
        expect.anything(),
        expect.objectContaining({ limit: 30 }),
      );
    });
    expect(screen.getByTestId("dashboard-show-more-gainers")).toHaveTextContent("Show less");
    await user.click(screen.getByTestId("dashboard-show-more-gainers"));
    await waitFor(() => {
      expect(mockFetchScreenerDashboard).toHaveBeenLastCalledWith(
        "nifty500",
        expect.anything(),
      );
    });
  });

  it("sort menu reorders rows client-side", async () => {
    const user = userEvent.setup();
    const base = payload();
    mockFetchScreenerDashboard.mockResolvedValue({
      ...base,
      sections: [
        {
          id: "movers",
          title: "Market Movers",
          panels: [
            {
              id: "gainers",
              title: "Top gainers",
              metric_label: "Change %",
              qualify: 2,
              rows: [
                row({ symbol: "AAA", change: 1.0, volume: 10 }),
                row({ symbol: "BBB", change: 5.0, volume: 5 }),
              ],
            },
          ],
        },
      ],
    });
    renderWithProvider(<DashboardView universe="nifty500" />);
    await screen.findByTestId("dashboard-card-gainers");
    const rowsBox = screen.getByTestId("dashboard-card-rows-gainers");
    const symbols = () =>
      Array.from(rowsBox.querySelectorAll("[data-symbol]")).map((el) =>
        el.getAttribute("data-symbol"),
      );
    expect(symbols()[0]).toBe("AAA");
    await user.click(screen.getByTestId("dashboard-sort-gainers"));
    await user.click(await screen.findByTestId("dashboard-sort-gainers-change"));
    await waitFor(() => {
      expect(symbols()[0]).toBe("BBB");
    });
  });

  it("search filters rows across cards", async () => {
    const user = userEvent.setup();
    renderWithProvider(<DashboardView universe="nifty500" />);
    await screen.findByTestId("dashboard-row-gainers-INDIAGLYCO");
    const search = screen.getByTestId("dashboard-search");
    await user.type(search, "reliance");
    await waitFor(() => {
      expect(screen.queryByTestId("dashboard-row-gainers-INDIAGLYCO")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("dashboard-row-gainers-RELIANCE")).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "no-such-symbol-xyz");
    await waitFor(() => {
      expect(screen.getByTestId("dashboard-card-empty-gainers")).toBeInTheDocument();
    });
  });

  it("customize menu hides a panel and persists it", async () => {
    const user = userEvent.setup();
    renderWithProvider(<DashboardView universe="nifty500" />);
    await screen.findByTestId("dashboard-card-gainers");
    expect(screen.getByTestId("dashboard-search")).toBeInTheDocument();
    await user.click(screen.getByTestId("dashboard-customize-button"));
    await user.click(await screen.findByTestId("dashboard-customize-gainers"));
    await waitFor(() => {
      expect(screen.queryByTestId("dashboard-card-gainers")).not.toBeInTheDocument();
    });
    expect(JSON.parse(window.localStorage.getItem("screener-dashboard.hidden-panels.v1") ?? "[]")).toContain(
      "gainers",
    );
    // sibling panel still visible
    expect(screen.getByTestId("dashboard-card-most_active")).toBeInTheDocument();
  });

  it("row expand shows extra fields without calling onOpenSymbol", async () => {
    const user = userEvent.setup();
    const onOpenSymbol = vi.fn();
    const base = payload();
    mockFetchScreenerDashboard.mockResolvedValue({
      ...base,
      sections: [
        {
          id: "movers",
          title: "Market Movers",
          panels: [
            {
              id: "gainers",
              title: "Top gainers",
              metric_label: "Change %",
              qualify: 1,
              rows: [richRow()],
            },
          ],
        },
      ],
    });
    renderWithProvider(<DashboardView universe="nifty500" onOpenSymbol={onOpenSymbol} />);
    const expand = await screen.findByTestId("dashboard-row-expand-gainers-INDIAGLYCO");
    await user.click(expand);
    const detail = await screen.findByTestId("dashboard-row-detail-gainers-INDIAGLYCO");
    expect(detail).toHaveTextContent("62.4");
    expect(detail).toHaveTextContent("₹410.00");
    expect(detail).toHaveTextContent("8.4x");
    expect(onOpenSymbol).not.toHaveBeenCalled();
  });

  it("stale snapshot shows cached age and refresh bypasses it", async () => {
    const user = userEvent.setup();
    const base = payload();
    mockFetchScreenerDashboard.mockResolvedValue({ ...base, cached: true, age_sec: 42 });
    renderWithProvider(<DashboardView universe="nifty500" />);
    const stale = await screen.findByTestId("dashboard-stale");
    expect(stale).toHaveTextContent("(cached 42s)");
    await user.click(screen.getByTestId("dashboard-refresh"));
    await waitFor(() => {
      expect(mockFetchScreenerDashboard).toHaveBeenLastCalledWith(
        "nifty500",
        expect.anything(),
        expect.objectContaining({ refresh: true }),
      );
    });
  });

  it("liquidity chip toggles min market-cap and refetches", async () => {
    const user = userEvent.setup();
    renderWithProvider(<DashboardView universe="nifty500" />);
    await screen.findByTestId("dashboard-card-gainers");
    const chip = screen.getByTestId("dashboard-liquidity-chip");
    expect(chip).toHaveTextContent("₹500 Cr+");
    await user.click(chip);
    await waitFor(() => {
      expect(mockFetchScreenerDashboard).toHaveBeenLastCalledWith(
        "nifty500",
        expect.anything(),
        expect.objectContaining({ minMarketCapCr: 0 }),
      );
    });
    await user.click(screen.getByTestId("dashboard-liquidity-chip"));
    await waitFor(() => {
      expect(mockFetchScreenerDashboard).toHaveBeenLastCalledWith(
        "nifty500",
        expect.anything(),
      );
    });
    // back to defaults → plain fetch (backend default is ₹500 Cr)
  });

  it("stays backward compatible with the legacy near_52w panel", async () => {
    const base = payload();
    mockFetchScreenerDashboard.mockResolvedValue({
      ...base,
      sections: [
        {
          id: "movers",
          title: "Market Movers",
          panels: [
            {
              id: "near_52w",
              title: "Near 52W high",
              metric_label: "Off high",
              qualify: 12,
              rows: [row({ symbol: "OLD1", change: 0.5 })],
            },
          ],
        },
      ],
    });
    renderWithProvider(<DashboardView universe="nifty500" />);
    expect(await screen.findByTestId("dashboard-card-near_52w")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-row-near_52w-OLD1")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-toggle-near_52w_high_low")).not.toBeInTheDocument();
  });
});
