// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { HeatmapPage } from "./HeatmapPage";
import { fetchHeatmapData, fetchHeatmapSectors } from "../../api/heatmap";
import { UIProvider } from "@/ui";

// @/ui's dynamic-tag layout primitives crash at runtime on this branch;
// stub them with intrinsic elements (see src/pages/solidTestStubs.tsx).
// @/ui's searchable Select is broken on this branch too (SearchableSelect
// calls createSignal without importing it), so swap in a minimal Select mock
// with the same value/onChange-onInput API.
vi.mock("@/ui", async (importOriginal) => {
  const { uiLayoutStub } = await import("@/pages/solidTestStubs");
  const actual = await importOriginal<Record<string, unknown>>();
  const stubbed = await uiLayoutStub(actual);
  const Select = (props: any) => (
    <select
      data-testid={props["data-testid"]}
      aria-label={props["aria-label"]}
      value={props.value ?? ""}
      onInput={(e: Event) => {
        const el = e.currentTarget as HTMLSelectElement;
        props.onChange?.(el.value === "" ? null : el.value);
      }}
    >
      <option value="">{props.placeholder ?? "Select"}</option>
      {(props.data ?? []).map((o: any) => (
        <option value={o.value}>{o.label}</option>
      ))}
    </select>
  );
  return { ...stubbed, Select };
});

// Charts are not the unit under test here.
vi.mock("./EChart", () => ({
  EChart: () => null,
}));

// src/components/heatmap/stockTreemap.ts is broken on this branch — commit
// 17edb93d "repaired" `const borderColor = ...` into `const ["border-color"]
// = ...`, which is a syntax error (and the borderColor references at
// lines 181/188/195 are left undefined). Mock the module so this test
// exercises HeatmapPage wiring instead of the syntax-broken file.
vi.mock("../../components/heatmap/stockTreemap", () => ({
  buildStockTreemapOption: () => ({ series: [] }),
  getStockMetricRange: () => ({ min: 0, max: 1 }),
  resolveStockMetric: (metrics: any[], value: string) =>
    metrics.find((m: any) => m.value === value) ?? metrics[0],
}));

vi.mock("../../api/heatmap", () => ({
  fetchHeatmapData: vi.fn(),
  fetchHeatmapSectors: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

const mockStocks = [
  { symbol: "RELIANCE", name: "Reliance Industries", pe_ratio: 22.5, market_cap: 15000000000000, price: 2850, change_pct: 1.2, sector: "Energy", pb_ratio: 2.5, dividend_yield: 0.8, perf_1y: 12.3, roe: 15.2, high_52w: 3000, low_52w: 2400 },
  { symbol: "TCS", name: "Tata Consultancy Services", pe_ratio: 28.0, market_cap: 12000000000000, price: 4200, change_pct: -0.5, sector: "Technology", pb_ratio: 8.1, dividend_yield: 0.5, perf_1y: 8.7, roe: 25.4, high_52w: 4500, low_52w: 3800 },
  { symbol: "HDFCBANK", name: "HDFC Bank", pe_ratio: 18.0, market_cap: 10000000000000, price: 1650, change_pct: 0.8, sector: "Financial Services", pb_ratio: 3.2, dividend_yield: 1.1, perf_1y: 5.2, roe: 18.9, high_52w: 1800, low_52w: 1400 },
];

const mockSectors = [
  { name: "Energy", count: 45 },
  { name: "Technology", count: 30 },
  { name: "Financial Services", count: 50 },
];

describe("HeatmapPage", () => {
  beforeEach(() => {
    vi.mocked(fetchHeatmapData).mockResolvedValue({ stocks: mockStocks, cached: false });
    vi.mocked(fetchHeatmapSectors).mockResolvedValue({ sectors: mockSectors });
  });

  it("renders heatmap page container", async () => {
    render(() => <UIProvider><HeatmapPage /></UIProvider>);
    await waitFor(() => expect(screen.getByTestId("heatmap-page")).toBeInTheDocument());
  });

  it("renders without crashing with pending data", () => {
    vi.useFakeTimers();
    vi.mocked(fetchHeatmapData).mockImplementation(() => new Promise(() => {}));
    render(() => <UIProvider><HeatmapPage /></UIProvider>);
    vi.advanceTimersByTime(100);
    expect(screen.getByTestId("heatmap-page")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("renders title", async () => {
    render(() => <UIProvider><HeatmapPage /></UIProvider>);
    await waitFor(() => expect(screen.getByTestId("heatmap-title")).toBeInTheDocument());
  });

  it("has sector filter", async () => {
    render(() => <UIProvider><HeatmapPage /></UIProvider>);
    await waitFor(() => expect(screen.getByTestId("heatmap-sector-filter")).toBeInTheDocument());
  });

  it("has search input", async () => {
    render(() => <UIProvider><HeatmapPage /></UIProvider>);
    await waitFor(() => expect(screen.getByTestId("heatmap-search")).toBeInTheDocument());
  });

  it("has metric selector", async () => {
    render(() => <UIProvider><HeatmapPage /></UIProvider>);
    await waitFor(() => expect(screen.getByTestId("heatmap-metric")).toBeInTheDocument());
  });

  it("has view selector", async () => {
    render(() => <UIProvider><HeatmapPage /></UIProvider>);
    await waitFor(() => expect(screen.getByTestId("heatmap-view")).toBeInTheDocument());
  });

  it("displays stock count", async () => {
    render(() => <UIProvider><HeatmapPage /></UIProvider>);
    await waitFor(() => {
      expect(screen.getByTestId("heatmap-stock-count")).toHaveTextContent(/3 stocks/);
    });
  });

  it("shows Live badge", async () => {
    render(() => <UIProvider><HeatmapPage /></UIProvider>);
    await waitFor(() => expect(screen.getByTestId("heatmap-badge")).toHaveTextContent("Live"));
  });

  it("shows Cached badge", async () => {
    vi.mocked(fetchHeatmapData).mockResolvedValue({ stocks: mockStocks, cached: true });
    render(() => <UIProvider><HeatmapPage /></UIProvider>);
    await waitFor(() => expect(screen.getByTestId("heatmap-badge")).toHaveTextContent("Cached"));
  });

  it("shows error on API failure", async () => {
    vi.mocked(fetchHeatmapData).mockRejectedValue(new Error("Network error"));
    render(() => <UIProvider><HeatmapPage /></UIProvider>);
    await waitFor(() => {
      expect(screen.getByTestId("heatmap-error")).toHaveTextContent(/Error:/);
    });
  });

  it("renders legend", async () => {
    render(() => <UIProvider><HeatmapPage /></UIProvider>);
    await waitFor(() => expect(screen.getByTestId("heatmap-legend")).toBeInTheDocument());
  });
});