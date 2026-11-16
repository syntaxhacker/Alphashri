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

import { OptionDockError, type OptionDockChain, type UnderlyingInfo } from "../../api/optionsDock";
import { OptionsDockPanel, expiryLabel } from "./OptionsDockPanel";
import { buildPayoff } from "./PayoffPanel";
import { __resetOptionsDock, addLeg, open, optionsDockState, refresh, setOptionsDockState } from "../../state/optionsDock";

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

function leg(ltp: number, oi: number, iv: number | null, delta: number | null) {
  return {
    ltp,
    oi,
    prevOi: oi,
    volume: 0,
    iv,
    delta,
    gamma: null,
    theta: null,
    vega: null,
    pop: null,
    bid: null,
    ask: null,
    instrumentKey: "",
  };
}

function chain(expiry = "2026-03-26"): OptionDockChain {
  return {
    expiry,
    spot: 24031.5,
    pcr: 1.11,
    atmIv: 13.8,
    spotChangePct: 0.42,
    asOf: "2026-03-24T14:52:00+05:30",
    rows: [
      { strike: 23900, ce: leg(177.5, 5_200_000, 13.9, 0.71), pe: leg(46, 14_100_000, 13.9, -0.29) },
      { strike: 24000, ce: leg(114.4, 8_600_000, 13.8, 0.55), pe: leg(82.9, 10_200_000, 13.8, -0.45) },
      { strike: 24100, ce: leg(67.7, 12_400_000, 13.8, 0.39), pe: leg(136.2, 5_100_000, 13.8, -0.61) },
    ],
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

describe("expiryLabel", () => {
  test("labels a 0-DTE contract", () => {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    expect(expiryLabel({ date: today, dteDays: 0 })).toContain("0-DTE");
  });

  test("keeps the day count for a far expiry", () => {
    expect(expiryLabel({ date: "2099-03-26", dteDays: 2 })).toBe("26 MAR · 2d");
  });
});

describe("OptionsDockPanel", () => {
  test("root fills its flex parent with flex-1, never a percentage height", () => {
    renderPanel();

    const root = screen.getByTestId("options-dock");
    // A percentage height resolves against an auto-height outlet and lets the
    // content dictate the panel size; flex-1 fills the definite flex column.
    expect(root.className).toContain("flex-1");
    expect(root.className).not.toContain("h-full");
  });

  test("non-maximized root is the single scroll owner; maximized root is not scrollable", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    const root = screen.getByTestId("options-dock");
    // The fixed-height sheet/rail wrappers clip, so the dock itself scrolls on
    // short heights. A fits-content sheet shows no bar (overflow-y-auto).
    expect(root.className).toContain("overflow-y-auto");
    expect(root.className).toContain("overflow-x-hidden");
    expect(root.className).not.toContain("h-full");

    await fireEvent.click(screen.getByTestId("options-maximize"));
    const maximizedRoot = screen.getByTestId("options-dock");
    expect(maximizedRoot.className).toContain("fixed inset-0");
    expect(maximizedRoot.className).toContain("overflow-hidden");
    expect(maximizedRoot.className).not.toContain("overflow-y-auto");
  });

  test("renders the chain with the ATM row tinted exactly once", async () => {
    open("NIFTY");
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByTestId("options-chain-row-24000")).toBeInTheDocument(),
    );

    const atmRows = document.querySelectorAll('[data-atm="true"]');
    expect(atmRows).toHaveLength(1);
    expect(atmRows[0].getAttribute("data-testid")).toBe("options-chain-row-24000");
    // ATM tint is a theme token, never a hard-coded dark colour.
    expect((atmRows[0] as HTMLElement).style.backgroundColor).toContain("var(--");
  });

  test("clicking a CE price adds a buy leg and shift-click adds a sell leg", async () => {
    open("NIFTY");
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("options-ce-24000")).toBeInTheDocument());
    await fireEvent.click(screen.getByTestId("options-ce-24000"));
    expect(optionsDockState.legs).toHaveLength(1);
    expect(optionsDockState.legs[0]).toMatchObject({ side: "buy", type: "CE", strike: 24000 });

    await fireEvent.click(screen.getByTestId("options-pe-24000"), { shiftKey: true });
    expect(optionsDockState.legs).toHaveLength(2);
    expect(optionsDockState.legs[1]).toMatchObject({ side: "sell", type: "PE", strike: 24000 });

    await waitFor(() => expect(screen.getByTestId("options-leg-chips")).toBeInTheDocument());
    expect(screen.getByTestId("options-leg-count")).toHaveTextContent("2/4");
  });

  test("adds no network request for a leg change", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-ce-24000")).toBeInTheDocument());

    const before = fetchChain.mock.calls.length + fetchUnderlying.mock.calls.length;
    await fireEvent.click(screen.getByTestId("options-ce-24000"));

    expect(fetchChain.mock.calls.length + fetchUnderlying.mock.calls.length).toBe(before);
  });

  test("payoff renders a full 241-point curve for a four-leg condor", async () => {
    open("NIFTY");
    await flush();
    for (const [side, type, strike, premium] of [
      ["sell", "CE", 24200, 36.6],
      ["buy", "CE", 24500, 3.5],
      ["sell", "PE", 23800, 23.1],
      ["buy", "PE", 23500, 1.8],
    ] as const) {
      addLeg({ side, type, strike, premium });
    }
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("options-pop")).toHaveTextContent("%"));
    expect(screen.getByTestId("options-breakevens")).toHaveTextContent("23,746");
    expect(screen.getByTestId("options-breakevens")).toHaveTextContent("24,254");
    expect(screen.getByTestId("options-net-premium")).toHaveTextContent("₹3.5K");

    const lastCall = chartStub.setOption.mock.calls.at(-1)?.[0] as {
      series?: { data?: unknown[] }[];
    };
    expect(lastCall?.series?.[0]?.data).toHaveLength(241);
  });

  test("the §4.1 condor prices at POP 69.7 % on a two-day T", () => {
    const legs = [
      { side: "sell", type: "CE", strike: 24200, premium: 36.6, lots: 1, lotSize: 65 },
      { side: "buy", type: "CE", strike: 24500, premium: 3.5, lots: 1, lotSize: 65 },
      { side: "sell", type: "PE", strike: 23800, premium: 23.1, lots: 1, lotSize: 65 },
      { side: "buy", type: "PE", strike: 23500, premium: 1.8, lots: 1, lotSize: 65 },
    ].map((leg) => ({
      ...leg,
      side: leg.side as "buy" | "sell",
      type: leg.type as "CE" | "PE",
      key: `${leg.type}|${leg.strike}`,
      expiry: "2026-03-26",
    })) as never;

    const snapshot = buildPayoff(legs, 24031.5, 0.138, 2 / 365);
    expect(snapshot!.pop).toBeCloseTo(0.697, 2);
    expect(snapshot!.maxProfit).toBeCloseTo(3536, 0);
    expect(snapshot!.maxLoss).toBeCloseTo(-15964, 0);
  });

  test("shows the non-F&O empty state and no chain table", async () => {
    fetchUnderlying.mockResolvedValue(listing({ fno: false, expiries: [], defaultExpiry: null }));
    open("RELIANCE");
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("options-dock-empty")).toBeInTheDocument());
    expect(screen.getByTestId("options-dock-empty")).toHaveTextContent("No listed options for RELIANCE");
    expect(screen.queryByTestId("options-chain-table")).not.toBeInTheDocument();
  });

  test("401 shows the reconnect message plus Retry", async () => {
    fetchUnderlying.mockRejectedValue(new OptionDockError("auth", "Reconnect Upstox in Settings", 401));
    open("NIFTY");
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("options-dock-error")).toBeInTheDocument());
    expect(screen.getByTestId("options-dock-error")).toHaveTextContent("Reconnect Upstox in Settings");
    expect(screen.getByTestId("options-dock-retry")).toBeInTheDocument();
    // The full-panel cold state never paints a chain, and only one error slot exists.
    expect(screen.queryByTestId("options-chain-table")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("options-dock-error")).toHaveLength(1);
  });

  test("a failed refresh with a painted chain shows the banner and Retry refreshes", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    setOptionsDockState("error", { kind: "auth", message: "Reconnect Upstox in Settings" });

    const banner = screen.getByTestId("options-dock-error");
    expect(banner).toHaveTextContent("Reconnect Upstox in Settings");
    expect(screen.getAllByTestId("options-dock-error")).toHaveLength(1);
    // The last frame stays on screen behind the banner.
    expect(screen.getByTestId("options-ce-24000")).toBeInTheDocument();

    const before = fetchChain.mock.calls.length;
    await fireEvent.click(screen.getByTestId("options-dock-retry"));
    await waitFor(() => expect(fetchChain.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByTestId("options-dock-error")).not.toBeInTheDocument());
  });

  test("a non-auth failure surfaces the raw error message", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    setOptionsDockState("error", { kind: "upstream", message: "Upstox unavailable" });

    const banner = screen.getByTestId("options-dock-error");
    expect(banner).toHaveTextContent("Upstox unavailable");
    expect(banner).not.toHaveTextContent("Reconnect Upstox in Settings");
    expect(screen.getByTestId("options-chain-table")).toBeInTheDocument();
  });

  test("not_fno and rate failures use their dedicated banner messages", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    setOptionsDockState("error", { kind: "not_fno", message: "raw not_fno detail" });
    expect(screen.getByTestId("options-dock-error")).toHaveTextContent("No listed options");

    setOptionsDockState("error", { kind: "rate_limited", message: "slow down" });
    expect(screen.getByTestId("options-dock-error")).toHaveTextContent("Refreshing paused");
  });

  test("no banner when the store has no error", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    expect(optionsDockState.error).toBeNull();
    expect(screen.queryByTestId("options-dock-error")).not.toBeInTheDocument();
    expect(screen.queryByTestId("options-dock-retry")).not.toBeInTheDocument();
  });

  test("429 keeps the chain painted and shows the paused chip", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    fetchChain.mockRejectedValueOnce(new OptionDockError("rate_limited", "slow down", 429, 8000));
    await refresh();

    await waitFor(() => expect(screen.getByTestId("options-refresh-paused")).toBeInTheDocument());
    expect(screen.getByTestId("options-chain-table")).toBeInTheDocument();
    expect(screen.getByTestId("options-refresh-paused")).toHaveTextContent("Refreshing paused");
  });

  test("header skeleton shows before the listing arrives", async () => {
    fetchUnderlying.mockImplementation(() => new Promise(() => undefined));
    open("NIFTY");
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("options-dock-header-skeleton")).toBeInTheDocument());
  });

  test("summary strip derives PCR, max pain, sigma and total OI from the frame", async () => {
    open("NIFTY");
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("options-summary")).toBeInTheDocument());
    expect(screen.getByTestId("options-stat-pcr")).toHaveTextContent("1.11");
    expect(screen.getByTestId("options-stat-max-pain")).toHaveTextContent("24,000");
    expect(screen.getByTestId("options-stat-atm-iv")).toHaveTextContent("13.8");
    expect(screen.getByTestId("options-stat-total-oi")).toHaveTextContent("Cr");
  });

  test("chain, strategy, legs and payoff carry their own titled section headers", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-payoff-placeholder")).toBeInTheDocument());

    expect(screen.getByTestId("dock-section-chain")).toHaveTextContent(/CHAIN · NIFTY/);
    expect(screen.getByTestId("dock-section-chain")).toHaveTextContent(/\d{2} [A-Z]{3}/);
    expect(screen.getByTestId("dock-section-strategy")).toHaveTextContent("STRATEGY");
    expect(screen.getByTestId("dock-section-legs")).toHaveTextContent("LEGS");
    expect(screen.getByTestId("options-payoff-placeholder")).toHaveTextContent("PAYOFF");
  });

  test("the sections are siblings separated by a top hairline, and none is a nested card", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("dock-section-strategy")).toBeInTheDocument());

    const sections = [
      screen.getByTestId("options-chain-section"),
      screen.getByTestId("options-strategy-row"),
      screen.getByTestId("options-legs"),
      screen.getByTestId("options-payoff-placeholder"),
    ];
    for (const section of sections) {
      expect(section).toHaveAttribute("data-dock-section");
      // One border per section: no rounded card chrome inside the column.
      expect(section.className).not.toContain("rounded");
    }
    // The chain opens the body (the summary strip already draws its own rule),
    // so only the three below it add a separator.
    expect(sections[0].className).not.toContain("border-t");
    for (const section of sections.slice(1)) {
      expect(section.className).toContain("border-t");
      expect(section.className).toContain("border-fin-border");
    }
    // Rendered in order, one after another in the same parent.
    const parent = sections[0].parentElement!;
    const order = Array.from(parent.querySelectorAll("[data-dock-section]"));
    expect(order).toEqual(sections);
  });

  test("sizes the chain section by flex fill with a shrink floor and scroll container", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    const chainSection = screen.getByTestId("options-chain-section");
    // The chain fills the remaining column height so its table scrolls instead
    // of pushing STRATEGY/LEGS/PAYOFF past the viewport. A percentage cap
    // (`max-h-[calc(100%-...)]`) resolves against an auto-height parent and no-ops.
    expect(chainSection.className).not.toContain("max-h-[calc");
    // A short viewport keeps a floor so the table never collapses to nothing.
    expect(chainSection.className).toContain("min-h-[160px]");
    // fill still supplies flex-1 + min-h-0, which lets the table shrink and scroll.
    expect(chainSection.className).toContain("min-h-0");
    expect(chainSection.className).toContain("flex-1");

    // The table and its scroll container are still mounted.
    expect(screen.getByTestId("options-chain-table")).toBeInTheDocument();
    const table = screen.getByTestId("options-chain");
    expect(table).toBeInTheDocument();
    const scroller = table.closest(".paper-tanstack-scroll") as HTMLElement | null;
    expect(scroller).not.toBeNull();
    expect(scroller!.style.overflow).toBe("auto");
  });

  test("keeps payoff as a sibling after strategy and legs with four legs", async () => {
    open("NIFTY");
    await flush();
    for (const [side, type, strike, premium] of [
      ["sell", "CE", 24200, 36.6],
      ["buy", "CE", 24500, 3.5],
      ["sell", "PE", 23800, 23.1],
      ["buy", "PE", 23500, 1.8],
    ] as const) {
      addLeg({ side, type, strike, premium });
    }
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("options-pop")).toBeInTheDocument());

    const parent = screen.getByTestId("options-chain-section").parentElement!;
    const directChild = (el: HTMLElement): HTMLElement => {
      let node = el;
      while (node.parentElement && node.parentElement !== parent) node = node.parentElement;
      return node;
    };
    const strategy = directChild(screen.getByTestId("options-strategy-row"));
    const legs = directChild(screen.getByTestId("options-legs"));
    const payoff = directChild(screen.getByTestId("options-pop"));

    // All four bands stay siblings in the same body, in visual order.
    const chain = screen.getByTestId("options-chain-section");
    const children = Array.from(parent.children);
    expect(children.indexOf(strategy)).toBeGreaterThan(children.indexOf(chain));
    expect(children.indexOf(legs)).toBeGreaterThan(children.indexOf(strategy));
    expect(children.indexOf(payoff)).toBeGreaterThan(children.indexOf(legs));
    // The payoff's fixed height is untouched by the chain cap.
    expect(payoff.style.height).toBe("206px");
  });
});
