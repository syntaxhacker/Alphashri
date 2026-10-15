// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReplayShell from "./ReplayShell";
import { getStrategy } from "../strategies";

vi.mock("lightweight-charts", () => ({
  ColorType: { Solid: "solid" },
  CandlestickSeries: {},
  LineSeries: {},
  createSeriesMarkers: vi.fn(),
  createChart: vi.fn(() => ({
    addSeries: () => ({
      setData: vi.fn(),
      update: vi.fn(),
      createPriceLine: vi.fn(),
      priceToCoordinate: () => 100,
    }),
    timeScale: () => ({
      setVisibleRange: vi.fn(),
      scrollToPosition: vi.fn(),
      timeToCoordinate: () => 100,
      fitContent: vi.fn(),
      subscribeVisibleLogicalRangeChange: vi.fn(),
      unsubscribeVisibleLogicalRangeChange: vi.fn(),
    }),
    applyOptions: vi.fn(),
    remove: vi.fn(),
  })),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  class ResizeObserverMock {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    constructor(_callback: ResizeObserverCallback) {}
  }
  global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({
    json: () => Promise.resolve({ bars: [], trades: [] }),
  } as unknown as Response);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ReplayShell manual run mode", () => {
  test("does not fetch on mount or state change, then fetches once on Run", async () => {
    const user = userEvent.setup();
    const plugin = getStrategy("orb")!;
    render(<ReplayShell plugin={plugin} />);

    // hint + Run affordance render before any fetch
    expect(screen.getByText(/Choose a symbol \/ date, then press Run/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    // changing the date (a fetch-key input) must NOT trigger an auto-fetch
    await user.click(screen.getByText("2026-09-09"));
    expect(fetchMock).not.toHaveBeenCalled();

    // explicit Run triggers exactly one fetch with the symbol param
    await user.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/poc/replay/orb"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(String(fetchMock.mock.calls[0][0])).toContain("symbol=RELIANCE");
  });
});
