// @vitest-environment happy-dom
/**
 * Layout regression: the analytics page is a `flex` column chain from the body
 * down to each chart frame. When that chain broke, all 14 charts rendered at
 * their 150px min height and the page left ~400px of dead space below the 2x2
 * grid. These assertions are cheap (classes + painted option) but they pin the
 * exact properties that broke: flex stretch, grid row fill, frame min height
 * and legend placement.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";

const chartStub = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({ init: vi.fn(() => chartStub) })),
}));

import { VolatilityPillar } from "./VolatilityPillar";
import { PositioningPillar } from "./PositioningPillar";
import { DealerPillar } from "./DealerPillar";
import { LiquidityPillar } from "./LiquidityPillar";
import { fullFixture } from "./fixtures";
import type { OptionsDashboardData } from "@/types/optionsDashboard";

const PILLARS = [
  { name: "volatility", component: VolatilityPillar, grid: "volatility-chart-grid", frames: 4, rows: "sm:grid-rows-2" },
  { name: "positioning", component: PositioningPillar, grid: "positioning-chart-grid", frames: 4, rows: "sm:grid-rows-2" },
  { name: "dealer", component: DealerPillar, grid: "dealer-chart-grid", frames: 4, rows: "sm:grid-rows-2" },
  { name: "liquidity", component: LiquidityPillar, grid: "liquidity-chart-grid", frames: 2, rows: "sm:grid-rows-1" },
] as const;

function renderPillar(component: typeof VolatilityPillar, data: OptionsDashboardData) {
  return render(() => (
    <UIProvider>
      <div class="flex h-[900px] flex-col">
        {component({ data, selectedExpiry: "2026-11-26", onExpiry: () => {} })}
      </div>
    </UIProvider>
  ));
}

const paintedOptions = () => chartStub.setOption.mock.calls.map((call) => call[0] as any);

afterEach(() => {
  cleanup();
  chartStub.setOption.mockClear();
  chartStub.dispose.mockClear();
});

describe("analytics pillar layout", () => {
  for (const pillar of PILLARS) {
    test(`${pillar.name}: the grid rows fill the body and every frame stretches`, () => {
      renderPillar(pillar.component, fullFixture());

      const grid = screen.getByTestId(pillar.grid);
      expect(grid).toHaveClass("grid");
      expect(grid).toHaveClass("sm:flex-1");
      expect(grid).toHaveClass("sm:auto-rows-fr");
      expect(grid).toHaveClass("sm:grid-cols-2");
      expect(grid).toHaveClass(pillar.rows);
      expect(grid).toHaveClass("min-h-0");
      expect(grid).toHaveClass("sm:overflow-y-auto");
      // Mobile rows must never shrink below the frame's own min height.
      expect(grid).toHaveClass("auto-rows-[minmax(200px,auto)]");

      const frames = Array.from(grid.children) as HTMLElement[];
      expect(frames).toHaveLength(pillar.frames);
      for (const frame of frames) {
        expect(frame).toHaveClass("h-full");
        expect(frame).toHaveClass("min-h-[200px]");
        expect(frame).not.toHaveClass("min-h-[150px]");
      }
    });

    test(`${pillar.name}: chart ink is 10px+ and no legend sits on the x-axis name`, async () => {
      renderPillar(pillar.component, fullFixture());
      await waitFor(() => expect(chartStub.setOption).toHaveBeenCalledTimes(pillar.frames));

      for (const option of paintedOptions()) {
        expect(option.grid.top).toBeGreaterThanOrEqual(54);
        expect(option.grid.containLabel).toBe(true);
        for (const axisOption of [option.xAxis, option.yAxis].filter(Boolean)) {
          expect(axisOption.axisLabel.fontSize).toBeGreaterThanOrEqual(10);
          expect(axisOption.nameTextStyle.fontSize).toBeGreaterThanOrEqual(10);
        }
        if (option.legend) {
          expect(option.legend.top).toBe(0);
          expect(option.legend.right).toBe(8);
          expect(option.legend.bottom).toBeUndefined();
          expect(option.legend.textStyle.fontSize).toBeGreaterThanOrEqual(10);
        }
        // The y unit is DOM text in the frame; the canvas axis stays unnamed so
        // it can never print over the tick column.
        expect(option.yAxis.name).toBe("");
        // A strike ladder is never anchored at zero (the smile uses `scale`).
        if (option.xAxis.name === "Strike" && option.xAxis.type === "value" && !option.xAxis.scale) {
          expect(option.xAxis.min).toBeGreaterThan(0);
          expect(option.xAxis.max).toBeGreaterThan(option.xAxis.min);
        }
      }
    });
  }

  test("the four pillars draw 14 charts in total", async () => {
    let total = 0;
    for (const pillar of PILLARS) {
      chartStub.setOption.mockClear();
      const { unmount } = renderPillar(pillar.component, fullFixture());
      await waitFor(() => expect(chartStub.setOption).toHaveBeenCalledTimes(pillar.frames));
      total += chartStub.setOption.mock.calls.length;
      unmount();
    }
    expect(total).toBe(14);
  });
});
