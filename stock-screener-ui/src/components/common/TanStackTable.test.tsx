// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TanStackTable } from "./TanStackTable";

vi.mock("@/ui", () => ({
  Box: ({ children, component: Tag, ...props }: any) => {
    const C = Tag || "div";
    return <C {...props}>{children}</C>;
  },
  ScrollArea: ({ children, ...props }: any) => (
    <div data-testid="scrollarea" {...props}>
      {children}
    </div>
  ),
  Flex: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  Text: ({ children, ...props }: any) => <span {...props}>{children}</span>,
  Loader: (props: any) => <div data-testid="loader" {...props} />,
  Group: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

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
    render(<TanStackTable<TestItem> data={data} columns={columns} />);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByText("Value")).toBeTruthy();
  });

  it("renders sort indicator when header is clicked", () => {
    render(<TanStackTable<TestItem> data={data} columns={columns} />);
    const nameTh = screen.getByText("Name").closest("th")!;
    fireEvent.click(nameTh);
    expect(nameTh.textContent).toContain("▲");
    fireEvent.click(nameTh);
    expect(nameTh.textContent).toContain("▼");
  });

  it("shows loading state when loading and data is empty", () => {
    render(<TanStackTable<TestItem> data={[]} columns={columns} loading />);
    expect(screen.getByTestId("table-loading-state")).toBeTruthy();
  });

  it("shows empty state when data is empty and not loading", () => {
    render(
      <TanStackTable<TestItem>
        data={[]}
        columns={columns}
        emptyMessage="No items found"
      />,
    );
    expect(screen.getByText("No items found")).toBeTruthy();
  });

  it("shows data when loading but data is not empty", () => {
    render(<TanStackTable<TestItem> data={data} columns={columns} loading />);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.queryByTestId("table-loading-state")).toBeNull();
  });

  it("fires onRowClick with correct row data", () => {
    const handleRowClick = vi.fn();
    render(
      <TanStackTable<TestItem>
        data={data}
        columns={columns}
        onRowClick={handleRowClick}
      />,
    );
    const rows = screen.getAllByRole("row");
    fireEvent.click(rows[1]);
    expect(handleRowClick).toHaveBeenCalledWith(data[0]);
  });

  it("applies dataTestId attribute", () => {
    render(
      <TanStackTable<TestItem>
        data={data}
        columns={columns}
        dataTestId="my-table"
      />,
    );
    expect(screen.getByTestId("my-table")).toBeTruthy();
  });

  it("shows default empty message when not provided", () => {
    render(<TanStackTable<TestItem> data={[]} columns={columns} />);
    expect(screen.getByText("No data")).toBeTruthy();
  });

  it("renders empty state with icon and action", () => {
    render(
      <TanStackTable<TestItem>
        data={[]}
        columns={columns}
        emptyMessage="Custom empty"
        emptyIcon={<span data-testid="custom-icon">🔍</span>}
        emptyAction={<button>Add Item</button>}
      />,
    );
    expect(screen.getByText("Custom empty")).toBeTruthy();
    expect(screen.getByText("Add Item")).toBeTruthy();
    expect(screen.getByTestId("custom-icon")).toBeTruthy();
  });

  it("applies sticky header by default", () => {
    render(<TanStackTable<TestItem> data={data} columns={columns} />);
    const th = screen.getAllByRole("columnheader")[0];
    expect(th.style.position).toBe("sticky");
  });

  it("removes sticky header when stickyHeader=false", () => {
    render(
      <TanStackTable<TestItem>
        data={data}
        columns={columns}
        stickyHeader={false}
      />,
    );
    const th = screen.getAllByRole("columnheader")[0];
    expect(th.style.position).toBe("");
  });

  it("applies getRowTestId to each row", () => {
    render(
      <TanStackTable<TestItem>
        data={data}
        columns={columns}
        getRowTestId={(row) => `row-${row.id}`}
      />,
    );
    expect(screen.getByTestId("row-1")).toBeTruthy();
    expect(screen.getByTestId("row-2")).toBeTruthy();
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
    render(<TanStackTable<TestItem> data={data} columns={alignedColumns} />);
    const valueTh = screen.getByText("Value").closest("th")!;
    expect(valueTh.style.textAlign).toBe("right");
    const nameTh = screen.getByText("Name").closest("th")!;
    expect(nameTh.style.textAlign).not.toBe("right");
    const valueTds = screen
      .getAllByRole("cell")
      .filter((td) => td.textContent === "100" || td.textContent === "200");
    expect(valueTds.length).toBe(2);
    expect(valueTds.every((td) => td.style.textAlign === "right")).toBe(true);
  });

  it("right-aligns numeric columns by default and keeps text columns left", () => {
    render(<TanStackTable<TestItem> data={data} columns={columns} />);
    const valueTh = screen.getByText("Value").closest("th")!;
    expect(valueTh.style.textAlign).toBe("right");
    const nameTh = screen.getByText("Name").closest("th")!;
    expect(nameTh.style.textAlign).toBe("left");
    const valueTds = screen
      .getAllByRole("cell")
      .filter((td) => td.textContent === "100" || td.textContent === "200");
    expect(valueTds.length).toBe(2);
    expect(valueTds.every((td) => td.style.textAlign === "right")).toBe(true);
    const nameTds = screen
      .getAllByRole("cell")
      .filter((td) => td.textContent === "Alpha" || td.textContent === "Beta");
    expect(nameTds.every((td) => td.style.textAlign === "left")).toBe(true);
  });

  it("explicit meta.align overrides numeric auto-alignment", () => {
    const leftValueColumns = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "value", header: "Value", accessorKey: "value", meta: { align: "left" } },
    ];
    render(<TanStackTable<TestItem> data={data} columns={leftValueColumns} />);
    const valueTh = screen.getByText("Value").closest("th")!;
    expect(valueTh.style.textAlign).toBe("left");
  });

  it("applies explicit column width and ellipsis overflow when size is set", () => {
    const sizedColumns = [
      { id: "name", header: "Name", accessorKey: "name", size: 200 },
      { id: "value", header: "Value", accessorKey: "value" },
    ];
    render(<TanStackTable<TestItem> data={data} columns={sizedColumns} />);
    const nameTh = screen.getByText("Name").closest("th")!;
    expect(nameTh.style.width).toBe("200px");
    const valueTh = screen.getByText("Value").closest("th")!;
    expect(valueTh.style.width).toBe("");
    const nameTd = screen
      .getAllByRole("cell")
      .find((td) => td.textContent === "Alpha")!;
    expect(nameTd.style.overflow).toBe("hidden");
    expect(nameTd.style.textOverflow).toBe("ellipsis");
    const valueTd = screen
      .getAllByRole("cell")
      .find((td) => td.textContent === "100")!;
    expect(valueTd.style.overflow).toBe("");
  });

  it("uses fixed table layout when any column has an explicit size", () => {
    const sizedColumns = [
      { id: "name", header: "Name", accessorKey: "name", size: 200 },
      { id: "value", header: "Value", accessorKey: "value" },
    ];
    render(<TanStackTable<TestItem> data={data} columns={sizedColumns} />);
    const htmlTable = document.querySelector("table")!;
    expect(htmlTable.style.tableLayout).toBe("fixed");
  });

  it("uses auto table layout when no column has an explicit size", () => {
    render(<TanStackTable<TestItem> data={data} columns={columns} />);
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
    render(
      <TanStackTable<{ id: string; name: string; value: number; category: string }>
        data={groupedData}
        columns={groupedColumns}
        enableGrouping
        grouping={["category"]}
        initialState={{ expanded: { "category:A": true, "category:B": true } }}
        renderGroupHeader={({ value, rows }) => (
          <span data-testid={`group-label-${String(value)}`}>Group {String(value)} ({rows.length})</span>
        )}
        getGroupRowTestId={(value) => `group-row-${String(value)}`}
      />,
    );
    expect(screen.getByTestId("group-row-A")).toBeTruthy();
    expect(screen.getByTestId("group-row-B")).toBeTruthy();
    expect(screen.getByTestId("group-label-A").textContent).toContain("Group A (2)");
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.getByText("Gamma")).toBeTruthy();
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
    render(
      <TanStackTable<{ id: string; name: string; value: number; category: string }>
        data={groupedData}
        columns={groupedColumns}
        enableGrouping
        grouping={["category"]}
        initialState={{ expanded: { "category:A": true } }}
        renderGroupHeader={({ value }) => <span data-testid={`group-label-${String(value)}`} />}
        getGroupRowTestId={(value) => `group-row-${String(value)}`}
      />,
    );
    // Group A expanded → its leaf row visible; group B collapsed → leaf hidden
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.queryByText("Gamma")).toBeNull();
    expect(screen.getByTestId("group-row-B")).toBeTruthy();
  });

  it("clears sorting on third click by default (enableSortingRemoval)", () => {
    render(<TanStackTable<TestItem> data={data} columns={columns} />);
    const nameTh = screen.getByText("Name").closest("th")!;
    fireEvent.click(nameTh);
    expect(nameTh.textContent).toContain("▲");
    fireEvent.click(nameTh);
    expect(nameTh.textContent).toContain("▼");
    fireEvent.click(nameTh);
    expect(nameTh.textContent).not.toContain("▲");
    expect(nameTh.textContent).not.toContain("▼");
  });

  it("keeps toggling asc/desc without removal when enableSortingRemoval is false", () => {
    render(
      <TanStackTable<TestItem> data={data} columns={columns} enableSortingRemoval={false} />,
    );
    // String columns sort ascending first, then descending, then back to
    // ascending (never removed) when sorting removal is disabled.
    const nameTh = screen.getByText("Name").closest("th")!;
    fireEvent.click(nameTh);
    expect(nameTh.textContent).toContain("▲");
    fireEvent.click(nameTh);
    expect(nameTh.textContent).toContain("▼");
    fireEvent.click(nameTh);
    expect(nameTh.textContent).toContain("▲");
  });
});
