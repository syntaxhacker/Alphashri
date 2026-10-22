// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import { NiftyPositionsDrawer } from "./NiftyPositionsDrawer";
import {
  buildPositionRows,
  formatGreek,
  netPositionPnl,
  paperToPnlLeg,
  parsePositionLeg,
  sumBookGreeks,
} from "./niftyPositions";
import type { PaperPosition } from "@/types/paperTrading";
import type { NiftyOptionSide, NiftyStrike } from "@/types/niftyReport";

function optionSide(overrides: Partial<NiftyOptionSide> = {}): NiftyOptionSide {
  return {
    ltp: 100,
    close: 98,
    oi: 10_000,
    prevOi: 9_000,
    oiChange: 1_000,
    priceChange: 2,
    sentiment: "Bullish",
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    iv: 12,
    ...overrides,
  };
}

function position(overrides: Partial<PaperPosition> = {}): PaperPosition {
  return {
    symbol: "NIFTY25700CE",
    side: "BUY",
    quantity: 50,
    entry_price: 120,
    current_price: 130,
    entry_time: "2026-10-21T09:20:00+05:30",
    stop_loss: 110,
    take_profit: 150,
    pnl: 500,
    pnl_pct: 8.33,
    margin_used: 0,
    order_id: "o-1",
    strategy_id: 1,
    strategy_name: "EOD short premium",
    ...overrides,
  };
}

const CHAIN: NiftyStrike[] = [
  {
    strike: 25_700,
    ce: optionSide({ delta: 0.52, gamma: 0.0018, theta: -12.5, vega: 8.2 }),
    pe: optionSide({ delta: -0.48, gamma: 0.0017, theta: -11.2, vega: 7.6 }),
  },
  {
    strike: 25_600,
    ce: optionSide({ delta: 0.42, gamma: 0.0015, theta: -10.4, vega: 6.9 }),
    pe: optionSide({ delta: -0.48, gamma: 0.0016, theta: -11, vega: 7.5 }),
  },
];

function twoLegs(): PaperPosition[] {
  return [
    position(),
    position({
      id: "p-2",
      symbol: "NIFTY25600PE",
      side: "SELL",
      quantity: 25,
      entry_price: 90,
      current_price: 70,
      pnl: 1_000,
      stop_loss: 105,
      take_profit: 40,
    }),
  ];
}

