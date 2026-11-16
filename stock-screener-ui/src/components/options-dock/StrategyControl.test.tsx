// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";

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

// happy-dom has no 2D canvas: the real ECharts init throws from zrender.
const chartStub = {
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
};
vi.mock("../../utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({ init: vi.fn(() => chartStub) })),
}));

import type { OptionDockChain, UnderlyingInfo } from "../../api/optionsDock";
import { OptionsDockPanel } from "./OptionsDockPanel";
import { __resetOptionsDock, open, optionsDockState, setStrategy } from "../../state/optionsDock";

function listing(overrides: Partial<UnderlyingInfo> = {}): UnderlyingInfo {
  return {
    symbol: "NIFTY",
    exchange: "NSE",
    fno: true,
    instrumentKey: "NSE_INDEX|Nifty 50",
    spot: 24031.5,
    expiries: [
      { date: "2026-03-26", weekly: true, dteDays: 2, lotSize: 65, tickSize: 0.05 },
      { date: "2026-04-02", weekly: true, dteDays: 9, lotSize: 65, tickSize: 0.05 },
    ],
    defaultExpiry: "2026-03-26",
    marketState: "open",
    ...overrides,
  };
}

function quote(ltp: number, iv: number | null = 13.8) {
  return {
    ltp,
    oi: 1_000_000,
    prevOi: 1_000_000,
    volume: 0,
    iv,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    pop: null,
    bid: null,
    ask: null,
    instrumentKey: "",
  };
}

/** Seven strikes, so the four-leg structures (condor/butterfly) can hold. */
function chain(expiry: string, strikes = [23500, 23750, 23900, 24000, 24100, 24250, 24500]): OptionDockChain {
  return {
    expiry,
    spot: 24031.5,
    pcr: 1.11,
    atmIv: 13.8,
    spotChangePct: 0.42,
    asOf: "2026-03-24T14:52:00+05:30",
    rows: strikes.map((strike) => ({
      strike,
      ce: quote(Math.max(1, (24500 - strike) * 0.12)),
      pe: quote(Math.max(1, (strike - 23500) * 0.12)),
    })),
  };
}

