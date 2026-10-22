// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import { ValuePanel } from "./ValuePanel";
import { valueScan } from "../../api/valueScan";
import type { ValueRow, ValueScanResponse } from "../../api/valueScan";

vi.mock("../../api/valueScan", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../api/valueScan")>();
  return { ...actual, valueScan: vi.fn() };
});

const mockValueScan = vi.mocked(valueScan);

function r(jsx: React.ReactElement) {
  return render(<UIProvider>{jsx}</UIProvider>);
}

afterEach(cleanup);

function row(symbol: string, overrides: Partial<ValueRow> = {}): ValueRow {
  return {
    symbol,
    name: `${symbol} Ltd`,
    exchange: "NSE",
    currency: "INR",
    price: 100,
    change: 0.5,
    mcap_bn: 10,
    rev_bn: 5,
    pe: 9.1,
    ps: 1.1,
    pb: 1.4,
    fcf_yield: 5.0,
    div_yield: 1.0,
    roe: 15.0,
    gross_margin: 30,
    op_margin: 15,
    rev_yoy: 7,
    eps_yoy: 6,
    debt_to_equity: 0.3,
    current_ratio: 1.5,
    rsi: 45,
    vs_200dma: 2.0,
    off_52w_high: -12.0,
    score: 78,
    subscores: { value: 80, quality: 75, growth: 70, health: 82 },
    peer: { bucket: "Banks", pe_median: 11.2, roe_median: 12.0, fcf_yield_median: 4.1 },
    flags: ["LOW_PE"],
    derived: {
      fcf_yield: 5.0,
      earnings_yield: 11.0,
      vs_200dma: 2.0,
      off_52w_high: -12.0,
      distorted_pe: false,
    },
    ...overrides,
  };
}

function response(rows: ValueRow[]): ValueScanResponse {
  return {
    market: "india",
    currency: "INR",
    as_of: "2026-10-21T10:00:00+05:30",
    scanned: 500,
    matched: rows.length,
    fields_complete: true,
    filters_applied: {},
    warnings: [],
    rows,
    sectors: [{ name: "Banks", count: rows.length, avg_score: 78 }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockValueScan.mockResolvedValue(response([row("RELIANCE"), row("TCS")]));
});

describe("ValuePanel", () => {
  test("shows loading state, then renders rows from the mock response", async () => {
    r(<ValuePanel />);
    expect(screen.getByTestId("value-loading")).toBeInTheDocument();
    expect(await screen.findByTestId("value-row-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("value-row-TCS")).toBeInTheDocument();
    expect(screen.getByTestId("value-summary")).toHaveTextContent("2 of 2 matches");
    expect(screen.getByTestId("value-sectors")).toHaveTextContent("Banks (2)");
    expect(screen.getByTestId("value-as-of")).toHaveTextContent("2026-10-21");
  });

  test("switching market tabs sends the new market to the client", async () => {
    const user = userEvent.setup();
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    expect(mockValueScan).toHaveBeenLastCalledWith(
      expect.objectContaining({ market: "india" }),
      expect.anything(),
    );
    await user.click(screen.getByTestId("value-market-tab-usa"));
    await waitFor(
      () => {
        expect(mockValueScan).toHaveBeenLastCalledWith(
          expect.objectContaining({ market: "usa" }),
          expect.anything(),
        );
      },
      { timeout: 3000 },
    );
  });

  test("applying a preset sends it to the client", async () => {
    const user = userEvent.setup();
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    await user.click(
      within(screen.getByTestId("value-preset-select")).getByRole("combobox"),
    );
    await user.click(await screen.findByRole("option", { name: "Deep" }));
    await waitFor(
      () => {
        expect(mockValueScan).toHaveBeenLastCalledWith(
          expect.objectContaining({ preset: "DEEP" }),
          expect.anything(),
        );
      },
      { timeout: 3000 },
    );
  });

  test("refresh button refetches", async () => {
    const user = userEvent.setup();
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    const calls = mockValueScan.mock.calls.length;
    await user.click(screen.getByTestId("value-refresh"));
    await waitFor(() => expect(mockValueScan.mock.calls.length).toBeGreaterThan(calls));
  });

  test("shows the empty state when no rows match", async () => {
    mockValueScan.mockResolvedValue(response([]));
    r(<ValuePanel />);
    expect(await screen.findByTestId("value-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("value-table")).not.toBeInTheDocument();
  });

  test("shows the error state on failure", async () => {
    mockValueScan.mockRejectedValue(new Error("network down"));
    r(<ValuePanel />);
    const err = await screen.findByTestId("value-error");
    expect(err).toHaveTextContent("network down");
  });

  test("CSV export produces a blob download", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn((_blob: Blob): string => "blob:csv");
    const revokeObjectURL = vi.fn();
    (URL as unknown as Record<string, unknown>).createObjectURL = createObjectURL;
    (URL as unknown as Record<string, unknown>).revokeObjectURL = revokeObjectURL;
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    await user.click(screen.getByTestId("value-export-csv"));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const firstCall = createObjectURL.mock.calls[0];
    expect(firstCall).toBeDefined();
    const blob = firstCall?.[0] as unknown as Blob;
    expect(blob.type).toBe("text/csv");
    const text = await blob.text();
    expect(text.split("\n")[0]).toContain("symbol");
    expect(text).toContain("RELIANCE");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:csv");
  });

  test("clicking a row opens the detail drawer", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    r(<ValuePanel onRowClick={onRowClick} />);
    await screen.findByTestId("value-row-RELIANCE");
    await user.click(screen.getByTestId("value-row-RELIANCE"));
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ symbol: "RELIANCE" }));
    expect(screen.getByTestId("value-detail-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("value-detail-sub-RELIANCE-value")).toBeInTheDocument();
  });
});
