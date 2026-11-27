import type { JSX } from "solid-js";
import { Alert, Box } from "@/ui";
import { AppliedFilters } from "@/components/patterns/AppliedFilters";
import { ScanProgress } from "@/components/patterns/ScanProgress";
import type { PatternsPageModel } from "./usePatternsPage";
import { ResultsPlaceholder, type ResultsPlaceholderModel } from "./ResultsPlaceholder";

export type ResultsSurfaceModel = ResultsPlaceholderModel &
  Pick<
    PatternsPageModel,
    | "patterns"
    | "error"
    | "matrixError"
    | "view"
    | "matrixLoading"
    | "loading"
    | "hasRows"
    | "filteredLatest"
    | "filters"
    | "setFilter"
    | "resetFilters"
  >;

export interface ResultsSurfaceProps {
  model: ResultsSurfaceModel;
  results: JSX.Element;
}

/** Banners + applied-filter row above the result grid or its placeholder. */
export function ResultsSurface(props: ResultsSurfaceProps) {
  const m = props.model;
  return (
    <Box className="flex flex-1 min-h-0 h-0 min-w-0 flex-col gap-2 overflow-hidden">
      <AppliedFilters
        filters={m.filters()}
        patterns={m.patterns()}
        setFilter={m.setFilter}
        resetFilters={m.resetFilters}
      />

      {m.scanActive() && m.filteredLatest().length > 0 ? (
        <ScanProgress
          job={m.job()}
          scanning={m.scanning()}
          universe={m.universe()}
          timeframe={m.timeframe()}
          variant="banner"
        />
      ) : null}

      {m.error() ? (
        <Alert color="error" data-testid="patterns-error">
          {m.error()}
        </Alert>
      ) : null}

      {m.view() === "matrix" && m.matrixError() ? (
        <Alert color="error" data-testid="patterns-matrix-error">
          {m.matrixError()}
        </Alert>
      ) : null}

      {(m.view() === "matrix" ? m.matrixLoading() : m.loading()) && !m.hasRows() ? (
        <ResultsPlaceholder model={m as ResultsPlaceholderModel} loading />
      ) : !m.hasRows() ? (
        <ResultsPlaceholder model={m as ResultsPlaceholderModel} loading={false} />
      ) : (
        props.results
      )}
    </Box>
  );
}
