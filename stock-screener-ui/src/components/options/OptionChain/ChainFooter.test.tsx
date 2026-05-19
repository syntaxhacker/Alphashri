// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { renderWithMantine } from "../../../test-utils/renderWithMantine";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ChainFooter } from "./ChainFooter";

afterEach(() => cleanup());

const mockTheme = {
  colors: {
    green: ["#f0fdf4", "#dcfce7", "#bbf7d0", "#86efac", "#4ade80", "#22c55e", "#16a34a", "#15803d", "#166534", "#14532d"],
    red: ["#fef2f2", "#fee2e2", "#fecaca", "#fca5a5", "#f87171", "#ef4444", "#dc2626", "#b91c1c", "#991b1b", "#7f1d1d"],
    yellow: ["#fefce8", "#fef9c3", "#fef08a", "#fde047", "#facc15", "#eab308", "#ca8a04", "#a16207", "#854d0e", "#713f12"],
    gray: ["#f9fafb", "#f3f4f6", "#e5e7eb", "#d1d5db", "#9ca3af", "#6b7280", "#4b5563", "#374151", "#1f2937", "#111827"],
  },
};

describe("ChainFooter", () => {
  it("renders footer container", () => {
    renderWithMantine(
      <ChainFooter theme={mockTheme as any} colorScheme="light" spotPrice={24500} />,
    );
    expect(screen.getByTestId("options-chain-table-footer")).toBeInTheDocument();
  });

  it("renders ITM legend item", () => {
    renderWithMantine(
      <ChainFooter theme={mockTheme as any} colorScheme="light" spotPrice={24500} />,
    );
    expect(screen.getByTestId("options-legend-itm")).toBeInTheDocument();
    expect(screen.getByText("ITM (In The Money)")).toBeInTheDocument();
  });

  it("renders ATM legend item", () => {
    renderWithMantine(
      <ChainFooter theme={mockTheme as any} colorScheme="light" spotPrice={24500} />,
    );
    expect(screen.getByTestId("options-legend-atm")).toBeInTheDocument();
    expect(screen.getByText("ATM (At The Money)")).toBeInTheDocument();
  });

  it("renders sentiment badges legend", () => {
    renderWithMantine(
      <ChainFooter theme={mockTheme as any} colorScheme="light" spotPrice={24500} />,
    );
    expect(screen.getByTestId("options-legend-badges")).toBeInTheDocument();
    expect(screen.getByText("LB: Long Buildup")).toBeInTheDocument();
    expect(screen.getByText("SB: Short Buildup")).toBeInTheDocument();
    expect(screen.getByText("SC: Short Covering")).toBeInTheDocument();
    expect(screen.getByText("LU: Long Unwinding")).toBeInTheDocument();
  });

  it("shows spot price when provided", () => {
    renderWithMantine(
      <ChainFooter theme={mockTheme as any} colorScheme="light" spotPrice={24500} />,
    );
    expect(screen.getByTestId("options-chain-spot-price")).toBeInTheDocument();
    expect(screen.getByText("24500.00")).toBeInTheDocument();
  });

  it("does not show spot price when null", () => {
    renderWithMantine(
      <ChainFooter theme={mockTheme as any} colorScheme="light" spotPrice={null} />,
    );
    expect(screen.queryByTestId("options-chain-spot-price")).not.toBeInTheDocument();
  });
});
