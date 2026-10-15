// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PayoffChart } from "./PayoffChart";
import type { PayoffLeg } from "./payoff";

vi.mock("../../../hooks/useECharts", () => ({
  useECharts: () => ({ chartRef: { current: null }, setChartOption: vi.fn() }),
}));

const legs: PayoffLeg[] = [
  { strike: 100, optionType: "CE", action: "BUY", qty: 1, entry: 5 },
];

describe("PayoffChart", () => {
  it("renders the container testid", () => {
    render(<PayoffChart legs={legs} spot={100} />);
    expect(screen.getByTestId("payoff-chart")).toBeInTheDocument();
    cleanup();
  });

  it("shows empty-state text with no legs", () => {
    render(<PayoffChart legs={[]} spot={null} />);
    expect(screen.getByTestId("payoff-chart")).toBeInTheDocument();
    expect(screen.getByText("Add a leg to see payoff")).toBeInTheDocument();
    cleanup();
  });

  it("honors a custom data-testid", () => {
    render(<PayoffChart legs={[]} spot={null} data-testid="custom-payoff" />);
    expect(screen.getByTestId("custom-payoff")).toBeInTheDocument();
    cleanup();
  });
});
