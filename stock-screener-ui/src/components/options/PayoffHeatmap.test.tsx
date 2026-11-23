// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import * as palette from "@/ui/palette";

type ChartProps = {
  option: Record<string, any>;
  onEvents?: Record<string, (params: unknown) => void>;
  "data-testid"?: string;
};

const captured = vi.hoisted(() => ({ charts: [] as ChartProps[] }));

vi.mock("../common/EChart", () => ({
  EChart: (props: ChartProps) => {
    captured.charts.push(props);
    const el = document.createElement("div");
    el.setAttribute("data-testid", props["data-testid"] ?? "");
    return el;
  },
}));

vi.mock("./payoffHeatmapOption", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./payoffHeatmapOption")>();
  return { ...actual, buildPayoffOption: vi.fn(actual.buildPayoffOption) };
});

import { PayoffHeatmap } from "./PayoffHeatmap";
import {
  buildPayoffOption,
  categoryAxisInterval,
  cellAt,
  hasIntrinsicOnlyPricedCell,
  INTRINSIC_ONLY_BADGE,
  INTRINSIC_ONLY_NOTE,
  MAX_EXPIRY_LABELS,
  NO_IV_NOTE,
  PAYOFF_LABEL_FONT_SIZE,
  payoffCellGroups,
  payoffNetGreeks,
  payoffTooltipHtml,
  robustPnlDomain,
  type PayoffCell,
  type PayoffMatrixShape,
} from "./payoffHeatmapOption";

const LEGS = [
  { action: "BUY" as const, opt: "CE" as const, strike: 24000, premium: 120, qty: 1 },
  { action: "SELL" as const, opt: "CE" as const, strike: 24500, premium: 60, qty: 1 },
];
const EXPIRIES = ["2026-11-23", "2026-11-30"];
const AS_OF = "2026-11-23";

function cell(
  pnl: number,
  timeValue: number | null = null,
  overrides: Partial<PayoffCell> = {},
): PayoffCell {
  return {
    pnl,
    intrinsic: pnl,
    timeValue,
    spotPct: -1.7,
    priced: true,
    basis: timeValue == null ? "intrinsic-only" : "intrinsic+time",
    ...overrides,
  };
}

/** Mixed lattice: five full quotes, three priced intrinsic-only intersections. */
function matrix(): PayoffMatrixShape {
  return {
    strikes: [23800, 24000, 24200, 24500],
    expiries: EXPIRIES,
    // cells[strikeIndex][expiryIndex] — the published builder contract.
    cells: [
      [cell(-485, 10), cell(-420)],
      [cell(0, 5), cell(15)],
      [cell(1200, 40), cell(1240, 40)],
      [cell(250), cell(280, 30)],
    ],
    kpis: { netDebit: 60, maxProfit: 1200, maxLoss: -485, breakevens: [24060], pop: null },
    spotRowIndex: 2,
  };
}

/** IV unavailable: every cell still carries a real intrinsic P&L. */
function noIvMatrix(): PayoffMatrixShape {
  const base = matrix();
  return {
    ...base,
    cells: base.cells.map((row) =>
      row.map((c) => ({ ...c, timeValue: null, priced: true, basis: "intrinsic-only" as const })),
    ),
    kpis: { ...base.kpis, maxProfit: null, maxLoss: null },
  };
}

/** Genuinely unpriceable lattice: the builder marked priced=false everywhere. */
function unpricedMatrix(): PayoffMatrixShape {
  const base = matrix();
  return {
    ...base,
    cells: base.cells.map((row) =>
      row.map((c) => ({ ...c, timeValue: null, priced: false, basis: "intrinsic-only" as const })),
    ),
    kpis: { ...base.kpis, maxProfit: null, maxLoss: null },
  };
}

function option(overrides: Partial<Parameters<typeof buildPayoffOption>[0]> = {}) {
  return buildPayoffOption({
    matrix: matrix(),
    legs: LEGS,
    spot: 24200,
    iv: null,
    asOf: AS_OF,
    ...overrides,
  }) as Record<string, any>;
}

