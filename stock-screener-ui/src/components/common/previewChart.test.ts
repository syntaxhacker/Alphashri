// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";

let showPreviewChart: typeof import("./previewChart").showPreviewChart;
let hidePreviewChart: typeof import("./previewChart").hidePreviewChart;
let toggleExpandedChart: typeof import("./previewChart").toggleExpandedChart;
let collapseChart: typeof import("./previewChart").collapseChart;
let navigateToFullChart: typeof import("./previewChart").navigateToFullChart;
let setPreviewTimeframe: typeof import("./previewChart").setPreviewTimeframe;
let setPreviewOrMinutes: typeof import("./previewChart").setPreviewOrMinutes;
let initPreviewChartHandlers: typeof import("./previewChart").initPreviewChartHandlers;

beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = "";

  vi.doMock("../../api/chartPreview", () => ({
    fetchChartPreview: vi.fn().mockResolvedValue({
      symbol: "TEST",
      candles: [
        {
          time: "2025-10-24T09:15",
          date: "2025-10-24",
          time_str: "09:15",
          open: 100,
          high: 105,
          low: 98,
          close: 103,
          volume: 1000,
        },
      ],
      orb_zones: [],
      pivot_levels: [],
    }),
  }));

  vi.doMock("../chart/chartRenderer", () => ({
    buildChartOption: vi.fn().mockReturnValue({ series: [] }),
  }));

  const mod = await import("./previewChart");
  showPreviewChart = mod.showPreviewChart;
  hidePreviewChart = mod.hidePreviewChart;
  toggleExpandedChart = mod.toggleExpandedChart;
  collapseChart = mod.collapseChart;
  navigateToFullChart = mod.navigateToFullChart;
  setPreviewTimeframe = mod.setPreviewTimeframe;
  setPreviewOrMinutes = mod.setPreviewOrMinutes;
  initPreviewChartHandlers = mod.initPreviewChartHandlers;
});

describe("showPreviewChart", () => {
  it("creates hover container after debounce", async () => {
    const evt = { clientX: 100, clientY: 100 } as MouseEvent;
    showPreviewChart(evt, "TEST");

    const containerBefore = document.getElementById("chart-hover-popup");
    expect(containerBefore).toBeNull();

    await new Promise((r) => setTimeout(r, 350));

    const containerAfter = document.getElementById("chart-hover-popup");
    expect(containerAfter).toBeTruthy();
    expect(containerAfter?.getAttribute("data-testid")).toBe("preview-chart-hover");
  });
});

describe("hidePreviewChart", () => {
  it("hides the hover container when visible", async () => {
    const evt = { clientX: 100, clientY: 100 } as MouseEvent;
    showPreviewChart(evt, "TEST");
    await new Promise((r) => setTimeout(r, 350));

    hidePreviewChart();

    const container = document.getElementById("chart-hover-popup");
    expect(container?.style.display).toBe("none");
  });
});

describe("toggleExpandedChart", () => {
  it("creates expanded panel on first call", () => {
    toggleExpandedChart("TEST");

    const container = document.getElementById("chart-expanded-panel");
    expect(container).toBeTruthy();
    expect(container?.getAttribute("data-testid")).toBe("preview-chart-expanded");
    expect(container?.innerHTML).toContain("TEST");
  });

  it("collapses when same symbol is toggled again", () => {
    toggleExpandedChart("TEST");
    toggleExpandedChart("TEST");

    const container = document.getElementById("chart-expanded-panel");
    expect(container?.style.display).toBe("none");
  });

  it("switches to different symbol", () => {
    toggleExpandedChart("AAA");
    toggleExpandedChart("BBB");

    const container = document.getElementById("chart-expanded-panel");
    expect(container?.innerHTML).toContain("BBB");
  });
});

describe("collapseChart", () => {
  it("hides expanded panel created by toggleExpandedChart", () => {
    toggleExpandedChart("TEST");
    collapseChart();

    const container = document.getElementById("chart-expanded-panel");
    expect(container?.style.display).toBe("none");
  });
});

describe("navigateToFullChart", () => {
  it("uses history pushState and dispatches popstate", () => {
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    navigateToFullChart("AAPL");

    expect(pushStateSpy).toHaveBeenCalledWith({}, "", "/chart/AAPL");
    expect(dispatchSpy).toHaveBeenCalled();
  });
});

describe("setPreviewTimeframe", () => {
  it("does nothing if same timeframe", async () => {
    toggleExpandedChart("TEST");
    await new Promise((r) => setTimeout(r, 350));
    const { fetchChartPreview } = await import("../../api/chartPreview");
    const callsBefore = (fetchChartPreview as any).mock.calls.length;
    setPreviewTimeframe(15);
    expect((fetchChartPreview as any).mock.calls.length).toBe(callsBefore);
  });
});

describe("setPreviewOrMinutes", () => {
  it("does nothing if same orMinutes", async () => {
    toggleExpandedChart("TEST");
    await new Promise((r) => setTimeout(r, 350));
    const { fetchChartPreview } = await import("../../api/chartPreview");
    const callsBefore = (fetchChartPreview as any).mock.calls.length;
    setPreviewOrMinutes(45);
    expect((fetchChartPreview as any).mock.calls.length).toBe(callsBefore);
  });
});

describe("initPreviewChartHandlers", () => {
  it("attaches handlers to window", () => {
    initPreviewChartHandlers();

    expect(typeof (window as any).showPreviewChart).toBe("function");
    expect((window as any).showPreviewChart).toBe(showPreviewChart);
    expect(typeof (window as any).hidePreviewChart).toBe("function");
    expect((window as any).hidePreviewChart).toBe(hidePreviewChart);
    expect(typeof (window as any).toggleExpandedChart).toBe("function");
    expect((window as any).toggleExpandedChart).toBe(toggleExpandedChart);
    expect(typeof (window as any).collapseChart).toBe("function");
    expect((window as any).collapseChart).toBe(collapseChart);
    expect(typeof (window as any).navigateToFullChart).toBe("function");
    expect((window as any).navigateToFullChart).toBe(navigateToFullChart);
    expect(typeof (window as any).setPreviewTimeframe).toBe("function");
    expect((window as any).setPreviewTimeframe).toBe(setPreviewTimeframe);
    expect(typeof (window as any).setPreviewOrMinutes).toBe("function");
    expect((window as any).setPreviewOrMinutes).toBe(setPreviewOrMinutes);
  });
});
