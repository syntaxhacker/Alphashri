// @vitest-environment happy-dom
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { useValueScanSolid } from "./useValueScanSolid";
import { valueScan } from "../../api/valueScan";
import type { ValueFilters, ValueRow, ValueScanResponse } from "../../api/valueScan";

vi.mock("../../api/valueScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/valueScan")>();
  return { ...actual, valueScan: vi.fn() };
});

const mockValueScan = vi.mocked(valueScan);

function row(symbol: string, currency = "INR"): ValueRow {
  return {
    symbol,
    name: `${symbol} Ltd`,
    exchange: currency === "USD" ? "NASDAQ" : "NSE",
    currency,
    price: 100,
    change: 0,
    mcap_bn: 10,
    rev_bn: 5,
    pe: 9,
    ps: 1,
    pb: 1.4,
    fcf_yield: 5,
    div_yield: 1,
    roe: 15,
    gross_margin: 30,
    op_margin: 15,
    rev_yoy: 7,
    eps_yoy: 6,
    debt_to_equity: 0.3,
    current_ratio: 1.5,
    rsi: 45,
    vs_200dma: 2,
    off_52w_high: -12,
    score: 78,
    subscores: { value: 80, quality: 75, growth: 70, health: 82 },
    peer: { bucket: "Banks", pe_median: 11, roe_median: 12, fcf_yield_median: 4 },
    flags: [],
    derived: {
      fcf_yield: 5,
      earnings_yield: 11,
      vs_200dma: 2,
      off_52w_high: -12,
      distorted_pe: false,
    },
  };
}

function payload(market: "india" | "usa", symbols: string[]): ValueScanResponse {
  return {
    market,
    currency: market === "usa" ? "USD" : "INR",
    as_of: "2026-10-21T10:00:00+05:30",
    scanned: 10,
    matched: symbols.length,
    fields_complete: true,
    filters_applied: {},
    warnings: [],
    rows: symbols.map((s) => row(s, market === "usa" ? "USD" : "INR")),
    sectors: [],
  };
}

function mount(filters: () => ValueFilters) {
  let api!: ReturnType<typeof useValueScanSolid>;
  let dispose!: () => void;
  createRoot((d) => {
    dispose = d;
    api = useValueScanSolid(filters);
  });
  return { api, dispose };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockValueScan.mockImplementation(async (f) =>
    f?.market === "usa"
      ? payload("usa", ["AAPL"])
      : payload("india", ["RELIANCE"]),
  );
});

describe("useValueScanSolid market identity", () => {
  test("clears the payload on a market change instead of keeping old rows", async () => {
    const [filters, setFilters] = createSignal<ValueFilters>({ market: "india", limit: 100 });
    const { api, dispose } = mount(filters);

    await vi.waitFor(() => expect(api.rows().length).toBe(1));
    expect(api.data()?.market).toBe("india");
    expect(api.stale()).toBe(false);

    setFilters({ market: "usa", limit: 100 });
    expect(api.data()).toBeNull();
    expect(api.rows()).toEqual([]);

    await vi.waitFor(() => expect(api.rows()[0]?.symbol).toBe("AAPL"));
    expect(api.data()?.market).toBe("usa");
    expect(api.data()?.currency).toBe("USD");
    expect(api.stale()).toBe(false);
    dispose();
  });

  test("keeps a same-market payload but marks it stale until the new key lands", async () => {
    const [filters, setFilters] = createSignal<ValueFilters>({ market: "india", limit: 100 });
    const { api, dispose } = mount(filters);

    await vi.waitFor(() => expect(api.rows().length).toBe(1));
    setFilters({ market: "india", limit: 50 });
    expect(api.rows()[0]?.symbol).toBe("RELIANCE");
    expect(api.stale()).toBe(true);

    await vi.waitFor(() => expect(api.stale()).toBe(false));
    dispose();
  });

  test("keeps the old payload out of state when the new market request fails", async () => {
    const [filters, setFilters] = createSignal<ValueFilters>({ market: "india", limit: 100 });
    const { api, dispose } = mount(filters);

    await vi.waitFor(() => expect(api.rows().length).toBe(1));
    mockValueScan.mockRejectedValueOnce(new Error("scan down"));
    setFilters({ market: "usa", limit: 100 });

    await vi.waitFor(() => expect(api.error()?.message).toBe("scan down"));
    expect(api.data()).toBeNull();
    expect(api.rows()).toEqual([]);
    dispose();
  });
});
