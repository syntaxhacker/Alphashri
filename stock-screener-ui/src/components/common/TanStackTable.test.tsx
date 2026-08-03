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
});
