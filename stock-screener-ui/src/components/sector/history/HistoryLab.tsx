import { createEffect, createMemo, createSignal, type JSX } from "solid-js";
import { Box, Select, Text, ToolbarRow } from "@/ui";
import { CompactPanel } from "../../common/compact";
import type {
  SectorHistoryMarket,
  SectorHistorySeasonality,
  SectorHistorySeries,
} from "../../../types/sectorHistory";
import { monthlyTransitionCount } from "./historyMath";
import { RankTransitionSankey } from "./visuals/RankTransitionSankey";
import { MonthlyMovers } from "./visuals/MonthlyMovers";
import { UnderwaterDrawdown } from "./visuals/UnderwaterDrawdown";
import { SeasonalityRadial } from "./visuals/SeasonalityRadial";
import { RelativeStrength } from "./visuals/RelativeStrength";
import { RelativeStrengthTrail } from "./visuals/RelativeStrengthTrail";

export function HistoryPanel(props: {
  testId: string;
  title: string;
  description: string;
  className?: string;
  children: JSX.Element;
}) {
  return (
    <CompactPanel
      flush
      padded={false}
      testId={props.testId}
      className={`min-w-0 ${props.className ?? ""}`}
    >
      <Box className="border-b border-fin-border px-2 pb-1 pt-2">
        <Text
          fw={700}
          tt="uppercase"
          data-testid="history-panel-title"
          className="text-ui-micro font-mono tracking-[0.08em] text-fin-primary"
        >
          {props.title}
        </Text>
        <Box className="mt-1">
          <Text c="dimmed" data-testid="status" className="text-ui-micro">
            {props.description}
          </Text>
        </Box>
      </Box>
      <Box className="min-w-0 overflow-hidden p-2">{props.children}</Box>
    </CompactPanel>
  );
}

// Latest ranked leader, falling back to the first universe member.
function defaultSector(
  universe: string[],
  series: SectorHistorySeries[],
  months: string[],
): string {
  const latest = months.length - 1;
  if (latest >= 0) {
    let best: { name: string; rank: number } | null = null;
    for (const item of series) {
      if (item.is_benchmark) continue;
      const ranks = Array.isArray(item.ranks) ? item.ranks : [];
      const rank = ranks[latest];
      if (typeof rank !== "number" || !Number.isFinite(rank)) continue;
      if (best == null || rank < best.rank) best = { name: item.name, rank };
    }
    if (best) return best.name;
  }
  return universe[0] ?? "";
}

/** Mirrors SeasonalityRadial's sample label: per-month observations for the selected sector. */
function seasonalitySampleLabel(cells: SectorHistorySeasonality[], sector: string): string {
  const zeroBased =
    cells.some((cell) => cell.month === 0) && !cells.some((cell) => cell.month === 12);
  const byMonth = new Map<number, SectorHistorySeasonality>();
  for (const cell of cells) {
    if (cell.name !== sector) continue;
    const index = zeroBased ? cell.month : cell.month - 1;
    if (index >= 0 && index < 12) byMonth.set(index, cell);
  }
  const counts = [...byMonth.values()]
    .map((cell) => cell.n)
    .filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
    .map((value) => Math.round(value));
  if (counts.length === 0) return "";
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  return min === max ? `n=${min} per month` : `n=${min}–${max} per month`;
}

