// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { alpha, PRIMARY } from "@/ui/palette";
import type { ScreenerDashboardResponse, ScreenerDashboardRow } from "../../types/screenerDashboard";
import { createSignal, type JSX } from "solid-js";

const mockFetchScreenerDashboard = vi.fn();

vi.mock("../../api/screenerDashboard", () => ({
  fetchScreenerDashboard: (...args: unknown[]) => mockFetchScreenerDashboard(...args),
}));

// @/ui Menu is missing its `createSignal` import on this branch and crashes
// at construction, so the whole @/ui module is stubbed with the repo's
// pass-through twins (see src/patterns/solidUiMock.tsx). Everything else is
// the real implementation.
vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/test-utils/solidUiMock");
  const { typeSize } = await import("@/ui/typography");
  const { For } = await import("solid-js");
  // The repo's stubs are near-miss twins: they drop `data-testid` from
  // SegmentedControl's root and Chip's onChange toggle. These match the real
  // component contracts (role=group with data-testid; role=checkbox toggling).
  const SegmentedControl = (props: any) => (
    <div role="group" data-testid={props["data-testid"]} class={props.className} style={props.style} id={props.id}>
      <For each={props.data ?? []}>
        {(item: any) => (
          <button
            type="button"
            aria-pressed={props.value === item.value}
            data-value={item.value}
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled) props.onChange?.(item.value);
            }}
          >
            {item.label}
          </button>
        )}
      </For>
    </div>
  );
  const Chip = (props: any) => {
    const checked = () => (props.checked !== undefined ? props.checked : props.defaultChecked ?? false);
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={checked()}
        disabled={props.disabled}
        data-testid={props["data-testid"]}
        className={props.className}
        style={props.style}
        id={props.id}
        onClick={(e: any) => {
          if (props.disabled) return;
          props.onClick?.(e);
          props.onChange?.(!checked());
        }}
      >
        {props.children ?? props.label}
      </button>
    );
  };
  return { ...mockSolidUi({ SegmentedControl, Chip }), typeSize };
});

import {
  DashboardView,
  dashboardRowMarketCap,
  formatDashboardMCap,
  formatDashboardPrice,
} from "./DashboardView";
import { marketUniverseDescriptor } from "@/config/marketUniverses";

