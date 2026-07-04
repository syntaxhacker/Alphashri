// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SortableHeader } from "./SortableHeader";

vi.mock("@/ui", () => ({
  TableTh: ({ children, ...props }: any) => (
    <th data-testid={props["data-testid"]} style={props.style} onClick={props.onClick}>
      {children}
    </th>
  ),
  Group: ({ children, ...props }: any) => (
    <div data-testid="group" {...props}>
      {children}
    </div>
  ),
  Text: ({ children, ...props }: any) => (
    <span data-testid="text" {...props}>
      {children}
    </span>
  ),
}));

vi.mock("@tabler/icons-react", () => ({
  IconArrowUp: ({ size }: any) => <svg data-testid="icon-arrow-up" width={size} height={size} />,
  IconArrowDown: ({ size }: any) => (
    <svg data-testid="icon-arrow-down" width={size} height={size} />
  ),
}));

afterEach(() => {
  cleanup();
});

const defaultProps = {
  label: "Name",
  columnKey: "name",
  sortColumn: null,
  sortDirection: "asc" as const,
  onSort: vi.fn(),
};

describe("SortableHeader", () => {
  it("renders label text", () => {
    render(<SortableHeader {...defaultProps} />);
    expect(screen.getByText("Name")).toBeTruthy();
  });

  it("shows up arrow when sorted ascending", () => {
    render(<SortableHeader {...defaultProps} sortColumn="name" sortDirection="asc" />);
    expect(screen.getByTestId("icon-arrow-up")).toBeTruthy();
    expect(screen.queryByTestId("icon-arrow-down")).toBeNull();
  });

  it("shows down arrow when sorted descending", () => {
    render(<SortableHeader {...defaultProps} sortColumn="name" sortDirection="desc" />);
    expect(screen.getByTestId("icon-arrow-down")).toBeTruthy();
    expect(screen.queryByTestId("icon-arrow-up")).toBeNull();
  });

  it("hides arrow when not the active sort column", () => {
    render(<SortableHeader {...defaultProps} sortColumn="other" sortDirection="asc" />);
    expect(screen.queryByTestId("icon-arrow-up")).toBeNull();
    expect(screen.queryByTestId("icon-arrow-down")).toBeNull();
  });

  it("calls onSort with columnKey when clicked", () => {
    const onSort = vi.fn();
    render(<SortableHeader {...defaultProps} onSort={onSort} />);
    fireEvent.click(screen.getByTestId("sort-header-name"));
    expect(onSort).toHaveBeenCalledWith("name");
  });

  it("does NOT call onSort when clicked and sortable=false", () => {
    const onSort = vi.fn();
    render(<SortableHeader {...defaultProps} onSort={onSort} sortable={false} />);
    fireEvent.click(screen.getByTestId("sort-header-name"));
    expect(onSort).not.toHaveBeenCalled();
  });

  it("does not set inline cursor style", () => {
    render(<SortableHeader {...defaultProps} />);
    const th = screen.getByTestId("sort-header-name");
    expect(th.style.cursor).toBe("");
  });

  it("renders children prop", () => {
    render(
      <SortableHeader {...defaultProps}>
        <span data-testid="extra-child">Extra</span>
      </SortableHeader>,
    );
    expect(screen.getByTestId("extra-child")).toBeTruthy();
    expect(screen.getByText("Extra")).toBeTruthy();
  });

  it("renders with custom testId", () => {
    render(<SortableHeader {...defaultProps} testId="custom-id" />);
    expect(screen.getByTestId("custom-id")).toBeTruthy();
  });
});
