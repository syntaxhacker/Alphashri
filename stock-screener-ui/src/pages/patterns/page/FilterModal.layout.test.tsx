// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { DEFAULT_PATTERN_FILTERS } from "@/state/chartPatterns";
import * as palette from "@/ui/palette";
import {
  FILTER_RAIL_GAP_PX,
  FILTER_RAIL_MIN_TRACK_PX,
  FILTER_RAIL_THREE_COL_MIN_PX,
  filterRailColumnCount,
  filterRailTrackWidths,
} from "@/components/patterns/PatternFilterRail";
import {
  FILTER_MODAL_CONTENT_INSET_PX,
  FILTER_MODAL_EDGE_FADE_CLASS,
  FILTER_MODAL_MAX_WIDTH,
  FILTER_MODAL_MAX_WIDTH_PX,
  FILTER_MODAL_OVERLAY_COLOR,
  FilterModal,
  type FilterModalModel,
} from "./FilterModal";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/test-utils/solidUiMock");
  const { typeSize } = await import("@/ui/typography");
  return { ...mockSolidUi(), typeSize };
});

function makeModel(): FilterModalModel {
  const [filtersOpen] = createSignal(true);
  return {
    filtersOpen,
    setFiltersOpen: vi.fn(),
    draftDirty: () => false,
    patterns: () => [],
    filteredLatest: () => [],
    displaySummary: () => null,
    draftFilters: () => ({ ...DEFAULT_PATTERN_FILTERS }),
    setDraftFilter: vi.fn(),
    resetDraft: vi.fn(),
    applyDraftPreset: vi.fn(),
    patternImages: () => ({}),
    scanReplay: vi.fn(),
    draftChipCount: () => 0,
    cancelDraft: vi.fn(),
    applyDraft: vi.fn(),
  } as unknown as FilterModalModel;
}

