// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/test-utils";
import { ChartBody } from "./ChartBody";
import { ChartControls } from "./ChartControls";
import { ChartHeader } from "./ChartHeader";

const chartNode = <div data-testid="stub-chart" />;

describe("ChartBody", () => {
  it("renders loading state", () => {
    render(<ChartBody loading={true} error={null} hasData={false} chart={chartNode} />);
    expect(screen.getByTestId("chart-loading")).toBeTruthy();
    expect(screen.queryByTestId("candlestick-chart")).toBeNull();
  });

  it("renders error with retry button", () => {
    render(<ChartBody loading={false} error="Failed to load" hasData={false} chart={chartNode} />);
    expect(screen.getByTestId("chart-error")).toBeTruthy();
    expect(screen.getByTestId("chart-retry-btn")).toBeTruthy();
    expect(screen.getByTestId("chart-error").textContent).toContain("Failed to load");
  });

  it("renders candlestick container with flex:1 style not ScrollArea when hasData", () => {
    render(<ChartBody loading={false} error={null} hasData={true} chart={chartNode} />);
    const el = screen.getByTestId("candlestick-chart");
    expect(el).toBeTruthy();
    // Generic: ensure not wrapped in ScrollArea — candlestick is direct child of chart-body
    expect(screen.getByTestId("candlestick-chart").parentElement?.getAttribute("data-testid")).toBe("chart-body");
    expect(screen.getByTestId("chart-body").contains(screen.getByTestId("candlestick-chart"))).toBe(true);
  });

  it("renders the injected chart node when hasData", () => {
    render(<ChartBody loading={false} error={null} hasData={true} chart={chartNode} />);
    expect(screen.getByTestId("stub-chart")).toBeTruthy();
  });

  it("does not render chart when loading even if hasData", () => {
    render(<ChartBody loading={true} error={null} hasData={true} chart={chartNode} />);
    expect(screen.queryByTestId("candlestick-chart")).toBeNull();
  });

  it("does not render chart when error present", () => {
    render(<ChartBody loading={false} error="err" hasData={true} chart={chartNode} />);
    expect(screen.queryByTestId("candlestick-chart")).toBeNull();
  });
});

describe("ChartControls", () => {
  it("renders timeframe and OR selects and checkboxes", () => {
    const { container } = renderWithProviders(
      <ChartControls timeframe={15} orMinutes={45} showPivots={true} show52wHigh={false} onTimeframeChange={() => {}} onOrMinutesChange={() => {}} onPivotsChange={() => {}} on52wHighChange={() => {}} />,
    );
    expect(container.querySelector('[data-testid="chart-timeframe-select"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="chart-or-select"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="chart-pivots-checkbox"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="chart-52w-checkbox"]')).toBeTruthy();
  });

  it("reflects checked state", () => {
    renderWithProviders(<ChartControls timeframe={5} orMinutes={15} showPivots={false} show52wHigh={true} onTimeframeChange={() => {}} onOrMinutesChange={() => {}} onPivotsChange={() => {}} on52wHighChange={() => {}} />);
    expect((screen.getByTestId("chart-pivots-checkbox") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("chart-52w-checkbox") as HTMLInputElement).checked).toBe(true);
  });
});

describe("ChartHeader", () => {
  it("renders symbol and back button", () => {
    renderWithProviders(<ChartHeader symbol="INFY" timeframe={15} orMinutes={45} showPivots={true} show52wHigh={true} onBack={() => {}} onTimeframeChange={() => {}} onOrMinutesChange={() => {}} onPivotsChange={() => {}} on52wHighChange={() => {}} />);
    expect(screen.getByTestId("chart-title").textContent).toBe("INFY");
    expect(screen.getByTestId("chart-back-btn")).toBeTruthy();
    expect(screen.getByTestId("chart-controls")).toBeTruthy();
  });
});
