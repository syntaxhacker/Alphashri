// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createComponent, createSignal } from "solid-js";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, test } from "vitest";
import {
  MarketFilterRail,
  formatRailMcap,
  formatRailPrice,
  hasFnoAffordance,
  railPriceLabel,
} from "./MarketFilterRail";
import { defaultMarketFilters } from "./marketFilters";

afterEach(cleanup);

describe("MarketFilterRail currency labels", () => {
  test("keeps India's label and bounds byte-identical by default", () => {
    expect(railPriceLabel()).toBe("Price ₹");
    expect(formatRailPrice(1339.7)).toBe("₹1339.7");
    expect(formatRailMcap(500000)).toBe("₹500k Cr");
    expect(formatRailMcap(0)).toBe("₹0k Cr");
  });

  test("uses dollars and billions for USD", () => {
    expect(railPriceLabel("USD")).toBe("Price $");
    expect(formatRailPrice(1339.7, "USD")).toBe("$1339.7");
    expect(formatRailMcap(500, "USD")).toBe("$500B");
    expect(formatRailMcap(12.5, "USD")).toBe("$12.5B");
  });

  test("renders the quote-currency price label without a new caller prop", () => {
    render(() =>
      createComponent(MarketFilterRail, {
        filters: defaultMarketFilters(),
        onChange: () => {},
        sectors: [],
      }),
    );
    expect(screen.getByText("Price ₹")).toBeInTheDocument();
  });

  test("renders the USD label when the caller opts in", () => {
    render(() =>
      createComponent(MarketFilterRail, {
        filters: defaultMarketFilters(),
        onChange: () => {},
        sectors: [],
        currency: "USD",
      }),
    );
    expect(screen.getByText("Price $")).toBeInTheDocument();
  });
});

describe("MarketFilterRail cap-tier labels", () => {
  test("India keeps the bare tier names, with counts, by default", () => {
    render(() =>
      createComponent(MarketFilterRail, {
        filters: defaultMarketFilters(),
        onChange: () => {},
        sectors: [],
        tierCounts: { large: 3, mid: 2, small: 1, micro: 4 },
      }),
    );
    for (const label of ["Large (3)", "Mid (2)", "Small (1)", "Micro (4)"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  test("USD reads the descriptor's absolute thresholds", () => {
    render(() =>
      createComponent(MarketFilterRail, {
        filters: defaultMarketFilters(),
        onChange: () => {},
        sectors: [],
        currency: "USD",
      }),
    );
    for (const label of ["Mega ≥200B", "Large 10–200B", "Mid 2–10B", "Small 0.3–2B", "Micro <0.3B"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  test("USD tier counts append to the threshold label", () => {
    render(() =>
      createComponent(MarketFilterRail, {
        filters: defaultMarketFilters(),
        onChange: () => {},
        sectors: [],
        currency: "USD",
        tierCounts: { large: 2 },
      }),
    );
    expect(screen.getByText("Large 10–200B (2)")).toBeInTheDocument();
  });

  test("India renders an ETF group with its count; the US rail has no ETF tier", () => {
    const india = render(() =>
      createComponent(MarketFilterRail, {
        filters: defaultMarketFilters(),
        onChange: () => {},
        sectors: [],
        tierCounts: { large: 3, mid: 2, small: 1, micro: 4, etf: 2 },
      }),
    );
    expect(screen.getByTestId("market-cap-etf")).toBeInTheDocument();
    expect(screen.getByText("ETF (2)")).toBeInTheDocument();
    // ETF sits in its own band, after the four size tiers — not in the size ladder.
    const sizes = ["market-cap-large", "market-cap-mid", "market-cap-small", "market-cap-micro"].map(
      (id) => screen.getByTestId(id),
    );
    const etf = screen.getByTestId("market-cap-etf");
    for (const size of sizes) {
      expect(size.compareDocumentPosition(etf) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    india.unmount();

    render(() =>
      createComponent(MarketFilterRail, {
        filters: defaultMarketFilters(),
        onChange: () => {},
        sectors: [],
        currency: "USD",
        tierCounts: { etf: 2 },
      }),
    );
    expect(screen.queryByTestId("market-cap-etf")).toBeNull();
    expect(screen.queryByText("ETF (2)")).toBeNull();
  });

  test("counts stay reactive when the snapshot's tierCounts changes", () => {
    // The rail is mounted once; a snapshot refresh (or India → US hydration)
    // replaces tierCounts without recreating the tier options. The label must
    // follow the new counts instead of freezing the first frame's value.
    const [counts, setCounts] = createSignal<Record<string, number>>({ large: 3, mid: 2 });
    render(() =>
      createComponent(MarketFilterRail, {
        filters: defaultMarketFilters(),
        onChange: () => {},
        sectors: [],
        get tierCounts() {
          return counts();
        },
      }),
    );
    expect(screen.getByText("Large (3)")).toBeInTheDocument();
    expect(screen.getByText("Mid (2)")).toBeInTheDocument();

    setCounts({ large: 739, mid: 1030 });

    expect(screen.getByText("Large (739)")).toBeInTheDocument();
    expect(screen.getByText("Mid (1030)")).toBeInTheDocument();
    expect(screen.queryByText("Large (3)")).toBeNull();
    expect(screen.queryByText("Mid (2)")).toBeNull();
  });
});

describe("MarketFilterRail F&O toggle is India-only", () => {
  test("India keeps the F&O toggle", () => {
    render(() =>
      createComponent(MarketFilterRail, {
        filters: defaultMarketFilters(),
        onChange: () => {},
        sectors: [],
      }),
    );
    expect(screen.getByTestId("market-filter-fno")).toBeInTheDocument();
  });

  test("USD hides the F&O toggle; ETF is a tier, not a second control", () => {
    render(() =>
      createComponent(MarketFilterRail, {
        filters: { ...defaultMarketFilters(), fnoOnly: true },
        onChange: () => {},
        sectors: [],
        currency: "USD",
      }),
    );
    expect(screen.queryByTestId("market-filter-fno")).toBeNull();
    expect(screen.queryByTestId("market-filter-etf")).toBeNull();
  });

  test("hasFnoAffordance keys off the quote currency alone", () => {
    expect(hasFnoAffordance()).toBe(true);
    expect(hasFnoAffordance("INR")).toBe(true);
    expect(hasFnoAffordance("USD")).toBe(false);
  });
});