export function HistoryLab(props: {
  market: SectorHistoryMarket;
  years: number;
  months: string[];
  series: SectorHistorySeries[];
  universe: string[];
  seasonality: SectorHistorySeasonality[];
  transitionN?: number;
}) {
  const [sector, setSector] = createSignal(
    defaultSector(props.universe, props.series, props.months),
  );

  let lastMarket: SectorHistoryMarket | undefined;
  let lastYears: number | undefined;
  let lastMonths: string[] | undefined;
  let lastSeries: SectorHistorySeries[] | undefined;

  createEffect(() => {
    const market = props.market;
    const years = props.years;
    const months = props.months;
    const series = props.series;
    const universe = props.universe;
    const queryChanged = market !== lastMarket || years !== lastYears;
    const dataChanged = months !== lastMonths || series !== lastSeries;
    if (queryChanged || dataChanged) {
      lastMarket = market;
      lastYears = years;
      lastMonths = months;
      lastSeries = series;
      setSector(defaultSector(universe, series, months));
    }
  });

  const options = createMemo(() => props.universe.map((name) => ({ value: name, label: name })));

  const benchmark = createMemo(
    () => props.series.find((item) => item.is_benchmark)?.name ?? "benchmark",
  );

  const seasonalityDescription = createMemo(() => {
    const sample = seasonalitySampleLabel(props.seasonality, sector());
    return sample
      ? `avg return by month · hit rate in tooltip · ${sample}`
      : "avg return by month · hit rate in tooltip";
  });

  const transitionDescription = createMemo(() => {
    const base = "where sectors move by rank band · aggregate band flows";
    const years = `${props.years}Y`;
    if (props.months.length < 2) return `${base} · ${years}`;
    const count =
      typeof props.transitionN === "number" && Number.isFinite(props.transitionN)
        ? props.transitionN
        : monthlyTransitionCount(props.series);
    return `${base} · n=${count} monthly transitions · ${years}`;
  });

  return (
    <Box
      data-testid="sector-history-lab"
      className="flex flex-1 min-h-0 flex-col gap-2 overflow-x-hidden overflow-y-auto p-2"
    >
      <ToolbarRow gap={8} data-testid="sector-history-lab-toolbar" className="shrink-0">
        <Text fw={700} tt="uppercase" className="text-ui-micro text-fin-text-muted">
          Sector
        </Text>
        <Box className="w-[220px] max-w-full min-w-[160px] shrink-0">
          <Select
            size="xs"
            value={sector()}
            onChange={(value) => {
              if (value != null) setSector(value);
            }}
            data={options()}
            className="text-ui-micro"
            aria-label="Rotation lab sector"
            data-testid="sector-history-lab-sector"
          />
        </Box>
      </ToolbarRow>

      <Box className="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-2">
        <HistoryPanel
          testId="sector-history-lab-sankey-panel"
          title="Rank transitions"
          description={transitionDescription()}
        >
          <RankTransitionSankey
            months={props.months}
            series={props.series}
            years={props.years}
            showHeader={false}
          />
        </HistoryPanel>

        <HistoryPanel
          testId="sector-history-lab-movers-panel"
          title="Monthly movers"
          description="rank change over the latest month"
        >
          <MonthlyMovers months={props.months} series={props.series} showHeader={false} />
        </HistoryPanel>

        <HistoryPanel
          testId="sector-history-lab-drawdown-panel"
          title={`Monthly drawdown · ${sector()}`}
          description="monthly closes · risk table uses daily closes"
        >
          <UnderwaterDrawdown
            months={props.months}
            series={props.series}
            sector={sector()}
            showHeader={false}
          />
        </HistoryPanel>

        <HistoryPanel
          testId="sector-history-lab-seasonality-panel"
          title={`Seasonality · ${sector()}`}
          description={seasonalityDescription()}
        >
          <SeasonalityRadial cells={props.seasonality} sector={sector()} showHeader={false} />
        </HistoryPanel>

        <HistoryPanel
          testId="sector-history-lab-rs-panel"
          className="lg:col-span-2"
          title={`Relative strength · ${sector()} vs ${benchmark()}`}
          description="indexed to 100 at first common month · above 100 = outperform · below 100 = lag"
        >
          <RelativeStrength
            months={props.months}
            series={props.series}
            sector={sector()}
            showHeader={false}
          />
        </HistoryPanel>

        <HistoryPanel
          testId="sector-history-lab-trail-panel"
          className="lg:col-span-2"
          title={`RS momentum trail · ${sector()}`}
          description="last 12 months · descriptive, not JdK RRG · RS > 100 = outperform · momentum > 0 = improving"
        >
          <RelativeStrengthTrail
            months={props.months}
            series={props.series}
            sector={sector()}
            showHeader={false}
          />
        </HistoryPanel>
      </Box>
    </Box>
  );
}
