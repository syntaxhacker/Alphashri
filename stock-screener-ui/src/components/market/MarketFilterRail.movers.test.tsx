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

  test("expanding reveals all twelve one-click presets with readable labels", () => {
    mount();
    fireEvent.click(screen.getByTestId("market-movers-toggle"));
    expect(screen.getByTestId("market-movers-toggle")).toHaveAttribute("aria-expanded", "true");

    const list = screen.getByTestId("market-movers-list");
    const buttons = within(list).getAllByRole("button");
    expect(buttons).toHaveLength(12);
    for (const preset of MOVER_PRESETS) {
      const button = screen.getByTestId(`market-mover-${preset.id}`);
      expect(list).toContainElement(button);
      expect(button).toHaveTextContent(preset.label);
      expect(button).toHaveAttribute("title", preset.description);
      // Button size="xs" carries text-xs (12px) — above the 11px floor.
      expect(button.className).toContain("text-xs");
    }
  });

  test("the two report-only 52W presets render their labels straight from the registry", () => {
    mount();
    fireEvent.click(screen.getByTestId("market-movers-toggle"));
    const list = screen.getByTestId("market-movers-list");
    for (const [id, label] of [
      ["newHigh", "New 52W High"],
      ["newLow", "New 52W Low"],
    ] as const) {
      const preset = MOVER_PRESETS.find((p) => p.id === id)!;
      expect(preset.label).toBe(label);
      expect(within(list).getByTestId(`market-mover-${id}`)).toHaveTextContent(label);
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
