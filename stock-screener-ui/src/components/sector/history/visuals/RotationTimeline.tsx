import { For, Show, createMemo, createUniqueId } from "solid-js";
import { BORDER, TEXT_MUTED } from "@/ui/palette";
import type { SectorHistorySeries } from "../../../../types/sectorHistory";
import { SVG_TEXT, finite, monthIndex, monthName, seriesAccent, truncate, yearOf } from "./shared";

const W = 640;
const LEFT = 36;
const RIGHT = 132;
const TOP = 28;
const LEGEND_H = 30;
const LABEL_GAP = 16;
const DOT_R = 2.6;

export interface RotationTimelineProps {
  months: string[];
  series: SectorHistorySeries[];
  topN?: number;
}

interface Segment {
  key: string;
  d: string;
  highlighted: boolean;
  accent: string;
}

interface Dot {
  key: string;
  cx: number;
  cy: number;
  label: string;
  accent: string;
}

interface Trajectory {
  key: string;
  index: number;
  name: string;
  segments: Segment[];
  dots: Dot[];
}

interface LeaderLabel {
  key: string;
  name: string;
  color: string;
  labelY: number;
  itemX: number;
}

export function RotationTimeline(props: RotationTimelineProps) {
  const titleId = `history-rotation-timeline-title-${createUniqueId()}`;
  const descId = `history-rotation-timeline-desc-${createUniqueId()}`;

  const model = createMemo(() => {
    const months = props.months;
    const sectors = props.series.filter((item) => !item.is_benchmark);
    const ranks = sectors.flatMap((sector) => sector.ranks).filter(finite);
    const maxRank = Math.max(1, sectors.length, ...ranks);
    const nTop = Math.max(1, Math.min(Math.round(props.topN ?? 3), Math.max(1, sectors.length)));
    const hasData = months.length >= 2 && sectors.length > 0 && ranks.length > 0;
    const showMonths = hasData && months.length <= 14;
    const bottom = showMonths ? 44 : 30;
    const innerH = Math.max(72, maxRank * 22);
    const innerW = W - LEFT - RIGHT;
    const height = hasData ? TOP + innerH + bottom + LEGEND_H : 112;

    const x = (index: number) =>
      months.length > 1 ? LEFT + (index / (months.length - 1)) * innerW : LEFT + innerW / 2;
    const y = (rank: number) =>
      maxRank > 1
        ? TOP + ((Math.max(1, Math.min(maxRank, rank)) - 1) / (maxRank - 1)) * innerH
        : TOP + innerH / 2;

    const trajectories: Trajectory[] = sectors.map((sector, sectorIndex) => {
      const accent = seriesAccent(sectorIndex);
      const segments: Segment[] = [];
      for (let offset = 0; offset < months.length - 1; offset++) {
        const from = sector.ranks[offset];
        const to = sector.ranks[offset + 1];
        if (!finite(from) || !finite(to)) continue;
        const highlighted = from <= nTop || to <= nTop;
        segments.push({
          key: `${sector.name}-${offset}`,
          d: `M${x(offset).toFixed(1)} ${y(from).toFixed(1)} L${x(offset + 1).toFixed(1)} ${y(to).toFixed(1)}`,
          highlighted,
          accent,
        });
      }
      const dots: Dot[] = [];
      months.forEach((month, index) => {
        const rank = sector.ranks[index];
        if (!finite(rank) || rank > nTop) return;
        dots.push({
          key: `${sector.name}-dot-${month}`,
          cx: x(index),
          cy: y(rank),
          label: `${month} · ${sector.name} · rank ${Math.round(rank)}`,
          accent,
        });
      });
      return {
        key: `${sector.name}-${sectorIndex}`,
        index: sectorIndex,
        name: sector.name,
        segments,
        dots,
      };
    });

    const lastRanks = sectors
      .map((sector, sectorIndex) => {
        const limit = Math.min(months.length, sector.ranks.length);
        for (let i = limit - 1; i >= 0; i--) {
          const rank = sector.ranks[i];
          if (finite(rank)) return { sector, rank, color: seriesAccent(sectorIndex) };
        }
        return null;
      })
      .filter(
        (item): item is { sector: SectorHistorySeries; rank: number; color: string } =>
          item !== null,
      )
      .sort((a, b) => a.rank - b.rank)
      .slice(0, nTop);

    let previousLabelY = -Infinity;
    const stacked = lastRanks
      .map((item) => {
        const proposed = y(item.rank);
        const labelY = Math.max(proposed, previousLabelY + LABEL_GAP);
        previousLabelY = labelY;
        return { ...item, labelY };
      })
      .sort((a, b) => a.labelY - b.labelY);

    let legendX = LEFT;
    const leaderLabels: LeaderLabel[] = stacked.map((item) => {
      const name = truncate(item.sector.name, 16);
      const itemX = legendX;
      legendX += truncate(item.sector.name, 14).length * 6.5 + 22;
      return {
        key: `leader-${item.sector.name}`,
        name,
        color: item.color,
        labelY: item.labelY,
        itemX,
      };
    });

    const yearMarks = months.reduce<Array<{ index: number; year: string }>>(
      (marks, month, index) => {
        const year = yearOf(month);
        if (index === 0 || year !== yearOf(months[index - 1])) marks.push({ index, year });
        return marks;
      },
      [],
    );

    return {
      hasData,
      showMonths,
      maxRank,
      nTop,
      innerH,
      innerW,
      height,
      x,
      y,
      trajectories,
      leaderLabels,
      yearMarks,
    };
  });

  return (
    <svg
      data-testid="history-rotation-timeline"
      width="100%"
      viewBox={`0 0 ${W} ${model().height}`}
      preserveAspectRatio="xMinYMin meet"
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
      style={{ display: "block" }}
    >
      <title id={titleId}>
        Sector leadership rank timeline. Rank 1 is the strongest sector, not a return series.
      </title>
      <desc id={descId}>
        Bump chart of sector leadership rank by month. Rank 1 sits at the top and the weakest rank
        sits at the bottom. Thin grey lines are all sectors; thick coloured segments mark months
        where a sector is in the top {model().nTop}. Coloured labels at the right edge name the
        current leaders.
      </desc>

      <Show
        when={model().hasData}
        fallback={
          <text
            data-testid="history-rotation-timeline-empty"
            x={W / 2}
            y={model().height / 2}
            font-size={SVG_TEXT}
            fill={TEXT_MUTED}
            text-anchor="middle"
            dominant-baseline="central"
          >
            No rotation history
          </text>
        }
      >
        <g>
          <text x={LEFT} y={15} font-size={SVG_TEXT} fill={TEXT_MUTED}>
            {`LEADERSHIP RANK · 1 = STRONGEST · TOP ${model().nTop} HIGHLIGHTED`}
          </text>

          <For each={Array.from({ length: model().maxRank }, (_, index) => index + 1)}>
            {(rank) => (
              <g>
                <line
                  x1={LEFT}
                  x2={LEFT + model().innerW}
                  y1={model().y(rank)}
                  y2={model().y(rank)}
                  stroke={BORDER}
                  stroke-opacity={0.45}
                  stroke-width={0.5}
                  vector-effect="non-scaling-stroke"
                />
                <text
                  x={LEFT - 6}
                  y={model().y(rank)}
                  font-size={SVG_TEXT}
                  fill={TEXT_MUTED}
                  text-anchor="end"
                  dominant-baseline="central"
                >
                  {rank}
                </text>
              </g>
            )}
          </For>

          <For each={model().yearMarks.filter((mark) => mark.index > 0)}>
            {(mark) => (
              <g>
                <line
                  x1={model().x(mark.index)}
                  x2={model().x(mark.index)}
                  y1={TOP}
                  y2={TOP + model().innerH}
                  stroke={BORDER}
                  stroke-opacity={0.4}
                  stroke-width={0.5}
                  vector-effect="non-scaling-stroke"
                />
                <text
                  x={model().x(mark.index)}
                  y={TOP + model().innerH + 18}
                  font-size={SVG_TEXT}
                  fill={TEXT_MUTED}
                  text-anchor="middle"
                >
                  {mark.year}
                </text>
              </g>
            )}
          </For>

          <For each={model().yearMarks.filter((mark) => mark.index === 0 && mark.year)}>
            {(mark) => (
              <text
                x={model().x(mark.index)}
                y={TOP + model().innerH + 18}
                font-size={SVG_TEXT}
                fill={TEXT_MUTED}
                text-anchor="start"
              >
                {mark.year}
              </text>
            )}
          </For>

          <Show when={model().showMonths}>
            <For each={props.months}>
              {(month, index) => (
                <text
                  x={model().x(index())}
                  y={TOP + model().innerH + 34}
                  font-size={SVG_TEXT}
                  fill={TEXT_MUTED}
                  text-anchor="middle"
                >
                  {monthName(monthIndex(month))}
                </text>
              )}
            </For>
          </Show>

          <For each={model().trajectories}>
            {(trajectory) => (
              <g>
                <For each={trajectory.segments}>
                  {(segment) => (
                    <path
                      d={segment.d}
                      fill="none"
                      stroke={segment.highlighted ? segment.accent : TEXT_MUTED}
                      stroke-opacity={segment.highlighted ? 0.95 : 0.26}
                      stroke-width={segment.highlighted ? 2.2 : 1}
                      stroke-linecap="round"
                      vector-effect="non-scaling-stroke"
                      data-trajectory={trajectory.index}
                      data-highlight={segment.highlighted ? "true" : "false"}
                    />
                  )}
                </For>

                <For each={trajectory.dots}>
                  {(dot) => (
                    <circle
                      cx={dot.cx}
                      cy={dot.cy}
                      r={DOT_R}
                      fill={dot.accent}
                      aria-label={dot.label}
                    >
                      <title>{dot.label}</title>
                    </circle>
                  )}
                </For>
              </g>
            )}
          </For>

          <For each={model().leaderLabels}>
            {(leader) => (
              <text
                x={LEFT + model().innerW + 8}
                y={leader.labelY}
                font-size={SVG_TEXT}
                fill={leader.color}
                dominant-baseline="central"
              >
                {leader.name}
              </text>
            )}
          </For>

          <For each={model().leaderLabels}>
            {(leader) => (
              <g>
                <rect
                  x={leader.itemX}
                  y={model().height - 22}
                  width={8}
                  height={8}
                  fill={leader.color}
                />
                <text
                  x={leader.itemX + 11}
                  y={model().height - 14}
                  font-size={SVG_TEXT}
                  fill={TEXT_MUTED}
                >
                  {truncate(leader.name, 14)}
                </text>
              </g>
            )}
          </For>
        </g>
      </Show>
    </svg>
  );
}
