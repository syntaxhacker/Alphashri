// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { SectorHeatmapControls } from "./SectorHeatmapContext";
import { SectorHeatmapView } from "./SectorHeatmapView";

vi.mock("@/utils/loadEcharts", () => ({ loadEcharts: async () => null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const noop = () => {};

describe("SectorHeatmapControls", () => {
  it("renders the layer toggle and hides stock-only filters on the sector layer", () => {
    render(() => (
      <SectorHeatmapControls
        viewMode="sector"
        onViewModeChange={noop}
        metric="change_pct"
        onMetricChange={noop}
      />
    ));
    expect(screen.getByTestId("sector-heatmap-view-toggle")).toBeInTheDocument();
    expect(screen.queryByTestId("sector-heatmap-metric")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sector-heatmap-sector-filter")).not.toBeInTheDocument();
  });

  it("reveals the metric and sector selects on the stock layer", () => {
    render(() => (
      <SectorHeatmapControls
        viewMode="stock"
        onViewModeChange={noop}
        metric="change_pct"
        onMetricChange={noop}
        sectorOptions={[{ value: "IT", label: "IT" }]}
      />
    ));
    expect(screen.getByTestId("sector-heatmap-metric")).toBeInTheDocument();
    expect(screen.getByTestId("sector-heatmap-sector-filter")).toBeInTheDocument();
  });

  it("switches layer through the toggle", () => {
    const onChange = vi.fn();
    render(() => (
      <SectorHeatmapControls
        viewMode="sector"
        onViewModeChange={onChange}
        metric="change_pct"
        onMetricChange={noop}
      />
    ));
    fireEvent.click(screen.getByText("Stocks"));
    expect(onChange).toHaveBeenCalledWith("stock");
  });
});

describe("SectorHeatmapView", () => {
  it("renders only the chart frame — no control row lives inside the panel", () => {
    render(() => (
      <SectorHeatmapView viewMode="sector" sectors={[]} stocks={[]} metric="change_pct" />
    ));
    expect(screen.getByTestId("sector-heatmap-view")).toBeInTheDocument();
    expect(screen.getByTestId("sector-heatmap-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("sector-heatmap-view-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sector-heatmap-metric")).not.toBeInTheDocument();
  });
});