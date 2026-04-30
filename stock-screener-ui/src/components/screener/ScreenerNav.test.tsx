// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ScreenerNav } from "./ScreenerNav";
import { MantineProvider } from "@mantine/core";
import type { ScreenerOption } from "../../types";

// Mock Mantine Tooltip to render tooltip content as visible text in tests
vi.mock("@mantine/core", async () => {
  const actual = await vi.importActual("@mantine/core");
  return {
    ...actual,
    Tooltip: ({ label, children, ..._rest }: any) => (
      <div data-testid="tooltip-wrapper" data-label={label}>
        {children}
        <span data-testid="tooltip-content">{label}</span>
      </div>
    ),
  };
});

describe("ScreenerNav", () => {
  const mockOptions: ScreenerOption[] = [
    { id: "trending", label: "Trending", description: "Stocks with strong momentum" },
    { id: "new-highs", label: "New Highs", description: "Stocks at 52-week highs" },
    {
      id: "rsi_reversal",
      label: "RSI Reversal",
      description: "Stocks showing RSI reversal signals",
    },
  ];

  const defaultProps = {
    options: mockOptions,
    activeScreener: "trending",
    onChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders navigation with all options", () => {
    render(
      <MantineProvider>
        <ScreenerNav {...defaultProps} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-nav")).toBeInTheDocument();
    expect(screen.getByText("Trending")).toBeInTheDocument();
    expect(screen.getByText("New Highs")).toBeInTheDocument();
    expect(screen.getByText("RSI Reversal")).toBeInTheDocument();
  });

  it("marks active screener as selected (checked radio button)", () => {
    render(
      <MantineProvider>
        <ScreenerNav {...defaultProps} />
      </MantineProvider>,
    );
    const checkedRadio = screen.getByRole("radio", { checked: true });
    expect(checkedRadio).toBeChecked();
    expect(checkedRadio).toHaveAttribute("value", "trending");
  });

  it("calls onChange when option is clicked", () => {
    render(
      <MantineProvider>
        <ScreenerNav {...defaultProps} />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByText("New Highs"));
    expect(defaultProps.onChange).toHaveBeenCalledWith("new-highs");
  });

  it("calls onChange with correct id from RSI Reversal", () => {
    render(
      <MantineProvider>
        <ScreenerNav {...defaultProps} />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByText("RSI Reversal"));
    expect(defaultProps.onChange).toHaveBeenCalledWith("rsi_reversal");
  });

  it("renders tooltips for options with descriptions", () => {
    render(
      <MantineProvider>
        <ScreenerNav {...defaultProps} />
      </MantineProvider>,
    );
    // Tooltip content is rendered (mocked to be visible)
    expect(screen.getByText("Stocks with strong momentum")).toBeInTheDocument();
    expect(screen.getByText("Stocks at 52-week highs")).toBeInTheDocument();
    expect(screen.getByText("Stocks showing RSI reversal signals")).toBeInTheDocument();
  });

  it("handles options without descriptions", () => {
    const optionsWithoutDesc: ScreenerOption[] = [{ id: "simple", label: "Simple" }];
    render(
      <MantineProvider>
        <ScreenerNav options={optionsWithoutDesc} activeScreener="simple" onChange={vi.fn()} />
      </MantineProvider>,
    );
    expect(screen.getByText("Simple")).toBeInTheDocument();
    // No tooltip should be rendered
    expect(screen.queryByText("simple")).not.toBeInTheDocument();
  });

  it("changes active screener when different option selected", () => {
    // Controlled component test: simulate parent state update
    let activeScreener = "trending";
    const handleChange = (id: string) => {
      activeScreener = id;
    };

    const { rerender } = render(
      <MantineProvider>
        <ScreenerNav
          options={mockOptions}
          activeScreener={activeScreener}
          onChange={handleChange}
        />
      </MantineProvider>,
    );

    // Initially trending is checked
    let checkedRadio = screen.getByRole("radio", { checked: true });
    expect(checkedRadio).toBeChecked();
    expect(checkedRadio).toHaveAttribute("value", "trending");

    // Click RSI Reversal to trigger onChange
    fireEvent.click(screen.getByText("RSI Reversal"));

    // Re-render with updated activeScreener to reflect new state
    rerender(
      <MantineProvider>
        <ScreenerNav
          options={mockOptions}
          activeScreener={activeScreener}
          onChange={handleChange}
        />
      </MantineProvider>,
    );

    checkedRadio = screen.getByRole("radio", { checked: true });
    expect(checkedRadio).toBeChecked();
    expect(checkedRadio).toHaveAttribute("value", "rsi_reversal");
  });

  it("renders correct number of options", () => {
    render(
      <MantineProvider>
        <ScreenerNav {...defaultProps} />
      </MantineProvider>,
    );
    const nav = screen.getByTestId("screener-nav");
    expect(nav).toHaveAttribute("data-options-count", "3");
  });

  it("handles single option", () => {
    const singleOption: ScreenerOption[] = [{ id: "only", label: "Only Option" }];
    render(
      <MantineProvider>
        <ScreenerNav options={singleOption} activeScreener="only" onChange={vi.fn()} />
      </MantineProvider>,
    );
    expect(screen.getByText("Only Option")).toBeInTheDocument();
  });

  it("handles empty options array", () => {
    render(
      <MantineProvider>
        <ScreenerNav options={[]} activeScreener="" onChange={vi.fn()} />
      </MantineProvider>,
    );
    const nav = screen.getByTestId("screener-nav");
    expect(nav).toHaveAttribute("data-options-count", "0");
  });

  it("renders with different active screener", () => {
    render(
      <MantineProvider>
        <ScreenerNav {...defaultProps} activeScreener="new-highs" />
      </MantineProvider>,
    );
    const checkedRadio = screen.getByRole("radio", { checked: true });
    expect(checkedRadio).toBeChecked();
    expect(checkedRadio).toHaveAttribute("value", "new-highs");
  });

  it("each option has unique test id", () => {
    render(
      <MantineProvider>
        <ScreenerNav {...defaultProps} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-nav-option-trending")).toBeInTheDocument();
    expect(screen.getByTestId("screener-nav-option-new-highs")).toBeInTheDocument();
    expect(screen.getByTestId("screener-nav-option-rsi_reversal")).toBeInTheDocument();
  });

  it("calls onChange when option label is clicked", () => {
    render(
      <MantineProvider>
        <ScreenerNav {...defaultProps} activeScreener="new-highs" />
      </MantineProvider>,
    );
    // Click the span inside the label
    const trendingOption = screen.getByTestId("screener-nav-option-trending");
    fireEvent.click(trendingOption);
    expect(defaultProps.onChange).toHaveBeenCalledWith("trending");
  });
});
