// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createComponent } from "solid-js";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MarketFilterRail } from "./MarketFilterRail";
import {
  defaultMarketFilters,
  MOVER_PRESETS,
  type MarketFilterState,
} from "./marketFilters";

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

function openMoverGallery(): void {
  fireEvent.click(screen.getByTestId("market-movers-toggle"));
}

describe("MarketFilterRail — mover gallery", () => {
  test("the rail is compact by default: no preset list until the gallery opens", () => {
    mount();
    const toggle = screen.getByTestId("market-movers-toggle");
    expect(toggle).toHaveAttribute("aria-haspopup", "dialog");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("market-movers-list")).toBeNull();
    for (const preset of MOVER_PRESETS) {
      expect(screen.queryByTestId(`market-mover-${preset.id}`)).toBeNull();
    }
  });

  test("opening reveals all twelve presets with label, thesis and applied chips", () => {
    mount();
    openMoverGallery();
    expect(screen.getByTestId("market-movers-toggle")).toHaveAttribute("aria-expanded", "true");

    const list = screen.getByTestId("market-movers-list");
    const cards = MOVER_PRESETS.map((preset) => screen.getByTestId(`preset-card-${preset.id}`));
    expect(cards).toHaveLength(12);
    for (const preset of MOVER_PRESETS) {
      const card = screen.getByTestId(`preset-card-${preset.id}`);
      expect(list).toContainElement(card);
      expect(within(card).getByTestId(`preset-label-${preset.id}`)).toHaveTextContent(preset.label);
      expect(within(card).getByTestId(`preset-thesis-${preset.id}`)).toHaveTextContent(
        preset.description,
      );
      // Every card exposes at least one chip for the bounds/sort it applies.
      expect(card.querySelectorAll('[data-testid^="preset-chip-"]').length).toBeGreaterThan(0);
    }
  });

  test("the two report-only 52W presets render their labels straight from the registry", () => {
    mount();
    openMoverGallery();
    for (const [id, label] of [
      ["newHigh", "New 52W High"],
      ["newLow", "New 52W Low"],
    ] as const) {
      const preset = MOVER_PRESETS.find((p) => p.id === id)!;
      expect(preset.label).toBe(label);
      expect(screen.getByTestId(`preset-label-${id}`)).toHaveTextContent(label);
    }
  });

  test("each preset applies its filters and its sort exactly once", () => {
    for (const preset of MOVER_PRESETS) {
      const onChange = mount();
      openMoverGallery();
      fireEvent.click(screen.getByTestId(`market-mover-${preset.id}`));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({ ...preset.filters, sort: preset.sort });
      cleanup();
    }
  });

  test("the active preset is badged and clears bounds + sort exactly once", () => {
    const preset = MOVER_PRESETS.find((p) => p.id === "gapUp")!;
    const onChange = mount({ ...preset.filters, sort: preset.sort });
    openMoverGallery();

    expect(screen.getByTestId("preset-active-gapUp")).toHaveTextContent("Active");
    const clear = screen.getByTestId("market-mover-gapUp-clear");
    expect(clear).toBeEnabled();
    fireEvent.click(clear);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      mcapMinCr: null,
      gapMin: null,
      sort: "mcap_desc",
    });
  });

  test("an inactive preset's clear button is disabled", () => {
    const onChange = mount();
    openMoverGallery();
    expect(screen.getByTestId("market-mover-gainers-clear")).toBeDisabled();
    fireEvent.click(screen.getByTestId("market-mover-gainers-clear"));
    expect(onChange).not.toHaveBeenCalled();
  });

  test("clicking the band header opens the gallery and keeps it open", () => {
    mount();
    fireEvent.click(screen.getByTestId("market-movers-toggle"));
    expect(screen.getByTestId("market-movers-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("market-preset-gallery")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("market-movers-toggle"));
    expect(screen.getByTestId("market-movers-toggle")).toHaveAttribute("aria-expanded", "true");
  });

  test("switching entry from value to movers keeps both sections browsable", () => {
    mount();
    fireEvent.click(screen.getByTestId("market-value-toggle"));
    fireEvent.click(screen.getByTestId("market-movers-toggle"));
    expect(screen.getByTestId("market-value-fields")).toBeInTheDocument();
    expect(screen.getByTestId("market-movers-list")).toBeInTheDocument();
  });
});
