// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { TanStackTable } from "./TanStackTable";

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
    const alignedColumns = [
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
    const leftValueColumns = [
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
});
