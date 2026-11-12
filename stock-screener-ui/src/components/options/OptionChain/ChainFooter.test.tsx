// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async (importOriginal) => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  const actual = await importOriginal<typeof import("@/ui")>();
  return mockSolidUi(actual);
});

import { ChainFooter } from "./ChainFooter";
import { SCALE_GREEN, SCALE_RED, SCALE_YELLOW, SCALE_GRAY } from "../../../config/colors";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mockTheme = {
  colors: {
    green: SCALE_GREEN,
    red: SCALE_RED,
    yellow: SCALE_YELLOW,
    gray: SCALE_GRAY,
  },
};

describe("ChainFooter", () => {
  it("renders ITM legend item", () => {
    render(() => 
      <ChainFooter theme={mockTheme as any} colorScheme="light" spotPrice={24500} />);
    expect(screen.getByTestId("options-legend-itm")).toBeInTheDocument();
    expect(screen.getByText("ITM (In The Money)")).toBeInTheDocument();
  });

  it("renders ATM legend item", () => {
    render(() => 
      <ChainFooter theme={mockTheme as any} colorScheme="light" spotPrice={24500} />);
    expect(screen.getByTestId("options-legend-atm")).toBeInTheDocument();
    expect(screen.getByText("ATM (At The Money)")).toBeInTheDocument();
  });

  it("renders sentiment badges legend", () => {
    render(() => 
      <ChainFooter theme={mockTheme as any} colorScheme="light" spotPrice={24500} />);
    expect(screen.getByTestId("options-legend-badges")).toBeInTheDocument();
    expect(screen.getByText("LB: Long Buildup")).toBeInTheDocument();
    expect(screen.getByText("SB: Short Buildup")).toBeInTheDocument();
    expect(screen.getByText("SC: Short Covering")).toBeInTheDocument();
    expect(screen.getByText("LU: Long Unwinding")).toBeInTheDocument();
  });

  it("shows spot price when provided", () => {
    render(() => 
      <ChainFooter theme={mockTheme as any} colorScheme="light" spotPrice={24500} />);
    expect(screen.getByTestId("options-chain-spot-price")).toBeInTheDocument();
    expect(screen.getByText("24500.00")).toBeInTheDocument();
  });

  it("does not show spot price when null", () => {
    render(() => 
      <ChainFooter theme={mockTheme as any} colorScheme="light" spotPrice={null} />);
    expect(screen.queryByTestId("options-chain-spot-price")).not.toBeInTheDocument();
  });
});
