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

// Sector-relative gates come first: they are what the preset uses.
const VALUE_INPUTS = [
  ["pePctMax", "P/E %ile ≤ (cheap)"],
  ["roePctMin", "ROE %ile ≥ (top)"],
  ["dePctMax", "D/E %ile ≤ (low)"],
  ["peMax", "P/E ≤ (absolute)"],
  ["psMax", "P/S ≤ (absolute)"],
  ["pbMax", "P/B ≤ (absolute)"],
  ["roeMin", "ROE ≥ (absolute)"],
  ["divYieldMin", "Div yield ≥"],
  ["fcfYieldMin", "FCF yield ≥"],
  ["debtToEquityMax", "D/E ≤ (absolute)"],
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

  test("expanding reveals all twelve value inputs with readable labels", () => {
    mount();
    fireEvent.click(screen.getByTestId("market-value-toggle"));
    expect(screen.getByTestId("market-value-toggle")).toHaveAttribute("aria-expanded", "true");

    const group = screen.getByTestId("market-value-fields");
    expect(within(group).getAllByRole("spinbutton")).toHaveLength(12);
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

  test("clicking the header text toggles the band", () => {
    mount();
    const toggle = screen.getByTestId("market-value-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByText("Value filters"));
    expect(screen.getByTestId("market-value-toggle")).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByText("Value filters"));
    expect(screen.getByTestId("market-value-toggle")).toHaveAttribute("aria-expanded", "false");
  });

  test("clicking the active-count badge still toggles the band", () => {
    mount({ pePctMax: 0.35 });
    const toggle = screen.getByTestId("market-value-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    // The badge is an absolutely positioned span inside the header button; a
    // click on it must bubble rather than being swallowed by the indicator.
    fireEvent.click(screen.getByTestId("market-value-toggle").querySelector("span span span")!);
    expect(screen.getByTestId("market-value-toggle")).toHaveAttribute("aria-expanded", "true");
  });
});

describe("MarketFilterRail — collapse affordance", () => {
  test("the icon-only collapse button has an accessible name", () => {
    render(() =>
      createComponent(MarketFilterRail, {
        filters: defaultMarketFilters(),
        onChange: vi.fn(),
        sectors: [],
        onCollapse: vi.fn(),
        collapseLabel: "Close filters",
      }),
    );

    const collapse = screen.getByTestId("market-rail-collapse");
    expect(collapse).toHaveAccessibleName("Close filters");
    expect(screen.getByRole("button", { name: "Close filters" })).toBe(collapse);
  });

  test("the default label names the desktop collapse button", () => {
    render(() =>
      createComponent(MarketFilterRail, {
        filters: defaultMarketFilters(),
        onChange: vi.fn(),
        sectors: [],
        onCollapse: vi.fn(),
      }),
    );
    expect(screen.getByTestId("market-rail-collapse")).toHaveAccessibleName("Collapse filters");
  });
});
