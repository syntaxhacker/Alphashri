// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";

let mockProfileMetaById: Record<string, any> = {};
let notify: (() => void) | null = null;

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/test-utils/solidUiMock");
  const { typeSize } = await import("@/ui/typography");
  return { ...mockSolidUi(), typeSize };
});

vi.mock("../../state", () => ({
  get profileMetaById() {
    return mockProfileMetaById;
  },
  subscribe: vi.fn((cb: () => void) => {
    notify = cb;
    return () => {
      notify = null;
    };
  }),
}));

vi.mock("../../api", () => ({ fetchData: vi.fn() }));

import {
  SCREENER_INLINE_FILTERS_EMPTY_TESTID,
  SCREENER_INLINE_FILTERS_HEIGHT_CLASS,
  SCREENER_INLINE_FILTERS_PLACEHOLDER,
  ScreenerInlineFilters,
} from "./ScreenerInlineFilters";

afterEach(() => {
  cleanup();
  mockProfileMetaById = {};
  notify = null;
  vi.clearAllMocks();
});

const noFilters = { trending: { filters: [] } };
const withFilter = { trending: { filters: [{ key: "rsi", label: "RSI >= 50" }] } };

describe("ScreenerInlineFilters", () => {
  test("stays mounted with a muted placeholder at zero filters, notes and status", () => {
    mockProfileMetaById = noFilters;
    render(() => <ScreenerInlineFilters activeScreener="trending" />);

    expect(screen.getByTestId("screener-inline-filters")).toBeInTheDocument();
    expect(screen.getByTestId(SCREENER_INLINE_FILTERS_EMPTY_TESTID)).toHaveTextContent(
      SCREENER_INLINE_FILTERS_PLACEHOLDER,
    );
    expect(screen.queryByTestId("apply-filters-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("screener-status")).not.toBeInTheDocument();
  });

  test("uses a fixed 24px, single-line band in both embedded and standalone layouts", () => {
    mockProfileMetaById = noFilters;
    const standalone = render(() => <ScreenerInlineFilters activeScreener="trending" />);
    const band = screen.getByTestId("screener-inline-filters");
    expect(band).toHaveClass(SCREENER_INLINE_FILTERS_HEIGHT_CLASS);
    expect(band).toHaveClass("min-h-[24px]");
    expect(band).toHaveClass("flex-nowrap");
    expect(band).toHaveClass("overflow-hidden");
    expect(band).not.toHaveClass("flex-wrap");
    standalone.unmount();

    render(() => <ScreenerInlineFilters activeScreener="trending" embedded />);
    const embeddedBand = screen.getByTestId("screener-inline-filters");
    expect(embeddedBand).toHaveClass(SCREENER_INLINE_FILTERS_HEIGHT_CLASS);
    expect(embeddedBand).toHaveClass("flex-nowrap");
    expect(embeddedBand).not.toHaveClass("flex-wrap");
  });

  test("shows chips and a truncated note/status in the same band, with no placeholder", () => {
    mockProfileMetaById = withFilter;
    render(() => (
      <ScreenerInlineFilters
        activeScreener="trending"
        status="265 stocks"
        notes={["52W from Upstox daily; a deliberately long notice that must truncate rather than wrap"]}
        embedded
      />
    ));

    expect(screen.getByTestId("filter-chip-rsi")).toHaveTextContent("RSI >= 50");
    expect(screen.getByTestId("apply-filters-btn")).toBeInTheDocument();
    expect(screen.getByTestId("screener-status")).toHaveTextContent("265 stocks");
    const note = screen.getByTestId("screener-52w-high-banner");
    // The real Text turns `truncate` into overflow/text-overflow/nowrap styles;
    // the local stub only exposes the shrink classes, so assert both signals.
    expect(note).toHaveClass("min-w-0");
    expect(note).toHaveClass("flex-shrink");
    expect(note).toHaveAttribute("title", expect.stringContaining("deliberately long notice"));
    const band = screen.getByTestId("screener-inline-filters");
    expect(band).toHaveClass("whitespace-nowrap");
    expect(band).toHaveClass("overflow-hidden");
    expect(band).not.toHaveClass("flex-wrap");
    expect(screen.queryByTestId(SCREENER_INLINE_FILTERS_EMPTY_TESTID)).not.toBeInTheDocument();
  });

  test("keeps the band node, its height and the table node across empty → first filter → empty", () => {
    mockProfileMetaById = noFilters;
    render(() => (
      <>
        <ScreenerInlineFilters activeScreener="trending" embedded />
        <div data-testid="screener-table-stub" className="min-h-0 flex-1">table</div>
      </>
    ));

    const band = screen.getByTestId("screener-inline-filters");
    const table = screen.getByTestId("screener-table-stub");
    const bandClass = band.className;
    const tableClass = table.className;
    expect(band).toHaveClass(SCREENER_INLINE_FILTERS_HEIGHT_CLASS);
    expect(screen.getByTestId(SCREENER_INLINE_FILTERS_EMPTY_TESTID)).toBeInTheDocument();

    mockProfileMetaById = withFilter;
    notify?.();
    expect(screen.getByTestId("filter-chip-rsi")).toBeInTheDocument();
    expect(screen.queryByTestId(SCREENER_INLINE_FILTERS_EMPTY_TESTID)).not.toBeInTheDocument();
    expect(screen.getByTestId("screener-inline-filters")).toBe(band);
    expect(screen.getByTestId("screener-table-stub")).toBe(table);
    expect(band.className).toBe(bandClass);
    expect(table.className).toBe(tableClass);

    mockProfileMetaById = noFilters;
    notify?.();
    expect(screen.getByTestId(SCREENER_INLINE_FILTERS_EMPTY_TESTID)).toBeInTheDocument();
    expect(screen.getByTestId("screener-inline-filters")).toBe(band);
    expect(screen.getByTestId("screener-table-stub")).toBe(table);
    expect(band).toHaveClass(SCREENER_INLINE_FILTERS_HEIGHT_CLASS);
  });
});
