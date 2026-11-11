// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import { ValueTable } from "./ValueTable";
import { buildValueColumns } from "./valueColumns";
import type { ValueRow } from "../../api/valueScan";

function r(jsx: React.ReactElement) {
  return render(<UIProvider>{jsx}</UIProvider>);
}

afterEach(cleanup);

export function makeValueRow(overrides: Partial<ValueRow> = {}): ValueRow {
  return {
    symbol: "RELIANCE",
    name: "Reliance Industries",
    exchange: "NSE",
    currency: "INR",
    price: 2450.5,
    change: 1.25,
    mcap_bn: 331.0,
    rev_bn: 102.4,
    pe: 9.1,
    ps: 1.2,
    pb: 1.8,
    fcf_yield: 5.4,
    div_yield: 1.1,
    roe: 14.2,
    gross_margin: 32.0,
    op_margin: 18.5,
    rev_yoy: 8.3,
    eps_yoy: 6.1,
    debt_to_equity: 0.4,
    current_ratio: 1.6,
    rsi: 42.0,
    vs_200dma: 3.2,
    off_52w_high: -14.0,
    score: 78,
    subscores: { value: 80, quality: 75, growth: 70, health: 82 },
    peer: { bucket: "Refining", pe_median: 11.2, roe_median: 12.0, fcf_yield_median: 4.1 },
    flags: ["LOW_PE", "HIGH_FCF_YIELD"],
    derived: {
      fcf_yield: 5.4,
      earnings_yield: 11.0,
      vs_200dma: 3.2,
      off_52w_high: -14.0,
      distorted_pe: false,
    },
    ...overrides,
  };
}

describe("ValueTable", () => {
  test("renders rows with symbol, price, and score", () => {
    r(<ValueTable rows={[makeValueRow(), makeValueRow({ symbol: "TCS", name: "Tata Consultancy" })]} />);
    expect(screen.getByTestId("value-table")).toBeInTheDocument();
    expect(screen.getByTestId("value-row-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("value-row-TCS")).toBeInTheDocument();
    expect(screen.getByTestId("value-price-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("value-score-chip-RELIANCE")).toHaveTextContent("78");
  });

  test("renders flags and null-safe dashes", () => {
    r(
      <ValueTable
        rows={[
          makeValueRow({
            symbol: "NULLCO",
            pe: null,
            flags: ["LOW_PE", "NET_CASH", "HIGH_ROE", "EXTRA_FLAG"],
          }),
        ]}
      />,
    );
    const flags = screen.getByTestId("value-flags-NULLCO");
    expect(within(flags).getByText("LOW PE")).toBeInTheDocument();
    expect(screen.getByTestId("value-dash-NULLCO-pe")).toBeInTheDocument();
  });

  test("colors change green/red and shows negative sign", () => {
    r(
      <ValueTable
        rows={[makeValueRow({ symbol: "DOWN", change: -2.5 }), makeValueRow({ symbol: "UP", change: 2.5 })]}
      />,
    );
    expect(screen.getByTestId("value-change-DOWN")).toHaveTextContent("-2.5%");
    expect(screen.getByTestId("value-change-UP")).toHaveTextContent("+2.5%");
  });

  test("clicking a row calls onRowClick", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    const row = makeValueRow();
    r(<ValueTable rows={[row]} onRowClick={onRowClick} />);
    await user.click(screen.getByTestId("value-row-RELIANCE"));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(row);
  });

  test("applies explicit column alignment (numbers right, text left, chips centre)", () => {
    const cols = buildValueColumns();
    const alignOf = (id: string): string => {
      const col = cols.find((c) => c.id === id);
      expect(col, `column ${id} exists`).toBeDefined();
      return (col?.meta as { align?: string } | undefined)?.align ?? "MISSING";
    };
    expect(alignOf("name")).toBe("left");
    for (const id of ["price", "change", "mcap", "pe", "ps", "fcf", "roe", "rev", "w52"]) {
      expect(alignOf(id), `column ${id}`).toBe("right");
    }
    expect(alignOf("score")).toBe("center");
    expect(alignOf("flags")).toBe("center");
    // Every column declares alignment explicitly — never rely on auto-detect.
    for (const col of cols) {
      expect((col.meta as { align?: string } | undefined)?.align).toBeTruthy();
    }
  });
});
