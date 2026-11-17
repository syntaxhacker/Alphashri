// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import {
  FILTER_STATUS_CLEAR_ALL_LABEL,
  FILTER_STATUS_EMPTY_TESTID_SUFFIX,
  FILTER_STATUS_ROW_ARIA_LABEL,
  FILTER_STATUS_ROW_HEIGHT_CLASS,
  FILTER_STATUS_ROW_PLACEHOLDER,
  FILTER_STATUS_SCROLL_LABEL,
  FILTER_STATUS_SCROLL_STEP_PX,
  FILTER_STATUS_SCROLL_TESTID_SUFFIX,
  FilterStatusRow,
  shouldShowScrollAffordance,
} from "./FilterStatusRow";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/test-utils/solidUiMock");
  return mockSolidUi();
});

afterEach(() => cleanup());

const TEST_ID = "test-active-filters";

describe("FilterStatusRow", () => {
  test("stays mounted with a muted placeholder when there are no filters", () => {
    render(() => (
      <FilterStatusRow testId={TEST_ID} hasFilters={false} />
    ));
    const row = screen.getByTestId(TEST_ID);
    expect(row).toBeInTheDocument();
    expect(screen.getByTestId(`${TEST_ID}-${FILTER_STATUS_EMPTY_TESTID_SUFFIX}`)).toHaveTextContent(
      FILTER_STATUS_ROW_PLACEHOLDER,
    );
    expect(screen.queryByText(FILTER_STATUS_CLEAR_ALL_LABEL)).not.toBeInTheDocument();
  });

  test("uses a fixed 24px band: no wrap, horizontal scroll, hidden scrollbar", () => {
    render(() => (
      <FilterStatusRow testId={TEST_ID} hasFilters={false} />
    ));
    const row = screen.getByTestId(TEST_ID);
    expect(row).toHaveClass(FILTER_STATUS_ROW_HEIGHT_CLASS);
    expect(row).toHaveClass("overflow-x-auto");
    expect(row).toHaveClass("whitespace-nowrap");
    expect(row).not.toHaveClass("flex-wrap");
    expect(row.style.getPropertyValue("scrollbar-width")).toBe("none");
  });

  test("exposes the scroll region as a labelled, keyboard-focusable region", () => {
    render(() => (
      <FilterStatusRow testId={TEST_ID} hasFilters={false} />
    ));
    const row = screen.getByTestId(TEST_ID);
    expect(row).toHaveAttribute("role", "region");
    expect(row).toHaveAttribute("aria-label", FILTER_STATUS_ROW_ARIA_LABEL);
    expect(row).toHaveAttribute("tabindex", "0");
    expect(row).toHaveClass("focus-visible:ring-1");
    expect(row).toHaveClass("focus-visible:ring-fin-primary");

    row.focus();
    expect(row).toHaveFocus();
  });

  test("renders chips and a clear-all action only when filters exist", () => {
    const remove = vi.fn();
    const clearAll = vi.fn();
    render(() => (
      <FilterStatusRow
        testId={TEST_ID}
        hasFilters={true}
        onClearAll={clearAll}
        clearAllTestId="test-clear-all"
      >
        <button type="button" data-testid="test-chip" onClick={remove}>Sector: IT</button>
      </FilterStatusRow>
    ));
    expect(screen.getByTestId("test-chip")).toBeInTheDocument();
    expect(screen.getByTestId("test-clear-all")).toHaveTextContent(FILTER_STATUS_CLEAR_ALL_LABEL);
    expect(screen.queryByText(FILTER_STATUS_ROW_PLACEHOLDER)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("test-chip"));
    expect(remove).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("test-clear-all"));
    expect(clearAll).toHaveBeenCalledTimes(1);
  });

  test("keeps the same row node and height across an empty → chip → empty transition", () => {
    const [hasFilters, setHasFilters] = createSignal(false);
    render(() => (
      <>
        <FilterStatusRow testId={TEST_ID} hasFilters={hasFilters()}>
          <span data-testid="test-chip">Sector: IT</span>
        </FilterStatusRow>
        <button type="button" data-testid="test-toggle" onClick={() => setHasFilters((v) => !v)}>
          toggle
        </button>
      </>
    ));
    const row = screen.getByTestId(TEST_ID);
    expect(row).toHaveClass(FILTER_STATUS_ROW_HEIGHT_CLASS);
    expect(screen.getByTestId(`${TEST_ID}-${FILTER_STATUS_EMPTY_TESTID_SUFFIX}`)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("test-toggle"));
    expect(screen.getByTestId("test-chip")).toBeInTheDocument();
    expect(screen.getByTestId(TEST_ID)).toBe(row);
    expect(row).toHaveClass(FILTER_STATUS_ROW_HEIGHT_CLASS);

    fireEvent.click(screen.getByTestId("test-toggle"));
    expect(screen.getByTestId(`${TEST_ID}-${FILTER_STATUS_EMPTY_TESTID_SUFFIX}`)).toBeInTheDocument();
    expect(screen.getByTestId(TEST_ID)).toBe(row);
  });

  test("honors a custom placeholder and placement class", () => {
    render(() => (
      <FilterStatusRow testId={TEST_ID} hasFilters={false} placeholder="Nothing applied" className="flex-shrink-0" />
    ));
    expect(screen.getByTestId(TEST_ID)).toHaveClass("flex-shrink-0");
    expect(screen.getByText("Nothing applied")).toBeInTheDocument();
  });
});