function renderPanel() {
  return render(() => (
    <UIProvider>
      <OptionsDockPanel />
    </UIProvider>
  ));
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function pick(id: string) {
  await fireEvent.click(screen.getByTestId("options-strategy"));
  await waitFor(() => expect(screen.getByTestId(`options-strategy-${id}`)).toBeInTheDocument());
  await fireEvent.click(screen.getByTestId(`options-strategy-${id}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  (window as any).__E2E_MOCK_MARKET_OPEN__ = false;
  __resetOptionsDock();
  fetchUnderlying.mockResolvedValue(listing());
  fetchChain.mockImplementation(async (_symbol: string, expiry: string) => chain(expiry));
});

afterEach(() => {
  cleanup();
  __resetOptionsDock();
  delete (window as any).__E2E_MOCK_MARKET_OPEN__;
});

describe("StrategyControl", () => {
  test("renders the three outlook groups with their presets", async () => {
    open("NIFTY");
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());
    await fireEvent.click(screen.getByTestId("options-strategy"));

    for (const group of ["bullish", "bearish", "neutral"]) {
      expect(screen.getByTestId(`options-strategy-group-${group}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("options-strategy-long_call")).toBeInTheDocument();
    expect(screen.getByTestId("options-strategy-iron_condor")).toBeInTheDocument();
    expect(screen.getByTestId("options-strategy-none")).toHaveTextContent("No strategy");
    // Nothing selected yet.
    expect(screen.getByTestId("options-strategy")).toHaveTextContent("No strategy");
  });

  test("selecting a bullish preset builds one or two legs and shows the risk badge", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    await pick("bull_call_spread");

    expect(optionsDockState.legs).toHaveLength(2);
    await waitFor(() => expect(screen.getByTestId("options-leg-chips")).toBeInTheDocument());
    expect(screen.getByTestId("options-leg-count")).toHaveTextContent("2/4");
    expect(screen.getByTestId("options-strategy")).toHaveTextContent("Bull call spread");
    expect(screen.getByTestId("options-strategy-description")).toHaveTextContent("sell the call");
    expect(screen.getByTestId("options-strategy-risk")).toHaveTextContent("defined risk");
  });

  test("a single-leg preset builds exactly one leg", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    await pick("long_call");

    expect(optionsDockState.legs).toHaveLength(1);
    expect(screen.getByTestId("options-leg-count")).toHaveTextContent("1/4");
  });

  test("a short preset carries the undefined-risk badge", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    await pick("short_put");

    expect(optionsDockState.legs).toHaveLength(1);
    expect(screen.getByTestId("options-strategy-risk")).toHaveTextContent("undefined risk");
  });

  test("switching to a neutral preset replaces the legs instead of appending", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    await pick("long_call");
    expect(optionsDockState.legs).toHaveLength(1);

    await pick("iron_condor");

    expect(optionsDockState.activePreset).toBe("iron_condor");
    expect(optionsDockState.legs).toHaveLength(4);
    expect(screen.getByTestId("options-leg-count")).toHaveTextContent("4/4");
    expect(screen.getByTestId("options-strategy")).toHaveTextContent("Iron condor");
  });

  test("a preset the chain cannot hold is disabled with a reason tooltip", async () => {
    // Three strikes: the condor needs two each side of spot.
    fetchChain.mockImplementation(async (_symbol: string, expiry: string) =>
      chain(expiry, [23900, 24000, 24100]),
    );
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId("options-strategy"));

    const condor = screen.getByTestId("options-strategy-iron_condor");
    expect(condor).toHaveAttribute("aria-disabled", "true");
    expect(condor).toHaveAttribute("title", "chain too narrow for this spread");
    // The simple preset still works on the same narrow chain.
    expect(screen.getByTestId("options-strategy-long_call")).not.toHaveAttribute("aria-disabled");
  });

  test("No strategy clears every leg", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    await pick("bull_call_spread");
    expect(optionsDockState.legs).toHaveLength(2);

    await fireEvent.click(screen.getByTestId("options-strategy"));
    await fireEvent.click(screen.getByTestId("options-strategy-none"));

    expect(optionsDockState.activePreset).toBeNull();
    expect(optionsDockState.legs).toEqual([]);
    await waitFor(() =>
      expect(screen.getByTestId("options-legs-empty")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("options-strategy")).toHaveTextContent("No strategy");
  });

  test("changing expiry rebuilds the preset's legs on the new chain", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    await pick("iron_condor");
    expect(optionsDockState.legs.every((leg) => leg.expiry === "2026-03-26")).toBe(true);

    await fireEvent.change(screen.getByTestId("options-expiry-select"), {
      target: { value: "2026-04-02" },
    });

    await waitFor(() => expect(optionsDockState.chain?.expiry).toBe("2026-04-02"));
    await waitFor(() => expect(optionsDockState.legs).toHaveLength(4));
    expect(optionsDockState.legs.every((leg) => leg.expiry === "2026-04-02")).toBe(true);
    expect(screen.getByTestId("options-strategy")).toHaveTextContent("Iron condor");
  });

  test("an unbuildable preset keeps its selection and explains itself", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    // The next frame lists a single strike, so no spread preset can hold it.
    fetchChain.mockImplementation(async (_symbol: string, expiry: string) =>
      chain(expiry, [24000]),
    );
    setStrategy("bull_call_spread");
    await flush();
    expect(optionsDockState.legs).toHaveLength(2);

    await fireEvent.change(screen.getByTestId("options-expiry-select"), {
      target: { value: "2026-04-02" },
    });

    await waitFor(() =>
      expect(screen.getByTestId("options-strategy-unavailable")).toBeInTheDocument(),
    );
    expect(optionsDockState.presetUnavailable).toBe(true);
    expect(optionsDockState.legs).toEqual([]);
    expect(screen.getByTestId("options-strategy")).toHaveTextContent("Bull call spread");
  });

  test("Escape and an outside press both dismiss the list", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId("options-strategy"));
    expect(screen.getByTestId("options-strategy-menu")).toBeInTheDocument();

    await fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("options-strategy-menu")).not.toBeInTheDocument());

    await fireEvent.click(screen.getByTestId("options-strategy"));
    expect(screen.getByTestId("options-strategy-menu")).toBeInTheDocument();

    await fireEvent.mouseDown(screen.getByTestId("options-dock-symbol"));
    await waitFor(() => expect(screen.queryByTestId("options-strategy-menu")).not.toBeInTheDocument());
    // Dismissing is not selecting: the legs are untouched.
    expect(optionsDockState.activePreset).toBeNull();
  });

  test("a press inside the list does not dismiss it before the click lands", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId("options-strategy"));
    const option = screen.getByTestId("options-strategy-long_call");
    await fireEvent.mouseDown(option);
    expect(screen.getByTestId("options-strategy-menu")).toBeInTheDocument();

    await fireEvent.click(option);
    expect(optionsDockState.activePreset).toBe("long_call");
    await waitFor(() => expect(screen.queryByTestId("options-strategy-menu")).not.toBeInTheDocument());
  });

  test("the list is disabled entirely before a chain lands", async () => {
    // A listing without an F&O flag lands on the empty state — no chain to build from.
    fetchUnderlying.mockResolvedValue(listing({ fno: false, expiries: [], defaultExpiry: null }));
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-dock-empty")).toBeInTheDocument());

    // The strategy row lives inside the ready branch, so it is not rendered at all.
    expect(screen.queryByTestId("options-strategy")).not.toBeInTheDocument();
  });

  test("the risk badge distinguishes an undefined-risk short", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    await pick("short_straddle");

    expect(screen.getByTestId("options-strategy-risk")).toHaveTextContent("undefined risk");
    expect(screen.getByTestId("options-strategy-description")).toBeInTheDocument();
  });
});
