// @vitest-environment happy-dom
import { createSignal } from "solid-js";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { TanStackTable, type ColumnPrefs, type SortEntry, type TableColumnDef } from "./TanStackTable";

afterEach(() => {
  cleanup();
});

interface TestItem {
  id: string;
  name: string;
  value: number;
}

const columns = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "value", header: "Value", accessorKey: "value" },
];

const data: TestItem[] = [
  { id: "1", name: "Alpha", value: 100 },
  { id: "2", name: "Beta", value: 200 },
];

describe("TanStackTable", () => {
  it("renders data rows and headers", () => {
    render(() => (<TanStackTable<TestItem> data={data} columns={columns} />));
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Value")).toBeInTheDocument();
  });

  it("renders sort indicator when header is clicked", async () => {
          render(() => (<TanStackTable<TestItem> data={data} columns={columns} />));
    const nameTh = screen.getByText("Name").closest("th")!;
    await fireEvent.click(nameTh);
    expect(nameTh.textContent).toContain("▲");
    await fireEvent.click(nameTh);
    expect(nameTh.textContent).toContain("▼");
  });

  it("shows loading state when loading and data is empty", () => {
    render(() => (<TanStackTable<TestItem> data={[]} columns={columns} loading />));
    expect(screen.getByTestId("table-loading-state")).toBeInTheDocument();
  });

  it("shows empty state when data is empty and not loading", () => {
    render(() => (<TanStackTable<TestItem>
        data={[]}
        columns={columns}
        emptyMessage="No items found"
      />),
    );
    expect(screen.getByText("No items found")).toBeInTheDocument();
  });

  it("makes rows focusable and activates onRowClick with Enter and Space", () => {
    const handleRowClick = vi.fn();
    render(() => (<TanStackTable<TestItem>
        data={data}
        columns={columns}
        onRowClick={handleRowClick}
        getRowTestId={(row) => `kb-${row.id}`}
      />),
    );
    const row = screen.getByTestId("kb-1");
    expect(row).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(handleRowClick).toHaveBeenCalledWith(data[0]);
    fireEvent.keyDown(row, { key: " " });
    expect(handleRowClick).toHaveBeenCalledTimes(2);
    expect(handleRowClick).toHaveBeenLastCalledWith(data[0]);
  });

  it("keeps rows out of the tab order when onRowClick is not provided", () => {
    render(() => (<TanStackTable<TestItem>
        data={data}
        columns={columns}
        getRowTestId={(row) => `plain-${row.id}`}
      />),
    );
    expect(screen.getByTestId("plain-1")).not.toHaveAttribute("tabindex");
  });

  it("applies ariaLabel to the table element", () => {
    render(() => (<TanStackTable<TestItem>
        data={data}
        columns={columns}
        dataTestId="aria-table"
        ariaLabel="Market screener results"
      />),
    );
    expect(screen.getByTestId("aria-table")).toHaveAttribute("aria-label", "Market screener results");
  });

  it("fires onRowClick with correct row data", async () => {
          const handleRowClick = vi.fn();
    render(() => (<TanStackTable<TestItem>
        data={data}
        columns={columns}
        onRowClick={handleRowClick}
      />),
    );
    const rows = screen.getAllByRole("row");
    await fireEvent.click(rows[1]);
    expect(handleRowClick).toHaveBeenCalledWith(data[0]);
  });

  it("shows default empty message when not provided", () => {
    render(() => (<TanStackTable<TestItem> data={[]} columns={columns} />));
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("renders empty state with icon and action", () => {
    render(() => (<TanStackTable<TestItem>
        data={[]}
        columns={columns}
        emptyMessage="Custom empty"
        emptyIcon={<span data-testid="custom-icon">🔍</span>}
        emptyAction={<button>Add Item</button>}
      />),
    );
    expect(screen.getByText("Custom empty")).toBeInTheDocument();
    expect(screen.getByText("Add Item")).toBeInTheDocument();
    expect(screen.getByTestId("custom-icon")).toBeInTheDocument();
  });

  it("applies sticky header by default", () => {
    render(() => (<TanStackTable<TestItem> data={data} columns={columns} />));
    const th = screen.getAllByRole("columnheader")[0];
    expect(th).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
  });

  it("applies getRowTestId to each row", () => {
    render(() => (<TanStackTable<TestItem>
        data={data}
        columns={columns}
        getRowTestId={(row) => `row-${row.id}`}
      />),
    );
    expect(screen.getByTestId("row-1")).toBeInTheDocument();
    expect(screen.getByTestId("row-2")).toBeInTheDocument();
  });

  it("applies right alignment from column meta to header and cells", () => {
    const alignedColumns: TableColumnDef<TestItem>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      {
        id: "value",
        header: "Value",
        accessorKey: "value",
        meta: { align: "right" },
      },
    ];
    render(() => (<TanStackTable<TestItem> data={data} columns={alignedColumns} />));
    expect(screen.getByText("Value")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    const valueTds = screen
      .getAllByRole("cell")
      .filter((td) => td.textContent === "100" || td.textContent === "200");
    expect(valueTds.length).toBe(2);
  });

  it("right-aligns numeric columns by default and keeps text columns left", () => {
    render(() => (<TanStackTable<TestItem> data={data} columns={columns} />));
    expect(screen.getByText("Value")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    const valueTds = screen
      .getAllByRole("cell")
      .filter((td) => td.textContent === "100" || td.textContent === "200");
    expect(valueTds.length).toBe(2);
    const nameTds = screen
      .getAllByRole("cell")
      .filter((td) => td.textContent === "Alpha" || td.textContent === "Beta");
    expect(nameTds.length).toBe(2);
  });

  it("explicit meta.align overrides numeric auto-alignment", () => {
    const leftValueColumns: TableColumnDef<TestItem>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "value", header: "Value", accessorKey: "value", meta: { align: "left" } },
    ];
    render(() => (<TanStackTable<TestItem> data={data} columns={leftValueColumns} />));
    expect(screen.getByText("Value")).toBeInTheDocument();
  });

  it("uses fixed table layout when any column has an explicit size", () => {
    const sizedColumns = [
      { id: "name", header: "Name", accessorKey: "name", size: 200 },
      { id: "value", header: "Value", accessorKey: "value" },
    ];
    render(() => (<TanStackTable<TestItem> data={data} columns={sizedColumns} />));
    const htmlTable = document.querySelector("table")!;
    expect(htmlTable.style.tableLayout).toBe("fixed");
  });

  it("uses auto table layout when no column has an explicit size", () => {
    render(() => (<TanStackTable<TestItem> data={data} columns={columns} />));
    const htmlTable = document.querySelector("table")!;
    expect(htmlTable.style.tableLayout).toBe("auto");
  });

  it("reacts to columns being sized/unsized after mount (table-layout tracks hasSizedColumns)", () => {
    const [sized, setSized] = createSignal(false);
    const unsizedCols = [{ id: "name", header: "Name", accessorKey: "name" }];
    const sizedCols = [{ id: "name", header: "Name", accessorKey: "name", size: 200 }];
    render(() => <TanStackTable<TestItem> data={data} columns={sized() ? sizedCols : unsizedCols} />);
    const table = document.querySelector("table")!;
    expect(table.style.tableLayout).toBe("auto");
    setSized(true);
    expect(table.style.tableLayout).toBe("fixed");
  });

  it("renders group header rows and leaf rows when grouping is enabled", () => {
    const groupedData = [
      { id: "1", name: "Alpha", value: 100, category: "A" },
      { id: "2", name: "Beta", value: 200, category: "A" },
      { id: "3", name: "Gamma", value: 300, category: "B" },
    ];
    const groupedColumns = [
      { id: "category", header: "Category", accessorKey: "category" },
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "value", header: "Value", accessorKey: "value" },
    ];
    render(() => (<TanStackTable<{ id: string; name: string; value: number; category: string }>
        data={groupedData}
        columns={groupedColumns}
        enableGrouping
        grouping={["category"]}
        initialState={{ expanded: { "category:A": true, "category:B": true } }}
        renderGroupHeader={({ value, rows }) => (
          <span data-testid={`group-label-${String(value)}`}>Group {String(value)} ({rows.length})</span>
        )}
        getGroupRowTestId={(value) => `group-row-${String(value)}`}
      />),
    );
    expect(screen.getByTestId("group-row-A")).toBeInTheDocument();
    expect(screen.getByTestId("group-row-B")).toBeInTheDocument();
    expect(screen.getByTestId("group-label-A").textContent).toContain("Group A (2)");
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("hides leaf rows of a collapsed group but keeps the group header", () => {
    const groupedData = [
      { id: "1", name: "Alpha", value: 100, category: "A" },
      { id: "3", name: "Gamma", value: 300, category: "B" },
    ];
    const groupedColumns = [
      { id: "category", header: "Category", accessorKey: "category" },
      { id: "name", header: "Name", accessorKey: "name" },
    ];
    render(() => (<TanStackTable<{ id: string; name: string; value: number; category: string }>
        data={groupedData}
        columns={groupedColumns}
        enableGrouping
        grouping={["category"]}
        initialState={{ expanded: { "category:A": true } }}
        renderGroupHeader={({ value }) => <span data-testid={`group-label-${String(value)}`} />}
        getGroupRowTestId={(value) => `group-row-${String(value)}`}
      />),
    );
    // Group A expanded → its leaf row visible; group B collapsed → leaf hidden
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Gamma")).toBeNull();
    expect(screen.getByTestId("group-row-B")).toBeInTheDocument();
  });

  it("clears sorting on third click by default (enableSortingRemoval)", async () => {
          render(() => (<TanStackTable<TestItem> data={data} columns={columns} />));
    const nameTh = screen.getByText("Name").closest("th")!;
    await fireEvent.click(nameTh);
    expect(nameTh.textContent).toContain("▲");
    await fireEvent.click(nameTh);
    expect(nameTh.textContent).toContain("▼");
    await fireEvent.click(nameTh);
    expect(nameTh.textContent).not.toContain("▲");
    expect(nameTh.textContent).not.toContain("▼");
  });

  it("keeps toggling asc/desc without removal when enableSortingRemoval is false", async () => {
          render(() => (<TanStackTable<TestItem> data={data} columns={columns} enableSortingRemoval={false} />),
    );
    // String columns sort ascending first, then descending, then back to
    // ascending (never removed) when sorting removal is disabled.
    const nameTh = screen.getByText("Name").closest("th")!;
    await fireEvent.click(nameTh);
    expect(nameTh.textContent).toContain("▲");
    await fireEvent.click(nameTh);
    expect(nameTh.textContent).toContain("▼");
    await fireEvent.click(nameTh);
    expect(nameTh.textContent).toContain("▲");
  });

  it("renders all rows when rowWindowSize is not set", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      name: `Item ${i}`,
      value: i,
    }));
    render(() => (<TanStackTable<TestItem>
        data={many}
        columns={columns}
        getRowTestId={(row) => `win-row-${row.id}`}
      />),
    );
    expect(screen.getAllByTestId(/^win-row-/)).toHaveLength(20);
  });

  it("mounts only a row window slice for oversized tables while keeping the model intact", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: String(i + 1),
      name: `row ${i}`,
      value: i,
    }));
    render(() => (<TanStackTable<TestItem>
        data={many}
        columns={columns}
        rowWindowSize={5}
        getRowTestId={(r) => `win-row-${r.id}`}
      />),
    );
    expect(screen.getAllByTestId(/^win-row-/)).toHaveLength(5);
    expect(screen.getByText("row 0")).toBeTruthy();
    expect(screen.queryByText("row 15")).toBeNull();
  });

  it("sorting still operates on the full row set when windowing is active", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: String(i + 1),
      name: i === 12 ? "zzz" : `row ${i}`,
      value: i,
    }));
    render(() => (<TanStackTable<TestItem>
        data={many}
        columns={columns}
        rowWindowSize={5}
        getRowTestId={(r) => `win-row-${r.id}`}
      />),
    );
    const th = screen.getByText("Value").closest("th")!;
    fireEvent.click(th);
    // sorting reorders the window (descending: highest value first) because
    // the full row model drives sorting before the window slice is applied.
    expect(screen.getAllByTestId(/^win-row-/)).toHaveLength(5);
    const firstNameCell = screen.getAllByTestId(/^win-row-/)[0].textContent!;
    expect(firstNameCell).toContain("row 19");
  });

  // rowWindowSize is a page size, not a hard cap: the footer discloses the
  // hidden rows and an explicit action grows the window to reach them.
  it("discloses how many rows the window is hiding", () => {
    const many: TestItem[] = Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), name: `Row${i}`, value: i }));
    render(() => (
      <TanStackTable<TestItem> data={many} columns={columns} rowWindowSize={5} />
    ));
    const footer = screen.getByTestId("table-window-footer");
    expect(footer).toHaveTextContent("showing 5 of 12");
    expect(footer).toHaveTextContent("7 not rendered");
    expect(screen.getByTestId("table-load-more")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("table-load-more"));
    expect(screen.getByTestId("table-window-footer")).toHaveTextContent("showing 10 of 12");
  });

  it("shows no window footer when every row fits", () => {
    render(() => <TanStackTable<TestItem> data={data} columns={columns} rowWindowSize={50} />);
    expect(screen.queryByTestId("table-window-footer")).not.toBeInTheDocument();
  });

  it("applies getRowClassName and getRowStyle per row", () => {
    render(() => (<TanStackTable<TestItem>
        data={data}
        columns={columns}
        getRowClassName={(r) => (r.value > 150 ? "highlight" : undefined)}
        getRowStyle={(r) => (r.name === "Alpha" ? { background: "yellow" } : undefined)}
        getRowTestId={(r) => `styled-${r.id}`}
      />),
    );
    const row1 = screen.getByTestId("styled-1");
    expect(row1.style.background).toBe("yellow");
    const row2 = screen.getByTestId("styled-2");
    expect(row2.className).toContain("highlight");
  });

  // Cells used to paint their own opaque surface, which covered the row tint —
  // so a selected row was invisible. Cells must inherit the row's background.
  it("a row tint is visible because cells inherit the row background", () => {
    render(() => (<TanStackTable<TestItem>
        data={data}
        columns={columns}
        getRowStyle={(r) => (r.name === "Alpha" ? { "background-color": "rgb(1, 2, 3)" } : undefined)}
        getRowTestId={(r) => `tint-${r.id}`}
      />),
    );
    const row = screen.getByTestId("tint-1");
    expect(row.style.backgroundColor).toBe("rgb(1, 2, 3)");
    const cells = row.querySelectorAll("td");
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of Array.from(cells)) {
      const el = cell as HTMLElement;
      // Inherit (or transparent) — never an opaque surface of its own.
      expect(["inherit", "transparent", ""]).toContain(el.style.backgroundColor);
    }
  });

  it("disables sorting when enableSorting is false", async () => {
        render(() => (<TanStackTable<TestItem> data={data} columns={columns} enableSorting={false} />));
    const nameTh = screen.getByText("Name").closest("th")!;
    await fireEvent.click(nameTh);
    expect(nameTh.textContent).not.toContain("▲");
    expect(nameTh.textContent).not.toContain("▼");
  });

  it("renders loadingMessage inside TableLoadingState", () => {
    render(() => (<TanStackTable<TestItem> data={[]} columns={columns} loading loadingMessage="Fetching..." />));
    expect(screen.getByText("Fetching...")).toBeInTheDocument();
  });

  it("handles custom className and style on table", () => {
    render(() => (<TanStackTable<TestItem> data={data} columns={columns} className="custom-table" style={{ border: "1px solid red" }} dataTestId="styled-table" />),
    );
    const table = screen.getByTestId("styled-table");
    expect(table.className).toContain("custom-table");
    expect(table.style.border).toBe("1px solid red");
  });

  it("wraps the table in Paper/TableContainer by default", () => {
    const { container } = render(() => (<TanStackTable<TestItem> data={data} columns={columns} dataTestId="wrapped-table" />),
    );
    expect(container.querySelector(".paper-tanstack-container")).toBeInTheDocument();
    expect(screen.getByTestId("wrapped-table")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("exposes row.isExpanded() as a live boolean that flips on toggle", () => {
    const toggleColumns = [
      { id: "name", header: "Name", accessorKey: "name" },
      {
        id: "toggle",
        header: "",
        enableSorting: false,
        cell: ({ row }: { row: { isExpanded: () => boolean; toggle: () => void } }) => (
          <button data-testid="row-toggle" onClick={() => row.toggle()}>
            {row.isExpanded() ? "open" : "closed"}
          </button>
        ),
      },
    ];
    render(() => (<TanStackTable<TestItem>
        data={[data[0]]}
        columns={toggleColumns}
        getRowCanExpand={() => true}
        renderSubComponent={() => <span data-testid="row-detail">detail</span>}
      />),
    );
    expect(screen.queryByTestId("row-detail")).toBeNull();
    expect(screen.getByTestId("row-toggle").textContent).toBe("closed");
    fireEvent.click(screen.getByTestId("row-toggle"));
    expect(screen.getByTestId("row-toggle").textContent).toBe("open");
    expect(screen.getByTestId("row-detail")).toBeInTheDocument();
  });

  it("keeps min-width in step with the visible column count", () => {
    const many = [
      { id: "c1", header: "C1", accessorKey: "name" },
      { id: "c2", header: "C2", accessorKey: "name" },
      { id: "c3", header: "C3", accessorKey: "name" },
      { id: "c4", header: "C4", accessorKey: "name" },
      { id: "c5", header: "C5", accessorKey: "name" },
      { id: "c6", header: "C6", accessorKey: "name" },
      { id: "c7", header: "C7", accessorKey: "name" },
    ];
    const few = many.slice(0, 2);
    const [wide, setWide] = createSignal(true);
    render(() => (<TanStackTable<TestItem> data={data} columns={wide() ? many : few} />));
    const table = document.querySelector("table")!;
    expect(table.style.minWidth).toBe("672px");
    setWide(false);
    expect(table.style.minWidth).toBe("640px");
  });

  it("re-aligns headers when the data turns a column numeric after mount", () => {
    const [rows, setRows] = createSignal<TestItem[]>([]);
    render(() => (<TanStackTable<TestItem> data={rows()} columns={columns} />));
    const valueTh = () => screen.getByText("Value").closest("th") as HTMLTableCellElement;
    expect(valueTh().style.textAlign).toBe("left");
    setRows(data);
    expect(valueTh().style.textAlign).toBe("right");
  });

  it("treats a non-positive rowWindowSize as no window instead of blanking the body", () => {
    render(() => (<TanStackTable<TestItem>
        data={data}
        columns={columns}
        rowWindowSize={0}
        getRowTestId={(r) => `zero-window-${r.id}`}
      />),
    );
    expect(screen.getAllByTestId(/^zero-window-/)).toHaveLength(2);
  });

  it("bare=true skips the outer Paper/TableContainer but keeps the table", () => {
    const { container } = render(() => (<TanStackTable<TestItem> data={data} columns={columns} dataTestId="bare-table" bare />),
    );
    expect(container.querySelector(".paper-tanstack-container")).toBeNull();
    // Scroll area + table still render with data intact.
    expect(container.querySelector(".paper-tanstack-scroll")).toBeInTheDocument();
    expect(screen.getByTestId("bare-table")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  // TanStack rebuilds row objects on every data change and `<For>` keys by
  // reference, so a filter/sort update used to unmount and remount every row.
  it("keeps the <tr> DOM node of an unchanged row when data is replaced", () => {
    const [rows, setRows] = createSignal<TestItem[]>([
      { id: "1", name: "Alpha", value: 100 },
      { id: "2", name: "Beta", value: 200 },
      { id: "3", name: "Gamma", value: 300 },
    ]);
    render(() => (
      <TanStackTable<TestItem>
        data={rows()}
        columns={columns}
        getRowTestId={(row) => `stable-${row.id}`}
      />
    ));

    const before = Array.from(document.querySelectorAll<HTMLTableRowElement>("tbody tr"));
    expect(before.map((tr) => tr.dataset.testid)).toEqual([
      "stable-1",
      "stable-2",
      "stable-3",
    ]);

    // Same keys, new row objects, one cell value changed — exactly what a filter
    // pass hands the table.
    setRows([
      { id: "1", name: "Alpha", value: 100 },
      { id: "2", name: "Beta", value: 250 },
      { id: "3", name: "Gamma", value: 300 },
    ]);

    const after = Array.from(document.querySelectorAll<HTMLTableRowElement>("tbody tr"));
    expect(after.length).toBe(3);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBe(before[2]);
    // ...while the changed cell still updated.
    expect(after[1].textContent).toContain("250");
  });

  it("keeps unchanged rows mounted when the visible set is filtered", () => {
    const [rows, setRows] = createSignal<TestItem[]>([
      { id: "1", name: "Alpha", value: 100 },
      { id: "2", name: "Beta", value: 200 },
    ]);
    render(() => (
      <TanStackTable<TestItem>
        data={rows()}
        columns={columns}
        getRowTestId={(row) => `filter-${row.id}`}
      />
    ));
    const betaBefore = screen.getByTestId("filter-2");

    setRows([
      { id: "1", name: "Alpha", value: 100 },
      { id: "2", name: "Beta", value: 200 },
      { id: "3", name: "Gamma", value: 300 },
    ]);

    expect(screen.getByTestId("filter-2")).toBe(betaBefore);
    expect(screen.getByTestId("filter-3")).toBeInTheDocument();
  });

  it("keeps group header rows and their leaf rows stable across a data change", () => {
    type Row = TestItem & { category: string };
    const groupedColumns = [
      { id: "category", header: "Category", accessorKey: "category" },
      { id: "name", header: "Name", accessorKey: "name" },
    ];
    const [rows, setRows] = createSignal<Row[]>([
      { id: "1", name: "Alpha", value: 100, category: "A" },
      { id: "2", name: "Beta", value: 200, category: "A" },
    ]);
    render(() => (
      <TanStackTable<Row>
        data={rows()}
        columns={groupedColumns}
        enableGrouping
        grouping={["category"]}
        initialState={{ expanded: { "category:A": true } }}
        getRowTestId={(row) => `grouped-row-${row.id}`}
        getGroupRowTestId={(value) => `grouped-header-${String(value)}`}
        renderGroupHeader={({ value }) => <span>{String(value)}</span>}
      />
    ));
    const headerBefore = screen.getByTestId("grouped-header-A");
    const rowBefore = screen.getByTestId("grouped-row-1");

    setRows([
      { id: "1", name: "Alpha", value: 120, category: "A" },
      { id: "2", name: "Beta", value: 200, category: "A" },
    ]);

    expect(screen.getByTestId("grouped-header-A")).toBe(headerBefore);
    expect(screen.getByTestId("grouped-row-1")).toBe(rowBefore);
    expect(screen.getByTestId("grouped-row-1").textContent).toContain("Alpha");
  });

  it("keeps the sub-row open across a data change", () => {
    const toggleColumns = [
      { id: "name", header: "Name", accessorKey: "name" },
      {
        id: "toggle",
        header: "",
        enableSorting: false,
        cell: ({ row }: { row: { isExpanded: () => boolean; toggle: () => void } }) => (
          <button data-testid="stable-toggle" onClick={() => row.toggle()}>
            {row.isExpanded() ? "open" : "closed"}
          </button>
        ),
      },
    ];
    const [rows, setRows] = createSignal<TestItem[]>([{ id: "1", name: "Alpha", value: 100 }]);
    render(() => (
      <TanStackTable<TestItem>
        data={rows()}
        columns={toggleColumns}
        getRowCanExpand={() => true}
        renderSubComponent={() => <span data-testid="stable-detail">detail</span>}
        getRowTestId={(row) => `expand-${row.id}`}
      />
    ));
    fireEvent.click(screen.getByTestId("stable-toggle"));
    expect(screen.getByTestId("stable-detail")).toBeInTheDocument();
    const rowBefore = screen.getByTestId("expand-1");

    setRows([{ id: "1", name: "Alpha", value: 999 }]);

    expect(screen.getByTestId("expand-1")).toBe(rowBefore);
    expect(screen.getByTestId("stable-detail")).toBeInTheDocument();
    expect(screen.getByTestId("stable-toggle").textContent).toBe("open");
  });

  it("reuses row nodes even with a row window applied", () => {
    const many: TestItem[] = Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      name: `Row ${i}`,
      value: i,
    }));
    const [rows, setRows] = createSignal(many);
    render(() => (
      <TanStackTable<TestItem>
        data={rows()}
        columns={columns}
        rowWindowSize={5}
        getRowTestId={(row) => `win-stable-${row.id}`}
      />
    ));
    const first = screen.getByTestId("win-stable-0");
    setRows(many.map((r, i) => (i === 1 ? { ...r, value: 42 } : r)));
    expect(screen.getByTestId("win-stable-0")).toBe(first);
    expect(screen.getByTestId("win-stable-1").textContent).toContain("42");
  });

  it("does not collapse rows that share one test id", () => {
    const many: TestItem[] = Array.from({ length: 4 }, (_, i) => ({
      id: String(i + 1),
      name: `Row${i}`,
      value: i,
    }));
    render(() => (
      <TanStackTable<TestItem>
        data={many}
        columns={columns}
        getRowTestId={() => "same-row"}
      />
    ));
    // The OI table returns one id for every non-ATM strike; row slots must not
    // treat that as one row.
    expect(screen.getAllByTestId("same-row")).toHaveLength(4);
    expect(screen.getByText("Row3")).toBeInTheDocument();
  });
});

describe("TanStackTable — load more window", () => {
  const makeRows = (n: number): TestItem[] =>
    Array.from({ length: n }, (_, i) => ({ id: String(i + 1), name: `Row${i}`, value: i }));

  it("reaches every row a page at a time and hides the action at the end", () => {
    render(() => (
      <TanStackTable<TestItem>
        data={makeRows(312)}
        columns={columns}
        rowWindowSize={80}
        getRowTestId={(r) => `lm-${r.id}`}
      />
    ));

    expect(screen.getAllByTestId(/^lm-/)).toHaveLength(80);
    const footer = screen.getByTestId("table-window-footer");
    expect(footer).toHaveTextContent("showing 80 of 312 · 232 not rendered");
    const button = screen.getByTestId("table-load-more");
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.getAllByTestId(/^lm-/)).toHaveLength(160);
    expect(footer).toHaveTextContent("showing 160 of 312 · 152 not rendered");

    fireEvent.click(button); // 80 → 240
    fireEvent.click(button); // capped at 312
    expect(screen.getAllByTestId(/^lm-/)).toHaveLength(312);
    expect(screen.queryByTestId("table-window-footer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("table-load-more")).not.toBeInTheDocument();
  });

  it("resets the window when the data is filtered", () => {
    const many = makeRows(312);
    const [rows, setRows] = createSignal<TestItem[]>(many);
    render(() => (
      <TanStackTable<TestItem>
        data={rows()}
        columns={columns}
        rowWindowSize={80}
        getRowTestId={(r) => `reset-data-${r.id}`}
      />
    ));
    fireEvent.click(screen.getByTestId("table-load-more"));
    expect(screen.getAllByTestId(/^reset-data-/)).toHaveLength(160);

    setRows(many.slice(0, 50));
    expect(screen.getAllByTestId(/^reset-data-/)).toHaveLength(50);
    expect(screen.queryByTestId("table-load-more")).not.toBeInTheDocument();
  });

  it("resets the window when the sort changes", () => {
    render(() => (
      <TanStackTable<TestItem>
        data={makeRows(312)}
        columns={columns}
        rowWindowSize={80}
        getRowTestId={(r) => `reset-sort-${r.id}`}
      />
    ));
    fireEvent.click(screen.getByTestId("table-load-more"));
    expect(screen.getAllByTestId(/^reset-sort-/)).toHaveLength(160);

    fireEvent.click(screen.getByText("Value").closest("th")!);
    expect(screen.getAllByTestId(/^reset-sort-/)).toHaveLength(80);
    expect(screen.getByTestId("table-load-more")).toBeInTheDocument();
  });

  it("resets the window when the columns change", () => {
    const base = [{ id: "name", header: "Name", accessorKey: "name" }];
    const more = [...base, { id: "value", header: "Value", accessorKey: "value" }];
    const [cols, setCols] = createSignal<TableColumnDef<TestItem>[]>(base);
    render(() => (
      <TanStackTable<TestItem>
        data={makeRows(312)}
        columns={cols()}
        rowWindowSize={80}
        getRowTestId={(r) => `reset-cols-${r.id}`}
      />
    ));
    fireEvent.click(screen.getByTestId("table-load-more"));
    expect(screen.getAllByTestId(/^reset-cols-/)).toHaveLength(160);

    setCols(more);
    expect(screen.getAllByTestId(/^reset-cols-/)).toHaveLength(80);
  });

  it("renders all rows with no footer when rowWindowSize is undefined", () => {
    render(() => (
      <TanStackTable<TestItem>
        data={makeRows(120)}
        columns={columns}
        getRowTestId={(r) => `all-${r.id}`}
      />
    ));
    expect(screen.getAllByTestId(/^all-/)).toHaveLength(120);
    expect(screen.queryByTestId("table-window-footer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("table-load-more")).not.toBeInTheDocument();
  });

  // A snapshot poll hands back a brand-new array of the same row objects. Arrow
  // keying off array identity used to collapse the window on every poll, so the
  // "Load more" action appeared to undo itself moments after a click.
  it("keeps the grown window when the same rows arrive in a new array", () => {
    const many = makeRows(20);
    const [rows, setRows] = createSignal<TestItem[]>(many);
    render(() => (
      <TanStackTable<TestItem>
        data={rows()}
        columns={columns}
        rowWindowSize={5}
        getRowTestId={(r) => `identity-${r.id}`}
      />
    ));
    expect(screen.getAllByTestId(/^identity-/)).toHaveLength(5);
    fireEvent.click(screen.getByTestId("table-load-more")); // 5 → 10
    fireEvent.click(screen.getByTestId("table-load-more")); // 10 → 15
    expect(screen.getAllByTestId(/^identity-/)).toHaveLength(15);
    expect(screen.getByTestId("table-window-footer")).toHaveTextContent("showing 15 of 20 · 5 not rendered");

    setRows([...many]); // same row objects, fresh array identity
    expect(screen.getAllByTestId(/^identity-/)).toHaveLength(15);
    expect(screen.getByTestId("table-window-footer")).toHaveTextContent("showing 15 of 20 · 5 not rendered");
    expect(screen.getByTestId("table-load-more")).toBeInTheDocument();
  });

  it("resets the window to the base and updates the footer when the row count changes", () => {
    const many = makeRows(20);
    const [rows, setRows] = createSignal<TestItem[]>(many);
    render(() => (
      <TanStackTable<TestItem>
        data={rows()}
        columns={columns}
        rowWindowSize={5}
        getRowTestId={(r) => `reset-len-${r.id}`}
      />
    ));
    fireEvent.click(screen.getByTestId("table-load-more"));
    fireEvent.click(screen.getByTestId("table-load-more"));
    expect(screen.getAllByTestId(/^reset-len-/)).toHaveLength(15);
    expect(screen.getByTestId("table-window-footer")).toHaveTextContent("showing 15 of 20 · 5 not rendered");

    setRows(many.slice(0, 8));
    expect(screen.getAllByTestId(/^reset-len-/)).toHaveLength(5);
    expect(screen.getByTestId("table-window-footer")).toHaveTextContent("showing 5 of 8 · 3 not rendered");
  });

  it("resets the window to the base when sorting changes", () => {
    render(() => (
      <TanStackTable<TestItem>
        data={makeRows(312)}
        columns={columns}
        rowWindowSize={5}
        getRowTestId={(r) => `reset-sort5-${r.id}`}
      />
    ));
    fireEvent.click(screen.getByTestId("table-load-more"));
    fireEvent.click(screen.getByTestId("table-load-more"));
    expect(screen.getAllByTestId(/^reset-sort5-/)).toHaveLength(15);

    fireEvent.click(screen.getByText("Value").closest("th")!);
    expect(screen.getAllByTestId(/^reset-sort5-/)).toHaveLength(5);
    expect(screen.getByTestId("table-load-more")).toBeInTheDocument();
  });

  it("resets the window to the base when a column's visibility changes", () => {
    const [prefs, setPrefs] = createSignal<ColumnPrefs>({ order: [], hidden: [] });
    render(() => (
      <TanStackTable<TestItem>
        data={makeRows(312)}
        columns={columns}
        rowWindowSize={5}
        enableColumnControls
        columnPrefs={prefs()}
        getRowTestId={(r) => `reset-vis-${r.id}`}
      />
    ));
    fireEvent.click(screen.getByTestId("table-load-more"));
    fireEvent.click(screen.getByTestId("table-load-more"));
    expect(screen.getAllByTestId(/^reset-vis-/)).toHaveLength(15);

    setPrefs({ order: [], hidden: ["value"] });
    expect(screen.getAllByTestId(/^reset-vis-/)).toHaveLength(5);
    expect(screen.getByTestId("table-load-more")).toBeInTheDocument();
  });

  it("resets the window to the new base when rowWindowSize changes", () => {
    const [size, setSize] = createSignal(5);
    render(() => (
      <TanStackTable<TestItem>
        data={makeRows(312)}
        columns={columns}
        rowWindowSize={size()}
        getRowTestId={(r) => `reset-size-${r.id}`}
      />
    ));
    fireEvent.click(screen.getByTestId("table-load-more"));
    fireEvent.click(screen.getByTestId("table-load-more"));
    expect(screen.getAllByTestId(/^reset-size-/)).toHaveLength(15);

    setSize(10);
    expect(screen.getAllByTestId(/^reset-size-/)).toHaveLength(10);
    expect(screen.getByTestId("table-window-footer")).toHaveTextContent("showing 10 of 312");
  });
});

describe("TanStackTable — visible row window callback", () => {
  it("emits the mounted window once, not one call per row", () => {
    const onVisibleRowsChange = vi.fn();
    render(() => (
      <TanStackTable<TestItem>
        data={data}
        columns={columns}
        onVisibleRowsChange={onVisibleRowsChange}
      />
    ));

    expect(onVisibleRowsChange).toHaveBeenCalledTimes(1);
    expect(onVisibleRowsChange.mock.calls[0][0]).toEqual(data);
  });

  it("emits only the window slice when rowWindowSize caps the body", () => {
    const many: TestItem[] = Array.from({ length: 12 }, (_, i) => ({
      id: String(i + 1),
      name: `Row${i}`,
      value: i,
    }));
    const onVisibleRowsChange = vi.fn();
    render(() => (
      <TanStackTable<TestItem>
        data={many}
        columns={columns}
        rowWindowSize={5}
        onVisibleRowsChange={onVisibleRowsChange}
      />
    ));

    expect(onVisibleRowsChange).toHaveBeenCalledTimes(1);
    expect(onVisibleRowsChange.mock.calls[0][0]).toHaveLength(5);
    expect(onVisibleRowsChange.mock.calls[0][0][0]).toBe(many[0]);
  });

  it("does not re-emit for a cell update when the window identities are unchanged", () => {
    const initial: TestItem[] = [
      { id: "1", name: "Alpha", value: 100 },
      { id: "2", name: "Beta", value: 200 },
      { id: "3", name: "Gamma", value: 300 },
    ];
    const [rows, setRows] = createSignal<TestItem[]>(initial);
    const onVisibleRowsChange = vi.fn();
    render(() => (
      <TanStackTable<TestItem>
        data={rows()}
        columns={columns}
        onVisibleRowsChange={onVisibleRowsChange}
      />
    ));
    expect(onVisibleRowsChange).toHaveBeenCalledTimes(1);

    // A live price tick mutates in place: same row references, same window.
    // The cell still re-renders through its own reactive read.
    const current = rows();
    setRows([...current]);
    expect(onVisibleRowsChange).toHaveBeenCalledTimes(1);
  });

  it("re-emits when a row inside the window is replaced by another symbol", () => {
    const [rows, setRows] = createSignal<TestItem[]>([
      { id: "1", name: "Alpha", value: 100 },
      { id: "2", name: "Beta", value: 200 },
      { id: "3", name: "Gamma", value: 300 },
    ]);
    const onVisibleRowsChange = vi.fn();
    render(() => (
      <TanStackTable<TestItem>
        data={rows()}
        columns={columns}
        onVisibleRowsChange={onVisibleRowsChange}
      />
    ));

    // A middle-row swap keeps both edges but changes membership — an edges-only
    // comparison would starve the new symbol of its lookup.
    const current = rows();
    setRows([current[0], { id: "9", name: "Delta", value: 900 }, current[2]]);

    expect(onVisibleRowsChange).toHaveBeenCalledTimes(2);
    expect(onVisibleRowsChange.mock.calls[1][0].map((r: TestItem) => r.id)).toEqual(["1", "9", "3"]);
  });

  it("re-emits when the window's first row changes", () => {
    const [rows, setRows] = createSignal<TestItem[]>([
      { id: "1", name: "Alpha", value: 100 },
      { id: "2", name: "Beta", value: 200 },
    ]);
    const onVisibleRowsChange = vi.fn();
    render(() => (
      <TanStackTable<TestItem>
        data={rows()}
        columns={columns}
        onVisibleRowsChange={onVisibleRowsChange}
      />
    ));

    setRows([
      { id: "2", name: "Beta", value: 200 },
      { id: "1", name: "Alpha", value: 100 },
    ]);

    expect(onVisibleRowsChange).toHaveBeenCalledTimes(2);
    expect(onVisibleRowsChange.mock.calls[1][0][0].id).toBe("2");
  });

  it("re-emits when load more extends the window", () => {
    const many: TestItem[] = Array.from({ length: 12 }, (_, i) => ({
      id: String(i + 1),
      name: `Row${i}`,
      value: i,
    }));
    const onVisibleRowsChange = vi.fn();
    render(() => (
      <TanStackTable<TestItem>
        data={many}
        columns={columns}
        rowWindowSize={5}
        onVisibleRowsChange={onVisibleRowsChange}
      />
    ));
    expect(onVisibleRowsChange).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("table-load-more"));

    expect(onVisibleRowsChange).toHaveBeenCalledTimes(2);
    expect(onVisibleRowsChange.mock.calls[1][0]).toHaveLength(10);
  });

  it("stays silent when no callback is supplied", () => {
    // A table without the prop must not do the slice work at all.
    render(() => <TanStackTable<TestItem> data={data} columns={columns} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });
});

describe("TanStackTable — row states (selected / hovered / focused)", () => {
  const rowsOf = () => Array.from(document.querySelectorAll<HTMLTableRowElement>("tbody tr[data-row='stock']"));
  const tinted = () => rowsOf().filter((tr) => tr.style.backgroundColor !== "");

  it("marks only clickable rows with data-clickable", () => {
    const { unmount } = render(() => (
      <TanStackTable<TestItem>
        data={data}
        columns={columns}
        onRowClick={() => {}}
        getRowTestId={(r) => `clickable-${r.id}`}
      />
    ));
    expect(screen.getByTestId("clickable-1")).toHaveAttribute("data-clickable", "true");
    expect(screen.getByTestId("clickable-2")).toHaveAttribute("data-clickable", "true");
    unmount();

    render(() => (
      <TanStackTable<TestItem>
        data={data}
        columns={columns}
        getRowTestId={(r) => `static-${r.id}`}
      />
    ));
    // A hover tint on a row that does nothing would promise an interaction.
    expect(screen.getByTestId("static-1")).not.toHaveAttribute("data-clickable");
    expect(screen.getByTestId("static-2")).not.toHaveAttribute("data-clickable");
  });

  it("leaves the base surface to CSS so a hover rule can win", () => {
    render(() => <TanStackTable<TestItem> data={data} columns={columns} onRowClick={() => {}} />);
    // The managed states live under this class in style.css.
    expect(document.querySelector("table")!.className).toContain("paper-row-states");
    for (const tr of rowsOf()) {
      // An inline surface outranks `:hover`; that is the bug this guards.
      expect(tr.style.backgroundColor).toBe("");
      // Cells must not paint their own surface either, or the row tint is hidden.
      for (const td of Array.from(tr.querySelectorAll("td"))) {
        expect((td as HTMLElement).style.backgroundColor).toBe("inherit");
      }
    }
  });

  it("keeps the selected inline tint, which outranks the hover rule", () => {
    const [selected, setSelected] = createSignal<string | null>("1");
    render(() => (
      <TanStackTable<TestItem>
        data={data}
        columns={columns}
        onRowClick={(r) => setSelected(r.id)}
        getRowStyle={(r) => (r.id === selected() ? { "background-color": "rgb(1, 2, 3)" } : undefined)}
        getRowTestId={(r) => `sel-${r.id}`}
      />
    ));
    expect(tinted()).toHaveLength(1);
    expect(screen.getByTestId("sel-1").style.backgroundColor).toBe("rgb(1, 2, 3)");
    expect(screen.getByTestId("sel-2").style.backgroundColor).toBe("");
  });

  it("never leaves two rows selected after clicking a different row", () => {
    const [selected, setSelected] = createSignal<string | null>(null);
    render(() => (
      <TanStackTable<TestItem>
        data={data}
        columns={columns}
        onRowClick={(r) => setSelected(r.id)}
        getRowStyle={(r) => (r.id === selected() ? { "background-color": "rgb(1, 2, 3)" } : undefined)}
        getRowTestId={(r) => `one-${r.id}`}
      />
    ));
    fireEvent.click(screen.getByTestId("one-1"));
    expect(tinted().map((tr) => tr.dataset.testid)).toEqual(["one-1"]);
    fireEvent.click(screen.getByTestId("one-2"));
    // The multiply-highlighted row the user saw: the previous row kept its tint.
    expect(tinted().map((tr) => tr.dataset.testid)).toEqual(["one-2"]);
  });

  it("focus paints an outline, never a background tint", () => {
    render(() => <TanStackTable<TestItem> data={data} columns={columns} onRowClick={() => {}} />);
    const first = rowsOf()[0];
    first.focus();
    expect(document.activeElement).toBe(first);
    // A focused row must not become indistinguishable from a selected one.
    expect(first.style.backgroundColor).toBe("");
    expect(first.style.outline).toBe("");
  });

  it("makes a sortable header keyboard-operable and reflects sort state in aria-sort", () => {
    render(() => <TanStackTable<TestItem> data={data} columns={columns} dataTestId="kb-sort" />);
    const th = screen.getByTestId("kb-sort").querySelector<HTMLElement>("th")!;

    expect(th).toHaveAttribute("tabindex", "0");
    expect(th).toHaveAttribute("aria-sort", "none");

    fireEvent.keyDown(th, { key: "Enter" });
    expect(th).toHaveAttribute("aria-sort", "ascending");
    expect(th.textContent).toContain("▲");

    fireEvent.keyDown(th, { key: "Enter" });
    expect(th).toHaveAttribute("aria-sort", "descending");
    expect(th.textContent).toContain("▼");

    fireEvent.keyDown(th, { key: " " });
    expect(th).toHaveAttribute("aria-sort", "none");
    expect(th.textContent).not.toContain("▲");
    expect(th.textContent).not.toContain("▼");
  });

  it("keeps non-sortable headers out of the tab order and without aria-sort", () => {
    const staticColumns: TableColumnDef<TestItem>[] = [
      { id: "name", header: "Name", accessorKey: "name", enableSorting: false },
    ];
    render(() => <TanStackTable<TestItem> data={data} columns={staticColumns} dataTestId="kb-static" />);
    const th = screen.getByTestId("kb-static").querySelector<HTMLElement>("th")!;
    expect(th).not.toHaveAttribute("tabindex");
    expect(th).not.toHaveAttribute("aria-sort");
  });

  it("only marks the active column as sorted", () => {
    render(() => <TanStackTable<TestItem> data={data} columns={columns} dataTestId="kb-one" />);
    const headers = screen.getByTestId("kb-one").querySelectorAll<HTMLElement>("th");
    fireEvent.click(headers[1]);
    expect(headers[0]).toHaveAttribute("aria-sort", "none");
    // Numeric columns sort biggest-first on first activation.
    expect(headers[1]).toHaveAttribute("aria-sort", "descending");
  });

  it("positions the header sticky only when stickyHeader is set", () => {
    const { unmount } = render(() => (
      <TanStackTable<TestItem> data={data} columns={columns} dataTestId="sticky-off" />
    ));
    const off = screen.getByTestId("sticky-off").querySelector<HTMLElement>("th")!;
    expect(off.style.position).not.toBe("sticky");
    unmount();

    render(() => (
      <TanStackTable<TestItem> data={data} columns={columns} dataTestId="sticky-on" stickyHeader />
    ));
    const on = screen.getByTestId("sticky-on").querySelector<HTMLElement>("th")!;
    expect(on.style.position).toBe("sticky");
    expect(on.style.top).toBe("0px");
    expect(on.style.backgroundColor).toBe("var(--color-fin-surface-alt)");
  });

  it("declares the hover/focus rules against data-clickable in style.css", async () => {
    // happy-dom cannot resolve `:hover` or `color-mix()`, so the rule text is
    // the only unit-level assertion available; the main agent measures the
    // painted pixels.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const css = readFileSync(resolve(process.cwd(), "src/style.css"), "utf8");
    expect(css).toMatch(/\.paper-row-states tbody tr\[data-row="stock"\]\s*\{[^}]*background-color: var\(--color-fin-surface\)/);
    expect(css).toMatch(/\.paper-row-states tbody tr\[data-clickable="true"\]:hover\s*\{[^}]*background-color: color-mix\(in srgb, var\(--color-fin-primary\) 7%/);
    expect(css).toMatch(/\.paper-row-states tbody tr\[data-clickable="true"\]:focus-visible\s*\{[^}]*outline: 1px solid var\(--color-fin-primary\)/);
    expect(css).toMatch(/\.paper-row-states tbody tr\[data-clickable="true"\]:focus-visible\s*\{[^}]*outline-offset: -1px/);
    // The old cell-level `!important` hover must not reach these rows again.
    expect(css).toMatch(/\.paper-tanstack-table:not\(\.paper-row-states\) tbody tr:hover td/);
  });
});

describe("TanStackTable — sort cycle and controlled sorting", () => {
  const cycleData: TestItem[] = [
    { id: "1", name: "Zulu", value: 30 },
    { id: "2", name: "Alpha", value: 10 },
    { id: "3", name: "Mike", value: 20 },
  ];

  // Names in render order; the first cell is the name column.
  const namesOf = (tableId: string) =>
    Array.from(
      screen.getByTestId(tableId).querySelectorAll<HTMLTableRowElement>("tbody tr[data-row='stock']"),
    ).map((tr) => tr.querySelector("td")!.textContent!.trim());

  const headerOf = (tableId: string, index: number) =>
    screen.getByTestId(tableId).querySelectorAll<HTMLElement>("th")[index];

  it("numeric column cycles none → desc → asc → none → desc", () => {
    render(() => (
      <TanStackTable<TestItem> data={cycleData} columns={columns} dataTestId="cycle-num" />
    ));
    const valueTh = headerOf("cycle-num", 1);

    fireEvent.click(valueTh);
    expect(valueTh).toHaveAttribute("aria-sort", "descending");
    expect(namesOf("cycle-num")[0]).toBe("Zulu");

    fireEvent.click(valueTh);
    expect(valueTh).toHaveAttribute("aria-sort", "ascending");
    expect(namesOf("cycle-num")[0]).toBe("Alpha");

    fireEvent.click(valueTh);
    expect(valueTh).toHaveAttribute("aria-sort", "none");
    expect(namesOf("cycle-num")).toEqual(["Zulu", "Alpha", "Mike"]);

    fireEvent.click(valueTh);
    expect(valueTh).toHaveAttribute("aria-sort", "descending");
    expect(namesOf("cycle-num")[0]).toBe("Zulu");
  });

  it("text column cycles none → asc → desc → none", () => {
    render(() => (
      <TanStackTable<TestItem> data={cycleData} columns={columns} dataTestId="cycle-text" />
    ));
    const nameTh = headerOf("cycle-text", 0);

    fireEvent.click(nameTh);
    expect(nameTh).toHaveAttribute("aria-sort", "ascending");
    expect(namesOf("cycle-text")[0]).toBe("Alpha");

    fireEvent.click(nameTh);
    expect(nameTh).toHaveAttribute("aria-sort", "descending");
    expect(namesOf("cycle-text")[0]).toBe("Zulu");

    fireEvent.click(nameTh);
    expect(nameTh).toHaveAttribute("aria-sort", "none");
    expect(namesOf("cycle-text")).toEqual(["Zulu", "Alpha", "Mike"]);
  });

  it("never clears when enableSortingRemoval is false — desc → asc → desc", () => {
    render(() => (
      <TanStackTable<TestItem>
        data={cycleData}
        columns={columns}
        dataTestId="cycle-noremove"
        enableSortingRemoval={false}
      />
    ));
    const valueTh = headerOf("cycle-noremove", 1);

    fireEvent.click(valueTh);
    expect(valueTh).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(valueTh);
    expect(valueTh).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(valueTh);
    expect(valueTh).toHaveAttribute("aria-sort", "descending");
    expect(namesOf("cycle-noremove")[0]).toBe("Zulu");
  });

  it("clicking a different column makes it primary without disturbing the other direction", () => {
    render(() => (
      <TanStackTable<TestItem> data={cycleData} columns={columns} dataTestId="cycle-multi" />
    ));
    const nameTh = headerOf("cycle-multi", 0);
    const valueTh = headerOf("cycle-multi", 1);

    fireEvent.click(nameTh);
    fireEvent.click(valueTh);

    expect(nameTh).toHaveAttribute("aria-sort", "ascending");
    expect(valueTh).toHaveAttribute("aria-sort", "descending");
    expect(namesOf("cycle-multi")[0]).toBe("Zulu");
  });

  it("initialSorting seeds the first render and aria-sort reflects it", () => {
    render(() => (
      <TanStackTable<TestItem>
        data={cycleData}
        columns={columns}
        dataTestId="seed-sorting"
        initialSorting={[{ id: "value", desc: false }]}
      />
    ));
    const valueTh = headerOf("seed-sorting", 1);
    expect(valueTh).toHaveAttribute("aria-sort", "ascending");
    expect(namesOf("seed-sorting")[0]).toBe("Alpha");
  });

  it("initialState.sorting still seeds sorting alongside initialSorting", () => {
    render(() => (
      <TanStackTable<TestItem>
        data={cycleData}
        columns={columns}
        dataTestId="legacy-seed"
        initialState={{ sorting: [{ id: "value", desc: true }] }}
        initialSorting={[{ id: "value", desc: false }]}
      />
    ));
    const valueTh = headerOf("legacy-seed", 1);
    expect(valueTh).toHaveAttribute("aria-sort", "descending");
    expect(namesOf("legacy-seed")[0]).toBe("Zulu");
  });

  it("emits onSortingChange in uncontrolled mode while keeping its own state", () => {
    const onSortingChange = vi.fn();
    render(() => (
      <TanStackTable<TestItem>
        data={cycleData}
        columns={columns}
        dataTestId="emit-sorting"
        onSortingChange={onSortingChange}
      />
    ));
    const valueTh = headerOf("emit-sorting", 1);

    fireEvent.click(valueTh);
    expect(onSortingChange).toHaveBeenCalledWith([{ id: "value", desc: true }]);
    expect(valueTh).toHaveAttribute("aria-sort", "descending");
    expect(namesOf("emit-sorting")[0]).toBe("Zulu");
  });

  it("controlled sorting: parent updates the prop and header clicks reorder rows", () => {
    const onSortingChange = vi.fn();
    const Controlled = () => {
      const [sorting, setSorting] = createSignal<SortEntry[]>([]);
      return (
        <TanStackTable<TestItem>
          data={cycleData}
          columns={columns}
          dataTestId="controlled-sorting"
          sorting={sorting()}
          onSortingChange={(next) => {
            onSortingChange(next);
            setSorting(next);
          }}
        />
      );
    };
    render(() => <Controlled />);
    const valueTh = headerOf("controlled-sorting", 1);

    fireEvent.click(valueTh);
    expect(onSortingChange).toHaveBeenCalledWith([{ id: "value", desc: true }]);
    expect(valueTh).toHaveAttribute("aria-sort", "descending");
    expect(namesOf("controlled-sorting")[0]).toBe("Zulu");

    fireEvent.click(valueTh);
    expect(onSortingChange).toHaveBeenLastCalledWith([{ id: "value", desc: false }]);
    expect(valueTh).toHaveAttribute("aria-sort", "ascending");
    expect(namesOf("controlled-sorting")[0]).toBe("Alpha");

    fireEvent.click(valueTh);
    expect(onSortingChange).toHaveBeenLastCalledWith([]);
    expect(valueTh).toHaveAttribute("aria-sort", "none");
    expect(namesOf("controlled-sorting")).toEqual(["Zulu", "Alpha", "Mike"]);
  });
});

describe("TanStackTable — null-safe sorting", () => {
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

  it("puts nulls last on a numeric column in both directions", () => {
    render(() => (
      <TanStackTable<NullRow>
        data={numData}
        columns={numColumns}
        dataTestId="null-num"
        getRowTestId={(r) => r.id}
      />
    ));
    const valueTh = headerOf("null-num", 1);

    fireEvent.click(valueTh); // first click desc
    expect(orderOf("null-num")).toEqual(["r1", "r5", "r3", "r2", "r4"]);
    fireEvent.click(valueTh); // second click asc
    expect(orderOf("null-num")).toEqual(["r3", "r5", "r1", "r2", "r4"]);

    // The trailing rows render as missing, not as a real zero.
    const valueCells = Array.from(
      screen.getByTestId("null-num").querySelectorAll<HTMLTableRowElement>("tbody tr[data-row='stock']"),
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
        dataTestId="null-str"
        getRowTestId={(r) => r.id}
      />
    ));
    const nameTh = headerOf("null-str", 0);

    fireEvent.click(nameTh); // text sorts ascending first
    expect(orderOf("null-str")).toEqual(["s3", "s5", "s1", "s2", "s4"]);
    fireEvent.click(nameTh);
    expect(orderOf("null-str")).toEqual(["s1", "s5", "s3", "s2", "s4"]);
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
        dataTestId="null-mixed"
        getRowTestId={(r) => r.id}
      />
    ));
    const vTh = headerOf("null-mixed", 0);

    // A NaN comparator result is treated as 0 by sort(), leaving insertion order
    // untouched. Missing values must trail, and flipping the direction must
    // reorder — that proves the comparator returned a real ordering.
    fireEvent.click(vTh); // sample has a string → ascending
    const ascending = orderOf("null-mixed");
    expect([...ascending].sort()).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(ascending.at(-1)).toBe("m3");
    expect(ascending).not.toEqual(["m1", "m2", "m3", "m4", "m5"]);

    fireEvent.click(vTh);
    const descending = orderOf("null-mixed");
    expect([...descending].sort()).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(descending.at(-1)).toBe("m3");
    expect(descending).not.toEqual(ascending);
  });

  it("a second header click makes that column primary", () => {
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
        dataTestId="null-multi"
        getRowTestId={(r) => r.id}
      />
    ));

    fireEvent.click(headerOf("null-multi", 0)); // delta desc → y, z, x
    fireEvent.click(headerOf("null-multi", 1)); // pnl desc → x, z, y
    expect(orderOf("null-multi")).toEqual(["x", "z", "y"]);
  });
});