function r(node: React.ReactElement) {
  return render(node, { wrapper: UIProvider });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("NiftyPositionsDrawer — toolbar button", () => {
  test("shows the open-leg count and net P&L with a dot", () => {
    r(<NiftyPositionsDrawer positions={twoLegs()} strikes={CHAIN} />);

    const button = screen.getByTestId("nifty-positions-button");
    expect(button).toHaveTextContent("POS 2");
    // 500 + 1,000 = 1,500 → compact "+₹1.5K"
    expect(button).toHaveTextContent("+₹1.5K");
    expect(screen.getByTestId("nifty-positions-dot")).toBeInTheDocument();
  });

  test("shows POS 0 · ₹0 and no dot for an empty book", () => {
    r(<NiftyPositionsDrawer positions={[]} strikes={CHAIN} />);

    const button = screen.getByTestId("nifty-positions-button");
    expect(button).toHaveTextContent("POS 0");
    expect(button).toHaveTextContent("+₹0");
    expect(screen.queryByTestId("nifty-positions-dot")).not.toBeInTheDocument();
  });

  test("renders the same empty label while the book is not loaded", () => {
    r(<NiftyPositionsDrawer positions={null} />);
    expect(screen.getByTestId("nifty-positions-button")).toHaveTextContent("POS 0");
  });
});

describe("NiftyPositionsDrawer — drawer", () => {
  test("click opens PAPER POSITIONS with every leg and the book greeks", async () => {
    const user = userEvent.setup();
    r(<NiftyPositionsDrawer positions={twoLegs()} strikes={CHAIN} />);

    await user.click(screen.getByTestId("nifty-positions-button"));

    const drawer = await screen.findByTestId("nifty-positions-drawer");
    expect(screen.getByTestId("panel-modal")).toHaveAttribute("data-variant", "drawer");
    expect(within(drawer).getByTestId("nifty-positions-drawer-label")).toHaveTextContent(
      "PAPER POSITIONS",
    );

    const table = within(drawer).getByTestId("nifty-positions-table");
    // Long call leg — symbol, opt, strike, side, qty, entry, mark, P&L, stop, target.
    expect(table).toHaveTextContent("NIFTY25700CE");
    expect(table).toHaveTextContent("CE");
    expect(table).toHaveTextContent("25,700");
    expect(table).toHaveTextContent("BUY");
    expect(table).toHaveTextContent("50");
    expect(table).toHaveTextContent("₹120.00");
    expect(table).toHaveTextContent("₹130.00");
    expect(table).toHaveTextContent("+₹500.00");
    expect(table).toHaveTextContent("₹110.00");
    expect(table).toHaveTextContent("₹150.00");
    // Short put leg.
    expect(table).toHaveTextContent("NIFTY25600PE");
    expect(table).toHaveTextContent("SELL");
    expect(table).toHaveTextContent("+₹1,000.00");
  });

  test("sums the chain greeks with signed qty and shows each book greek", async () => {
    const user = userEvent.setup();
    r(<NiftyPositionsDrawer positions={twoLegs()} strikes={CHAIN} />);
    await user.click(screen.getByTestId("nifty-positions-button"));

    const drawer = await screen.findByTestId("nifty-positions-drawer");
    // Δ = 50×0.52 + (−25)×(−0.48) = 38
    expect(within(drawer).getByTestId("nifty-book-delta")).toHaveTextContent("+38.0");
    // Γ = 50×0.0018 + (−25)×0.0016 = +0.05
    expect(within(drawer).getByTestId("nifty-book-gamma")).toHaveTextContent("+0.05");
    // Θ = 50×(−12.5) + (−25)×(−11) = −350
    expect(within(drawer).getByTestId("nifty-book-theta")).toHaveTextContent("-350.00");
    // V = 50×8.2 + (−25)×7.5 = +222.5
    expect(within(drawer).getByTestId("nifty-book-vega")).toHaveTextContent("+222.50");
  });

  test("keyboard Enter opens the drawer", async () => {
    const user = userEvent.setup();
    r(<NiftyPositionsDrawer positions={twoLegs()} strikes={CHAIN} />);

    screen.getByTestId("nifty-positions-button").focus();
    await user.keyboard("{Enter}");

    expect(await screen.findByTestId("nifty-positions-drawer")).toBeInTheDocument();
  });

  test("empty book shows the no-positions state", async () => {
    const user = userEvent.setup();
    r(<NiftyPositionsDrawer positions={[]} strikes={CHAIN} />);

    await user.click(screen.getByTestId("nifty-positions-button"));

    const drawer = await screen.findByTestId("nifty-positions-drawer");
    expect(within(drawer).getByTestId("nifty-positions-empty")).toHaveTextContent(
      "No open paper positions",
    );
    // No table and no fake greeks when there are no legs.
    expect(within(drawer).queryByTestId("nifty-positions-table")).not.toBeInTheDocument();
    expect(within(drawer).getByTestId("nifty-book-delta")).toHaveTextContent("—");
  });

  test("refreshes on open and every 30s while open", async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    r(<NiftyPositionsDrawer positions={twoLegs()} strikes={CHAIN} onRefresh={onRefresh} />);

    expect(onRefresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("nifty-positions-button"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(POSITIONS_REFRESH_MS_FOR_TEST);
    });
    expect(onRefresh).toHaveBeenCalledTimes(2);

    // Closing the drawer stops the poll.
    fireEvent.click(screen.getByTestId("panel-modal-close"));
    await act(async () => {
      vi.advanceTimersByTime(POSITIONS_REFRESH_MS_FOR_TEST * 2);
    });
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });
});

const POSITIONS_REFRESH_MS_FOR_TEST = 30_000;

describe("niftyPositions helpers", () => {
  test("parses option legs and skips equity symbols", () => {
    expect(parsePositionLeg("NIFTY25700CE")).toEqual({ opt: "CE", strike: 25_700 });
    expect(parsePositionLeg("NIFTY 25600 PE")).toEqual({ opt: "PE", strike: 25_600 });
    expect(parsePositionLeg("RELIANCE")).toBeNull();
    expect(paperToPnlLeg(position())).toHaveLength(1);
    expect(paperToPnlLeg(position({ symbol: "RELIANCE" }))).toEqual([]);
  });

  test("builds one table row per open leg", () => {
    const rows = buildPositionRows(twoLegs());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ opt: "CE", strike: 25_700, side: "BUY", qty: 50 });
    expect(rows[1]).toMatchObject({ opt: "PE", strike: 25_600, side: "SELL", qty: 25 });
    expect(netPositionPnl(twoLegs())).toBe(1_500);
  });

  test("skips missing greeks and unmatched chain rows instead of adding zeroes", () => {
    const book = sumBookGreeks(
      [
        position(),
        // Equity leg carries no chain row → ignored.
        position({ id: "eq", symbol: "RELIANCE", pnl: 999 }),
      ],
      [CHAIN[0]],
    );
    expect(book.legs).toBe(1);
    expect(book.delta).toBeCloseTo(26);
    expect(book.gamma).toBeCloseTo(0.09);
    expect(book.theta).toBeCloseTo(-625);
    expect(book.vega).toBeCloseTo(410);

    const noTheta = sumBookGreeks(
      [position()],
      [
        {
          strike: 25_700,
          ce: optionSide({ delta: 0.5, gamma: 0.002, theta: null, vega: 8 }),
          pe: optionSide(),
        },
      ],
    );
    expect(noTheta.delta).toBeCloseTo(25);
    expect(noTheta.theta).toBeNull();
  });

  test("formats a dash for a greek nobody contributed", () => {
    expect(formatGreek(null)).toBe("—");
    expect(formatGreek(0, 1)).toBe("0.0");
    expect(formatGreek(12.346, 2)).toBe("+12.35");
    expect(formatGreek(-0.004, 2)).toBe("0.00");
  });
});
