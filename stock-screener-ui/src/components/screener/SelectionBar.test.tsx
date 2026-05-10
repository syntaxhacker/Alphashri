// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SelectionBar } from "./SelectionBar";
import { MantineProvider } from "@mantine/core";

const mockClearSelectedSymbols = vi.fn();
let mockSelectedSymbols: string[] = [];

vi.mock("../../state", () => ({
  get selectedSymbols() {
    return mockSelectedSymbols;
  },
  clearSelectedSymbols: (...args: any[]) => mockClearSelectedSymbols(...args),
  subscribe: vi.fn(() => vi.fn()),
}));

vi.mock("../../hooks/useStoreSubscription", () => ({
  useStoreSubscription: vi.fn(),
}));

describe("SelectionBar", () => {
  const onCompare = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectedSymbols = [];
  });

  afterEach(() => {
    cleanup();
  });

  it("renders when selectedSymbols length > 0", () => {
    mockSelectedSymbols = ["RELIANCE"];
    render(
      <MantineProvider>
        <SelectionBar onCompare={onCompare} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("selection-bar")).toBeInTheDocument();
  });

  it("returns null when selectedSymbols is empty", () => {
    mockSelectedSymbols = [];
    const { container } = render(
      <MantineProvider>
        <SelectionBar onCompare={onCompare} />
      </MantineProvider>,
    );
    expect(screen.queryByTestId("selection-bar")).not.toBeInTheDocument();
  });

  it("shows selected count badge", () => {
    mockSelectedSymbols = ["RELIANCE", "TCS", "INFY"];
    render(
      <MantineProvider>
        <SelectionBar onCompare={onCompare} />
      </MantineProvider>,
    );
    expect(screen.getByText("3 selected")).toBeInTheDocument();
  });

  it("Clear button calls clearSelectedSymbols", () => {
    mockSelectedSymbols = ["RELIANCE"];
    render(
      <MantineProvider>
        <SelectionBar onCompare={onCompare} />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByTestId("clear-selection-btn"));
    expect(mockClearSelectedSymbols).toHaveBeenCalledTimes(1);
  });

  it("Compare button disabled when < 2 symbols", () => {
    mockSelectedSymbols = ["RELIANCE"];
    render(
      <MantineProvider>
        <SelectionBar onCompare={onCompare} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("compare-btn")).toBeDisabled();
  });

  it("Compare button calls onCompare when clicked", () => {
    mockSelectedSymbols = ["RELIANCE", "TCS"];
    render(
      <MantineProvider>
        <SelectionBar onCompare={onCompare} />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByTestId("compare-btn"));
    expect(onCompare).toHaveBeenCalledTimes(1);
  });
});
