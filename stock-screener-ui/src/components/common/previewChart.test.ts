// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockEcharts = {
  init: vi.fn().mockReturnValue({
    setOption: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
  }),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  (window as any).echarts = mockEcharts;
  globalThis.fetch = vi.fn(() => Promise.reject(new Error("fetch mock"))) as unknown as typeof fetch;
});

afterEach(async () => {
  vi.useRealTimers();
  try {
    const mod = await import("./previewChart");
    mod.hidePreviewChart();
    mod.collapseChart();
  } catch (_e) {}
  delete (window as any).echarts;
});

describe("previewChart module", () => {
  it("showPreviewChart debounces and creates hover container", async () => {
    const mod = await import("./previewChart");
    const event = new MouseEvent("mouseenter", { clientX: 100, clientY: 100 });
    mod.showPreviewChart(event, "TEST");

    expect(document.getElementById("chart-hover-popup")).toBeNull();

    vi.advanceTimersByTime(300);

    expect(document.getElementById("chart-hover-popup")).toBeTruthy();
    expect(document.getElementById("chart-hover-popup")?.style.display).toBe("block");
  });

  it("hidePreviewChart clears hover timer and hides container", async () => {
    const mod = await import("./previewChart");
    const event = new MouseEvent("mouseenter", { clientX: 100, clientY: 100 });
    mod.showPreviewChart(event, "TEST");
    vi.advanceTimersByTime(300);

    expect(document.getElementById("chart-hover-popup")?.style.display).toBe("block");

    mod.hidePreviewChart();
    expect(document.getElementById("chart-hover-popup")?.style.display).toBe("none");
  });

  it("toggleExpandedChart creates expanded panel", async () => {
    const mod = await import("./previewChart");
    mod.toggleExpandedChart("TEST");
    vi.advanceTimersByTime(100);

    expect(document.getElementById("chart-expanded-panel")).toBeTruthy();
    expect(document.getElementById("chart-expanded-panel")?.style.display).toBe("block");
  });

  it("collapseChart clears expanded panel", async () => {
    const mod = await import("./previewChart");
    mod.toggleExpandedChart("TEST");
    vi.advanceTimersByTime(100);
    mod.collapseChart();

    expect(document.getElementById("chart-expanded-panel")?.style.display).toBe("none");
  });

  it("toggleExpandedChart collapses when same symbol toggled again", async () => {
    const mod = await import("./previewChart");
    mod.toggleExpandedChart("TEST");
    vi.advanceTimersByTime(100);
    expect(document.getElementById("chart-expanded-panel")?.style.display).toBe("block");

    mod.toggleExpandedChart("TEST");
    expect(document.getElementById("chart-expanded-panel")?.style.display).toBe("none");
  });

  it("navigateToFullChart uses history API", async () => {
    const mod = await import("./previewChart");
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    mod.navigateToFullChart("RELIANCE");

    expect(pushStateSpy).toHaveBeenCalledWith({}, "", "/chart/RELIANCE");
    expect(dispatchSpy).toHaveBeenCalledWith(expect.any(PopStateEvent));
  });

  it("initPreviewChartHandlers attaches to window", async () => {
    const mod = await import("./previewChart");
    mod.initPreviewChartHandlers();

    expect(typeof (window as any).showPreviewChart).toBe("function");
    expect(typeof (window as any).hidePreviewChart).toBe("function");
    expect(typeof (window as any).toggleExpandedChart).toBe("function");
    expect(typeof (window as any).collapseChart).toBe("function");
    expect(typeof (window as any).navigateToFullChart).toBe("function");
    expect(typeof (window as any).setPreviewTimeframe).toBe("function");
    expect(typeof (window as any).setPreviewOrMinutes).toBe("function");
  });

  it("setPreviewTimeframe updates expanded chart", async () => {
    const mod = await import("./previewChart");
    mod.toggleExpandedChart("TEST");
    vi.advanceTimersByTime(100);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no api"));
    mod.setPreviewTimeframe(5);
    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("setPreviewOrMinutes updates expanded chart", async () => {
    const mod = await import("./previewChart");
    mod.toggleExpandedChart("TEST");
    vi.advanceTimersByTime(100);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no api"));
    mod.setPreviewOrMinutes(60);
    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
