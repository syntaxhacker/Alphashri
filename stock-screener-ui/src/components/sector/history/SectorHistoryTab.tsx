import { Show, createMemo, createSignal } from "solid-js";
import { Box } from "@/ui";
import type {
  SectorHistoryMarket,
  SectorHistoryRisk,
  SectorHistorySeasonality,
} from "../../../types/sectorHistory";
import { useSectorHistory } from "./useSectorHistory";
import { HistoryHeader, type HistoryView } from "./HistoryHeader";
import { HistoryEmptyState, HistoryErrorState, HistoryLoadingState } from "./HistoryStates";
import { HistoryOverview } from "./HistoryOverview";
import { HistoryLab } from "./HistoryLab";

const HISTORY_YEARS = [3, 5, 10] as const;

function readHistoryYears(): number {
  if (typeof window === "undefined") return 5;
  const value = Number(new URLSearchParams(window.location.search).get("hyears"));
  return (HISTORY_YEARS as readonly number[]).includes(value) ? value : 5;
}

function readHistoryView(): HistoryView {
  if (typeof window === "undefined") return "overview";
  return new URLSearchParams(window.location.search).get("hview") === "lab" ? "lab" : "overview";
}

/** Keep history state in the query string without disturbing `tab` or any other param. */
function writeHistoryParams(patch: { years?: number; view?: HistoryView }): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (patch.years !== undefined) {
    if (patch.years === 5) url.searchParams.delete("hyears");
    else url.searchParams.set("hyears", String(patch.years));
  }
  if (patch.view !== undefined) {
    if (patch.view === "overview") url.searchParams.delete("hview");
    else url.searchParams.set("hview", patch.view);
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export function SectorHistoryTab(props: { market: SectorHistoryMarket }) {
  const [years, setYears] = createSignal(readHistoryYears());
  const [view, setView] = createSignal<HistoryView>(readHistoryView());

  const { data, loading, error, transitionN, refresh } = useSectorHistory(
    () => props.market,
    years,
  );

  const series = createMemo(() => (Array.isArray(data()?.series) ? data()!.series : []));
  const months = createMemo(() => (Array.isArray(data()?.months) ? data()!.months : []));
  const universe = createMemo(() => (Array.isArray(data()?.universe) ? data()!.universe : []));
  const risk = createMemo<SectorHistoryRisk[]>(() =>
    Array.isArray(data()?.risk) ? data()!.risk : [],
  );
  const seasonality = createMemo<SectorHistorySeasonality[]>(() =>
    Array.isArray(data()?.seasonality) ? data()!.seasonality : [],
  );
  const transitionMatrix = createMemo<(number | null)[][]>(() =>
    Array.isArray(data()?.persistence?.transition_matrix)
      ? data()!.persistence.transition_matrix
      : [],
  );

  // The shell only needs a drawable rank history; optional sections empty per panel.
  const hasCoreData = createMemo(
    () => series().length > 0 && months().length > 0 && universe().length > 0,
  );

  // The rank history must reopen on the newest month whenever the query or the
  // payload changes, even when two markets happen to share a month count.
  const rankResetKey = createMemo(
    () => `${props.market}:${years()}:${months().length}:${months().at(-1) ?? ""}`,
  );

  const asOf = createMemo(() => {
    const value = data()?.as_of;
    return typeof value === "string" ? value : "";
  });

  const cached = createMemo(() => {
    const value = data()?.cached;
    return typeof value === "boolean" ? value : null;
  });

  const disclaimer = createMemo(() => {
    const response = data();
    const source =
      typeof response?.source === "string" && response.source
        ? `Source: ${response.source} · `
        : "";
    const note = typeof response?.disclaimer === "string" ? response.disclaimer : "";
    return `${source}${note}`;
  });

  const onYearsChange = (next: number) => {
    setYears(next);
    writeHistoryParams({ years: next });
  };

  const onViewChange = (next: HistoryView) => {
    setView(next);
    writeHistoryParams({ view: next });
  };

  return (
    <Box
      data-testid="sector-history-tab"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-fin-bg"
    >
      <HistoryHeader
        market={props.market}
        years={years()}
        view={view()}
        loading={loading() && hasCoreData()}
        asOf={asOf()}
        cached={cached()}
        onYearsChange={onYearsChange}
        onViewChange={onViewChange}
        onRefresh={refresh}
      />

      <Show
        when={error()}
        fallback={
          <Show
            when={hasCoreData()}
            fallback={
              <Show
                when={loading()}
                fallback={
                  <HistoryEmptyState market={props.market} years={years()} onRefresh={refresh} />
                }
              >
                <HistoryLoadingState />
              </Show>
            }
          >
            <Show
              when={view() === "lab"}
              fallback={
                <HistoryOverview
                  months={months()}
                  series={series()}
                  universe={universe()}
                  seasonality={seasonality()}
                  transitionMatrix={transitionMatrix()}
                  transitionN={transitionN()}
                  risk={risk()}
                  disclaimer={disclaimer()}
                  rankResetKey={rankResetKey()}
                />
              }
            >
              <HistoryLab
                market={props.market}
                years={years()}
                months={months()}
                series={series()}
                universe={universe()}
                seasonality={seasonality()}
                transitionN={transitionN()}
              />
            </Show>
          </Show>
        }
      >
        <HistoryErrorState error={error()!} onRetry={refresh} />
      </Show>
    </Box>
  );
}
