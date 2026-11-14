// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import type { TableColumnDef } from "../common/TanStackTable";
import { buildFnoColumns } from "./fnoColumns";
import type { FnoScreenerRow } from "../../api/fnoScreener";

const EXPECTED_DATA_COLUMNS = [
  "symbol",
  "setup",
  "call",
  "spot",
  "d1",
  "d5",
  "vol_ratio",
  "otm_pct",
  "premium",
  "cost_lot",
  "pop",
  "delta",
  "gamma",
  "theta",
  "vega",
  "iv",
  "oi",
  "spread_pct",
  "move_2pct_est",
] as const;

const sampleRow: FnoScreenerRow = {
  symbol: "RELIANCE",
  spot: 2946,
  d1: 1.25,
  d5: 4.6,
  vol_ratio: 1.4,
  above20: 1,
  setup: "BREAKOUT",
  call: "CE",
  strike: 3000,
  otm_pct: 1.83,
  premium: 45.5,
  cost_lot: 9100,
  breakeven: 3045.5,
  pop: 62,
  delta: 0.55,
  gamma: 0.012,
  theta: -18.5,
  vega: 0.42,
  iv: 22.5,
  oi: 125000,
  volume: 45000,
  spread_pct: 0.8,
  move_2pct_est: 3.4,
};

type Accessor = (row: FnoScreenerRow) => unknown;

function accessorOf(columns: TableColumnDef<FnoScreenerRow>[], id: string): Accessor {
  const col = columns.find((c) => c.id === id);
  expect(col).toBeDefined();
  return col!.accessorFn as Accessor;
}

describe("buildFnoColumns", () => {
  // Build once, reuse across assertions.
  const columns = buildFnoColumns();

  it("exposes every expected data column plus the expander", () => {
    const ids = columns.map((c) => c.id);
    EXPECTED_DATA_COLUMNS.forEach((id) => expect(ids).toContain(id));
    expect(ids).toContain("expand");
    expect(columns.length).toBe(EXPECTED_DATA_COLUMNS.length + 1);
  });

  it("every data column has a callable accessorFn", () => {
    columns.forEach((col) => {
      if (col.id === "expand") return;
      expect(col.accessorFn).toBeTypeOf("function");
      expect(() => accessorOf(columns, col.id)(sampleRow)).not.toThrow();
    });
  });

  it("accessorFn returns the correct value from a sample row", () => {
    expect(accessorOf(columns, "premium")(sampleRow)).toBe(45.5);
    expect(accessorOf(columns, "pop")(sampleRow)).toBe(62);
    expect(accessorOf(columns, "move_2pct_est")(sampleRow)).toBe(3.4);
  });

  it("expander column has no accessorFn and sorting disabled", () => {
    const expand = columns.find((c) => c.id === "expand");
    expect(expand).toBeDefined();
    expect(expand?.accessorFn).toBeUndefined();
    expect(expand?.enableSorting).toBe(false);
  });

  it("every accessor maps to its matching row field", () => {
    const fieldById: Record<string, keyof FnoScreenerRow> = {
      symbol: "symbol",
      setup: "setup",
      call: "call",
      spot: "spot",
      d1: "d1",
      d5: "d5",
      vol_ratio: "vol_ratio",
      otm_pct: "otm_pct",
      premium: "premium",
      cost_lot: "cost_lot",
      pop: "pop",
      delta: "delta",
      gamma: "gamma",
      theta: "theta",
      vega: "vega",
      iv: "iv",
      oi: "oi",
      spread_pct: "spread_pct",
      move_2pct_est: "move_2pct_est",
    };
    EXPECTED_DATA_COLUMNS.forEach((id) => {
      expect(accessorOf(columns, id)(sampleRow)).toBe(sampleRow[fieldById[id]]);
    });
  });

  it("declares an alignment that matches the rendered cell", () => {
    const numbers = [
      "spot",
      "d1",
      "d5",
      "vol_ratio",
      "otm_pct",
      "premium",
      "cost_lot",
      "pop",
      "delta",
      "gamma",
      "theta",
      "vega",
      "iv",
      "oi",
      "spread_pct",
      "move_2pct_est",
    ];
    const alignOf = (id: string) =>
      (columns.find((c) => c.id === id)?.meta as { align?: string })?.align;
    numbers.forEach((id) => expect(alignOf(id), `${id} is numeric`).toBe("right"));
    expect(alignOf("symbol")).toBe("left");
    expect(alignOf("call")).toBe("left");
    expect(alignOf("setup")).toBe("center");
    expect(alignOf("expand")).toBe("center");
    for (const col of columns) {
      expect((col.meta as { align?: string } | undefined)?.align).toBeTruthy();
    }
  });
});
