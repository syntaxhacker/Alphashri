// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderWithMantine } from "../../test/test-utils";
import { ChartBody } from "./ChartBody";
import { ChartControls } from "./ChartControls";
import { ChartHeader } from "./ChartHeader";
import { createRef } from "react";

describe("ChartBody", () => {
  it("renders loading state", () => {
    render(<ChartBody loading={true} error={null} chartError={null} hasData={false} ref={createRef()} />);
    expect(screen.getByTestId("chart-loading")).toBeTruthy();
    expect(screen.queryByTestId("candlestick-chart")).toBeNull();
  });

  it("renders error with retry button", () => {
    render(<ChartBody loading={false} error="Failed to load" chartError={null} hasData={false} ref={createRef()} />);
    expect(screen.getByTestId("chart-error")).toBeTruthy();
    expect(screen.getByTestId("chart-retry-btn")).toBeTruthy();
    expect(screen.getByTestId("chart-error").textContent).toContain("Failed to load");
  });

  it("prefers chartError when error is null", () => {
    render(<ChartBody loading={false} error={null} chartError="ECharts not loaded" hasData={false} ref={createRef()} />);
    expect(screen.getByTestId("chart-error").textContent).toContain("ECharts not loaded");
  });

  it("renders candlestick container with flex:1 style not ScrollArea when hasData", () => {
    const ref = createRef<HTMLDivElement>();
    render(<ChartBody loading={false} error={null} chartError={null} hasData={true} ref={ref} />);
    const el = screen.getByTestId("candlestick-chart");
    expect(el).toBeTruthy();
    expect(el.style.width).toBe("100%");
    expect(el.style.height).toBe("100%");
    // Ensure not wrapped in ScrollArea (Mantine ScrollArea renders with class mantine-ScrollArea)
    expect(document.querySelector(".mantine-ScrollArea-root")).toBeNull();
  });

  it("does not render chart when loading even if hasData", () => {
    render(<ChartBody loading={true} error={null} chartError={null} hasData={true} ref={createRef()} />);
    expect(screen.queryByTestId("candlestick-chart")).toBeNull();
  });

  it("does not render chart when error present", () => {
    render(<ChartBody loading={false} error="err" chartError={null} hasData={true} ref={createRef()} />);
    expect(screen.queryByTestId("candlestick-chart")).toBeNull();
  });
});

describe("ChartControls", () => {
  it("renders timeframe and OR selects and checkboxes", () => {
    const { container } = renderWithMantine(
      <ChartControls timeframe={15} orMinutes={45} showPivots={true} show52wHigh={false} onTimeframeChange={() => {}} onOrMinutesChange={() => {}} onPivotsChange={() => {}} on52wHighChange={() => {}} />,
    );
    expect(container.querySelector('[data-testid="chart-timeframe-select"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="chart-or-select"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="chart-pivots-checkbox"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="chart-52w-checkbox"]')).toBeTruthy();
  });

  it("reflects checked state", () => {
    renderWithMantine(<ChartControls timeframe={5} orMinutes={15} showPivots={false} show52wHigh={true} onTimeframeChange={() => {}} onOrMinutesChange={() => {}} onPivotsChange={() => {}} on52wHighChange={() => {}} />);
    expect((screen.getByTestId("chart-pivots-checkbox") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("chart-52w-checkbox") as HTMLInputElement).checked).toBe(true);
  });
});

describe("ChartHeader", () => {
  it("renders symbol and back button", () => {
    renderWithMantine(<ChartHeader symbol="INFY" timeframe={15} orMinutes={45} showPivots={true} show52wHigh={true} onBack={() => {}} onTimeframeChange={() => {}} onOrMinutesChange={() => {}} onPivotsChange={() => {}} on52wHighChange={() => {}} />);
    expect(screen.getByTestId("chart-title").textContent).toBe("INFY");
    expect(screen.getByTestId("chart-back-btn")).toBeTruthy();
    expect(screen.getByTestId("chart-controls")).toBeTruthy();
  });
});