const renderWithProvider = (ui: JSX.Element) => render(() => <UIProvider>{ui}</UIProvider>);

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
    const onOpenSymbol = vi.fn();
    renderWithProvider(<DashboardView universe="nifty500" onOpenSymbol={onOpenSymbol} />);
    const rowEl = await screen.findByTestId("dashboard-row-gainers-INDIAGLYCO");
    fireEvent.click(rowEl);
    expect(onOpenSymbol).toHaveBeenCalledWith("INDIAGLYCO");
  });

  it("calls onOpenScan with the panel id and deduped symbols", async () => {
    const onOpenScan = vi.fn();
    renderWithProvider(<DashboardView universe="nifty500" onOpenScan={onOpenScan} />);
    await screen.findByTestId("dashboard-card-gainers");
    fireEvent.click(screen.getByTestId("dashboard-open-scan-gainers"));
    expect(onOpenScan).toHaveBeenCalledWith("gainers", ["INDIAGLYCO", "RELIANCE"]);
    fireEvent.click(screen.getByTestId("dashboard-open-scan-volume_surge"));
    expect(onOpenScan).toHaveBeenCalledWith("volume_surge", ["INFY"]);
  });

  it("dedupes symbols across the group's panels", async () => {
    const onOpenScan = vi.fn();
    mockFetchScreenerDashboard.mockResolvedValue({
      ...payload(),
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
              rows: [row({ symbol: "RELIANCE" }), row({ symbol: "INDIAGLYCO" })],
            },
            {
              id: "losers",
              title: "Top losers",
              metric_label: "Change %",
              qualify: 2,
              rows: [row({ symbol: "INDIAGLYCO" }), row({ symbol: "TATAMOTORS" })],
            },
          ],
        },
      ],
    });
    renderWithProvider(<DashboardView universe="nifty500" onOpenScan={onOpenScan} />);
    await screen.findByTestId("dashboard-card-gainers_losers");
    fireEvent.click(screen.getByTestId("dashboard-open-scan-gainers_losers"));
    expect(onOpenScan).toHaveBeenCalledWith("gainers", [
      "RELIANCE",
      "INDIAGLYCO",
      "TATAMOTORS",
    ]);
  });

  it("re-fetches when the universe changes", async () => {
    const [universe, setUniverse] = createSignal("nifty500");
    render(() => <DashboardView universe={universe()} />);
    await screen.findByTestId("dashboard-card-gainers");
    expect(mockFetchScreenerDashboard).toHaveBeenCalledTimes(1);
    setUniverse("nifty200");
    await waitFor(() => {
      expect(mockFetchScreenerDashboard).toHaveBeenCalledWith(
        "nifty200",
        expect.anything(),
      );
    });
    expect(mockFetchScreenerDashboard).toHaveBeenCalledTimes(2);
  });

  it("re-fetches when Refresh is clicked", async () => {
    renderWithProvider(<DashboardView universe="nifty500" />);
    await screen.findByTestId("dashboard-card-gainers");
    expect(mockFetchScreenerDashboard).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("dashboard-refresh"));
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

  it("tints only the row matching selectedSymbol, and follows it reactively", async () => {
    const [selected, setSelected] = createSignal<string | null>("RELIANCE");
    renderWithProvider(<DashboardView universe="nifty500" selectedSymbol={selected()} />);
    const reliance = await screen.findByTestId("dashboard-row-gainers-RELIANCE");
    const glycols = screen.getByTestId("dashboard-row-gainers-INDIAGLYCO");
    const tint = alpha(PRIMARY, 0.12).replace(/\s+/g, "");

    expect(reliance.style.backgroundColor.replace(/\s+/g, "")).toBe(tint);
    expect(glycols.style.backgroundColor).toBe("");

    setSelected("INDIAGLYCO");
    expect(glycols.style.backgroundColor.replace(/\s+/g, "")).toBe(tint);
    expect(reliance.style.backgroundColor).toBe("");
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
    mockFetchScreenerDashboard.mockResolvedValue(twoSidedPayload());
    renderWithProvider(<DashboardView universe="nifty500" />);
    expect(await screen.findByTestId("dashboard-card-gainers_losers")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-card-losers")).not.toBeInTheDocument();
    expect(screen.getByTestId("dashboard-toggle-gainers_losers")).toBeInTheDocument();
    // gainers shown by default
    expect(screen.getByTestId("dashboard-row-gainers-GAIN1")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-row-losers-LOSE1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Losers" }));
    expect(screen.getByTestId("dashboard-row-losers-LOSE1")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-row-gainers-GAIN1")).not.toBeInTheDocument();
  });

  it("renders a lone gainers panel with no toggle", async () => {
    renderWithProvider(<DashboardView universe="nifty500" />);
    expect(await screen.findByTestId("dashboard-card-gainers")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-toggle-gainers_losers")).not.toBeInTheDocument();
  });

  it("merges 52w high+low into one card with a toggle", async () => {
    mockFetchScreenerDashboard.mockResolvedValue(twoSidedPayload());
    renderWithProvider(<DashboardView universe="nifty500" />);
    expect(await screen.findByTestId("dashboard-card-near_52w_high_low")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-row-near_52w_high-HIGH1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "52W low" }));
    expect(screen.getByTestId("dashboard-row-near_52w_low-LOW1")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-row-near_52w_high-HIGH1")).not.toBeInTheDocument();
  });

  it("show more refetches with a larger limit and toggles to show less", async () => {
    renderWithProvider(<DashboardView universe="nifty500" />);
    const more = await screen.findByTestId("dashboard-show-more-gainers");
    expect(more).toHaveTextContent("Show more");
    fireEvent.click(more);
    await waitFor(() => {
      expect(mockFetchScreenerDashboard).toHaveBeenLastCalledWith(
        "nifty500",
        expect.anything(),
        expect.objectContaining({ limit: 30 }),
      );
    });
    expect(screen.getByTestId("dashboard-show-more-gainers")).toHaveTextContent("Show less");
    fireEvent.click(screen.getByTestId("dashboard-show-more-gainers"));
    await waitFor(() => {
      expect(mockFetchScreenerDashboard).toHaveBeenLastCalledWith(
        "nifty500",
        expect.anything(),
      );
    });
  });

  it("sort menu reorders rows client-side", async () => {
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
    fireEvent.click(screen.getByTestId("dashboard-sort-gainers"));
    fireEvent.click(await screen.findByTestId("dashboard-sort-gainers-change"));
    await waitFor(() => {
      expect(symbols()[0]).toBe("BBB");
    });
  });

  it("null metric sorts last in both directions and the toggle reverses order", async () => {
    mockFetchScreenerDashboard.mockResolvedValue({
      ...payload(),
      sections: [
        {
          id: "movers",
          title: "Market Movers",
          panels: [
            {
              id: "gainers",
              title: "Top gainers",
              metric_label: "Change %",
              qualify: 3,
              rows: [
                row({ symbol: "AAA", change: 1.0 }),
                row({ symbol: "BBB", change: 5.0 }),
                row({ symbol: "NULLY", change: Number.NaN }),
              ],
            },
          ],
        },
      ],
    });
    renderWithProvider(<DashboardView universe="nifty500" />);
    await screen.findByTestId("dashboard-card-gainers");
    const symbols = () =>
      Array.from(
        screen
          .getByTestId("dashboard-card-rows-gainers")
          .querySelectorAll('[data-testid^="dashboard-row-gainers-"]'),
      ).map((el) => el.getAttribute("data-symbol"));

    fireEvent.click(screen.getByTestId("dashboard-sort-gainers"));
    fireEvent.click(await screen.findByTestId("dashboard-sort-gainers-change"));
    await waitFor(() => expect(symbols()).toEqual(["BBB", "AAA", "NULLY"]));

    const toggle = screen.getByTestId("dashboard-sort-direction-gainers");
    expect(toggle).toHaveAttribute(
      "aria-label",
      "Sort descending — click to sort ascending",
    );
    fireEvent.click(toggle);
    await waitFor(() => expect(symbols()).toEqual(["AAA", "BBB", "NULLY"]));
    expect(toggle).toHaveAttribute(
      "aria-label",
      "Sort ascending — click to sort descending",
    );
  });

  it("renders a literal null change as a dash without crashing the card", async () => {
    mockFetchScreenerDashboard.mockResolvedValue({
      ...payload(),
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
                row({ symbol: "NULLCHG", change: null as unknown as number }),
                row({ symbol: "GOODCHG", change: 3.5 }),
              ],
            },
          ],
        },
      ],
    });
    renderWithProvider(<DashboardView universe="nifty500" />);
    // The card renders (leaves loading) even though one metric is null.
    expect(await screen.findByTestId("dashboard-card-gainers")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-loading")).not.toBeInTheDocument();
    const nullRow = screen.getByTestId("dashboard-row-gainers-NULLCHG");
    expect(nullRow).toHaveTextContent("—");
    // The sibling row with a finite metric renders normally.
    const goodRow = screen.getByTestId("dashboard-row-gainers-GOODCHG");
    expect(goodRow).toHaveTextContent("+3.50%");
  });

  it("search filters rows across cards", async () => {
    renderWithProvider(<DashboardView universe="nifty500" />);
    await screen.findByTestId("dashboard-row-gainers-INDIAGLYCO");
    const search = screen.getByTestId("dashboard-search");
    fireEvent.input(search, { target: { value: "reliance" } });
    await waitFor(() => {
      expect(screen.queryByTestId("dashboard-row-gainers-INDIAGLYCO")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("dashboard-row-gainers-RELIANCE")).toBeInTheDocument();
    fireEvent.input(search, { target: { value: "" } });
    fireEvent.input(search, { target: { value: "no-such-symbol-xyz" } });
    await waitFor(() => {
      expect(screen.getByTestId("dashboard-card-empty-gainers")).toBeInTheDocument();
    });
  });

  it("customize menu hides a panel and persists it", async () => {
    renderWithProvider(<DashboardView universe="nifty500" />);
    await screen.findByTestId("dashboard-card-gainers");
    expect(screen.getByTestId("dashboard-search")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("dashboard-customize-button"));
    fireEvent.click(await screen.findByTestId("dashboard-customize-gainers"));
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
    fireEvent.click(expand);
    const detail = await screen.findByTestId("dashboard-row-detail-gainers-INDIAGLYCO");
    expect(detail).toHaveTextContent("62.4");
    expect(detail).toHaveTextContent("₹410.00");
    expect(detail).toHaveTextContent("8.4x");
    expect(onOpenSymbol).not.toHaveBeenCalled();
  });

  it("stale snapshot shows cached age and refresh bypasses it", async () => {
    const base = payload();
    mockFetchScreenerDashboard.mockResolvedValue({ ...base, cached: true, age_sec: 42 });
    renderWithProvider(<DashboardView universe="nifty500" />);
    const stale = await screen.findByTestId("dashboard-stale");
    expect(stale).toHaveTextContent("(cached 42s)");
    fireEvent.click(screen.getByTestId("dashboard-refresh"));
    await waitFor(() => {
      expect(mockFetchScreenerDashboard).toHaveBeenLastCalledWith(
        "nifty500",
        expect.anything(),
        expect.objectContaining({ refresh: true }),
      );
    });
  });

  it("liquidity chip toggles min market-cap and refetches", async () => {
    renderWithProvider(<DashboardView universe="nifty500" />);
    await screen.findByTestId("dashboard-card-gainers");
    const chip = screen.getByTestId("dashboard-liquidity-chip");
    expect(chip).toHaveTextContent("₹500 Cr+");
    fireEvent.click(chip);
    await waitFor(() => {
      expect(mockFetchScreenerDashboard).toHaveBeenLastCalledWith(
        "nifty500",
        expect.anything(),
        expect.objectContaining({ minMarketCapCr: 0 }),
      );
    });
    fireEvent.click(screen.getByTestId("dashboard-liquidity-chip"));
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

describe("DashboardView embedded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockFetchScreenerDashboard.mockResolvedValue(payload());
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("hides the as-of row and refresh button but keeps the toolbar", async () => {
    renderWithProvider(<DashboardView universe="nifty500" embedded onOpenSymbol={() => {}} />);
    await screen.findByTestId("dashboard-card-gainers");

    expect(screen.getByTestId("screener-dashboard")).not.toHaveTextContent("as of");
    expect(screen.queryByTestId("dashboard-refresh")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-stale")).not.toBeInTheDocument();

    expect(screen.getByTestId("dashboard-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-search")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-customize")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-section-movers")).toBeInTheDocument();
  });

  it("keeps the as-of row and refresh button when not embedded", async () => {
    renderWithProvider(<DashboardView universe="nifty500" />);
    await screen.findByTestId("dashboard-card-gainers");

    expect(screen.getByTestId("dashboard-refresh")).toBeInTheDocument();
    expect(screen.getByTestId("screener-dashboard")).toHaveTextContent("500 stocks · as of");
    expect(screen.getByTestId("dashboard-toolbar")).toBeInTheDocument();
  });
});

describe("DashboardView currency descriptor", () => {
  const india = marketUniverseDescriptor("nifty500");
  const usa = marketUniverseDescriptor("us");

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  function currencyPayload(universe: string, row: ScreenerDashboardRow): ScreenerDashboardResponse {
    return {
      universe,
      as_of: "2026-11-16T10:00:00+05:30",
      total: 1,
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
              rows: [row],
            },
          ],
        },
      ],
    };
  }

  it("keeps India price and mcap formatting byte-identical", async () => {
    mockFetchScreenerDashboard.mockResolvedValue(
      currencyPayload(
        "nifty500",
        row({
          symbol: "INDIAGLYCO",
          close: 382.7,
          rsi: 62.4,
          vwap: 375.5,
          atr: 8.25,
          price_52_week_high: 410.0,
          market_cap_cr: 1200,
        }),
      ),
    );
    renderWithProvider(<DashboardView universe="nifty500" />);
    const rowEl = await screen.findByTestId("dashboard-row-gainers-INDIAGLYCO");
    expect(rowEl).toHaveTextContent("₹382.70");

    fireEvent.click(screen.getByTestId("dashboard-row-expand-gainers-INDIAGLYCO"));
    const detail = await screen.findByTestId("dashboard-row-detail-gainers-INDIAGLYCO");
    expect(detail).toHaveTextContent("₹410.00");
    expect(detail).toHaveTextContent("₹8.25");
    expect(detail).toHaveTextContent("₹375.50");
    expect(detail).toHaveTextContent("₹1.2K Cr");
  });

  it("renders $ prices and a $…B mcap for a USD row in the us universe", async () => {
    mockFetchScreenerDashboard.mockResolvedValue(
      currencyPayload(
        "us",
        row({
          symbol: "AAPL",
          close: 189.5,
          currency: "USD",
          marketCapUsdB: 250,
          rsi: 62.4,
          vwap: 187.5,
          atr: 2.25,
          price_52_week_high: 200.0,
        }),
      ),
    );
    renderWithProvider(<DashboardView universe="us" />);
    const rowEl = await screen.findByTestId("dashboard-row-gainers-AAPL");
    expect(rowEl).toHaveTextContent("$189.50");
    expect(rowEl).not.toHaveTextContent("₹");

    fireEvent.click(screen.getByTestId("dashboard-row-expand-gainers-AAPL"));
    const detail = await screen.findByTestId("dashboard-row-detail-gainers-AAPL");
    expect(detail).toHaveTextContent("$200.00");
    expect(detail).toHaveTextContent("$2.25");
    expect(detail).toHaveTextContent("$187.50");
    expect(detail).toHaveTextContent("$250 B");
    expect(detail).not.toHaveTextContent("₹");
    expect(detail).not.toHaveTextContent("Cr");
  });

  it("reads the cap from the descriptor's field and formats per currency", () => {
    const usRow = row({ marketCapUsdB: 2950, market_cap_cr: 999, currency: "USD" });
    const inrRow = row({ market_cap_cr: 1200, marketCapUsdB: 2950 });

    expect(dashboardRowMarketCap(usRow, usa)).toBe(2950);
    expect(dashboardRowMarketCap(inrRow, india)).toBe(1200);
    expect(formatDashboardPrice(382.7, india)).toBe("₹382.70");
    expect(formatDashboardPrice(189.5, usa)).toBe("$189.50");
    expect(formatDashboardMCap(null, usa)).toBe("—");
    expect(formatDashboardMCap(250, usa)).toBe("$250 B");
    expect(formatDashboardMCap(2950, usa)).toBe("$3.0K B");
    expect(formatDashboardMCap(1200, india)).toBe("₹1.2K Cr");
  });
});
