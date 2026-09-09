// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderWithProviders } from "../../../test-utils/renderWithProviders";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OptionChainHeader } from "./OptionChainHeader";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OptionChainHeader", () => {
  const defaultProps = {
    selectedUnderlying: "NIFTY",
    selectedExpiry: "25MAY",
    setUnderlying: vi.fn(),
    setExpiry: vi.fn(),
    availableUnderlyings: ["NIFTY", "BANKNIFTY", "FINNIFTY"],
    availableExpiries: ["25MAY", "01JUN", "08JUN"],
  };

  it("renders underlying select", () => {
    renderWithProviders(<OptionChainHeader {...defaultProps} />);
    expect(screen.getByTestId("underlying-select")).toBeInTheDocument();
  });

  it("renders expiry select", () => {
    renderWithProviders(<OptionChainHeader {...defaultProps} />);
    expect(screen.getByTestId("expiry-select")).toBeInTheDocument();
  });

  it("renders header controls container", () => {
    renderWithProviders(<OptionChainHeader {...defaultProps} />);
    expect(screen.getByTestId("options-chain-header-controls")).toBeInTheDocument();
  });

  it("has select labels", () => {
    renderWithProviders(<OptionChainHeader {...defaultProps} />);
    expect(screen.getByText("Underlying")).toBeInTheDocument();
    expect(screen.getByText("Expiry")).toBeInTheDocument();
  });

  it("displays available underlyings as select options", () => {
    renderWithProviders(<OptionChainHeader {...defaultProps} />);
    expect(screen.getByText("NIFTY")).toBeInTheDocument();
    expect(screen.getByText("BANKNIFTY")).toBeInTheDocument();
    expect(screen.getByText("FINNIFTY")).toBeInTheDocument();
  });

  it("displays available expiries as select options", () => {
    renderWithProviders(<OptionChainHeader {...defaultProps} />);
    expect(screen.getByText("25MAY")).toBeInTheDocument();
    expect(screen.getByText("01JUN")).toBeInTheDocument();
    expect(screen.getByText("08JUN")).toBeInTheDocument();
  });
});
