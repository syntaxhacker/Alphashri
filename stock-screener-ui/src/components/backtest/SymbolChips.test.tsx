// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { SymbolChips } from "./SymbolChips";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

vi.mock("../../api/symbols", () => ({
  searchSymbols: vi.fn(),
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

describe("SymbolChips", () => {
  const mockOnSymbolsChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the multi-select input", () => {
    render(<SymbolChips selectedSymbols={[]} onSymbolsChange={mockOnSymbolsChange} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByTestId("symbol-multiselect")).toBeInTheDocument();
  });

  it("renders with no symbols initially", () => {
    render(<SymbolChips selectedSymbols={[]} onSymbolsChange={mockOnSymbolsChange} />, {
      wrapper: Wrapper,
    });
    expect(screen.queryByTestId("symbol-chips")).not.toBeInTheDocument();
  });

  it("renders chips for selected symbols", () => {
    const symbols = ["TCS", "INFY", "RELIANCE"];
    render(<SymbolChips selectedSymbols={symbols} onSymbolsChange={mockOnSymbolsChange} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByTestId("chip-TCS")).toBeInTheDocument();
    expect(screen.getByTestId("chip-INFY")).toBeInTheDocument();
    expect(screen.getByTestId("chip-RELIANCE")).toBeInTheDocument();
  });

  it("shows only MAX_VISIBLE_CHIPS when not expanded", () => {
    const symbols = ["TCS", "INFY", "RELIANCE", "WIPRO", "HDFC", "ICICI"];
    render(<SymbolChips selectedSymbols={symbols} onSymbolsChange={mockOnSymbolsChange} />, {
      wrapper: Wrapper,
    });
    const allChips = screen.getAllByTestId(/^(chip-|symbol-expand)/);
    expect(allChips.length).toBe(6);
    expect(screen.getByTestId("symbol-expand-more-btn")).toBeInTheDocument();
  });

  it("expands to show all chips when clicking expand button", async () => {
    const symbols = ["TCS", "INFY", "RELIANCE", "WIPRO", "HDFC", "ICICI"];
    render(<SymbolChips selectedSymbols={symbols} onSymbolsChange={mockOnSymbolsChange} />, {
      wrapper: Wrapper,
    });
    screen.getByTestId("symbol-expand-more-btn").click();
    await waitFor(() => {
      const allChips = screen.getAllByTestId(/^(chip-|symbol-expand)/);
      expect(allChips.length).toBe(7);
    });
    expect(screen.getByTestId("symbol-expand-less-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("symbol-expand-more-btn")).not.toBeInTheDocument();
  });

  it("collapses back when clicking collapse button", async () => {
    const symbols = ["TCS", "INFY", "RELIANCE", "WIPRO", "HDFC", "ICICI"];
    render(<SymbolChips selectedSymbols={symbols} onSymbolsChange={mockOnSymbolsChange} />, {
      wrapper: Wrapper,
    });
    screen.getByTestId("symbol-expand-more-btn").click();
    await waitFor(() => {
      expect(screen.getByTestId("symbol-expand-less-btn")).toBeInTheDocument();
    });
    screen.getByTestId("symbol-expand-less-btn").click();
    await waitFor(() => {
      const allChips = screen.getAllByTestId(/^(chip-|symbol-expand)/);
      expect(allChips.length).toBe(6);
    });
    expect(screen.getByTestId("symbol-expand-more-btn")).toBeInTheDocument();
  });

  it("calls onSymbolsChange when clicking chip X button", async () => {
    const symbols = ["TCS", "INFY", "RELIANCE"];
    render(<SymbolChips selectedSymbols={symbols} onSymbolsChange={mockOnSymbolsChange} />, {
      wrapper: Wrapper,
    });
    const chipBadge = screen.getByTestId("chip-TCS");
    const svg = chipBadge.querySelector("svg");
    expect(svg).toBeInTheDocument();
    if (svg) {
      fireEvent.click(svg);
    }
    await waitFor(() => {
      expect(mockOnSymbolsChange).toHaveBeenCalledWith(["INFY", "RELIANCE"]);
    });
  });

  it("shows clear button when symbols are selected", () => {
    render(<SymbolChips selectedSymbols={["TCS"]} onSymbolsChange={mockOnSymbolsChange} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByTestId("clear-symbols-btn")).toBeInTheDocument();
  });

  it("does not show clear button when no symbols selected", () => {
    render(<SymbolChips selectedSymbols={[]} onSymbolsChange={mockOnSymbolsChange} />, {
      wrapper: Wrapper,
    });
    expect(screen.queryByTestId("clear-symbols-btn")).not.toBeInTheDocument();
  });

  it("clears all symbols when clear button is clicked", () => {
    render(
      <SymbolChips selectedSymbols={["TCS", "INFY"]} onSymbolsChange={mockOnSymbolsChange} />,
      { wrapper: Wrapper },
    );
    screen.getByTestId("clear-symbols-btn").click();
    expect(mockOnSymbolsChange).toHaveBeenCalledWith([]);
  });

  it("renders single chip without expand button", () => {
    render(<SymbolChips selectedSymbols={["TCS"]} onSymbolsChange={mockOnSymbolsChange} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByTestId("chip-TCS")).toBeInTheDocument();
    expect(screen.queryByTestId("symbol-expand-more-btn")).not.toBeInTheDocument();
  });

  it("handles many symbols", () => {
    const symbols = Array.from({ length: 20 }, (_, i) => `SYM${i}`);
    render(<SymbolChips selectedSymbols={symbols} onSymbolsChange={mockOnSymbolsChange} />, {
      wrapper: Wrapper,
    });
    const visibleChips = screen.getAllByTestId(/^chip-/);
    expect(visibleChips.length).toBe(5);
    expect(screen.getByTestId("symbol-expand-more-btn")).toBeInTheDocument();
  });
});
