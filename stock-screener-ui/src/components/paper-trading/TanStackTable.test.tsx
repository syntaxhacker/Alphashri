// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { TanStackTable, type TableColumnDef } from "./TanStackTable";

afterEach(() => {
  cleanup();
});

interface NullRow {
  id: string;
  name: string | null;
  value: number | null;
}

const headerOf = (tableId: string, index: number) =>
  screen.getByTestId(tableId).querySelectorAll<HTMLElement>("th")[index];

const orderOf = (tableId: string) =>
  Array.from(
    screen.getByTestId(tableId).querySelectorAll<HTMLTableRowElement>("tbody tr[data-row='stock']"),
  ).map((tr) => tr.dataset.testid);

const numData: NullRow[] = [
  { id: "r1", name: "Charlie", value: 3 },
  { id: "r2", name: "Bravo", value: null },
  { id: "r3", name: "Alpha", value: 1 },
  { id: "r4", name: "Delta", value: null },
  { id: "r5", name: "Echo", value: 2 },
];

const numColumns: TableColumnDef<NullRow>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  {
    id: "value",
    header: "Value",
    accessorKey: "value",
    cell: ({ row }) => <span>{row.original.value == null ? "—" : String(row.original.value)}</span>,
  },
];

const renderNumTable = (props?: { enableSortingRemoval?: boolean }) => {
  const tableId = props?.enableSortingRemoval === false ? "paper-noremove" : "paper-num";
  render(() => (
    <TanStackTable<NullRow>
      data={numData}
      columns={numColumns}
      dataTestId={tableId}
      getRowTestId={(r) => r.id}
      enableSortingRemoval={props?.enableSortingRemoval}
    />
  ));
  return tableId;
};

describe("paper-trading TanStackTable — null-safe sorting", () => {
  it("puts nulls last on a numeric column in both directions", () => {
    const tableId = renderNumTable();
    const valueTh = headerOf(tableId, 1);

    fireEvent.click(valueTh); // first click desc
    expect(orderOf(tableId)).toEqual(["r1", "r5", "r3", "r2", "r4"]);
    fireEvent.click(valueTh); // second click asc
    expect(orderOf(tableId)).toEqual(["r3", "r5", "r1", "r2", "r4"]);

    // The trailing rows render as missing, not as a real zero.
    const valueCells = Array.from(
      screen.getByTestId(tableId).querySelectorAll<HTMLTableRowElement>("tbody tr[data-row='stock']"),
    ).map((tr) => tr.querySelectorAll("td")[1].textContent!.trim());
    expect(valueCells.slice(-2)).toEqual(["—", "—"]);
  });

  it("puts nulls last on a string column in both directions", () => {
    const strData: NullRow[] = [
      { id: "s1", name: "Charlie", value: 1 },
      { id: "s2", name: null, value: 2 },
      { id: "s3", name: "Alpha", value: 3 },
      { id: "s4", name: null, value: 4 },
      { id: "s5", name: "Bravo", value: 5 },
    ];
    render(() => (
      <TanStackTable<NullRow>
        data={strData}
        columns={numColumns}
        dataTestId="paper-str"
        getRowTestId={(r) => r.id}
      />
    ));
    const nameTh = headerOf("paper-str", 0);

    fireEvent.click(nameTh); // text sorts ascending first
    expect(orderOf("paper-str")).toEqual(["s3", "s5", "s1", "s2", "s4"]);
    fireEvent.click(nameTh);
    expect(orderOf("paper-str")).toEqual(["s1", "s5", "s3", "s2", "s4"]);
  });

  it("never lets a mixed number/string column return NaN from the comparator", () => {
    type MixedRow = { id: string; v: number | string | null };
    const mixedData: MixedRow[] = [
      { id: "m1", v: 5 },
      { id: "m2", v: "abc" },
      { id: "m3", v: null },
      { id: "m4", v: 3 },
      { id: "m5", v: "10" },
    ];
    const mixedColumns: TableColumnDef<MixedRow>[] = [
      {
        id: "v",
        header: "V",
        accessorKey: "v",
        cell: ({ row }) => <span>{row.original.v == null ? "—" : String(row.original.v)}</span>,
      },
    ];
    render(() => (
      <TanStackTable<MixedRow>
        data={mixedData}
        columns={mixedColumns}
        dataTestId="paper-mixed"
        getRowTestId={(r) => r.id}
      />
    ));
    const vTh = headerOf("paper-mixed", 0);

    // A NaN comparator result is treated as 0 by sort(), leaving insertion order
    // untouched. Missing values must trail, and flipping the direction must
    // reorder — that proves the comparator returned a real ordering.
    fireEvent.click(vTh); // sample has a string → ascending
    const ascending = orderOf("paper-mixed");
    expect([...ascending].sort()).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(ascending.at(-1)).toBe("m3");
    expect(ascending).not.toEqual(["m1", "m2", "m3", "m4", "m5"]);

    fireEvent.click(vTh);
    const descending = orderOf("paper-mixed");
    expect([...descending].sort()).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(descending.at(-1)).toBe("m3");
    expect(descending).not.toEqual(ascending);
  });

  it("treats an empty string as missing, not as a sortable zero", () => {
    const emptyData: NullRow[] = [
      { id: "e1", name: "A", value: 3 },
      { id: "e2", name: "B", value: "" as unknown as number },
      { id: "e3", name: "C", value: 1 },
    ];
    render(() => (
      <TanStackTable<NullRow>
        data={emptyData}
        columns={numColumns}
        dataTestId="paper-empty"
        getRowTestId={(r) => r.id}
      />
    ));
    const valueTh = headerOf("paper-empty", 1);

    fireEvent.click(valueTh); // desc
    expect(orderOf("paper-empty")).toEqual(["e1", "e3", "e2"]);
    fireEvent.click(valueTh); // asc
    expect(orderOf("paper-empty")).toEqual(["e3", "e1", "e2"]);
  });
});

