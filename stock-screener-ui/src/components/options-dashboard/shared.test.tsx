// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";

const chartStub = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({ init: vi.fn(() => chartStub) })),
}));

import { ChartFrame, ExpiryChips, pillarGridClass } from "./shared";
import { axis, baseOption, CHART_GRID, COMPACT_CHART_GRID, guideSeries, legend, paddedDomain } from "./chartBase";

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches,
      media: "(max-width: 1200px)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function view() {
  return render(() => (
    <UIProvider>
      <ChartFrame
        testId="probe"
        label="probe"
        description="probe"
        option={{ grid: CHART_GRID, series: [] }}
        optionKey="probe"
      />
    </UIProvider>
  ));
}

const painted = () => chartStub.setOption.mock.calls.at(-1)?.[0] as any;

afterEach(() => {
  cleanup();
  chartStub.setOption.mockClear();
  chartStub.dispose.mockClear();
  vi.unstubAllGlobals();
});

describe("ChartFrame grid bands", () => {
  test("keeps a legend band and two mark-label rows above the plot at 390px", async () => {
    mockMatchMedia(true);
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());
    expect(painted().grid).toEqual(COMPACT_CHART_GRID);
    expect(painted().grid.top).toBeGreaterThanOrEqual(54);
    expect(painted().grid.bottom).toBeGreaterThanOrEqual(28);
    expect(painted().grid.containLabel).toBe(true);
  });

  test("keeps the same top band at 1600px so nothing is clipped", async () => {
    mockMatchMedia(false);
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());
    expect(painted().grid).toEqual(CHART_GRID);
    expect(painted().grid.top).toBeGreaterThanOrEqual(54);
    expect(painted().grid.bottom).toBeGreaterThanOrEqual(30);
    expect(painted().grid.containLabel).toBe(true);
  });

  // ECharts grows the plot to `left + tickBand + labelMargin`, so a tick band
  // that fits leaves a gutter equal to `left`; a wider band is clamped to the
  // canvas edge (gutter 0, the 390px max-pain cut). A 10px mono compact tick
  // ("120.0Cr", 7 glyphs) measures 35.7px in ECharts' own layout.
  const TICK_BAND = 35.7;
  const LABEL_MARGIN = 8;

  test("the narrow grid leaves a real left gutter at 390px", async () => {
    mockMatchMedia(true);
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());
    const { left, right } = painted().grid as { left: number; right: number };
    expect(left).toBeGreaterThanOrEqual(4);
    // A 376px frame at 390: 376 - 14 - 35.7 - 8 - 10 = 308 → 82% plot.
    expect((376 - left - TICK_BAND - LABEL_MARGIN - right) / 376).toBeGreaterThanOrEqual(0.7);
  });

  test("the wide grid keeps a gutter without eating the plot", async () => {
    mockMatchMedia(false);
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());
    const { left, right } = painted().grid as { left: number; right: number };
    expect(left).toBeGreaterThanOrEqual(4);
    // The dock's narrowest two-column frame is ~278px: 72% plot.
    expect((278 - left - TICK_BAND - LABEL_MARGIN - right) / 278).toBeGreaterThanOrEqual(0.7);
    // The 1600px page frame (~740px) keeps ~90%.
    expect((740 - left - TICK_BAND - LABEL_MARGIN - right) / 740).toBeGreaterThanOrEqual(0.7);
  });
});

describe("ChartFrame fills its cell", () => {
  test("stretches to the grid row instead of sitting at a 150px strip", () => {
    view();
    const frame = screen.getByTestId("probe-frame");
    expect(frame).toHaveClass("h-full");
    expect(frame).toHaveClass("min-h-[200px]");
    expect(frame).not.toHaveClass("min-h-[150px]");
    expect(frame).not.toHaveClass("flex-1");
  });

  test("the pillar grid gives every row an equal share of the height on desktop", () => {
    for (const cls of ["grid", "sm:flex-1", "sm:auto-rows-fr", "sm:grid-cols-2", "sm:grid-rows-2", "sm:overflow-y-auto"]) {
      expect(pillarGridClass(2).split(" ")).toContain(cls);
    }
    expect(pillarGridClass(2)).not.toContain("sm:grid-rows-1");
  });

  test("mobile rows are minmax(200px, auto) so a frame never overflows its row", () => {
    const mobile = pillarGridClass(2).split(" ");
    // `auto-rows-fr` across four mobile rows computed ~135px rows under a
    // 200px frame — the charts overlapped each other and the metric band.
    expect(mobile).toContain("auto-rows-[minmax(200px,auto)]");
    expect(mobile).not.toContain("auto-rows-fr");
    expect(mobile).not.toContain("flex-1");
    expect(mobile).not.toContain("overflow-y-auto");
  });

  test("a two-chart pillar uses one desktop row, not an empty second one", () => {
    expect(pillarGridClass(1).split(" ")).toContain("sm:grid-rows-1");
    expect(pillarGridClass(1)).not.toContain("sm:grid-rows-2");
  });
});