describe("FilterModal responsive filter layout", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  test("1600: three columns fit the modal content box with every label legible", () => {
    // The old `xl` modal rendered ~574px: the third grid track started at
    // x≈1060 and was cut at the border, leaving only "FR/FO/A/ST/BA/52" shards.
    const contentPx = FILTER_MODAL_MAX_WIDTH_PX - FILTER_MODAL_CONTENT_INSET_PX;
    expect(FILTER_MODAL_MAX_WIDTH).toContain(`${FILTER_MODAL_MAX_WIDTH_PX}px`);
    expect(contentPx).toBeGreaterThanOrEqual(FILTER_RAIL_THREE_COL_MIN_PX);
    expect(filterRailColumnCount(contentPx)).toBe(3);

    const tracks = filterRailTrackWidths(contentPx);
    expect(tracks).toHaveLength(3);
    tracks.forEach((width, index) => {
      expect(width).toBeGreaterThanOrEqual(FILTER_RAIL_MIN_TRACK_PX[index]);
    });
    expect(tracks.reduce((sum, width) => sum + width, 0) + 2 * FILTER_RAIL_GAP_PX).toBeLessThanOrEqual(
      contentPx,
    );

    render(() => <FilterModal model={makeModel()} />);
    const modal = screen.getByTestId("patterns-filter-modal");
    const grid = within(modal).getByTestId("patterns-filter-rail-grid");
    expect(grid.parentElement?.className).toContain("@container");
    expect(grid.className).toContain("@4xl:grid-cols-");
    expect(grid.className).not.toContain("lg:grid-cols-");

    const third = within(modal).getByTestId("patterns-filter-rail-column-3");
    expect(grid).toContainElement(third);
    expect(within(third).getByText("Freshness")).toBeInTheDocument();
    expect(within(third).getByText("Structure")).toBeInTheDocument();
    expect(within(third).getByText("52W gap ≤ %")).toBeInTheDocument();
    expect(within(third).getByText("Base length (days)")).toBeInTheDocument();
    expect(within(third).getByTestId("patterns-filter-advanced")).toBeInTheDocument();
    expect(within(third).getByTestId("patterns-filter-max-52w-gap")).toBeInTheDocument();
    expect(within(third).getByTestId("patterns-filter-min-base")).toBeInTheDocument();
  });

  test("tablet width wraps to two columns instead of clipping the third", () => {
    const contentPx = 768 - FILTER_MODAL_CONTENT_INSET_PX;
    expect(filterRailColumnCount(contentPx)).toBe(2);

    render(() => <FilterModal model={makeModel()} />);
    const grid = screen.getByTestId("patterns-filter-rail-grid");
    expect(grid.className).toContain("@2xl:grid-cols-2");
    const third = screen.getByTestId("patterns-filter-rail-column-3");
    expect(third.className).toContain("@2xl:col-span-2");
    expect(within(third).getByTestId("patterns-filter-advanced")).toBeInTheDocument();
  });

  test("390: a single column keeps all controls in one labelled scroll port", () => {
    const contentPx = 390 - FILTER_MODAL_CONTENT_INSET_PX;
    expect(filterRailColumnCount(contentPx)).toBe(1);

    render(() => <FilterModal model={makeModel()} />);
    const modal = screen.getByTestId("patterns-filter-modal");
    const grid = within(modal).getByTestId("patterns-filter-rail-grid");
    expect(grid.className).toContain("grid-cols-1");

    const scroll = within(modal).getByTestId("patterns-filter-modal-scroll");
    expect(scroll).toHaveAttribute("role", "region");
    expect(scroll).toHaveAttribute("aria-label", "Filter controls, scroll for more");
    expect(scroll).toHaveAttribute("tabindex", "0");
    expect(scroll.className).toContain("overflow-y-auto");
    expect(scroll.className).toContain("overflow-x-hidden");
    // One modal-level scroll owner; the pattern-chip list has its own small
    // 340px viewport, which is deliberately not a second dialog scrollport.
    expect(modal.querySelectorAll('[data-scroll="vertical"]')).toHaveLength(1);
    expect(within(scroll).getByTestId("patterns-filter-rail-grid")).toBeInTheDocument();
    expect(within(scroll).getByTestId("patterns-filter-max-52w-gap")).toBeInTheDocument();
    expect(within(scroll).getByTestId("patterns-filter-advanced")).toBeInTheDocument();

    // The cue is present in the DOM but inert until the scrollport overflows.
    const cue = within(modal).getByTestId("patterns-filter-modal-scroll-cue");
    expect(cue).toHaveAttribute("aria-hidden", "true");
    expect(cue).toHaveClass("hidden");
    expect(cue).toHaveTextContent("Scroll for more ↓");
  });

  test("390: no partial glyph paints at the scrollport edge", () => {
    // The old overlay was transparent, so clipped page-rail labels and the
    // header button leaked beside the panel; a palette wash masks them.
    expect(FILTER_MODAL_OVERLAY_COLOR).toBe(palette.alpha(palette.BG, 0.78));
    expect(FILTER_MODAL_OVERLAY_COLOR).toMatch(/^rgba\(/);
    expect(FILTER_MODAL_EDGE_FADE_CLASS).toContain("from-fin-surface");
    expect(FILTER_MODAL_EDGE_FADE_CLASS).toContain("pointer-events-none");

    render(() => <FilterModal model={makeModel()} />);
    const modal = screen.getByTestId("patterns-filter-modal");
    const scroll = within(modal).getByTestId("patterns-filter-modal-scroll");
    expect(scroll).toHaveClass("px-2", "pt-2");
    expect(scroll.className).not.toContain("overflow-x-auto");
    expect(modal.querySelectorAll('[data-scroll="vertical"]')).toHaveLength(1);

    const fade = within(modal).getByTestId("patterns-filter-modal-top-fade");
    expect(fade).toHaveAttribute("aria-hidden", "true");
    expect(fade).toHaveClass("hidden");
    expect(within(modal).getByTestId("patterns-filter-modal-scroll-cue")).toHaveAttribute(
      "data-scroll-cue",
      "vertical",
    );
  });
});
