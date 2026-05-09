// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TableEmptyState } from "./TableEmptyState";

afterEach(() => {
  cleanup();
});

vi.mock("@mantine/core", () => ({
  Flex: ({ children, ...props }: any) => <div data-testid="flex" {...props}>{children}</div>,
  Text: ({ children, ...props }: any) => <span data-testid="text" {...props}>{children}</span>,
  Group: ({ children }: any) => <div data-testid="group">{children}</div>,
}));

describe("TableEmptyState", () => {
  it("renders message text", () => {
    render(<TableEmptyState message="No data found" />);
    expect(screen.getByText("No data found")).toBeInTheDocument();
  });

  it("renders correct test id", () => {
    render(<TableEmptyState message="Empty" />);
    expect(screen.getByTestId("table-empty-state")).toBeInTheDocument();
  });

  it("renders icon when provided", () => {
    render(<TableEmptyState message="Empty" icon={<span data-testid="icon">🔄</span>} />);
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("renders action when provided", () => {
    render(<TableEmptyState message="Empty" action={<button data-testid="action-btn">Retry</button>} />);
    expect(screen.getByTestId("action-btn")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("renders without icon or action", () => {
    render(<TableEmptyState message="Just text" />);
    expect(screen.getByText("Just text")).toBeInTheDocument();
    expect(screen.queryByTestId("icon")).not.toBeInTheDocument();
  });
});
