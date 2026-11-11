// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import userEvent from "@testing-library/user-event";
import { useContext } from "react";
import { MemoryRouter } from "react-router-dom";
import { UIProvider } from "@/ui";
import { SymbolDockProvider } from "./SymbolDockProvider";
import { SymbolDockContext } from "./symbolDockContext";

vi.mock("../../api/chartPatterns", () => ({
  fetchSymbolChart: vi.fn(),
  fetchPatternHit: vi.fn(),
}));

vi.mock("@/components/patterns/PatternFullscreenView", () => ({
  PatternFullscreenView: ({ symbol, loading }: { symbol: string | null; loading?: boolean }) => (
    <div data-testid="patterns-chart-dock" data-loading={String(Boolean(loading))}>
      {symbol}
    </div>
  ),
}));

import { fetchSymbolChart } from "../../api/chartPatterns";

const mockedFetchSymbolChart = vi.mocked(fetchSymbolChart);

function candle() {
  return { t: "2026-11-06", o: 118, h: 122, l: 117, c: 120, v: 1000 };
}

const STALE_CHART = {
  candles: [candle()],
  hits: [],
  trend_lines: [],
  cached: true,
  stale: true,
  as_of: "2026-11-06",
} as never;

const FRESH_CHART = {
  candles: [candle()],
  hits: [],
  trend_lines: [],
  cached: false,
  stale: false,
} as never;

function DockHarness() {
  const dock = useContext(SymbolDockContext);
  return (
    <>
      <button type="button" data-testid="open-ircon" onClick={() => dock.open("IRCON")}>
        IRCON
      </button>
      <button type="button" data-testid="open-reliance" onClick={() => dock.open("RELIANCE")}>
        RELIANCE
      </button>
      <button type="button" data-testid="close-dock" onClick={() => dock.close()}>
        close
      </button>
    </>
  );
}

function renderDock() {
  return render(
    <UIProvider>
      <MemoryRouter>
        <SymbolDockProvider>
          <DockHarness />
        </SymbolDockProvider>
      </MemoryRouter>
    </UIProvider>,
  );
}

describe("SymbolDockProvider stale badge", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("1200px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  test("a stale-first payload shows the Cached badge", async () => {
    mockedFetchSymbolChart.mockResolvedValue(STALE_CHART);
    const user = userEvent.setup();
    renderDock();

    await user.click(screen.getByTestId("open-ircon"));

    const badge = await screen.findByTestId("dock-stale");
    expect(badge).toHaveTextContent("Cached 2026-11-06");
    await waitFor(() =>
      expect(screen.getByTestId("patterns-chart-dock")).toHaveTextContent("IRCON"),
    );
  });

  test("a fresh payload hides the badge", async () => {
    mockedFetchSymbolChart.mockResolvedValue(STALE_CHART);
    const user = userEvent.setup();
    renderDock();

    await user.click(screen.getByTestId("open-ircon"));
    expect(await screen.findByTestId("dock-stale")).toBeInTheDocument();

    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    await user.click(screen.getByTestId("open-reliance"));

    await waitFor(() =>
      expect(screen.getByTestId("patterns-chart-dock")).toHaveTextContent("RELIANCE"),
    );
    await waitFor(() => expect(screen.queryByTestId("dock-stale")).not.toBeInTheDocument());
  });

  test("switching symbol resets the badge before the new frame arrives", async () => {
    mockedFetchSymbolChart.mockResolvedValue(STALE_CHART);
    const user = userEvent.setup();
    renderDock();

    await user.click(screen.getByTestId("open-ircon"));
    expect(await screen.findByTestId("dock-stale")).toBeInTheDocument();

    // RELIANCE phase 1 hangs: the badge must disappear via the synchronous reset,
    // not because a fresh frame happened to land.
    let resolvePhase1!: (v: unknown) => void;
    mockedFetchSymbolChart.mockReset();
    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    mockedFetchSymbolChart.mockImplementationOnce(
      () => new Promise((resolve) => { resolvePhase1 = resolve; }),
    );
    await user.click(screen.getByTestId("open-reliance"));

    expect(screen.queryByTestId("dock-stale")).not.toBeInTheDocument();

    await act(async () => {
      resolvePhase1(FRESH_CHART);
    });
  });

  test("closing the dock removes the badge", async () => {
    mockedFetchSymbolChart.mockResolvedValue(STALE_CHART);
    const user = userEvent.setup();
    renderDock();

    await user.click(screen.getByTestId("open-ircon"));
    expect(await screen.findByTestId("dock-stale")).toBeInTheDocument();

    await user.click(screen.getByTestId("close-dock"));

    expect(screen.queryByTestId("symbol-dock")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dock-stale")).not.toBeInTheDocument();
  });
});
