// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { SetupCard } from "./SetupCard";
import { setupBrowserMocks } from "../../../test-utils/setupBrowser";
import { renderWithProviders } from "../../../test-utils/renderWithProviders";
import type { PaperSetup } from "./strategies";

vi.mock("./PayoffChart", () => ({
  PayoffChart: () => <div data-testid="mock-payoff-chart">chart</div>,
}));

const setup: PaperSetup = {
  id: "s1",
  templateId: "bull-put-spread",
  name: "Bull Put Spread",
  underlying: "NIFTY",
  createdAt: "2026-09-28",
  closedAt: null,
  legs: [
    { legId: "l1", strike: 23100, optionType: "PE", action: "SELL", qty: 65, entry: 40 },
    { legId: "l2", strike: 23000, optionType: "PE", action: "BUY", qty: 65, entry: 25 },
  ],
};

const props = {
  setup,
  spot: 23140,
  ltpOf: () => null,
  onUpdateLeg: vi.fn(),
  onDeleteSetup: vi.fn(),
  onPaperFill: vi.fn(),
};

beforeEach(() => setupBrowserMocks());
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SetupCard", () => {
  it("renders legs, payoff chart, and bounded stats", () => {
    renderWithProviders(<SetupCard {...props} />);
    expect(screen.getByTestId("setup-card-s1")).toBeInTheDocument();
    expect(screen.getByTestId("mock-payoff-chart")).toBeInTheDocument();
    const stats = screen.getByTestId("setup-stats-s1").textContent ?? "";
    expect(stats).toContain("Credit");
    expect(stats).toContain("BE");
  });

  it("edits a leg entry and deletes the setup", async () => {
    const { container } = renderWithProviders(<SetupCard {...props} />);
    const entryWrap = screen.getByTestId("setup-leg-entry-l1");
    const entryInput = within(entryWrap).getByRole("spinbutton");
    fireEvent.change(entryInput, { target: { value: "45" } });
    expect(props.onUpdateLeg).toHaveBeenCalledWith("s1", "l1", expect.objectContaining({ entry: 45 }));
    await userEvent.click(screen.getByTestId("setup-delete-s1"));
    expect(props.onDeleteSetup).toHaveBeenCalledWith("s1");
    expect(container).toBeInTheDocument();
  });

  it("paper fills with conviction and plan", async () => {
    renderWithProviders(<SetupCard {...props} />);
    await userEvent.type(screen.getByTestId("setup-plan-s1"), "sell costly chop");
    await userEvent.click(screen.getByTestId("setup-fill-s1"));
    expect(props.onPaperFill).toHaveBeenCalledWith(
      setup,
      expect.objectContaining({ conviction: "MEDIUM", plan: "sell costly chop" }),
    );
  });

  it("shows live pnl when chain marks exist", () => {
    renderWithProviders(<SetupCard {...props} ltpOf={() => 30} />);
    const card = screen.getByTestId("setup-card-s1").textContent ?? "";
    expect(within(screen.getByTestId("setup-card-s1")).getByTestId("setup-stats-s1")).toBeInTheDocument();
    expect(card).toContain("Live");
  });
});
