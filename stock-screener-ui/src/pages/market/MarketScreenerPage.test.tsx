// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { MarketScreenerPage } from "./MarketScreenerPage";
import { useMarketSnapshotSolid } from "../../components/market/useMarketSnapshotSolid";
import type { MarketRow } from "../../types/marketScreener";
import type { UseMarketSnapshotResult } from "../../components/market/useMarketSnapshotSolid";

vi.mock("../../components/market/useMarketSnapshotSolid", () => ({
  useMarketSnapshotSolid: vi.fn(),
}));

const mockUseMarketSnapshot = vi.mocked(useMarketSnapshotSolid);

function row(symbol: string, overrides: Partial<MarketRow> = {}): MarketRow {
  return {
    symbol,
    name: `${symbol} Ltd`,
    sector: "IT",
    exchange: "NSE",
    close: 100,
    change: 1,
    relativeVolume: 1.0,
    marketCapCr: 1000,
    capTier: "mid",
    rsi: 50,
    adx: 20,
    sma20: 90,
    sma50: 85,
    sma200: 70,
    perfW: 1,
    perf1m: 2,
    high52w: 120,
    low52w: 60,
    pos52w: 66,
    fno: false,
    etf: false,
    ...overrides,
  };
}

const ROWS: MarketRow[] = [
  row("RELIANCE", {
    name: "Reliance Industries",
    sector: "Energy",
    close: 2946,
    change: 0.82,
    relativeVolume: 1.4,
    marketCapCr: 199000,
    capTier: "large",
    rsi: 61,
    fno: true,
    pos52w: 95,
  }),
  row("MPHASIS", {
    name: "Mphasis Ltd",
    sector: "IT",
    close: 2450,
    change: -1.2,
    relativeVolume: 0.9,
    marketCapCr: 46500,
    capTier: "mid",
    rsi: 45,
    fno: true,
    pos52w: 40,
  }),
  row("SMALLCO", {
    name: "Smallco Pharma",
    sector: "Pharma",
    close: 80,
    change: -3.1,
    relativeVolume: 3.2,
    marketCapCr: 750,
    capTier: "small",
    rsi: 32,
    sma20: 90,
    sma50: 95,
    sma200: 110,
    pos52w: 12,
  }),
];

function hookResult(overrides: Partial<UseMarketSnapshotResult> = {}): UseMarketSnapshotResult {
  const snapshot = {
    asOf: new Date().toISOString(),
    universe: "all_equity" as const,
    total: ROWS.length,
    updateMode: "streaming" as const,
    rows: ROWS,
  };
  return {
    snapshot: () => snapshot,
    rows: () => ROWS,
    total: () => ROWS.length,
    updateMode: () => "streaming",
    asOf: () => new Date().toISOString(),
    isLoading: () => false,
    error: () => null,
    refresh: vi.fn(),
    lastUpdated: () => new Date().toISOString(),
    stale: () => false,
    warming: () => false,
    ...overrides,
  };
}

// @/ui's dynamic-tag layout primitives crash at runtime on this branch;
// stub them with intrinsic elements (see src/pages/solidTestStubs.tsx).
vi.mock("@/ui", async (importOriginal) => {
  const { uiLayoutStub } = await import("@/pages/solidTestStubs");
  return uiLayoutStub(await importOriginal<Record<string, unknown>>());
});

function r(jsx: unknown) {
  return render(() => <UIProvider>{jsx as never}</UIProvider>);
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mockUseMarketSnapshot.mockReturnValue(hookResult());
});

