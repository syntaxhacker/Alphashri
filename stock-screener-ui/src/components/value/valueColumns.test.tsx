// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { buildValueColumns } from "./valueColumns";
import type { ValueRow } from "../../api/valueScan";

function row(overrides: Partial<ValueRow> = {}): ValueRow {
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
    flags: ["LOW_PE"],
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

function nameAccessor(): (r: ValueRow) => unknown {
  const col = buildValueColumns().find((c) => c.id === "name");
  expect(col?.accessorFn).toBeTypeOf("function");
  return col!.accessorFn!;
}

describe("buildValueColumns NAME accessor", () => {
  it("returns the company name, falling back to the symbol", () => {
    const accessor = nameAccessor();
    expect(accessor(row({ symbol: "RELIANCE", name: "Reliance Industries" }))).toBe(
      "Reliance Industries",
    );
    const nameless = row({ symbol: "ACME" });
    expect(accessor({ ...nameless, name: undefined as unknown as string })).toBe("ACME");
  });

  it("sorts rows by name ascending and descending via the accessor", () => {
    const accessor = nameAccessor();
    const rows = [
      row({ symbol: "ZOMATO", name: "Zomato Ltd" }),
      row({ symbol: "ABB", name: "ABB India" }),
    ];
    const asc = [...rows].sort((a, b) =>
      String(accessor(a)).localeCompare(String(accessor(b))),
    );
    expect(asc.map((r) => r.symbol)).toEqual(["ABB", "ZOMATO"]);
    const desc = [...rows].sort((a, b) =>
      String(accessor(b)).localeCompare(String(accessor(a))),
    );
    expect(desc.map((r) => r.symbol)).toEqual(["ZOMATO", "ABB"]);
  });
});
