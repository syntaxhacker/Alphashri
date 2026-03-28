// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DataTable } from "./DataTable";

const mockTableProps: Record<string, any>[] = [];

vi.mock("@mantine/core", () => ({
  Table: ({ children, ...props }: any) => {
    mockTableProps.push(props);
    return (
      <div data-testid="mantine-table">
        {children}
      </div>
    );
  },
}));

afterEach(() => {
  cleanup();
  mockTableProps.length = 0;
});

function getLastTableProps() {
  return mockTableProps[mockTableProps.length - 1];
}

describe("DataTable", () => {
  it("renders children (Table.Thead and Table.Tbody)", () => {
    render(
      <DataTable>
        <thead>
          <tr>
            <th>Name</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Alice</td>
          </tr>
        </tbody>
      </DataTable>,
    );
    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
  });

  it("applies default props: striped, highlightOnHover, no border, no stickyHeader", () => {
    render(<DataTable>Content</DataTable>);
    const props = getLastTableProps();
    expect(props.striped).toBe(true);
    expect(props.highlightOnHover).toBe(true);
    expect(props.withTableBorder).toBe(false);
    expect(props.withColumnBorders).toBe(false);
    expect(props.stickyHeader).toBe(false);
  });

  it("passes through withTableBorder when true", () => {
    render(<DataTable withTableBorder>Content</DataTable>);
    expect(getLastTableProps().withTableBorder).toBe(true);
  });

  it("passes through withColumnBorders when true", () => {
    render(<DataTable withColumnBorders>Content</DataTable>);
    expect(getLastTableProps().withColumnBorders).toBe(true);
  });

  it("passes through stickyHeader when true", () => {
    render(<DataTable stickyHeader>Content</DataTable>);
    expect(getLastTableProps().stickyHeader).toBe(true);
  });

  it("passes through custom className", () => {
    render(<DataTable className="custom-class">Content</DataTable>);
    expect(getLastTableProps().className).toBe("custom-class");
  });

  it("passes through dataTestId", () => {
    render(<DataTable dataTestId="my-table">Content</DataTable>);
    expect(getLastTableProps()["data-testid"]).toBe("my-table");
  });

  it("passes through custom verticalSpacing and horizontalSpacing", () => {
    render(
      <DataTable verticalSpacing="md" horizontalSpacing="md">
        Content
      </DataTable>,
    );
    const props = getLastTableProps();
    expect(props.verticalSpacing).toBe("md");
    expect(props.horizontalSpacing).toBe("md");
  });
});