describe("chart ink and legend placement", () => {
  function legendView() {
    return render(() => (
      <UIProvider>
        <ChartFrame
          testId="legend-probe"
          label="legend probe"
          description="legend probe"
          option={{
            ...baseOption("#ffffff"),
            grid: CHART_GRID,
            legend: legend("#ffffff", ["CE IV", "PE IV"]),
            xAxis: axis("#ffffff", "Strike"),
            yAxis: axis("#ffffff", "IV %"),
            series: [],
          }}
          optionKey="legend-probe"
        />
      </UIProvider>
    ));
  }

  test("legend sits in the top band, right-aligned, never on the x-axis name", async () => {
    mockMatchMedia(false);
    legendView();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());
    const opt = painted();
    expect(opt.legend.top).toBe(0);
    expect(opt.legend.right).toBe(8);
    expect(opt.legend.left).toBeUndefined();
    expect(opt.legend.bottom).toBeUndefined();
    expect(opt.legend.textStyle.fontSize).toBeGreaterThanOrEqual(10);
  });

  test("prints the y-axis unit as DOM text and keeps it off the canvas", async () => {
    mockMatchMedia(false);
    legendView();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());
    const unit = screen.getByTestId("legend-probe-unit");
    expect(unit).toHaveTextContent("IV %");
    expect(unit).toHaveClass("pointer-events-none");
    expect(unit).toHaveClass("absolute");
    // A rotated canvas name overprinted the widest tick label, so the axis goes
    // unnamed and the frame prints the unit instead.
    expect(painted().yAxis.name).toBe("");
  });

  test("axis labels and names are at least 10px", async () => {
    mockMatchMedia(false);
    legendView();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());
    const opt = painted();
    expect(opt.xAxis.axisLabel.fontSize).toBeGreaterThanOrEqual(10);
    expect(opt.xAxis.nameTextStyle.fontSize).toBeGreaterThanOrEqual(10);
    expect(opt.yAxis.axisLabel.fontSize).toBeGreaterThanOrEqual(10);
    expect(opt.textStyle.fontSize).toBeGreaterThanOrEqual(10);
    // A tick that cannot fit is dropped, not overprinted.
    expect(opt.xAxis.axisLabel.hideOverlap).toBe(true);
  });

  test("staggered mark labels keep neighbouring strikes from overprinting", () => {
    const series = guideSeries("#ffffff", [
      { xAxis: 100, name: "CW", color: "#ff0000" },
      { xAxis: 82, name: "MP", color: "#0000ff" },
      { xAxis: 84, name: "SPOT", color: "#00ff00" },
    ]) as any;
    const labels = series.markLine.data.map((mark: any) => mark.label);
    // `end` is the only position that keeps a vertical line's label horizontal.
    expect(labels[0].position).toBe("end");
    // Rows are assigned after sorting by strike, so each label gets its own
    // band before a neighbour can reuse one.
    expect(labels[1].distance[1]).toBe(2);
    expect(labels[2].distance[1]).toBe(15);
    expect(labels[0].distance[1]).toBe(28);
    expect(labels[0].fontSize).toBeGreaterThanOrEqual(10);
  });

  test("paddedDomain hugs the data and never anchors at zero", () => {
    // Half a strike step (4) beats the 5% pad (1.2), so edge bars stay whole.
    expect(paddedDomain([62, 70, 78, 86])).toEqual({ min: 58, max: 90 });
    expect(paddedDomain([100, 100.5, 101])).toEqual({ min: 99.75, max: 101.25 });
    expect(paddedDomain([62, 86]).min).toBeGreaterThan(0);
    expect(paddedDomain([])).toEqual({});
  });
});

describe("ChartFrame accessibility", () => {
  test("is a labelled img with an sr-only summary and no inner tab stops", () => {
    view();
    const frame = screen.getByTestId("probe-frame");
    expect(frame).toHaveAttribute("role", "img");
    expect(frame).toHaveAttribute("aria-label", "probe");
    expect(frame).toHaveAttribute("tabindex", "0");
    const desc = screen.getByTestId("probe-desc");
    expect(desc).toHaveClass("sr-only");
    expect(desc).toHaveTextContent("probe");
    const innerStops = Array.from(frame.querySelectorAll<HTMLElement>("[tabindex]")).filter(
      (el) => Number(el.getAttribute("tabindex")) >= 0,
    );
    expect(innerStops).toHaveLength(0);
  });
});

function expiryView(selected: string | null = "2026-11-20") {
  const onExpiry = vi.fn();
  render(() => (
    <UIProvider>
      <ExpiryChips
        options={[
          { date: "2026-11-20", dte: 3, label: "20 NOV" },
          { date: "2026-11-27", dte: 10, label: "27 NOV" },
          { date: "2026-12-31", dte: 44, label: "31 DEC" },
        ]}
        selectedExpiry={selected}
        onExpiry={onExpiry}
        testId="exp"
      />
    </UIProvider>
  ));
  return { onExpiry };
}

describe("ExpiryChips keyboard parity", () => {
  test("chips stay in the Tab order with a visible focus ring and Enter selects", () => {
    const { onExpiry } = expiryView();
    const first = screen.getByTestId("exp-2026-11-20");
    const second = screen.getByTestId("exp-2026-11-27");
    for (const chip of [first, second]) {
      expect(chip.tagName).toBe("BUTTON");
      expect(chip).toHaveAttribute("aria-pressed");
      expect(chip).not.toHaveAttribute("tabindex");
      expect(chip).toHaveClass("focus-visible:ring-1");
      expect(chip).toHaveClass("focus-visible:ring-fin-primary");
    }
    second.focus();
    fireEvent.keyDown(second, { key: "Enter" });
    // Native buttons activate on Enter via a click; happy-dom needs it fired explicitly.
    fireEvent.click(second);
    expect(onExpiry).toHaveBeenCalledWith("2026-11-27");
  });

  test("arrow keys and Home/End move focus across chips without a dead end", () => {
    expiryView();
    const first = screen.getByTestId("exp-2026-11-20");
    const second = screen.getByTestId("exp-2026-11-27");
    const third = screen.getByTestId("exp-2026-12-31");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "ArrowRight" });
    expect(document.activeElement).toBe(third);
    fireEvent.keyDown(third, { key: "ArrowRight" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "End" });
    expect(document.activeElement).toBe(third);
    fireEvent.keyDown(third, { key: "Home" });
    expect(document.activeElement).toBe(first);
  });
});