beforeEach(() => {
  captured.charts.length = 0;
  vi.mocked(buildPayoffOption).mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("payoffHeatmapOption — axes, thinning and label floor", () => {
  test("strikes are a descending category axis and expiries are formatted columns", () => {
    const opt = option();
    expect(opt.xAxis).toMatchObject({ type: "category", data: ["23 Nov · 0d", "30 Nov · 7d"] });
    expect(opt.yAxis).toMatchObject({
      type: "category",
      inverse: true,
      data: ["24.5k", "24.2k", "24k", "23.8k"],
    });
  });

  test("categoryAxisInterval thins by column count, never by measured width", () => {
    expect(categoryAxisInterval(21)).toBe(2);
    expect(categoryAxisInterval(6)).toBe(0);
    expect(categoryAxisInterval(1)).toBe(0);
    expect(categoryAxisInterval(70)).toBe(9);
    expect(MAX_EXPIRY_LABELS).toBe(7);
    expect(option().xAxis.axisLabel.interval).toBe(categoryAxisInterval(2));

    const wide = matrix();
    const manyExpiries = Array.from({ length: 21 }, (_, i) => `2026-12-${String(i + 1).padStart(2, "0")}`);
    const opt = option({
      matrix: { ...wide, expiries: manyExpiries, cells: wide.cells.map((row) => [...row, ...row, ...row]) },
    });
    expect(opt.xAxis.axisLabel.interval).toBe(2);
  });

  test("every chart text surface uses the 10px floor", () => {
    expect(PAYOFF_LABEL_FONT_SIZE).toBeGreaterThanOrEqual(10);
    const opt = option();
    expect(opt.xAxis.axisLabel.fontSize).toBeGreaterThanOrEqual(10);
    expect(opt.yAxis.axisLabel.fontSize).toBeGreaterThanOrEqual(10);
    expect(opt.visualMap.textStyle.fontSize).toBeGreaterThanOrEqual(10);
    expect(opt.series[0].label.fontSize).toBeGreaterThanOrEqual(10);
    for (const item of opt.graphic) {
      expect(item.style.fontSize).toBeGreaterThanOrEqual(10);
    }
  });

  test("graphic disclosure carries a centred signed-zero tick", () => {
    const zero = option().graphic.find((item: any) => item.style?.text === "0");
    expect(zero).toBeTruthy();
  });
});

describe("payoffHeatmapOption — robust fixed colour domain", () => {
  test("domain is anchored to defined risk, not the largest cell", () => {
    // The 1240 cell exceeds the leg-imposed 1200 max profit; it must not widen
    // the scale, otherwise dragging the range slider would recolour the grid.
    const opt = option();
    expect(opt.visualMap.min).toBe(-1200);
    expect(opt.visualMap.max).toBe(1200);
  });

  test("an unbounded tail is clipped at the 96th percentile", () => {
    const pnls = Array.from({ length: 100 }, (_, i) => i + 1).concat(1_000_000);
    const domain = robustPnlDomain(pnls, { maxProfit: null, maxLoss: null });
    expect(domain.max).toBeGreaterThan(0);
    expect(domain.max).toBeLessThan(200);
    expect(domain.min).toBe(-domain.max);
    // The same tail with a defined-risk anchor ignores the outlier entirely.
    expect(robustPnlDomain(pnls, { maxProfit: 500, maxLoss: null }).max).toBe(500);
  });

  test("an explicit frozen domain survives a slider change to the cells", () => {
    const domain = { min: -100, max: 100 };
    const shifted = matrix();
    shifted.cells = shifted.cells.map((row) => row.map((c) => ({ ...c, pnl: c.pnl! * 9 })));
    const before = option({ domain });
    const after = option({ matrix: shifted, domain });
    expect(before.visualMap.min).toBe(-100);
    expect(after.visualMap.min).toBe(-100);
    expect(after.visualMap.max).toBe(100);
  });

  test("empty input yields a finite neutral domain with no NaN", () => {
    const empty: PayoffMatrixShape = { strikes: [], expiries: [], cells: [], spotRowIndex: null };
    const opt = option({ matrix: empty, legs: [], spot: 0, asOf: AS_OF });
    expect(opt.visualMap.min).toBe(-1);
    expect(opt.visualMap.max).toBe(1);
    expect(JSON.stringify(opt)).not.toMatch(/NaN|undefined/);
  });

  test("visualMap maps only the priced series with palette-derived signed stops", () => {
    const opt = option();
    expect(opt.visualMap).toMatchObject({ type: "continuous", series: [0], calculable: false });
    expect(opt.visualMap.text).toEqual(["+1.2k", "−1.2k"]);
    const colors: string[] = opt.visualMap.inRange.color;
    expect(colors).toHaveLength(5);
    for (const color of colors) expect(color).toMatch(/^rgba\(/);
    expect(colors[0]).toBe(palette.alpha(palette.NEGATIVE, 0.92));
    expect(colors[4]).toBe(palette.alpha(palette.POSITIVE, 0.92));
  });
});

describe("payoffHeatmapOption — pricing vs genuine exclusions", () => {
  test("a null timeValue never hatches: every intersection keeps its real P&L on the ramp", () => {
    const groups = payoffCellGroups(matrix());
    expect(groups.priced).toHaveLength(8);
    expect(groups.unpriced).toHaveLength(0);
    const intrinsicOnly = groups.priced.filter((d) => d.basis === "intrinsic-only");
    expect(intrinsicOnly).toHaveLength(3);
    for (const datum of intrinsicOnly) {
      expect(datum.placeholder).toBe(false);
      expect(datum.priced).toBe(true);
      expect(datum.timeValue).toBeNull();
      expect(typeof datum.pnl).toBe("number");
      expect(datum.value[2]).toBe(datum.pnl);
    }
    // Exactly zero time value at expiry is a genuine full quote, not an exclusion.
    const atExpiry = payoffCellGroups({
      strikes: [24500],
      expiries: [EXPIRIES[0]],
      cells: [[cell(1, 0)]],
      spotRowIndex: 0,
    });
    expect(atExpiry.priced).toHaveLength(1);
    expect(atExpiry.unpriced).toHaveLength(0);
  });

  test("only priced=false or a non-finite P&L hatches a cell", () => {
    const base = matrix();
    const flagged: PayoffMatrixShape = {
      ...base,
      cells: base.cells.map((row, r) =>
        // Original row 3 is strike 24500 → first cell of the descending axis.
        row.map((c, col) => (r === 3 && col === 0 ? { ...c, priced: false } : c)),
      ),
    };
    const groups = payoffCellGroups(flagged);
    expect(groups.priced).toHaveLength(7);
    expect(groups.unpriced).toHaveLength(1);
    const excluded = groups.unpriced[0];
    expect(excluded.placeholder).toBe(true);
    // Strikes are enumerated high → low, so the 24500 row is first.
    expect(excluded.value).toEqual([0, 0, 0]);
    expect(excluded.strike).toBe(24500);
    expect(excluded.timeValue).toBeNull();
    expect(excluded.pnl).toBe(250); // real intrinsic retained for the tooltip

    const nonFinite: PayoffMatrixShape = {
      ...base,
      cells: [[cell(Number.NaN, null), ...base.cells[0].slice(1)], ...base.cells.slice(1)],
    };
    expect(payoffCellGroups(nonFinite).unpriced).toHaveLength(1);
    expect(payoffCellGroups(nonFinite).priced).toHaveLength(7);
  });

  test("with no IV at all every intersection is priced from intrinsic P&L, none hatched", () => {
    const groups = payoffCellGroups(noIvMatrix());
    expect(groups.unpriced).toHaveLength(0);
    expect(groups.priced).toHaveLength(8);
    expect(hasIntrinsicOnlyPricedCell(noIvMatrix())).toBe(true);

    const opt = option({ matrix: noIvMatrix(), iv: null });
    expect(opt.series[0].data).toHaveLength(8);
    expect(opt.series[1].data).toEqual([]);
    const pnls = opt.series[0].data.map((datum: any) => datum.pnl);
    expect(pnls.every((p: unknown) => typeof p === "number" && Number.isFinite(p))).toBe(true);
    expect(opt.visualMap.min).toBeLessThan(0);
    expect(opt.visualMap.max).toBeGreaterThan(0);
    expect(JSON.stringify(opt)).not.toMatch(/NaN|undefined/);
  });

  test("a priced intrinsic-only tooltip keeps the real P&L and discloses the missing IV", () => {
    const datum = payoffCellGroups(noIvMatrix()).priced.find((d) => d.pnl === 250)!;
    expect(datum.basis).toBe("intrinsic-only");
    expect(datum.placeholder).toBe(false);
    expect(datum.timeValue).toBeNull();

    const opt = option({ matrix: noIvMatrix(), iv: null });
    const formatter = opt.tooltip.formatter as (p: unknown) => string;
    const html = formatter({ data: opt.series[0].data.find((d: any) => d.pnl === 250) });
    expect(html).toContain("P&amp;L <b>+250</b>");
    expect(html).toContain(INTRINSIC_ONLY_NOTE);
    expect(html).not.toContain(NO_IV_NOTE);

    expect(hasIntrinsicOnlyPricedCell({
      strikes: [24500],
      expiries: [EXPIRIES[0]],
      cells: [[cell(1, 1)]],
      spotRowIndex: 0,
    })).toBe(false);
  });

  test("excluded series is low contrast, decal-hatched and omitted from visualMap", () => {
    const opt = option({ matrix: unpricedMatrix() });
    expect(opt.series[0]).toMatchObject({ name: "P&L", type: "heatmap" });
    expect(opt.series[1]).toMatchObject({ name: "No IV quote", type: "heatmap" });
    expect(opt.visualMap.series).toEqual([0]);
    const excluded = opt.series[1];
    expect(excluded.itemStyle.color).toBe(palette.SURFACE_ALT);
    expect(excluded.itemStyle.decal.color).toBe(palette.TEXT_MUTED);
    expect(excluded.data).toHaveLength(8);
    expect(excluded.data.every((d: any) => d.placeholder === true)).toBe(true);
  });

  test("each genuinely unpriced cell carries the exact no-IV note in its own tooltip", () => {
    const opt = option({ matrix: unpricedMatrix() });
    const formatter = opt.series[1].data[0].tooltip.formatter as () => string;
    const html = formatter();
    expect(html).toContain(NO_IV_NOTE);
    expect(html).toContain("Time value —");
    expect(html).toContain("Intrinsic ₹250");
    // No fabricated IV / time value is smuggled into the cell payload.
    expect(opt.series[1].data[0].timeValue).toBeNull();
  });
});

describe("payoffHeatmapOption — tooltip and annotations", () => {
  test("tooltip has every field and escapes injected HTML", () => {
    const opt = option();
    const formatter = opt.tooltip.formatter as (p: unknown) => string;
    const html = formatter({
      data: {
        value: [0, 3, -485],
        strike: 23800,
        expiry: "2026-11-23",
        pnl: -485,
        intrinsic: -485,
        timeValue: null,
        spotPct: -1.7,
      },
    });
    expect(html).toContain("<b>₹23.8k</b> · 23 Nov · 0d");
    expect(html).toContain("Spot −1.7%");
    expect(html).toContain("P&amp;L <b>−485</b>");
    expect(html).toContain("Intrinsic ₹−485");
    expect(html).toContain("Time value —");
    expect(html).toContain(INTRINSIC_ONLY_NOTE);

    const injected = payoffTooltipHtml(cell(1, 1), {
      strike: 24000,
      expiry: '<img src=x onerror="alert(1)">',
    });
    expect(injected).toContain("&lt;img");
    expect(injected).toContain("&quot;");
    expect(injected).not.toContain("<img");
  });

  test("tooltip uses the formatted expiry label and net Δ/θ when available", () => {
    const html = payoffTooltipHtml(cell(120, 65), {
      strike: 24200,
      expiry: "2026-11-30",
      expiryLabel: "30 Nov · 7d",
      greeks: { delta: 0.42, theta: -12.3 },
    });
    expect(html).toContain("30 Nov · 7d");
    expect(html).toContain("Time value ₹65");
    expect(html).toContain("Δ +0.42 · θ −12.30");
    expect(html).not.toContain(NO_IV_NOTE);
    const without = payoffTooltipHtml(cell(10, 4), {
      strike: 24200,
      expiry: "2026-11-30",
      greeks: { delta: null, theta: null },
    });
    expect(without).not.toContain("Δ");
  });

  test("tooltip prints a dash for every missing scalar, never undefined or NaN", () => {
    const html = payoffTooltipHtml(null, { strike: Number.NaN, expiry: "" });
    expect(html).toContain("P&amp;L <b>—</b>");
    expect(html).not.toMatch(/undefined|NaN/);
    const tooltip = option().tooltip.formatter as (p: unknown) => string;
    expect(tooltip({ data: {} })).toBe("");
  });

  test("markLine carries spot and every leg strike; selected expiry is an alpha wash", () => {
    const opt = option();
    const marks = opt.series[2].markLine.data as Array<{ yAxis: string }>;
    expect(marks.map((mark) => mark.yAxis)).toEqual(["24.2k", "24k", "24.5k"]);
    expect(option({ selectedExpiry: "2099-01-01" }).series[2].markArea).toBeUndefined();
    const selected = option({ selectedExpiry: "2026-11-30" });
    expect(selected.series[2].markArea.itemStyle.color).toBe(palette.alpha(palette.INFO, 0.14));
    expect(selected.series[2].markArea.data).toHaveLength(1);
    // A host that already passes a formatted label still selects the column.
    expect(option({ selectedExpiry: "30 Nov · 7d" }).series[2].markArea.data).toHaveLength(1);
  });

  test("cellAt and net greeks keep their published contracts", () => {
    expect(cellAt(matrix(), 2, 1)).toEqual(cell(1240, 40));
    const base = matrix();
    const transposed: PayoffMatrixShape = {
      ...base,
      cells: base.expiries.map((_, x) => base.strikes.map((__, y) => base.cells[y][x])),
    };
    expect(cellAt(transposed, 1, 0)).toEqual(cell(0, 5));
    const greeks = payoffNetGreeks([
      { ...LEGS[0], delta: 0.5, theta: -1 },
      { ...LEGS[1], delta: 0.2, theta: -2 },
    ]);
    expect(greeks).toMatchObject({ delta: 0.3, theta: 1, partial: true });
  });
});

describe("PayoffHeatmap component", () => {
  const props = {
    legs: LEGS,
    spot: 24200,
    expiries: EXPIRIES,
    iv: null,
    asOf: AS_OF,
    height: 320,
  };

  test("iv=null renders coloured cells, zero hatched cells and the intrinsic-only badge", () => {
    render(() => <PayoffHeatmap {...props} testIdPrefix="strat" />);
    expect(screen.getByTestId("strat-heatmap")).toBeInTheDocument();
    expect(screen.getByTestId("strat-legend")).toHaveTextContent("LOSS");
    expect(screen.getByTestId("strat-legend")).toHaveTextContent("PROFIT");
    // No genuinely unpriced cell exists, so the NOIV swatch is hidden.
    expect(screen.queryByTestId("strat-legend-no-iv")).toBeNull();
    expect(screen.getByTestId("strat-intrinsic-only-badge")).toHaveTextContent(INTRINSIC_ONLY_BADGE);
    expect(screen.getByTestId("strat-heatmap-chart")).toBeInTheDocument();
    expect(screen.getByTestId("strat-heatmap-keyboard")).toHaveAttribute("tabindex", "0");
    expect(screen.queryByTestId("strat-heatmap-empty")).toBeNull();
    expect(screen.getByTestId("strat-heatmap")).toHaveStyle({ height: "320px" });
    expect(vi.mocked(buildPayoffOption)).toHaveBeenCalled();
    expect(vi.mocked(buildPayoffOption).mock.calls[0][0]).toMatchObject({
      spot: 24200,
      asOf: AS_OF,
      iv: null,
    });
    const option = captured.charts[0].option;
    expect(option.series[0].type).toBe("heatmap");
    expect(option.series[0].data.length).toBeGreaterThan(0);
    expect(option.series[1].data).toHaveLength(0);
    // The ECharts container is a direct flex child, never wrapped in a ScrollArea.
    expect(screen.getByTestId("strat-heatmap").querySelector("[data-testid*='scroll']")).toBeNull();
  });

  test("a live IV removes the intrinsic-only badge and still hides the NOIV swatch", () => {
    render(() => <PayoffHeatmap {...props} iv={0.25} testIdPrefix="live" />);
    expect(screen.queryByTestId("live-intrinsic-only-badge")).toBeNull();
    expect(screen.queryByTestId("live-legend-no-iv")).toBeNull();
    expect(captured.charts[0].option.series[0].data.length).toBeGreaterThan(0);
    expect(captured.charts[0].option.series[1].data).toHaveLength(0);
  });

  test("frozen domain never changes when only the IV slider moves", async () => {
    const [iv, setIv] = createSignal<number | null>(null);
    render(() => <PayoffHeatmap {...props} iv={iv()} />);
    const calls = vi.mocked(buildPayoffOption).mock.calls;
    const first = calls[0][0].domain;
    expect(first).toEqual({ min: -440, max: 440 });
    setIv(0.25);
    await Promise.resolve();
    const after = vi.mocked(buildPayoffOption).mock.calls.at(-1)![0].domain;
    expect(after).toEqual(first);
  });

  test("grid mirror exposes roving tabindex and arrow keys move focus", async () => {
    const onSelectCell = vi.fn();
    const onSelectExpiry = vi.fn();
    render(() => (
      <PayoffHeatmap {...props} onSelectCell={onSelectCell} onSelectExpiry={onSelectExpiry} />
    ));
    const grid = screen.getByTestId("payoff-heatmap-keyboard");
    expect(grid).toHaveAttribute("role", "grid");
    const cells = screen.getAllByRole("gridcell");
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.filter((node) => node.getAttribute("tabindex") === "0")).toHaveLength(1);

    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    await Promise.resolve();
    const active = screen.getByTestId("payoff-heatmap-cell-6-1");
    expect(active).toHaveAttribute("tabindex", "0");
    expect(active).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(active);
    expect(screen.getByTestId("payoff-heatmap-cursor").textContent).toContain("30 Nov · 7d");

    fireEvent.keyDown(grid, { key: "Enter" });
    expect(onSelectCell).toHaveBeenCalledTimes(1);
    expect(onSelectExpiry).toHaveBeenCalledWith("2026-11-30");
  });

  test("clicking a cell or the expiry axis reports the selection", () => {
    const onSelectCell = vi.fn();
    const onSelectExpiry = vi.fn();
    render(() => <PayoffHeatmap {...props} onSelectCell={onSelectCell} onSelectExpiry={onSelectExpiry} />);
    captured.charts[0].onEvents?.click({
      data: { value: [1, 2, 1240], strike: 24200, expiry: "2026-11-30" },
    });
    expect(onSelectCell).toHaveBeenCalledWith(24200, "2026-11-30");
    captured.charts[0].onEvents?.click({ componentType: "xAxis", value: 1 });
    expect(onSelectExpiry).toHaveBeenCalledWith("2026-11-30");
  });

  test("an empty leg set renders the empty state and no chart or grid cells", () => {
    render(() => <PayoffHeatmap {...props} legs={[]} />);
    expect(screen.getByTestId("payoff-heatmap-empty")).toHaveTextContent(
      "No payoff data — add a leg to see the grid",
    );
    expect(captured.charts).toHaveLength(0);
    expect(screen.queryByTestId("payoff-heatmap-keyboard")).toBeNull();
    expect(screen.queryAllByRole("gridcell")).toHaveLength(0);
  });

  test("the default height is 420 and the canvas is not inside a ScrollArea", () => {
    const { height: _height, ...withoutHeight } = props;
    void _height;
    render(() => <PayoffHeatmap {...withoutHeight} />);
    expect(screen.getByTestId("payoff-heatmap")).toHaveStyle({ height: "420px" });
    expect(screen.getByTestId("payoff-heatmap").querySelector("[data-testid*='scroll']")).toBeNull();
  });
});

describe("PayoffHeatmap — value-change flashes", () => {
  const flush = () => Promise.resolve();
  const cell = () => screen.getByTestId("payoff-heatmap-cell-0-0");
  const key = () => cell().getAttribute("data-flash-key");

  function mountLive() {
    const [premium, setPremium] = createSignal(120);
    render(() => (
      <PayoffHeatmap
        legs={[{ ...LEGS[0], premium: premium() }, LEGS[1]]}
        spot={24200}
        expiries={EXPIRIES}
        iv={null}
        asOf={AS_OF}
        height={320}
      />
    ));
    return { setPremium };
  }

  test("per-cell P&L labels flash down/up with a bumping sequence; legend never flashes", async () => {
    const { setPremium } = mountLive();
    await flush();
    expect(key()).toBe("0");
    expect(cell().className).not.toContain("value-flash-");
    expect(screen.queryByTestId("payoff-heatmap-flash-0-0")).toBeNull();
    const legend = screen.getByTestId("payoff-legend");
    expect(legend.className).not.toContain("value-flash-");
    expect(legend.querySelector(".value-flash-up, .value-flash-down")).toBeNull();

    // A dearer long call lowers every cell's P&L.
    setPremium(200);
    await flush();
    expect(key()).toBe("1");
    expect(cell()).toHaveAttribute("data-flash-direction", "down");
    expect(cell().className).toContain("value-flash-down");
    const tile = screen.getByTestId("payoff-heatmap-flash-0-0");
    expect(tile.className).toContain("value-flash-down");
    expect(tile).toHaveAttribute("data-flash-key", "1");
    expect(legend.className).not.toContain("value-flash-");
    expect(legend.querySelector(".value-flash-up, .value-flash-down")).toBeNull();

    setPremium(200);
    await flush();
    expect(key()).toBe("1");

    setPremium(50);
    await flush();
    expect(key()).toBe("2");
    expect(cell()).toHaveAttribute("data-flash-direction", "up");
    expect(cell().className).toContain("value-flash-up");
  });

  test("advancing only the playhead/selection does not bump the flash sequence", async () => {
    const { setPremium } = mountLive();
    await flush();
    setPremium(200);
    await flush();
    expect(key()).toBe("1");
    const neighbourBefore = screen.getByTestId("payoff-heatmap-cell-1-0").getAttribute("data-flash-key");

    fireEvent.keyDown(screen.getByTestId("payoff-heatmap-keyboard"), { key: "ArrowRight" });
    await flush();
    expect(key()).toBe("1");
    expect(screen.getByTestId("payoff-heatmap-cell-1-0")).toHaveAttribute("data-flash-key", neighbourBefore!);
  });
});
