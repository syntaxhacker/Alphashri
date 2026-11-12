// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  return mockSolidUi();
});
import { OptionChainFilters } from "./OptionChainFilters";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OptionChainFilters", () => {
  it("displays current option type as available option", () => {
    render(() => (
      <OptionChainFilters
        filters={{ optionType: "BOTH", moneyness: "ALL", strikeRange: [0, 100000] }}
        setFilters={vi.fn()}
      />
    ));
    expect(screen.getByText("Both CE/PE")).toBeInTheDocument();
  });

  it("displays all filter option labels", () => {
    render(() => (
      <OptionChainFilters
        filters={{ optionType: "CE", moneyness: "ITM", strikeRange: [0, 100000] }}
        setFilters={vi.fn()}
      />
    ));
    expect(screen.getByText("Calls Only")).toBeInTheDocument();
    expect(screen.getByText("ITM")).toBeInTheDocument();
  });

  it("shows strike range inputs with correct labels", () => {
    render(() => (
      <OptionChainFilters
        filters={{ optionType: "BOTH", moneyness: "ALL", strikeRange: [24000, 25000] }}
        setFilters={vi.fn()}
      />
    ));
    expect(screen.getByTestId("strike-min-input")).toBeInTheDocument();
    expect(screen.getByTestId("strike-max-input")).toBeInTheDocument();
    expect(screen.getAllByText("Strike Min").length).toBeGreaterThan(0);
  });
});