/** happy-dom does not lay out, so feed the pure read the metrics it expects. */
function setScrollMetrics(
  el: HTMLElement,
  metrics: { scrollWidth?: number; clientWidth?: number; scrollLeft?: number },
) {
  if (metrics.scrollWidth !== undefined) {
    Object.defineProperty(el, "scrollWidth", { configurable: true, value: metrics.scrollWidth });
  }
  if (metrics.clientWidth !== undefined) {
    Object.defineProperty(el, "clientWidth", { configurable: true, value: metrics.clientWidth });
  }
  if (metrics.scrollLeft !== undefined) {
    Object.defineProperty(el, "scrollLeft", {
      configurable: true,
      writable: true,
      value: metrics.scrollLeft,
    });
  }
  window.dispatchEvent(new Event("resize"));
}

function renderOverflowRow() {
  return render(() => (
    <FilterStatusRow testId={TEST_ID} hasFilters={true}>
      <span data-testid="test-chip">Sector: IT</span>
    </FilterStatusRow>
  ));
}

const AFFORDANCE_TESTID = `${TEST_ID}-${FILTER_STATUS_SCROLL_TESTID_SUFFIX}`;

describe("shouldShowScrollAffordance", () => {
  test("hidden when the strip fits", () => {
    expect(shouldShowScrollAffordance(100, 100, 0)).toBe(false);
    expect(shouldShowScrollAffordance(100.5, 100, 0)).toBe(false);
  });

  test("visible while overflowing and not at the end", () => {
    expect(shouldShowScrollAffordance(400, 100, 0)).toBe(true);
    expect(shouldShowScrollAffordance(400, 100, 120)).toBe(true);
  });

  test("hidden once at the end or when unmeasurable", () => {
    expect(shouldShowScrollAffordance(400, 100, 300)).toBe(false);
    expect(shouldShowScrollAffordance(400, 0, 0)).toBe(false);
  });
});

describe("FilterStatusRow scroll affordance", () => {
  test("absent while the chip strip fits", () => {
    renderOverflowRow();
    setScrollMetrics(screen.getByTestId(TEST_ID), {
      scrollWidth: 100,
      clientWidth: 100,
      scrollLeft: 0,
    });
    expect(screen.queryByTestId(AFFORDANCE_TESTID)).not.toBeInTheDocument();
  });

  test("appears on overflow and scrolls right when the chevron is clicked", () => {
    renderOverflowRow();
    const row = screen.getByTestId(TEST_ID);
    setScrollMetrics(row, { scrollWidth: 400, clientWidth: 100, scrollLeft: 0 });

    const affordance = screen.getByTestId(AFFORDANCE_TESTID);
    expect(affordance).toHaveAttribute("aria-label", FILTER_STATUS_SCROLL_LABEL);
    // The region is the only tab stop; the chevron must not add a second one.
    expect(affordance).toHaveAttribute("tabindex", "-1");

    fireEvent.click(affordance);
    expect(row.scrollLeft).toBe(FILTER_STATUS_SCROLL_STEP_PX);
  });

  test("hides once the strip is scrolled to the end", () => {
    renderOverflowRow();
    const row = screen.getByTestId(TEST_ID);
    setScrollMetrics(row, { scrollWidth: 400, clientWidth: 100, scrollLeft: 0 });
    expect(screen.getByTestId(AFFORDANCE_TESTID)).toBeInTheDocument();

    setScrollMetrics(row, { scrollWidth: 400, clientWidth: 100, scrollLeft: 300 });
    expect(screen.queryByTestId(AFFORDANCE_TESTID)).not.toBeInTheDocument();
  });
});
