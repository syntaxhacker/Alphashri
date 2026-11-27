// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/test-utils/solidUiMock");
  const { typeSize } = await import("@/ui/typography");
  return { ...mockSolidUi(), typeSize };
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
    expect(screen.getByTestId("options-legend-itm")).toHaveTextContent("ITM");
    expect(screen.queryByText("ITM (In The Money)")).not.toBeInTheDocument();
  });

  it("renders ATM legend item", () => {
    render(() => 
      <ChainFooter theme={mockTheme as any} colorScheme="light" spotPrice={24500} />);
    expect(screen.getByTestId("options-legend-atm")).toHaveTextContent("ATM");
    expect(screen.queryByText("ATM (At The Money)")).not.toBeInTheDocument();
  });

  it("renders sentiment codes without repeating the guide's explanations", () => {
    render(() =>
      <ChainFooter theme={mockTheme as any} colorScheme="light" spotPrice={24500} />);
    const legend = screen.getByTestId("options-legend-badges");
    expect(legend).toHaveTextContent("LB");
    expect(legend).toHaveTextContent("SB");
    expect(legend).toHaveTextContent("SC");
    expect(legend).toHaveTextContent("LU");
    expect(screen.queryByText("LB: Long Buildup")).not.toBeInTheDocument();
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
