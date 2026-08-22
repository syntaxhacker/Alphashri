// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderWithMantine } from "../../../test-utils/renderWithMantine";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OptionChainFilters } from "./OptionChainFilters";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OptionChainFilters", () => {
  it("renders option type select", () => {
    renderWithMantine(
      <OptionChainFilters
        filters={{ optionType: "BOTH", moneyness: "ALL", strikeRange: [0, 100000] }}
        setFilters={vi.fn()}
      />,
    );
    expect(screen.getByTestId("option-type-select")).toBeInTheDocument();
  });

  it("renders moneyness select", () => {
    renderWithMantine(
      <OptionChainFilters
        filters={{ optionType: "BOTH", moneyness: "ALL", strikeRange: [0, 100000] }}
        setFilters={vi.fn()}
      />,
    );
    expect(screen.getByTestId("moneyness-select")).toBeInTheDocument();
  });

  it("renders strike min and max inputs", () => {
    renderWithMantine(
      <OptionChainFilters
        filters={{ optionType: "BOTH", moneyness: "ALL", strikeRange: [0, 100000] }}
        setFilters={vi.fn()}
      />,
    );
    expect(screen.getByTestId("strike-min-input")).toBeInTheDocument();
    expect(screen.getByTestId("strike-max-input")).toBeInTheDocument();
  });

  it("renders filters container", () => {
    renderWithMantine(
      <OptionChainFilters
        filters={{ optionType: "BOTH", moneyness: "ALL", strikeRange: [0, 100000] }}
        setFilters={vi.fn()}
      />,
    );
    expect(screen.getByTestId("options-chain-filters")).toBeInTheDocument();
  });

  it("displays current option type as available option", () => {
    renderWithMantine(
      <OptionChainFilters
        filters={{ optionType: "BOTH", moneyness: "ALL", strikeRange: [0, 100000] }}
        setFilters={vi.fn()}
      />,
    );
    expect(screen.getByText("Both CE/PE")).toBeInTheDocument();
  });

  it("displays all filter option labels", () => {
    renderWithMantine(
      <OptionChainFilters
        filters={{ optionType: "CE", moneyness: "ITM", strikeRange: [0, 100000] }}
        setFilters={vi.fn()}
      />,
    );
    expect(screen.getByText("Calls Only")).toBeInTheDocument();
    expect(screen.getByText("ITM")).toBeInTheDocument();
  });

  it("shows strike range inputs with correct labels", () => {
    renderWithMantine(
      <OptionChainFilters
        filters={{ optionType: "BOTH", moneyness: "ALL", strikeRange: [24000, 25000] }}
        setFilters={vi.fn()}
      />,
    );
    expect(screen.getByTestId("strike-min-input")).toBeInTheDocument();
    expect(screen.getByTestId("strike-max-input")).toBeInTheDocument();
    expect(screen.getByText("Strike Min")).toBeInTheDocument();
  });
});