describe("MarketScreenerPage", () => {
  test("renders the market screener shell with rows", () => {
    r(<MarketScreenerPage />);
    expect(screen.getByTestId("market-screener")).toBeInTheDocument();
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("market-row-MPHASIS")).toBeInTheDocument();
    expect(screen.getByTestId("market-row-SMALLCO")).toBeInTheDocument();
    expect(screen.getByTestId("market-result-count")).toHaveTextContent("3 / 3");
    expect(screen.getByTestId("market-mode-badge")).toHaveTextContent("Live");
    expect(screen.getByTestId("market-grid")).toHaveAttribute("aria-label", "Market screener results");
  });

  test("loading state shows the skeleton and no rows", () => {
    mockUseMarketSnapshot.mockReturnValue(
      hookResult({ isLoading: () => true, rows: () => [], total: () => 0, snapshot: () => null }),
    );
    r(<MarketScreenerPage />);
    expect(screen.getByTestId("market-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("market-grid")).not.toBeInTheDocument();
  });

  test("error state shows the panel and retry calls refresh", async () => {
    const refresh = vi.fn();
    mockUseMarketSnapshot.mockReturnValue(
      hookResult({
        error: () => new Error("snapshot 503"),
        rows: () => [],
        total: () => 0,
        snapshot: () => null,
        refresh,
      }),
    );
    r(<MarketScreenerPage />);
    expect(screen.getByTestId("market-error")).toBeInTheDocument();
    expect(screen.getByTestId("market-error-message")).toHaveTextContent("snapshot 503");
    fireEvent.click(screen.getByTestId("market-retry"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("refresh failure with cached rows shows a banner and keeps the grid", async () => {
    const refresh = vi.fn();
    mockUseMarketSnapshot.mockReturnValue(
      hookResult({ error: () => new Error("refresh 503"), refresh }),
    );
    r(<MarketScreenerPage />);
    expect(screen.getByTestId("market-error-banner")).toBeInTheDocument();
    expect(screen.getByTestId("market-error-banner-message")).toHaveTextContent("refresh 503");
    expect(screen.getByTestId("market-grid")).toBeInTheDocument();
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();
    expect(screen.queryByTestId("market-error")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("market-error-banner-retry"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("switching universe resets filters and search", async () => {
    r(<MarketScreenerPage />);
    const rsiInput = screen
      .getByTestId("market-filter-rsi-min")
      .querySelector("input") as HTMLInputElement;
    fireEvent.input(rsiInput, { target: { value: "58" } });
    fireEvent.input(screen.getByTestId("market-search"), { target: { value: "reliance" } });
    await waitFor(() =>
      expect(screen.getByTestId("market-filter-chip-rsi")).toBeInTheDocument(),
    );
    const combobox = screen.getByTestId("market-universe-select").querySelector('[role="combobox"]') as HTMLInputElement;
    fireEvent.focus(combobox);
    fireEvent.mouseDown(await screen.findByRole("option", { name: "F&O" }));
    await waitFor(() =>
      expect(screen.queryByTestId("market-filter-chip-rsi")).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("market-filter-chip-search")).not.toBeInTheDocument();
    expect(screen.getByTestId("market-search")).toHaveValue("");
    expect(
      (screen.getByTestId("market-filter-rsi-min").querySelector("input") as HTMLInputElement).value,
    ).toBe("");
    expect(screen.getByTestId("market-result-count")).toHaveTextContent("3 / 3");
  });

  test("RSI filter reduces the rows and updates the count + chip", async () => {
    r(<MarketScreenerPage />);
    const input = screen
      .getByTestId("market-filter-rsi-min")
      .querySelector("input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "58" } });
    await waitFor(() =>
      expect(screen.queryByTestId("market-row-MPHASIS")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();
    expect(screen.queryByTestId("market-row-SMALLCO")).not.toBeInTheDocument();
    expect(screen.getByTestId("market-result-count")).toHaveTextContent("1 / 3");
    expect(screen.getByTestId("market-filter-chip-rsi")).toBeInTheDocument();
  });

  test("cap tier + RSI combined filters narrow to zero rows and reset restores", async () => {
    r(<MarketScreenerPage />);
    const input = screen
      .getByTestId("market-filter-rsi-min")
      .querySelector("input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "58" } });
    fireEvent.click(screen.getByTestId("market-cap-mid"));
    await waitFor(() =>
      expect(screen.getByText("No rows match the current filters")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("market-filter-chip-capTier:mid")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("market-empty-reset"));
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("market-row-MPHASIS")).toBeInTheDocument();
    expect(screen.getByTestId("market-row-SMALLCO")).toBeInTheDocument();
    expect(screen.queryByTestId("market-filter-chip-rsi")).not.toBeInTheDocument();
  });

  test("search narrows rows via the deferred query", async () => {
    r(<MarketScreenerPage />);
    fireEvent.input(screen.getByTestId("market-search"), { target: { value: "reliance" } });
    await waitFor(() =>
      expect(screen.queryByTestId("market-row-MPHASIS")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("market-result-count")).toHaveTextContent("1 / 3");
    expect(screen.getByTestId("market-filter-chip-search")).toBeInTheDocument();
  });

  test("removing the search chip restores the rows", async () => {
    r(<MarketScreenerPage />);
    fireEvent.input(screen.getByTestId("market-search"), { target: { value: "reliance" } });
    await waitFor(() =>
      expect(screen.queryByTestId("market-row-MPHASIS")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("market-filter-chip-search"));
    await waitFor(() => expect(screen.getByTestId("market-row-MPHASIS")).toBeInTheDocument());
    expect(screen.getByTestId("market-result-count")).toHaveTextContent("3 / 3");
  });

  test("reset button clears filters and search", async () => {
    r(<MarketScreenerPage />);
    const input = screen
      .getByTestId("market-filter-rsi-min")
      .querySelector("input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "58" } });
    fireEvent.input(screen.getByTestId("market-search"), { target: { value: "reliance" } });
    await waitFor(() =>
      expect(screen.getByTestId("market-filter-chip-rsi")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("market-reset"));
    await waitFor(() =>
      expect(screen.getByTestId("market-result-count")).toHaveTextContent("3 / 3"),
    );
    expect(screen.queryByTestId("market-filter-chip-rsi")).not.toBeInTheDocument();
    expect(screen.queryByTestId("market-filter-chip-search")).not.toBeInTheDocument();
  });

  test("universe select drives useMarketSnapshot", async () => {
    r(<MarketScreenerPage />);
    const combobox = screen.getByTestId("market-universe-select").querySelector('[role="combobox"]') as HTMLInputElement;
    fireEvent.focus(combobox);
    fireEvent.mouseDown(await screen.findByRole("option", { name: "F&O" }));
    const call = mockUseMarketSnapshot.mock.calls.at(-1)?.[0];
    expect(typeof call).toBe("function");
    expect((call as unknown as () => string)()).toBe("nse_fo");
  });

  test("delayed update mode shows the Delayed badge, not Live", () => {
    mockUseMarketSnapshot.mockReturnValue(hookResult({ updateMode: () => "delayed_15m" }));
    r(<MarketScreenerPage />);
    expect(screen.getByTestId("market-mode-badge")).toHaveTextContent("Delayed");
  });

  test("row click selects it (selected styling hook fires without crashing)", async () => {
    r(<MarketScreenerPage />);
    fireEvent.click(screen.getByTestId("market-row-RELIANCE"));
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();
  });

  test("rail collapse hides the rail panel", async () => {
    r(<MarketScreenerPage />);
    expect(screen.getByTestId("market-rail-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("market-rail-collapse"));
    expect(screen.queryByTestId("market-rail-panel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("market-rail-toggle"));
    expect(screen.getByTestId("market-rail-panel")).toBeInTheDocument();
  });
});
