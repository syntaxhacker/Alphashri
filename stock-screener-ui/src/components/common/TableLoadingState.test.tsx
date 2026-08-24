// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TableLoadingState } from "./TableLoadingState";

afterEach(() => {
  cleanup();

  vi.clearAllMocks();
});

describe("TableLoadingState", () => {
  it("renders with default message", () => {
    render(<TableLoadingState />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("renders correct test id", () => {
    render(<TableLoadingState />);
    expect(screen.getByTestId("table-loading-state")).toBeInTheDocument();
  });

  it("renders custom message", () => {
    render(<TableLoadingState message="Fetching data..." />);
    expect(screen.getByText("Fetching data...")).toBeInTheDocument();
  });

  it("shows spinner by default", () => {
    render(<TableLoadingState />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("hides spinner when showSpinner is false", () => {
    render(<TableLoadingState showSpinner={false} />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("renders children instead of message", () => {
    render(<TableLoadingState><span data-testid="child">Custom</span></TableLoadingState>);
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });
});
