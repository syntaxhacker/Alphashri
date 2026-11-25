import { Show } from "solid-js";
import { Box, Text } from "@/ui";
import { useMediaQuery } from "@/ui/hooks";
import type {
  SectorHistoryRisk,
  SectorHistorySeasonality,
  SectorHistorySeries,
} from "../../../types/sectorHistory";
import { HistoryPanel } from "./HistoryLab";
import { HistoryScroller } from "./HistoryScroller";
import { HistoryPanelEmpty } from "./HistoryStates";
import { RiskTable } from "./RiskTable";
import { SectorRankHeatmap, SectorRankSummary } from "./visuals/SectorRankHeatmap";
import { SeasonalityHeatmap } from "./visuals/SeasonalityHeatmap";
import { PersistenceMatrix } from "./visuals/PersistenceMatrix";
import { RotationTimeline } from "./visuals/RotationTimeline";

const RANK_CHART_CLASS = "min-w-0 [&>svg]:h-auto [&>svg]:w-full [&>svg]:min-w-[900px]";
const SEASONALITY_BODY_CLASS = "mx-auto w-full min-w-0 max-w-[760px]";
const PERSISTENCE_BODY_CLASS = "mx-auto w-full min-w-0 max-w-[560px]";
const VISIBLE_MONTHS = 60;

const monthYear = (month: string | undefined): string => month?.slice(0, 4) ?? "";

export interface HistoryOverviewProps {
  months: string[];
  series: SectorHistorySeries[];
  universe: string[];
  seasonality: SectorHistorySeasonality[];
  transitionMatrix: (number | null)[][];
  transitionN: number | undefined;
  risk: SectorHistoryRisk[];
  disclaimer: string;
  /** Changes when the market, lookback or payload changes; re-pins the rank scroller. */
  rankResetKey: string;
}

export function HistoryOverview(props: HistoryOverviewProps) {
  const compact = useMediaQuery("(max-width: 640px)", undefined, { noSsr: true });

  const rankDescription = () => {
    let description = `${props.universe.length} sectors · monthly rank`;
    if (props.months.length > 0) {
      description += ` · ${props.months[0]} → ${props.months[props.months.length - 1]}`;
    }
    if (props.months.length <= VISIBLE_MONTHS) return description;

    const lastYear = monthYear(props.months[props.months.length - 1]);
    if (compact()) return `${description} · shown ${lastYear}`;
    const firstVisibleYear = monthYear(props.months[props.months.length - VISIBLE_MONTHS]);
    return `${description} · shown ${firstVisibleYear} → ${lastYear}`;
  };

  return (
    <Box
      data-testid="sector-history-overview"
      className="flex flex-1 min-h-0 flex-col gap-2 overflow-x-hidden overflow-y-auto p-2"
    >
      <HistoryPanel
        testId="sector-history-rank-panel"
        title="Sector Rank History"
        description={rankDescription()}
      >
        <HistoryScroller
          testId="sector-history-rank-scroll"
          label="Sector rank history by month. Scroll sideways for older months."
          startAtEnd
          resetKey={props.rankResetKey}
        >
          <Box className={RANK_CHART_CLASS}>
            <SectorRankHeatmap months={props.months} series={props.series} showSummary={false} />
          </Box>
        </HistoryScroller>
        <SectorRankSummary months={props.months} series={props.series} />
      </HistoryPanel>

      <Box className="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-2">
        <HistoryPanel
          testId="sector-history-seasonality-panel"
          title="Seasonality"
          description="avg return by calendar month"
        >
          <Show
            when={props.seasonality.length > 0}
            fallback={
              <HistoryPanelEmpty
                testId="sector-history-seasonality-empty"
                message="No seasonality data for this lookback."
              />
            }
          >
            <Box className={SEASONALITY_BODY_CLASS}>
              <SeasonalityHeatmap cells={props.seasonality} names={props.universe} />
            </Box>
          </Show>
        </HistoryPanel>

        <HistoryPanel
          testId="sector-history-persistence-panel"
          title="Persistence"
          description="top-3 rank stickiness"
        >
          <Show
            when={props.transitionMatrix.length > 0}
            fallback={
              <HistoryPanelEmpty
                testId="sector-history-persistence-empty"
                message="No persistence data for this lookback."
              />
            }
          >
            <Box className={PERSISTENCE_BODY_CLASS}>
              <PersistenceMatrix
                names={props.universe}
                matrix={props.transitionMatrix}
                transitionCount={props.transitionN}
              />
            </Box>
          </Show>
        </HistoryPanel>
      </Box>

      <HistoryPanel
        testId="sector-history-rotation-panel"
        title="Rotation Timeline"
        description="rank trajectory over time"
      >
        <RotationTimeline months={props.months} series={props.series} />
      </HistoryPanel>

      <HistoryPanel
        testId="sector-history-risk-panel"
        title="Risk"
        description="drawdown · Sharpe · volatility"
      >
        <Show
          when={props.risk.length > 0}
          fallback={
            <HistoryPanelEmpty
              testId="sector-history-risk-empty"
              message="No risk metrics for this lookback."
            />
          }
        >
          <RiskTable risk={props.risk} series={props.series} />
        </Show>
      </HistoryPanel>

      <Show when={props.disclaimer}>
        <Text
          c="dimmed"
          data-testid="sector-history-disclaimer"
          className="text-ui-micro leading-snug px-1"
        >
          {props.disclaimer}
        </Text>
      </Show>
    </Box>
  );
}
