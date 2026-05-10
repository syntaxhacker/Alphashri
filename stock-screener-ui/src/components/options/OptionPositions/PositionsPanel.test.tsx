// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MantineProvider } from "@mantine/core";
import { PositionsPanel } from "./PositionsPanel";
import { setupBrowserMocks } from "../../../test-utils/setupBrowser";

beforeEach(() => setupBrowserMocks());
afterEach(() => cleanup());

function renderWithMantine(ui: React.ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe("PositionsPanel", () => {
  it("shows loading state", () => {
    renderWithMantine(<PositionsPanel positions={[]} loading={true} />);
    expect(screen.getByTestId("options-positions-loading")).toBeInTheDocument();
    expect(screen.getByText("Loading positions...")).toBeInTheDocument();
  });

  it("shows error state", () => {
    renderWithMantine(<PositionsPanel positions={[]} error="API error" />);
    expect(screen.getByTestId("options-positions-error")).toBeInTheDocument();
    expect(screen.getByText("API error")).toBeInTheDocument();
  });

  it("shows empty state", () => {
    renderWithMantine(<PositionsPanel positions={[]} />);
    expect(screen.getByTestId("options-positions-empty")).toBeInTheDocument();
    expect(screen.getByText("No open positions")).toBeInTheDocument();
  });

  it("shows Option Positions title", () => {
    renderWithMantine(<PositionsPanel positions={[]} />);
    expect(screen.getByText("Option Positions")).toBeInTheDocument();
  });

  it("renders position rows with symbol, type, strike, qty, avg price, LTP, P&L", () => {
    const positions = [
      {
        instrument_key: "NFO:OPT:24500",
        trading_symbol: "NIFTY2450024500CE",
        option_type: "CE",
        strike_price: 24500,
        quantity: 50,
        average_price: 150.5,
        current_price: 175.0,
        pnl: 1225,
      },
      {
        instrument_key: "NFO:OPT:24000",
        trading_symbol: "NIFTY2400024000PE",
        option_type: "PE",
        strike_price: 24000,
        quantity: 25,
        average_price: 100.0,
        current_price: 80.0,
        pnl: -500,
      },
    ];
    renderWithMantine(<PositionsPanel positions={positions} />);
    expect(screen.getByTestId("options-position-row-0")).toBeInTheDocument();
    expect(screen.getByTestId("options-position-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("options-position-type-0")).toHaveTextContent("CE");
    expect(screen.getByTestId("options-position-type-1")).toHaveTextContent("PE");
    expect(screen.getByTestId("options-position-strike-0")).toHaveTextContent("24500");
    expect(screen.getByTestId("options-position-qty-0")).toHaveTextContent("50");
    expect(screen.getByTestId("options-position-avg-price-0")).toHaveTextContent("₹150.50");
    expect(screen.getByTestId("options-position-ltp-0")).toHaveTextContent("₹175.00");
  });

  it("color-codes P&L values green for profit and red for loss", () => {
    const positions = [
      {
        instrument_key: "NFO:OPT:24500",
        trading_symbol: "NIFTY2450024500CE",
        option_type: "CE",
        strike_price: 24500,
        quantity: 50,
        average_price: 150.5,
        current_price: 175.0,
        pnl: 1225,
      },
      {
        instrument_key: "NFO:OPT:24000",
        trading_symbol: "NIFTY2400024000PE",
        option_type: "PE",
        strike_price: 24000,
        quantity: 25,
        average_price: 100.0,
        current_price: 80.0,
        pnl: -500,
      },
    ];
    renderWithMantine(<PositionsPanel positions={positions} />);
    const pnl0 = screen.getByTestId("options-position-pnl-0");
    const pnl1 = screen.getByTestId("options-position-pnl-1");
    expect(pnl0).toHaveTextContent("+₹1.2K");
    expect(pnl1).toHaveTextContent("₹-500");
  });

  it("shows dash for P&L when undefined", () => {
    const positions = [
      {
        instrument_key: "NFO:OPT:24500",
        trading_symbol: "NIFTY2450024500CE",
        option_type: "CE",
        strike_price: 24500,
        quantity: 50,
        average_price: 150.5,
      },
    ];
    renderWithMantine(<PositionsPanel positions={positions} />);
    expect(screen.getByTestId("options-position-pnl-0")).toHaveTextContent("-");
  });
});
