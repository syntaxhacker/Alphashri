// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MantineProvider } from "@mantine/core";
import { ChainSummary } from "./ChainSummary";
import { setupBrowserMocks } from "../../../test-utils/setupBrowser";

beforeEach(() => setupBrowserMocks());
afterEach(() => cleanup());

function renderWithMantine(ui: React.ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe("ChainSummary component rendering", () => {
  it("renders chain summary container", () => {
    renderWithMantine(
      <ChainSummary strikeMatrix={[]} spotPrice={24500} selectedExpiry="25MAY" />,
    );
    expect(screen.getByTestId("chain-summary")).toBeInTheDocument();
  });

  it("renders PCR value", () => {
    renderWithMantine(
      <ChainSummary
        strikeMatrix={[]}
        spotPrice={24500}
        selectedExpiry="25MAY"
        summary={{ pcr: 1.5, max_pain: 24500, expected_move: null, total_ce_oi: 5000, total_pe_oi: 10000 }}
      />,
    );
    expect(screen.getByText("1.50")).toBeInTheDocument();
  });

  it("renders PCR bias bullish when pcr > 1", () => {
    renderWithMantine(
      <ChainSummary
        strikeMatrix={[]}
        spotPrice={24500}
        selectedExpiry="25MAY"
        summary={{ pcr: 1.5, max_pain: 24500, expected_move: null, total_ce_oi: 5000, total_pe_oi: 10000 }}
      />,
    );
    expect(screen.getByText("Bullish bias")).toBeInTheDocument();
  });

  it("renders PCR bias bearish when pcr < 1", () => {
    renderWithMantine(
      <ChainSummary
        strikeMatrix={[]}
        spotPrice={24500}
        selectedExpiry="25MAY"
        summary={{ pcr: 0.5, max_pain: 24500, expected_move: null, total_ce_oi: 10000, total_pe_oi: 5000 }}
      />,
    );
    expect(screen.getByText("Bearish bias")).toBeInTheDocument();
  });

  it("renders Max Pain value", () => {
    renderWithMantine(
      <ChainSummary
        strikeMatrix={[]}
        spotPrice={24500}
        selectedExpiry="25MAY"
        summary={{ pcr: 1.0, max_pain: 24500, expected_move: null, total_ce_oi: 0, total_pe_oi: 0 }}
      />,
    );
    expect(screen.getByText("24500")).toBeInTheDocument();
  });

  it("renders market range when expected move is available", () => {
    renderWithMantine(
      <ChainSummary
        strikeMatrix={[]}
        spotPrice={24500}
        selectedExpiry="25MAY"
        summary={{
          pcr: 1.0,
          max_pain: 24500,
          expected_move: { lower: 24000, upper: 25000, range: 500 },
          total_ce_oi: 0,
          total_pe_oi: 0,
        }}
      />,
    );
    expect(screen.getByText("24000 - 25000")).toBeInTheDocument();
  });

  it("renders support and resistance strikes", () => {
    const strikeMatrix = [
      { strike: 24000, ce: { market_data: { oi: 1000 } }, pe: { market_data: { oi: 500 } } },
      { strike: 24500, ce: { market_data: { oi: 5000 } }, pe: { market_data: { oi: 200 } } },
      { strike: 25000, ce: { market_data: { oi: 3000 } }, pe: { market_data: { oi: 800 } } },
    ];
    renderWithMantine(
      <ChainSummary
        strikeMatrix={strikeMatrix}
        spotPrice={24500}
        selectedExpiry="25MAY"
        summary={{ pcr: 1.0, max_pain: 24500, expected_move: null, total_ce_oi: 9000, total_pe_oi: 1500 }}
      />,
    );
    expect(screen.getByText("RES 24500")).toBeInTheDocument();
    expect(screen.getByText("SUP 25000")).toBeInTheDocument();
  });

  it("renders data pending when no expected move", () => {
    renderWithMantine(
      <ChainSummary strikeMatrix={[]} spotPrice={24500} selectedExpiry="25MAY" />,
    );
    expect(screen.getByText("Data pending")).toBeInTheDocument();
  });

  it("renders ring progress chart for CE/Put OI ratio", () => {
    const strikeMatrix = [
      { strike: 24000, ce: { market_data: { oi: 1000 } }, pe: { market_data: { oi: 500 } } },
      { strike: 24500, ce: { market_data: { oi: 5000 } }, pe: { market_data: { oi: 200 } } },
    ];
    renderWithMantine(
      <ChainSummary
        strikeMatrix={strikeMatrix}
        spotPrice={24500}
        selectedExpiry="25MAY"
        summary={{ pcr: 0.5, max_pain: 24500, expected_move: null, total_ce_oi: 6000, total_pe_oi: 700 }}
      />,
    );
    const pcrCard = screen.getByTestId("options-chain-summary-pcr");
    expect(pcrCard.querySelector("svg")).toBeTruthy();
  });
});
