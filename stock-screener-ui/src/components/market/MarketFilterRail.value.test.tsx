// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createComponent } from "solid-js";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MarketFilterRail } from "./MarketFilterRail";
import {
  DEEP_VALUE_PRESET,
  defaultMarketFilters,
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

function openValueGallery(): void {
  fireEvent.click(screen.getByTestId("market-value-toggle"));
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

describe("MarketFilterRail — value gallery entry", () => {
  test("the rail keeps all value fields out of the document until the gallery opens", () => {
    mount();
    const toggle = screen.getByTestId("market-value-toggle");
    expect(toggle).toHaveAttribute("aria-haspopup", "dialog");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("market-value-fields")).toBeNull();
    expect(screen.queryByTestId("market-preset-gallery")).toBeNull();
    expect(screen.queryByTestId("market-filter-pe-input")).toBeNull();
  });

  test("opening the gallery reveals all twelve value inputs with readable labels", () => {
    mount();
    openValueGallery();
    expect(screen.getByTestId("market-value-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("market-preset-gallery")).toBeInTheDocument();

    const group = screen.getByTestId("market-value-fields");
    expect(within(group).getAllByRole("spinbutton")).toHaveLength(12);
    for (const [key, label] of VALUE_INPUTS) {
      const input = screen.getByTestId(`market-filter-${key}-input`);
      expect(group).toContainElement(input);
      const labelEl = screen.getByText(label);
      expect(group).toContainElement(labelEl);
      expect(labelEl.className).toContain("text-xs");
    }
  });

  test("a typed bound is committed locally; clearing it writes null", () => {
    const onChange = mount();
    openValueGallery();

    const pe = screen.getByTestId("market-filter-peMax-input");
    fireEvent.input(pe, { target: { value: "15" } });
    expect(onChange).toHaveBeenLastCalledWith({ peMax: 15 });

    fireEvent.input(pe, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ peMax: null });
  });

  test("the Deep Value card states its gates and applies the whole bundle once", () => {
    const onChange = mount();
    openValueGallery();

    const card = screen.getByTestId("market-value-fields");
    expect(within(card).getByText(/Cheapest 35% on P\/E/)).toBeInTheDocument();
    for (const label of ["P/E cheapest 35%", "ROE top 55%", "D/E least leveraged 30%", "Inside each row's own sector"]) {
      expect(within(card).getByText(label)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByTestId("market-value-preset"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(DEEP_VALUE_PRESET);
  });

  test("the Deep Value card shows active state and clears the exact three gates once", () => {
    const onChange = mount(DEEP_VALUE_PRESET);
    openValueGallery();
    expect(screen.getByTestId("preset-active-deep-value")).toHaveTextContent("Active");
    const clear = screen.getByTestId("market-value-preset-clear");
    expect(clear).toBeEnabled();

    fireEvent.click(clear);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      pePctMax: null,
      roePctMin: null,
      dePctMax: null,
    });
  });

  test("the disabled clear button cannot clear an inactive preset", () => {
    const onChange = mount();
    openValueGallery();
    expect(screen.getByTestId("market-value-preset-clear")).toBeDisabled();
    fireEvent.click(screen.getByTestId("market-value-preset-clear"));
    expect(onChange).not.toHaveBeenCalled();
  });

  test("opening needs no styles prop and no new network dependency", () => {
    mount();
    openValueGallery();
    expect(screen.getByTestId("market-value-fields")).toBeInTheDocument();
  });

  test("clicking the header text opens the gallery, not an inline band", () => {
    mount();
    const toggle = screen.getByTestId("market-value-toggle");
    fireEvent.click(screen.getByText("Value filters"));
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByText("Value filters"));
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  test("clicking the active-count badge still opens the gallery", () => {
    mount({ pePctMax: 0.35 });
    fireEvent.click(screen.getByTestId("market-value-toggle").querySelector("span span span")!);
    expect(screen.getByTestId("market-preset-gallery")).toBeInTheDocument();
  });

  test("Escape closes the gallery and returns focus to the rail entry", () => {
    mount();
    const toggle = screen.getByTestId("market-value-toggle");
    toggle.focus();
    openValueGallery();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("market-preset-gallery")).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  test("arrow keys walk the gallery's apply actions from the search field", () => {
    mount();
    openValueGallery();
    const search = screen.getByTestId("market-preset-search");
    search.focus();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId("market-value-preset"));
    fireEvent.keyDown(search, { key: "ArrowUp" });
    expect(document.activeElement).toBe(
      Array.from(document.querySelectorAll<HTMLButtonElement>('[data-preset-apply="true"]')).at(-1),
    );
  });

  test("slash focuses the search field from anywhere in the open gallery", () => {
    mount();
    openValueGallery();
    fireEvent.click(screen.getByTestId("preset-match-count"));
    fireEvent.keyDown(document, { key: "/" });
    expect(document.activeElement).toBe(screen.getByTestId("market-preset-search"));
  });

  test("the search field narrows the preset list without hiding the gallery", () => {
    mount();
    openValueGallery();
    fireEvent.input(screen.getByTestId("market-preset-search"), {
      target: { value: "gap down" },
    });
    expect(screen.getByTestId("preset-card-gapDown")).toBeInTheDocument();
    expect(screen.queryByTestId("preset-card-gainers")).toBeNull();
    expect(screen.getByTestId("market-preset-gallery")).toBeInTheDocument();
  });
});

describe("MarketFilterRail — viewport fit", () => {
  test("the rail stays compact: no inline number inputs or advanced lists", () => {
    mount();
    const rail = screen.getByTestId("market-filter-rail");
    expect(rail.className).toContain("overflow-x-hidden");
    expect(rail.className).toContain("min-w-0");
    expect(rail.querySelector('[data-testid="market-filter-pePctMax"]')).toBeNull();
    expect(rail.querySelector('[data-testid="market-filter-gapMin"]')).toBeNull();
    expect(within(rail).queryByTestId("market-value-fields")).toBeNull();
    expect(within(rail).queryByTestId("market-movers-list")).toBeNull();
  });

  test("the modal owns its own scroll and blocks page scroll while open", () => {
    mount();
    openValueGallery();
    expect(document.body.style.overflow).toBe("hidden");
    const gallery = screen.getByTestId("market-preset-gallery");
    expect(gallery.className).toContain("overflow-x-hidden");
    expect(gallery.querySelector('[data-sheet="false"]')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("market-preset-gallery-close"));
    expect(document.body.style.overflow).toBe("");
  });

  test("at 390 the gallery renders as a full-height sheet", () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("640px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    try {
      mount();
      openValueGallery();
      expect(screen.getByTestId("market-preset-gallery").querySelector('[data-sheet="true"]')).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
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
