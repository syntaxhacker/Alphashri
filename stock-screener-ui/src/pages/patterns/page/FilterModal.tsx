import { Box, Button, Modal, Text, ToolbarRow } from "@/ui";
import { PatternFilterRail } from "@/components/patterns/PatternFilterRail";
import type { PatternsPageModel } from "./usePatternsPage";

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
  return (
    <Modal
      opened={m.filtersOpen()}
      onClose={() => m.setFiltersOpen(false)}
      title={m.draftDirty() ? "Filters · unsaved changes" : "Filters"}
      size="xl"
      data-testid="patterns-filter-modal"
    >
      <Box className="max-h-[78vh] overflow-y-auto pr-2">
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
      </Box>
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
