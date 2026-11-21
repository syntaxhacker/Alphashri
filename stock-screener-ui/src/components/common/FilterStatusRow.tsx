import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import { Box, Button, Text } from "@/ui";
import { alpha, SURFACE } from "@/ui/palette";
import { IconChevronRight } from "@/components/common/Icons";

/** Fixed band height (xs control step) — asserted by the empty-state tests. */
export const FILTER_STATUS_ROW_HEIGHT_CLASS = "h-6";
export const FILTER_STATUS_ROW_PLACEHOLDER = "No filters";
export const FILTER_STATUS_CLEAR_ALL_LABEL = "Clear all";
export const FILTER_STATUS_ROW_ARIA_LABEL = "Active filters";
export const FILTER_STATUS_EMPTY_TESTID_SUFFIX = "empty";
export const FILTER_STATUS_SCROLL_LABEL = "Scroll filters";
export const FILTER_STATUS_SCROLL_TESTID_SUFFIX = "scroll-affordance";
/** How far the chevron advances the chip strip per click. */
export const FILTER_STATUS_SCROLL_STEP_PX = 120;

export interface FilterStatusRowProps {
  /** Test id for the row itself (e.g. `market-active-chips`). */
  testId: string;
  /** Whether any filter chip is active. Drives the placeholder ↔ chip swap. */
  hasFilters: boolean;
  /** Removable filter chips. Rendered only when `hasFilters` is true. */
  children?: JSX.Element;
  /** Optional clear-all action, pinned right inside the same fixed-height row. */
  onClearAll?: () => void;
  /** Test id for the clear-all button (only rendered with `onClearAll`). */
  clearAllTestId?: string;
  clearAllLabel?: string;
  /** Placement helpers from the caller (`shrink-0`, `min-w-0`, …). */
  className?: string;
  placeholder?: string;
}

/**
 * Pure overflow read. The 1px tolerances keep sub-pixel rounding at the seam
 * from flickering the affordance on and off. Exported so the decision is unit
 * testable without a real layout engine.
 */
export function shouldShowScrollAffordance(
  scrollWidth: number,
  clientWidth: number,
  scrollLeft: number,
): boolean {
  if (clientWidth <= 0) return false;
  const overflows = scrollWidth > clientWidth + 1;
  const atEnd = scrollLeft + clientWidth >= scrollWidth - 1;
  return overflows && !atEnd;
}

/**
 * Always-mounted, fixed-height band for the active-filter chips.
 *
 * The old rows were wrapped in `Show when={chips().length > 0}`, so applying or
 * removing a filter mounted/unmounted a 22px row and shifted the table. Keeping
 * the band mounted at 24px with a muted placeholder removes that jump. Chips
 * live on one line and scroll horizontally instead of wrapping to new rows.
 *
 * A right-edge fade + chevron appears only while there is more content to the
 * right. It is absolutely positioned over the row (so it never affects the
 * scroll width or the 24px height), with pointer events on the chevron alone.
 */
export function FilterStatusRow(props: FilterStatusRowProps) {
  let rowEl: HTMLDivElement | undefined;
  const [showAffordance, setShowAffordance] = createSignal(false);

  const measure = () => {
    if (!rowEl) return;
    setShowAffordance(
      shouldShowScrollAffordance(rowEl.scrollWidth, rowEl.clientWidth, rowEl.scrollLeft),
    );
  };

  const scrollRight = () => {
    if (!rowEl) return;
    rowEl.scrollLeft = Math.min(
      rowEl.scrollLeft + FILTER_STATUS_SCROLL_STEP_PX,
      rowEl.scrollWidth,
    );
    measure();
  };

  onMount(() => {
    measure();
    window.addEventListener("resize", measure);
    rowEl?.addEventListener("scroll", measure);

    // ResizeObserver sees viewport changes; a MutationObserver catches chip
    // add/remove (which only changes scrollWidth, not the observed box). Both
    // are optional so happy-dom's partial DOM API cannot break the mount.
    const resizeObserver =
      typeof ResizeObserver !== "undefined" && rowEl ? new ResizeObserver(measure) : undefined;
    resizeObserver?.observe(rowEl!);
    const mutationObserver =
      typeof MutationObserver !== "undefined" && rowEl ? new MutationObserver(measure) : undefined;
    mutationObserver?.observe(rowEl!, { childList: true, subtree: true });

    onCleanup(() => {
      window.removeEventListener("resize", measure);
      rowEl?.removeEventListener("scroll", measure);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    });
  });

  createEffect(() => {
    // Reading these tracks the placeholder↔chip swap and any chip-list signal;
    // queue so the measurement runs after Solid commits the new DOM.
    void props.hasFilters;
    void props.children;
    queueMicrotask(measure);
  });

  return (
    <Box className="relative min-w-0 shrink-0">
      <div
        ref={(el) => (rowEl = el)}
        data-testid={props.testId}
        role="region"
        aria-label={FILTER_STATUS_ROW_ARIA_LABEL}
        tabIndex={0}
        class={`flex ${FILTER_STATUS_ROW_HEIGHT_CLASS} min-w-0 shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap outline-none focus-visible:ring-1 focus-visible:ring-fin-primary ${props.className ?? ""}`}
        style={{ "scrollbar-width": "none" }}
      >
        <Show
          when={props.hasFilters}
          fallback={
            <Text
              c="dimmed"
              className="text-[10px] leading-none whitespace-nowrap"
              data-testid={`${props.testId}-${FILTER_STATUS_EMPTY_TESTID_SUFFIX}`}
            >
              {props.placeholder ?? FILTER_STATUS_ROW_PLACEHOLDER}
            </Text>
          }
        >
          <Box className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap">
            {props.children}
          </Box>
          <Show when={props.onClearAll}>
            <Button
              size="xs"
              variant="subtle"
              className="ml-auto shrink-0"
              onClick={() => props.onClearAll?.()}
              data-testid={props.clearAllTestId}
            >
              {props.clearAllLabel ?? FILTER_STATUS_CLEAR_ALL_LABEL}
            </Button>
          </Show>
        </Show>
      </div>
      <Show when={showAffordance()}>
        <Box
          className="pointer-events-none absolute inset-y-0 right-0 flex w-8 items-center justify-end"
          style={{ background: `linear-gradient(to right, ${alpha(SURFACE, 0)}, ${SURFACE})` }}
        >
          <button
            type="button"
            aria-label={FILTER_STATUS_SCROLL_LABEL}
            data-testid={`${props.testId}-${FILTER_STATUS_SCROLL_TESTID_SUFFIX}`}
            // The region already scrolls with the arrow keys when focused; this
            // stays out of the tab order so there is only one tab stop.
            tabIndex={-1}
            className="pointer-events-auto flex h-5 w-5 items-center justify-center rounded-sm text-fin-text hover:text-fin-primary"
            onClick={scrollRight}
          >
            <IconChevronRight size={14} />
          </button>
        </Box>
      </Show>
    </Box>
  );
}
