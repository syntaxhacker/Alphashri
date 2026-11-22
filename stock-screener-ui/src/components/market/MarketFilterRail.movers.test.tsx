// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createComponent } from "solid-js";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MarketFilterRail } from "./MarketFilterRail";
import { defaultMarketFilters, MOVER_PRESETS, type MarketFilterState } from "./marketFilters";

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

describe("MarketFilterRail — Movers band", () => {
  test("is collapsed by default so the default Market view is unchanged", () => {
    mount();
    const toggle = screen.getByTestId("market-movers-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("market-movers-list")).toBeNull();
    for (const preset of MOVER_PRESETS) {
      expect(screen.queryByTestId(`market-mover-${preset.id}`)).toBeNull();
    }
  });

  test("expanding reveals all ten one-click presets with readable labels", () => {
    mount();
    fireEvent.click(screen.getByTestId("market-movers-toggle"));
    expect(screen.getByTestId("market-movers-toggle")).toHaveAttribute("aria-expanded", "true");

    const list = screen.getByTestId("market-movers-list");
    const buttons = within(list).getAllByRole("button");
    expect(buttons).toHaveLength(10);
    for (const preset of MOVER_PRESETS) {
      const button = screen.getByTestId(`market-mover-${preset.id}`);
      expect(list).toContainElement(button);
      expect(button).toHaveTextContent(preset.label);
      expect(button).toHaveAttribute("title", preset.description);
      // Button size="xs" carries text-xs (12px) — above the 11px floor.
      expect(button.className).toContain("text-xs");
    }
  });

  test("each preset applies its filters and its sort in one click", () => {
    for (const preset of MOVER_PRESETS) {
      const onChange = mount();
      fireEvent.click(screen.getByTestId("market-movers-toggle"));
      fireEvent.click(screen.getByTestId(`market-mover-${preset.id}`));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({ ...preset.filters, sort: preset.sort });
      cleanup();
    }
  });

  test("clicking the band header toggles it closed again", () => {
    mount();
    fireEvent.click(screen.getByText("Mover presets"));
    expect(screen.getByTestId("market-movers-toggle")).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByText("Mover presets"));
    expect(screen.getByTestId("market-movers-toggle")).toHaveAttribute("aria-expanded", "false");
  });
});