describe("paper-trading TanStackTable — sort cycle", () => {
  it("a numeric column's first click sorts descending", () => {
    const tableId = renderNumTable();
    fireEvent.click(headerOf(tableId, 1));
    expect(orderOf(tableId)[0]).toBe("r1"); // value 3, the largest
    expect(headerOf(tableId, 1).textContent).toContain("▼");
  });

  it("a numeric column cycles desc → asc → none → desc", () => {
    const tableId = renderNumTable();
    const valueTh = headerOf(tableId, 1);

    fireEvent.click(valueTh);
    expect(orderOf(tableId)).toEqual(["r1", "r5", "r3", "r2", "r4"]);
    expect(valueTh.textContent).toContain("▼");

    fireEvent.click(valueTh);
    expect(orderOf(tableId)).toEqual(["r3", "r5", "r1", "r2", "r4"]);
    expect(valueTh.textContent).toContain("▲");

    fireEvent.click(valueTh);
    expect(orderOf(tableId)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
    expect(valueTh.textContent).not.toContain("▲");
    expect(valueTh.textContent).not.toContain("▼");

    fireEvent.click(valueTh);
    expect(orderOf(tableId)[0]).toBe("r1");
    expect(valueTh.textContent).toContain("▼");
  });

  it("bounces between directions when enableSortingRemoval is false", () => {
    const tableId = renderNumTable({ enableSortingRemoval: false });
    const valueTh = headerOf(tableId, 1);

    fireEvent.click(valueTh);
    expect(valueTh.textContent).toContain("▼");
    fireEvent.click(valueTh);
    expect(valueTh.textContent).toContain("▲");
    fireEvent.click(valueTh);
    expect(valueTh.textContent).toContain("▼");
    expect(orderOf(tableId)[0]).toBe("r1");
  });

  it("clicking a second header makes it primary", () => {
    type MultiRow = { id: string; delta: number; pnl: number };
    const multiData: MultiRow[] = [
      { id: "x", delta: 1, pnl: 30 },
      { id: "y", delta: 3, pnl: 10 },
      { id: "z", delta: 2, pnl: 20 },
    ];
    const multiColumns: TableColumnDef<MultiRow>[] = [
      { id: "delta", header: "Delta", accessorKey: "delta" },
      { id: "pnl", header: "PnL", accessorKey: "pnl" },
    ];
    render(() => (
      <TanStackTable<MultiRow>
        data={multiData}
        columns={multiColumns}
        dataTestId="paper-multi"
        getRowTestId={(r) => r.id}
      />
    ));

    fireEvent.click(headerOf("paper-multi", 0)); // delta desc → y, z, x
    fireEvent.click(headerOf("paper-multi", 1)); // pnl desc → x, z, y
    expect(orderOf("paper-multi")).toEqual(["x", "z", "y"]);
  });
});

describe("paper-trading TanStackTable — keyboard sorting", () => {
  it("makes a sortable header keyboard-operable and reflects sort state in aria-sort", () => {
    const tableId = renderNumTable();
    const valueTh = headerOf(tableId, 1);

    expect(valueTh).toHaveAttribute("tabindex", "0");
    expect(valueTh).toHaveAttribute("aria-sort", "none");

    valueTh.focus();
    expect(document.activeElement).toBe(valueTh);

    fireEvent.keyDown(valueTh, { key: "Enter" });
    expect(valueTh).toHaveAttribute("aria-sort", "descending");
    expect(valueTh.textContent).toContain("▼");
    expect(orderOf(tableId)).toEqual(["r1", "r5", "r3", "r2", "r4"]);

    fireEvent.keyDown(valueTh, { key: " " });
    expect(valueTh).toHaveAttribute("aria-sort", "ascending");
    expect(valueTh.textContent).toContain("▲");
    expect(orderOf(tableId)).toEqual(["r3", "r5", "r1", "r2", "r4"]);
  });

  it("keeps non-sortable headers out of the tab order and without aria-sort", () => {
    const staticColumns: TableColumnDef<NullRow>[] = [
      { id: "name", header: "Name", accessorKey: "name", enableSorting: false },
    ];
    render(() => (
      <TanStackTable<NullRow>
        data={numData}
        columns={staticColumns}
        dataTestId="paper-static"
        getRowTestId={(r) => r.id}
      />
    ));
    const th = headerOf("paper-static", 0);

    expect(th).not.toHaveAttribute("tabindex");
    expect(th).not.toHaveAttribute("aria-sort");
    fireEvent.keyDown(th, { key: "Enter" });
    expect(orderOf("paper-static")).toEqual(["r1", "r2", "r3", "r4", "r5"]);
  });
});

describe("paper-trading TanStackTable — controlled sorting", () => {
  it("renders from the passed sorting and emits changes without mutating the source", () => {
    const changes: Array<Array<{ id: string; desc: boolean }>> = [];
    const controlled = [{ id: "value", desc: false }];
    render(() => (
      <TanStackTable<NullRow>
        data={numData}
        columns={numColumns}
        dataTestId="paper-controlled"
        getRowTestId={(r) => r.id}
        sorting={controlled}
        onSortingChange={(next) => changes.push(next)}
      />
    ));
    expect(orderOf("paper-controlled")).toEqual(["r3", "r5", "r1", "r2", "r4"]);
    expect(headerOf("paper-controlled", 1)).toHaveAttribute("aria-sort", "ascending");

    fireEvent.click(headerOf("paper-controlled", 1));
    // Controlled: the caller owns the value, so emitting [] does not change the rendered order.
    expect(changes).toEqual([[]]);
    expect(orderOf("paper-controlled")).toEqual(["r3", "r5", "r1", "r2", "r4"]);
  });

  it("uncontrolled table keeps its internal signal and still emits", () => {
    const changes: Array<Array<{ id: string; desc: boolean }>> = [];
    render(() => (
      <TanStackTable<NullRow>
        data={numData}
        columns={numColumns}
        dataTestId="paper-uncontrolled"
        getRowTestId={(r) => r.id}
        onSortingChange={(next) => changes.push(next)}
      />
    ));
    fireEvent.click(headerOf("paper-uncontrolled", 1)); // numeric → desc
    expect(orderOf("paper-uncontrolled")).toEqual(["r1", "r5", "r3", "r2", "r4"]);
    expect(changes).toEqual([[{ id: "value", desc: true }]]);
  });

  it("initialSorting seeds an uncontrolled table", () => {
    render(() => (
      <TanStackTable<NullRow>
        data={numData}
        columns={numColumns}
        dataTestId="paper-seeded"
        getRowTestId={(r) => r.id}
        initialSorting={[{ id: "value", desc: false }]}
      />
    ));
    expect(orderOf("paper-seeded")).toEqual(["r3", "r5", "r1", "r2", "r4"]);
    expect(headerOf("paper-seeded", 1)).toHaveAttribute("aria-sort", "ascending");
  });
});
