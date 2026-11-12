// Shared test-only fixture builders for src/hooks tests (not under src/test).
// Extracted so the hook suites stop cloning their setup/teardown harnesses.
import { vi, beforeEach, afterEach, expect } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useSearchParams } from "@solidjs/router";
import { DEFAULT_PATTERN_FILTERS } from "../state/chartPatterns";
import { usePatternUrlSync, type UsePatternUrlSyncArgs } from "./usePatternUrlSync";

// ---------- useECharts ----------

export interface MockChartInstance {
  setOption: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

export interface MockECharts {
  mockEcharts: { init: ReturnType<typeof vi.fn> };
  getChartInstance: () => MockChartInstance;
  install: () => void;
  uninstall: () => void;
}

export function createMockECharts(): MockECharts {
  // Instance slot is per-harness so parallel suites never share a chart.
  let mockChartInstance: MockChartInstance | null = null;
  const mockEcharts = {
    init: vi.fn(() => {
      mockChartInstance = {
        setOption: vi.fn(),
        resize: vi.fn(),
        on: vi.fn(),
        dispose: vi.fn(),
      };
      return mockChartInstance;
    }),
  };
  return {
    mockEcharts,
    getChartInstance: () => mockChartInstance as MockChartInstance,
    install: () => {
      vi.stubEnv("NODE_ENV", "test");
      global.ResizeObserver = vi.fn(() => ({
        observe: vi.fn(),
        disconnect: vi.fn(),
      })) as unknown as typeof ResizeObserver;
      (window as unknown as Record<string, unknown>).echarts = mockEcharts;
    },
    uninstall: () => {
      vi.unstubAllEnvs();
      vi.clearAllMocks();
      delete (window as unknown as Record<string, unknown>).echarts;
    },
  };
}

/** Attach a fresh <div> to a hook chartRef via Object.defineProperty. */
export function attachMockDiv(
  chartRef: unknown,
  opts: { configurable?: boolean } = {},
): HTMLDivElement {
  const mockDiv = document.createElement("div");
  Object.defineProperty(chartRef as object, "current", {
    value: mockDiv,
    configurable: opts.configurable,
  });
  return mockDiv;
}

/** Await `setChartOption(option)` inside act(). */
export async function applyOption(
  result: { current: any },
  option: unknown = { series: [] },
): Promise<void> {
  await act(async () => {
    await result.current.setChartOption(option);
  });
}

/** Attach a div to the chartRef and apply the option inside act(). Returns the div. */
export async function initChart(
  result: { current: any },
  option: unknown = { series: [] },
  opts: { configurable?: boolean } = {},
): Promise<HTMLDivElement> {
  const mockDiv = attachMockDiv(result.current.chartRef, opts);
  await applyOption(result, option);
  return mockDiv;
}

// ---------- usePatternUrlSync ----------

export const urlSyncSetSearchParams = vi.fn();

/** Point the mocked useSearchParams at the given query string. */
export function setMockUrl(url: string): void {
  vi.mocked(useSearchParams).mockReturnValue([
    new URLSearchParams(url),
    urlSyncSetSearchParams,
  ] as never);
}

/** Clear the write-spy and reset the mocked location to an empty query string. */
export function resetMockUrlSync(): void {
  urlSyncSetSearchParams.mockClear();
  setMockUrl("");
}

/** Base args shared by the URL-sync suites. Call sites layer their
 * file-specific defaults (computeTrendlines / setTab) on top.
 */
export function urlSyncArgsBase() {
  return {
    universe: "",
    timeframe: "1D",
    lookbackBars: null,
    filters: { ...DEFAULT_PATTERN_FILTERS },
    setUniverse: vi.fn(),
    setTimeframe: vi.fn(),
    setLookbackBars: vi.fn(),
    setComputeTrendlines: vi.fn(),
    applyFilters: vi.fn(),
  };
}

/** Register the shared beforeEach/afterEach pair the URL-sync suites both need. */
export function registerUrlSyncTestHarness(): void {
  beforeEach(() => {
    resetMockUrlSync();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });
}

/** renderHook wrapper with the props-typed usePatternUrlSync call signature. */
export function renderPatternUrlSync(args: UsePatternUrlSyncArgs) {
  return renderHook((props: UsePatternUrlSyncArgs) => usePatternUrlSync(props), {
    initialProps: args,
  });
}

/** Assert the "sync hook did nothing" block shared by several mount/adoption tests. */
export function expectNoUrlSyncCalls(
  args: UsePatternUrlSyncArgs,
  opts: { computeTrendlines?: boolean; writes?: boolean } = {},
): void {
  const { computeTrendlines = false, writes = true } = opts;
  expect(args.setUniverse).not.toHaveBeenCalled();
  expect(args.setTimeframe).not.toHaveBeenCalled();
  expect(args.setLookbackBars).not.toHaveBeenCalled();
  if (computeTrendlines) expect(args.setComputeTrendlines).not.toHaveBeenCalled();
  expect(args.applyFilters).not.toHaveBeenCalled();
  if (writes) expect(urlSyncSetSearchParams).not.toHaveBeenCalled();
}

/** Assert exactly one URL write with replace:true; returns the written params. */
export function expectUrlWrite(): URLSearchParams {
  expect(urlSyncSetSearchParams).toHaveBeenCalledTimes(1);
  const [params, options] = urlSyncSetSearchParams.mock.calls[0];
  expect(options).toEqual({ replace: true });
  return params as URLSearchParams;
}
