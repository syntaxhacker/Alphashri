import type { Meta, StoryObj } from "@storybook/html-vite";
import { For, Show } from "solid-js";
import { BORDER, CHART_CURRENT, SURFACE, TEXT_MUTED } from "@/ui/palette";
import { rankColor } from "@/components/sector/history/visuals/chartPalette";
import { SVG_TEXT, monthIndex, monthName, yearOf } from "@/components/sector/history/visuals/shared";
import { MatrixFrame, type MatrixRowRail } from "@/components/sector/history/visuals/matrices/MatrixFrame";
import { pickTextColor } from "@/utils/contrast";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack } from "../app/StoryFrame";
import { CHART_HEIGHT } from "./ChartStage";
import { MATRIX_MONTHS, MATRIX_SECTORS } from "./market.fixtures";

type MatrixArgs = { state: "data" | "empty" };

const WIDTH = 760;
const LABEL_W = 96;
const HEADER_H = 30;
const ROW_H = 24;
const CELL_W = (WIDTH - LABEL_W) / MATRIX_MONTHS.length;
const HEIGHT = HEADER_H + MATRIX_SECTORS.length * ROW_H;
const ROW_RAIL: MatrixRowRail = {
  rows: MATRIX_SECTORS.map((sector) => ({ label: sector.label, title: sector.label })),
  labelWidth: LABEL_W,
  headerHeight: HEADER_H,
  rowHeight: ROW_H,
};

const meta: Meta<MatrixArgs> = {
  title: "App/Components/MatrixFrame",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The labelled SVG shell shared by the sector-history visuals from " +
          "src/components/sector/history/visuals/matrices/MatrixFrame.tsx. It owns the title/desc " +
          "ids, the surface, an optional empty message and a sticky row rail. This specimen fills " +
          "it with the same rank grid SectorRankHeatmap renders: sectors down, months across, " +
          "1 = strongest, with the latest month outlined.",
      },
    },
  },
  args: { state: "data" },
  argTypes: {
    state: {
      control: "inline-radio",
      options: ["data", "empty"],
      description: "Filled sector-rank grid or the no-history fallback.",
    },
  },
};
export default meta;
type Story = StoryObj<MatrixArgs>;

const matrixStory = (args: MatrixArgs) =>
  solidStory(() => (
    <DemoStack width={1024}>
      <DemoPanel
        title="Sector history matrix · rank by month"
        detail="frozen monthly sector ranks · 2026-01 → 2026-11"
        meta="1 = strongest · dashed outline = latest month"
        testId="story-matrix-frame-panel"
      >
        <div style={{ height: `${CHART_HEIGHT}px`, "max-width": "100%", overflow: "auto" }}>
          <MatrixFrame
            testId="story-sector-rank-matrix"
            title="Sector rank heatmap, 8 sectors across 11 months. Rank 1 is strongest."
            desc="Rows are sectors and columns are months. Green-yellow marks a high rank and dark blue a low rank. The dashed cyan outline marks the latest month."
            width={WIDTH}
            height={HEIGHT}
            rowRail={ROW_RAIL}
            empty={
              <text
                x={WIDTH / 2}
                y={HEIGHT / 2}
                font-size={SVG_TEXT}
                fill={TEXT_MUTED}
                text-anchor="middle"
                dominant-baseline="central"
              >
                No sector history
              </text>
            }
          >
            <Show when={args.state === "data"}>
              <g>
                <For each={MATRIX_MONTHS}>
                  {(month, col) => (
                    <Show when={col() === 0 || monthIndex(month) === 0}>
                      <text
                        x={LABEL_W + col() * CELL_W + 2}
                        y={12}
                        font-size={SVG_TEXT}
                        font-weight={700}
                        fill={TEXT_MUTED}
                      >
                        {yearOf(month)}
                      </text>
                    </Show>
                  )}
                </For>
                <For each={MATRIX_MONTHS}>
                  {(month, col) => (
                    <text
                      x={LABEL_W + col() * CELL_W + CELL_W / 2}
                      y={HEADER_H - 5}
                      font-size={SVG_TEXT}
                      fill={TEXT_MUTED}
                      text-anchor="middle"
                    >
                      {monthName(monthIndex(month))}
                    </text>
                  )}
                </For>
                <For each={MATRIX_SECTORS}>
                  {(sector, row) => (
                    <For each={MATRIX_MONTHS}>
                      {(month, col) => {
                        const rank = sector.ranks[col()] ?? null;
                        const fill = rank === null ? SURFACE : rankColor(rank, MATRIX_SECTORS.length);
                        const ink = pickTextColor(fill);
                        return (
                          <g>
                            <rect
                              data-cell={`rank-${row()}-${col()}`}
                              x={LABEL_W + col() * CELL_W}
                              y={HEADER_H + row() * ROW_H}
                              width={CELL_W}
                              height={ROW_H}
                              fill={fill}
                              stroke={BORDER}
                              stroke-width={0.5}
                              shape-rendering="crispEdges"
                              role="img"
                              tabindex={0}
                              aria-label={`${sector.label}, ${month}, rank ${rank ?? "unavailable"}`}
                            />
                            <text
                              x={LABEL_W + col() * CELL_W + CELL_W / 2}
                              y={HEADER_H + row() * ROW_H + ROW_H / 2}
                              font-size={SVG_TEXT}
                              font-weight={rank !== null && rank <= 3 ? 700 : 500}
                              fill={ink}
                              text-anchor="middle"
                              dominant-baseline="central"
                              pointer-events="none"
                            >
                              {rank ?? "–"}
                            </text>
                          </g>
                        );
                      }}
                    </For>
                  )}
                </For>
                <rect
                  data-latest-column="true"
                  x={LABEL_W + (MATRIX_MONTHS.length - 1) * CELL_W + 0.5}
                  y={HEADER_H}
                  width={CELL_W - 1}
                  height={MATRIX_SECTORS.length * ROW_H}
                  fill="none"
                  stroke={CHART_CURRENT}
                  stroke-width={1.5}
                  stroke-dasharray="2 2"
                  pointer-events="none"
                  aria-hidden="true"
                />
              </g>
            </Show>
          </MatrixFrame>
        </div>
      </DemoPanel>
    </DemoStack>
  ));

export const Playground: Story = {
  render: (args) => matrixStory(args),
};

export const SectorRankGrid: Story = {
  render: (args) => matrixStory({ ...args, state: "data" }),
};

/** MatrixFrame paints its `empty` node only when no children are supplied. */
export const Empty: Story = {
  render: (args) => matrixStory({ ...args, state: "empty" }),
};
