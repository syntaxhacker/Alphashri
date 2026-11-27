import { For } from "solid-js";
import { Box, Button, Chip, Text } from "@/ui";
import { ScanProgress } from "@/components/patterns/ScanProgress";
import { PatternGridSkeleton } from "@/components/patterns/PatternSkeleton";
import type { PatternsPageModel } from "./usePatternsPage";

export type ResultsPlaceholderModel = Pick<
  PatternsPageModel,
  | "scanActive"
  | "job"
  | "scanning"
  | "universe"
  | "timeframe"
  | "emptyCustom"
  | "activeChips"
  | "setFilter"
  | "resetFilters"
  | "scan"
  | "refresh"
>;

export interface ResultsPlaceholderProps {
  model: ResultsPlaceholderModel;
  loading: boolean;
}

/** Loading and zero-result states for the Scan panel. */
export function ResultsPlaceholder(props: ResultsPlaceholderProps) {
  return (
    <>
      {props.loading ? (
        <Box
          data-testid="patterns-loading"
          className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden"
        >
          {props.model.scanActive() ? (
            <ScanProgress
              job={props.model.job()}
              scanning={props.model.scanning()}
              universe={props.model.universe()}
              timeframe={props.model.timeframe()}
              variant="block"
            />
          ) : (
            <PatternGridSkeleton />
          )}
        </Box>
      ) : props.model.scanActive() ? (
        <Box
          data-testid="patterns-empty"
          className="flex flex-col items-center"
        >
          <ScanProgress
            job={props.model.job()}
            scanning={props.model.scanning()}
            universe={props.model.universe()}
            timeframe={props.model.timeframe()}
            variant="block"
          />
        </Box>
      ) : (
        <Box
          data-testid="patterns-empty"
          className="flex flex-col items-center justify-center gap-2 rounded-fin border border-dashed border-fin-border bg-fin-surface px-2 py-4 text-center"
        >
          <Text size="sm" c="dimmed">
            No patterns match the current filters.
          </Text>
          <Text size="xs" c="dimmed">
            {props.model.emptyCustom()
              ? "Custom scope is empty — paste or add symbols before scanning."
              : `No results yet for ${props.model.universe()} · ${props.model.timeframe()} — run a scan.`}
          </Text>
          {props.model.activeChips().length > 0 ? (
            <Box
              data-testid="patterns-empty-relax"
              className="flex flex-wrap items-center justify-center gap-1"
            >
              <Text size="xs" c="dimmed">
                Relax:
              </Text>
              <For each={props.model.activeChips().slice(0, 3)}>{(chip) => (
                <Chip
                  size="xs"
                  variant="light"
                  onClick={() => props.model.setFilter(chip.key, chip.nextValue)}
                  data-testid={`patterns-empty-relax-${chip.id}`}
                >
                  {`${chip.group}: ${chip.label}`}
                </Chip>
              )}</For>
              <Button
                size="xs"
                variant="subtle"
                onClick={props.model.resetFilters}
                data-testid="patterns-empty-reset"
              >
                Clear all
              </Button>
            </Box>
          ) : null}
          <Box className="flex flex-wrap items-center justify-center gap-2">
            <Button
              size="xs"
              variant="filled"
              onClick={props.model.scan}
              disabled={props.model.scanning() || props.model.emptyCustom()}
              data-testid="patterns-empty-scan"
            >
              Scan {props.model.timeframe()} now
            </Button>
            <Button size="xs" variant="outline" onClick={props.model.refresh}>
              Refresh
            </Button>
          </Box>
        </Box>
      )}
    </>
  );
}
