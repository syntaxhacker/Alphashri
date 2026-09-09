// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PositionsPanel } from "./PositionsPanel";
import { setupBrowserMocks } from "../../../test-utils/setupBrowser";
import { renderWithProviders } from "../../../test-utils/renderWithProviders";

beforeEach(() => setupBrowserMocks());
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PositionsPanel", () => {
  it("shows loading state", () => {
    renderWithProviders(<PositionsPanel positions={[]} loading={true} />);
    expect(screen.getByTestId("options-positions-loading")).toBeInTheDocument();
    expect(screen.getByText("Loading positions...")).toBeInTheDocument();
  });

  it("shows error state", () => {
    renderWithProviders(<PositionsPanel positions={[]} error="API error" />);
    expect(screen.getByTestId("options-positions-error")).toBeInTheDocument();
    expect(screen.getByText("API error")).toBeInTheDocument();
  });

  it("shows empty state", () => {
    renderWithProviders(<PositionsPanel positions={[]} />);
    expect(screen.getByText("No open positions")).toBeInTheDocument();
  });

  it("shows Option Positions title", () => {
    renderWithProviders(<PositionsPanel positions={[]} />);
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
    renderWithProviders(<PositionsPanel positions={positions} />);
    expect(screen.getByTestId("options-position-row-0")).toBeInTheDocument();
    expect(screen.getByTestId("options-position-row-1")).toBeInTheDocument();
    expect(screen.getByText("CE")).toBeInTheDocument();
    expect(screen.getByText("PE")).toBeInTheDocument();
    expect(screen.getByText("24500")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.getByText("₹150.50")).toBeInTheDocument();
    expect(screen.getByText("₹175.00")).toBeInTheDocument();
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
    renderWithProviders(<PositionsPanel positions={positions} />);
    expect(screen.getByText("+₹1.2K")).toBeInTheDocument();
    expect(screen.getByText("₹-500")).toBeInTheDocument();
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
    renderWithProviders(<PositionsPanel positions={positions} />);
    expect(screen.getByText("-")).toBeInTheDocument();
  });
});
