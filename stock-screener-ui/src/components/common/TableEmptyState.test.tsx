// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TableEmptyState } from "./TableEmptyState";

afterEach(() => {
  cleanup();

  vi.clearAllMocks();
});

describe("TableEmptyState", () => {
  it("renders message text", () => {
    render(<TableEmptyState message="No data found" />);
    expect(screen.getByText("No data found")).toBeInTheDocument();
  });

  it("renders without icon or action when not provided", () => {
    render(<TableEmptyState message="Just text" />);
    expect(screen.getByText("Just text")).toBeInTheDocument();
    expect(screen.queryByTestId("icon")).not.toBeInTheDocument();
  });
});
