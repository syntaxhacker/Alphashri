// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createComponent } from "solid-js";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MarketFilterRail } from "./MarketFilterRail";
import { DEEP_VALUE_PRESET, defaultMarketFilters, type MarketFilterState } from "./marketFilters";

afterEach(cleanup);

function mount(overrides: Partial<MarketFilterState> = {}, onChange = vi.fn()) {
  render(() =>
    createComponent(MarketFilterRail, {
      filters: { ...defaultMarketFilters(), ...overrides },
      onChange,
      sectors: [],
    }),
  );
  return onChange;
}

const VALUE_INPUTS = [
  ["peMax", "P/E ≤"],
  ["psMax", "P/S ≤"],
  ["pbMax", "P/B ≤"],
  ["roeMin", "ROE ≥"],
  ["divYieldMin", "Div yield ≥"],
  ["fcfYieldMin", "FCF yield ≥"],
  ["debtToEquityMax", "D/E ≤"],
  ["revYoyMin", "Rev growth ≥"],
  ["epsYoyMin", "EPS growth ≥"],
] as const;

describe("MarketFilterRail — collapsible Value group", () => {
  test("is collapsed by default so the default Market view is unchanged", () => {
    mount();
    const toggle = screen.getByTestId("market-value-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("market-value-fields")).toBeNull();
    expect(screen.queryByTestId("market-filter-pe-input")).toBeNull();
  });

  test("expanding reveals all nine value inputs with readable labels", () => {
    mount();
    fireEvent.click(screen.getByTestId("market-value-toggle"));
    expect(screen.getByTestId("market-value-toggle")).toHaveAttribute("aria-expanded", "true");

    const group = screen.getByTestId("market-value-fields");
    expect(within(group).getAllByRole("spinbutton")).toHaveLength(9);
    for (const [key, label] of VALUE_INPUTS) {
      const input = screen.getByTestId(`market-filter-${key}-input`);
      expect(group).toContainElement(input);
      const field = input.closest(".flex.flex-col") as HTMLElement;
      const labelEl = within(field).getByText(label);
      expect(labelEl.className).toContain("text-xs");
    }
  });

  test("a typed bound is committed locally; clearing it writes null", () => {
    const onChange = mount();
    fireEvent.click(screen.getByTestId("market-value-toggle"));

    const pe = screen.getByTestId("market-filter-peMax-input");
    fireEvent.input(pe, { target: { value: "15" } });
    expect(onChange).toHaveBeenLastCalledWith({ peMax: 15 });

    fireEvent.input(pe, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ peMax: null });
  });

  test("the deep value preset applies the whole bundle in one click", () => {
    const onChange = mount();
    fireEvent.click(screen.getByTestId("market-value-toggle"));
    fireEvent.click(screen.getByTestId("market-value-preset"));
    expect(onChange).toHaveBeenCalledWith(DEEP_VALUE_PRESET);
  });

  test("expanding the group needs no styles prop and no new network dependency", () => {
    mount();
    fireEvent.click(screen.getByTestId("market-value-toggle"));
    expect(screen.getByTestId("market-value-fields")).toBeInTheDocument();
  });
});
