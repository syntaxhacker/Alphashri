// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createSignal } from "solid-js";
import { cleanup, render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  return mockSolidUi();
});
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

  it("renders a label for each select", () => {
    render(() => <OptionChainHeader {...defaultProps} />);
    expect(screen.getAllByText("Underlying").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Expiry").length).toBeGreaterThan(0);
  });

  it("keeps the accessible name on the select", () => {
    render(() => <OptionChainHeader {...defaultProps} />);
    expect(screen.getByLabelText("Underlying")).toBe(screen.getByTestId("underlying-select").querySelector("select"));
    expect(screen.getByLabelText("Expiry")).toBe(screen.getByTestId("expiry-select").querySelector("select"));
  });

  it("displays available underlyings as select options", async () => {
    render(() => <OptionChainHeader {...defaultProps} />);
    expect(screen.getByRole("option", { name: "NIFTY" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "BANKNIFTY" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "FINNIFTY" })).toBeInTheDocument();
  });

  it("displays available expiries as select options", async () => {
    render(() => <OptionChainHeader {...defaultProps} />);
    expect(screen.getByRole("option", { name: "25MAY" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "01JUN" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "08JUN" })).toBeInTheDocument();
  });

  it("reacts to signal-backed selections and option lists", () => {
    const [underlying, setUnderlying] = createSignal("NIFTY");
    const [underlyings, setUnderlyings] = createSignal(["NIFTY", "BANKNIFTY"]);
    render(() => (
      <OptionChainHeader
        {...defaultProps}
        selectedUnderlying={underlying()}
        availableUnderlyings={underlyings()}
      />
    ));

    const underlyingSelect = screen.getByTestId("underlying-select").querySelector("select")!;
    expect(underlyingSelect.value).toBe("NIFTY");
    expect(screen.queryByRole("option", { name: "FINNIFTY" })).not.toBeInTheDocument();

    setUnderlyings(["NIFTY", "BANKNIFTY", "FINNIFTY"]);

    expect(screen.getByRole("option", { name: "FINNIFTY" })).toBeInTheDocument();
    expect(underlyingSelect.options.length).toBe(3);

    setUnderlying("BANKNIFTY");
    expect(underlyingSelect.value).toBe("BANKNIFTY");
  });
});
