// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ScreenerNav } from "./ScreenerNav";
import { MantineProvider } from "@mantine/core";
import type { ScreenerOption } from "../../types";

vi.mock("@mantine/core", async () => {
  const actual = await vi.importActual("@mantine/core");
  return {
    ...actual,
    Tooltip: ({ label, children }: { label: string; children: React.ReactNode }) => (
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

  it("marks active screener with data-active", () => {
    render(
      <MantineProvider>
        <ScreenerNav {...defaultProps} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-nav-option-trending")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("screener-nav-option-new-highs")).not.toHaveAttribute("data-active");
  });

  it("calls onChange when option is clicked", () => {
    render(
      <MantineProvider>
        <ScreenerNav {...defaultProps} />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByTestId("screener-nav-option-new-highs"));
    expect(defaultProps.onChange).toHaveBeenCalledWith("new-highs");
  });

  it("calls onChange with correct id from RSI Reversal", () => {
    render(
      <MantineProvider>
        <ScreenerNav {...defaultProps} />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByTestId("screener-nav-option-rsi_reversal"));
    expect(defaultProps.onChange).toHaveBeenCalledWith("rsi_reversal");
  });

  it("renders tooltips for options with descriptions", () => {
    render(
      <MantineProvider>
        <ScreenerNav {...defaultProps} />
      </MantineProvider>,
    );
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
  });

  it("changes active screener when different option selected", () => {
    let activeScreener = "trending";
    const handleChange = (id: string) => {
      activeScreener = id;
    };

    const { rerender } = render(
      <MantineProvider>
        <ScreenerNav options={mockOptions} activeScreener={activeScreener} onChange={handleChange} />
      </MantineProvider>,
    );

    expect(screen.getByTestId("screener-nav-option-trending")).toHaveAttribute("data-active", "true");

    fireEvent.click(screen.getByTestId("screener-nav-option-rsi_reversal"));

    rerender(
      <MantineProvider>
        <ScreenerNav options={mockOptions} activeScreener={activeScreener} onChange={handleChange} />
      </MantineProvider>,
    );

    expect(screen.getByTestId("screener-nav-option-rsi_reversal")).toHaveAttribute("data-active", "true");
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
    expect(screen.getByTestId("screener-nav-option-new-highs")).toHaveAttribute("data-active", "true");
  });

  it("shows compact badges for legacy and current screeners", () => {
    const optionsWithStatus: ScreenerOption[] = [
      { id: "52w_high", label: "52W High", status: "current" },
      { id: "near_52w_breakout", label: "Near 52W", status: "legacy" },
    ];
    render(
      <MantineProvider>
        <ScreenerNav
          options={optionsWithStatus}
          activeScreener="52w_high"
          onChange={vi.fn()}
        />
      </MantineProvider>,
    );
    expect(screen.getByText("N")).toBeInTheDocument();
    expect(screen.getByText("L")).toBeInTheDocument();
    expect(screen.getByText("Legacy")).toBeInTheDocument();
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

  it("calls onChange when option test id is clicked", () => {
    render(
      <MantineProvider>
        <ScreenerNav {...defaultProps} activeScreener="new-highs" />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByTestId("screener-nav-option-trending"));
    expect(defaultProps.onChange).toHaveBeenCalledWith("trending");
  });
});