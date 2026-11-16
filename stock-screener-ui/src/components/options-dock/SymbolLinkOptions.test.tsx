// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { useContext } from "solid-js";
import { Router } from "@solidjs/router";
import { UIProvider } from "@/ui";
import { SymbolLink } from "@/components/common/SymbolLink";
import { SymbolDockContext } from "@/components/common/symbolDockContext";
import { SymbolDockProvider } from "@/components/common/SymbolDockProvider";
import { __resetOptionsDock } from "@/state/optionsDock";

// The dock's options panel is lazy; these tests only assert the wiring, so the
// panel is stubbed and the chain client is never reached.
vi.mock("./OptionsDockPanel", () => ({
  OptionsDockPanel: (props: { onClose?: () => void }) => (
    <div data-testid="options-dock-panel">
      options
      <button type="button" data-testid="options-dock-panel-close" onClick={() => props.onClose?.()}>
        close
      </button>
    </div>
  ),
}));

const fetchUnderlying = vi.fn();
const fetchChain = vi.fn();
vi.mock("../../api/optionsDock", async () => {
  const actual = await vi.importActual<typeof import("../../api/optionsDock")>("../../api/optionsDock");
  return {
    ...actual,
    fetchUnderlying: (...args: unknown[]) => fetchUnderlying(...args),
    fetchChain: (...args: unknown[]) => fetchChain(...args),
  };
});

const open = vi.fn();
const close = vi.fn();

function renderLink(props: { onOpen?: (symbol: string) => void } = {}) {
  return render(() => (
    <UIProvider>
      <SymbolDockContext.Provider
        value={{ open, close, preview: vi.fn(), endPreview: vi.fn(), pinned: false, setOutlet: vi.fn() }}
      >
        <SymbolLink symbol="RELIANCE" testId="sym-tv" onOpen={props.onOpen} />
      </SymbolDockContext.Provider>
    </UIProvider>
  ));
}

describe("SymbolLink options affordance", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("renders an options icon with the documented test id", () => {
    renderLink();
    expect(screen.getByTestId("symbol-options-RELIANCE")).toBeInTheDocument();
  });

  test("clicking the options icon opens the dock in options mode, not the chart handler", async () => {
    const onOpen = vi.fn();
    renderLink({ onOpen });

    await fireEvent.click(screen.getByTestId("symbol-options-RELIANCE"));

    expect(open).toHaveBeenCalledWith("RELIANCE", "options");
    expect(onOpen).not.toHaveBeenCalled();
  });

  test("the options click does not bubble to the row handler", async () => {
    const row = vi.fn();
    render(() => (
      <UIProvider>
        <SymbolDockContext.Provider
          value={{ open, close, preview: vi.fn(), endPreview: vi.fn(), pinned: false, setOutlet: vi.fn() }}
        >
          <div onClick={row}>
            <SymbolLink symbol="SBIN" testId="sym-tv" />
          </div>
        </SymbolDockContext.Provider>
      </UIProvider>
    ));

    await fireEvent.click(screen.getByTestId("symbol-options-SBIN"));
    expect(row).not.toHaveBeenCalled();
  });
});

function DockHarness() {
  const dock = useContext(SymbolDockContext);
  return (
    <>
      <button type="button" data-testid="open-options" onClick={() => dock.open("RELIANCE", "options")}>
        options
      </button>
      <button type="button" data-testid="open-chart" onClick={() => dock.open("RELIANCE")}>
        chart
      </button>
      <span data-testid="dock-mode">{dock.mode?.() ?? "chart"}</span>
      <span data-testid="dock-symbol">{dock.symbol?.() ?? ""}</span>
    </>
  );
}

describe("SymbolDockProvider options mode", () => {
  beforeEach(() => {
    __resetOptionsDock();
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
    fetchUnderlying.mockResolvedValue({
      symbol: "RELIANCE",
      exchange: "NSE",
      fno: true,
      instrumentKey: "NSE_EQ|INE002A01018",
      spot: 1417.4,
      expiries: [{ date: "2026-12-31", weekly: false, dteDays: 45, lotSize: 500, tickSize: 0.05 }],
      defaultExpiry: "2026-12-31",
      marketState: "open",
    });
    fetchChain.mockResolvedValue({
      expiry: "2026-12-31",
      spot: 1417.4,
      pcr: 1,
      atmIv: 20,
      spotChangePct: null,
      rows: [],
      asOf: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    __resetOptionsDock();
  });

  test("open(symbol, 'options') renders the options panel and reports the mode", async () => {
    render(() => (
      <Router root={() => <UIProvider><SymbolDockProvider><DockHarness /></SymbolDockProvider></UIProvider>} />
    ));

    await fireEvent.click(screen.getByTestId("open-options"));

    await waitFor(() => expect(screen.getByTestId("options-dock-panel")).toBeInTheDocument());
    expect(screen.getByTestId("dock-mode")).toHaveTextContent("options");
    expect(screen.getByTestId("dock-symbol")).toHaveTextContent("RELIANCE");
    expect(document.querySelector('[data-testid="symbol-dock"]')?.getAttribute("data-mode")).toBe(
      "options",
    );
    // One E1 + one E2: the dock opened once.
    expect(fetchUnderlying).toHaveBeenCalledTimes(1);
    expect(fetchChain).toHaveBeenCalledTimes(1);
  });

  test("closing from the panel returns the dock to chart mode", async () => {
    render(() => (
      <Router root={() => <UIProvider><SymbolDockProvider><DockHarness /></SymbolDockProvider></UIProvider>} />
    ));

    await fireEvent.click(screen.getByTestId("open-options"));
    await waitFor(() => expect(screen.getByTestId("options-dock-panel")).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId("options-dock-panel-close"));

    await waitFor(() => expect(screen.queryByTestId("options-dock-panel")).not.toBeInTheDocument());
    expect(screen.getByTestId("dock-mode")).toHaveTextContent("chart");
  });
});
