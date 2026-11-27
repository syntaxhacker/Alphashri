import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Box, Button, Modal, Text, ToolbarRow } from "@/ui";
import * as palette from "@/ui/palette";
import { PatternFilterRail } from "@/components/patterns/PatternFilterRail";
import type { PatternsPageModel } from "./usePatternsPage";

/**
 * The panel rail needs 896px of container width for three legible columns.
 * `xl` (576px) starved the last column, so size the dialog from that minimum
 * plus its chrome; 94vw keeps the single-column layout usable on a 390px phone.
 * Keep in sync with `FILTER_RAIL_THREE_COL_MIN_PX`.
 */
export const FILTER_MODAL_MAX_WIDTH_PX = 1180;
export const FILTER_MODAL_CONTENT_INSET_PX = 24;
export const FILTER_MODAL_MAX_WIDTH = `min(94vw, ${FILTER_MODAL_MAX_WIDTH_PX}px)`;
/** The default Modal overlay is transparent; without this wash the clipped
 *  page rail behind a phone-width dialog paints glyph slivers beside the panel. */
export const FILTER_MODAL_OVERLAY_COLOR = palette.alpha(palette.BG, 0.78);
/** Palette-derived wash for glyphs cut by the scrollport's top edge mid-scroll. */
export const FILTER_MODAL_EDGE_FADE_CLASS =
  "pointer-events-none absolute inset-x-0 top-0 h-3 bg-gradient-to-b from-fin-surface to-transparent";
const SCROLL_STEP_PX = 80;

export type FilterModalModel = Pick<
  PatternsPageModel,
  | "filtersOpen"
  | "setFiltersOpen"
  | "draftDirty"
  | "patterns"
  | "filteredLatest"
  | "displaySummary"
  | "draftFilters"
  | "setDraftFilter"
  | "resetDraft"
  | "applyDraftPreset"
  | "patternImages"
  | "scanReplay"
  | "draftChipCount"
  | "cancelDraft"
  | "applyDraft"
>;

/** Draft filter rail modal and its staged-change footer. */
export function FilterModal(props: { model: FilterModalModel }) {
  const m = props.model;
  const [hasOverflow, setHasOverflow] = createSignal(false);
  const [moreBelow, setMoreBelow] = createSignal(false);
  const [scrolled, setScrolled] = createSignal(false);
  let scrollEl: HTMLDivElement | undefined;
  let contentEl: HTMLDivElement | undefined;

  const syncCue = () => {
    if (!scrollEl) return;
    const overflow = scrollEl.scrollHeight - scrollEl.clientHeight;
    setHasOverflow(overflow > 1);
    setMoreBelow(overflow - scrollEl.scrollTop > 1);
    setScrolled(scrollEl.scrollTop > 1);
  };

  onMount(() => {
    syncCue();
    if (!scrollEl) return;
    // Advanced can expand and change scrollHeight without resizing the viewport.
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(syncCue);
    observer?.observe(scrollEl);
    if (contentEl) observer?.observe(contentEl);
    scrollEl.addEventListener("scroll", syncCue);
    onCleanup(() => {
      observer?.disconnect();
      scrollEl?.removeEventListener("scroll", syncCue);
    });
  });

  createEffect(() => {
    m.filtersOpen();
    m.draftDirty();
    queueMicrotask(syncCue);
  });

  const onScrollKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const region = event.currentTarget as HTMLElement;
    region.scrollTop += event.key === "ArrowDown" ? SCROLL_STEP_PX : -SCROLL_STEP_PX;
    event.preventDefault();
  };

  return (
    <Modal
      opened={m.filtersOpen()}
      onClose={() => m.setFiltersOpen(false)}
      title={m.draftDirty() ? "Filters · unsaved changes" : "Filters"}
      size={FILTER_MODAL_MAX_WIDTH}
      overlayProps={{ color: FILTER_MODAL_OVERLAY_COLOR }}
      data-testid="patterns-filter-modal"
    >
      <div className="relative">
        <Box
          ref={(el: HTMLDivElement) => (scrollEl = el)}
          data-testid="patterns-filter-modal-scroll"
          data-scroll="vertical"
          role="region"
          aria-label="Filter controls, scroll for more"
          tabIndex={0}
          onScroll={syncCue}
          onKeyDown={onScrollKeyDown}
          className="max-h-[78vh] min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-width:thin] px-2 pt-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-fin-primary"
          style={{ "padding-bottom": hasOverflow() ? "20px" : "8px" }}
        >
          <div ref={(el: HTMLDivElement) => (contentEl = el)} className="min-w-0">
            <PatternFilterRail
              layout="panel"
              patterns={m.patterns()}
              results={m.filteredLatest()}
              summary={m.displaySummary()}
              filters={m.draftFilters()}
              setFilter={m.setDraftFilter}
              resetFilters={m.resetDraft}
              applyFilters={m.applyDraftPreset}
              images={m.patternImages()}
              onReplayScan={m.scanReplay}
            />
          </div>
        </Box>
        <div
          data-testid="patterns-filter-modal-top-fade"
          data-scroll-edge="top"
          aria-hidden="true"
          className={scrolled() ? FILTER_MODAL_EDGE_FADE_CLASS : "hidden"}
        />
        <div
          data-testid="patterns-filter-modal-scroll-cue"
          data-scroll-cue="vertical"
          aria-hidden={!moreBelow()}
          className={
            moreBelow()
              ? "pointer-events-none absolute inset-x-0 bottom-0 flex justify-end bg-fin-surface px-1 pt-1 text-ui-micro text-fin-text-muted"
              : "hidden"
          }
        >
          Scroll for more ↓
        </div>
      </div>
      <ToolbarRow
        justify="space-between"
        gap={8}
        style={{ "padding-top": "12px", "border-top": "1px solid", "border-color": "var(--color-fin-border)" }}
      >
        <Button
          size="sm"
          variant="outline"
          onClick={m.resetDraft}
          data-testid="patterns-reset"
        >
          Reset all
        </Button>
        <ToolbarRow gap={8}>
          <Text size="xs" c="dimmed" data-testid="patterns-filters-hint">
            {m.draftDirty()
              ? `${m.draftChipCount()} filter${m.draftChipCount() === 1 ? "" : "s"} staged · ⌘/Ctrl+Enter`
              : `${m.filteredLatest().length} result${m.filteredLatest().length === 1 ? "" : "s"} shown`}
          </Text>
          <Button
            size="sm"
            variant="outline"
            onClick={m.cancelDraft}
            data-testid="patterns-filters-cancel"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant="filled"
            onClick={m.applyDraft}
            data-testid="patterns-filters-done"
          >
            {m.draftDirty() ? "Apply filters" : "Done"}
          </Button>
        </ToolbarRow>
      </ToolbarRow>
    </Modal>
  );
}
