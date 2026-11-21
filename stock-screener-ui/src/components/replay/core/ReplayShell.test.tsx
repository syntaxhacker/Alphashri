// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@solidjs/testing-library";
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

const searchSymbols = vi.fn();
vi.mock("@/api/symbols", () => ({
  searchSymbols: (...args: unknown[]) => searchSymbols(...args),
}));

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
  searchSymbols.mockReset();
  searchSymbols.mockResolvedValue([{ symbol: "RELIANCE", name: "Reliance Industries" }]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ReplayShell manual run mode", () => {
  test("does not fetch on mount or state change, then fetches once on Run", async () => {
    const plugin = getStrategy("orb")!;
    render(() => <ReplayShell plugin={plugin} />);

    // hint + Run affordance render before any fetch
    expect(screen.getByText(/Choose a symbol \/ date, then press Run/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    // changing the date (a fetch-key input) must NOT trigger an auto-fetch
    await fireEvent.click(screen.getByText("2026-09-09"));
    expect(fetchMock).not.toHaveBeenCalled();

    // explicit Run triggers exactly one fetch with the symbol param
    await fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/poc/replay/orb"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(String(fetchMock.mock.calls[0][0])).toContain("symbol=RELIANCE");
  });
});

/**
 * The Replay page shell is `h-screen overflow-hidden` and its cards clip too, so
 * an in-flow `absolute` list was cut off at the field's own height. The symbol
 * field now uses the shared portalled autocomplete — pin that here so a
 * re-duplicated local copy cannot silently regress.
 */
describe("ReplayShell symbol field — portalled list", () => {
  const listbox = () => document.querySelector<HTMLElement>('[data-part="symbol-autocomplete-list"]');

  test("renders the option list in a fixed portal, not as an absolute child", async () => {
    const shell = render(() => (
      <div style={{ height: "100vh", overflow: "hidden" }}>
        <ReplayShell plugin={getStrategy("orb")!} />
      </div>
    ));

    const input = screen.getByLabelText("Symbol");
    await fireEvent.input(input, { target: { value: "RELI" } });
    await waitFor(() => expect(searchSymbols).toHaveBeenCalledWith("RELI", 10));
    await screen.findByText("RELIANCE");

    const list = listbox()!;
    expect(shell.container.contains(list)).toBe(false);
    expect(list.style.position).toBe("fixed");
  });

  test("a mousedown inside the list keeps it open and the click commits", async () => {
    render(() => (
      <div style={{ height: "100vh", overflow: "hidden" }}>
        <ReplayShell plugin={getStrategy("orb")!} />
      </div>
    ));

    const input = screen.getByLabelText("Symbol");
    await fireEvent.input(input, { target: { value: "RELI" } });
    const option = await screen.findByText("RELIANCE");

    fireEvent.mouseDown(option);
    expect(listbox()).not.toBeNull();

    fireEvent.click(option);
    expect(input).toHaveValue("RELIANCE");
    expect(listbox()).toBeNull();
  });
});
