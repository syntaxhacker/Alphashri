// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { UIProvider } from "@/ui";
import {
  NiftyDepthMap,
  buildDepthRows,
  findOiPoc,
  dayStats,
  formatOiCompact,
  buildDepthOption,
  levelLines,
  topOiLabelStrikes,
  formatIstTimeMs,
  candleEpochMs,
  DEPTH_WINDOW,
  DEPTH_MAX_ROWS,
} from "./NiftyDepthMap";
import type { NiftyReport } from "@/types/niftyReport";

const depthMocks = vi.hoisted(() => ({
  mounts: 0,
  setOption: vi.fn(),
  resize: vi.fn(),
  lastShouldSetOption: null as null | (() => boolean),
}));

vi.mock("echarts-for-react", async () => {
  const React = await import("react");
  // Faithful-enough stand-in: exposes getEchartsInstance via ref, fires
  // onChartReady on mount (like the real async init), and records the
  // shouldSetOption guard so tests can assert the auto-update path is off.
  const MockECharts = React.forwardRef(function MockECharts(
    props: {
      option?: { series?: unknown[] };
      onChartReady?: (instance: unknown) => void;
      shouldSetOption?: () => boolean;
    },
    ref: React.Ref<{ getEchartsInstance: () => unknown }>,
  ) {
    const instance = React.useMemo(
      () => ({ setOption: depthMocks.setOption, resize: depthMocks.resize }),
      [],
    );
    const readyRef = React.useRef(props.onChartReady);
    readyRef.current = props.onChartReady;
    React.useEffect(() => {
      depthMocks.mounts += 1;
      readyRef.current?.(instance);
    }, [instance]);
    React.useImperativeHandle(
      ref,
      () => ({ getEchartsInstance: () => instance }),
      [instance],
    );
    depthMocks.lastShouldSetOption = props.shouldSetOption ?? null;
    return (
      <div data-testid="nifty-depth-echarts" data-series={props.option?.series?.length ?? 0} />
    );
  });
  return { default: MockECharts };
});

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: TestWrapper });
}

function strikeAt(strike: number, ceOi: number, peOi: number, chg = 0) {
  return {
    strike,
    ce: { ltp: 1, close: 1, oi: ceOi, prevOi: ceOi, oiChange: chg, priceChange: 0, sentiment: "NEUTRAL" },
    pe: { ltp: 1, close: 1, oi: peOi, prevOi: peOi, oiChange: chg, priceChange: 0, sentiment: "NEUTRAL" },
  };
}

function mockReport(overrides?: Partial<NiftyReport>): NiftyReport {
  return {
    mode: "live",
    date: "2026-10-12",
    expiry: "weekly",
    spot: 25750,
    ohlc: { open: 25600, high: 25800, low: 25550, close: 25750 },
    pcrOi: 1.12,
    pcrVol: 0.95,
    maxPain: 25700,
    walls: {
      calls: [
        { strike: 25800, oi: 5000 },
        { strike: 25900, oi: 4000 },
      ],
      puts: [
        { strike: 25600, oi: 6000 },
        { strike: 25500, oi: 4500 },
      ],
    },
    strikes: [
      strikeAt(24000, 100, 100),
      strikeAt(25700, 2000, 2500),
      strikeAt(25800, 9000, 1000),
      strikeAt(27500, 100, 100),
    ],
    timeline: [],
    candles: [
      { time: "2026-10-12T09:15:00", open: 25600, high: 25650, low: 25580, close: 25620, volume: 1000 },
      { time: "2026-10-12T09:30:00", open: 25620, high: 25760, low: 25600, close: 25750, volume: 1200 },
    ],
    ...overrides,
  };
}

interface MarkLineEntry {
  name: string;
  yAxis: number;
}

interface OptSeries {
  name: string;
  type?: string;
  symbolSize?: number;
  xAxisIndex?: number;
  yAxisIndex?: number;
  encode?: { x?: number; y?: number };
  label?: { show?: boolean; formatter?: (p: { value?: unknown }) => string };
  markLine?: { data?: MarkLineEntry[]; label?: { show?: boolean } };
  data?: unknown[];
}

interface DepthOpt {
  series: OptSeries[];
  grid: { left?: unknown; right?: unknown }[];
  axisPointer?: { link?: { yAxisIndex?: unknown } };
  xAxis: { type?: string; data?: unknown[]; axisLabel?: { formatter?: (v: unknown) => string } }[];
  yAxis: { type?: string; data?: unknown[]; min?: number; max?: number; position?: string }[];
}

function asOpt(report: NiftyReport): DepthOpt {
  return buildDepthOption(report) as unknown as DepthOpt;
}

afterEach(() => {
  cleanup();
  depthMocks.mounts = 0;
  depthMocks.lastShouldSetOption = null;
  depthMocks.setOption.mockClear();
  depthMocks.resize.mockClear();
});

describe("buildDepthRows", () => {
  test("windows to ATM ±750 and sorts ascending", () => {
    expect(DEPTH_WINDOW).toBe(750);
    const rows = buildDepthRows(mockReport());
    expect(rows.map((r) => r.strike)).toEqual([25700, 25800]);
  });

  test("boundary ±750 included, beyond excluded", () => {
    const report = mockReport({
      strikes: [
        strikeAt(25000, 10, 10), // exactly -750
        strikeAt(26500, 10, 10), // exactly +750
        strikeAt(24950, 10, 10), // -800 → out
        strikeAt(26550, 10, 10), // +800 → out
      ],
    });
    expect(buildDepthRows(report).map((r) => r.strike)).toEqual([25000, 26500]);
  });

  test("caps at 31 rows keeping strikes closest to spot", () => {
    const strikes = [];
    for (let s = 25000; s <= 26500; s += 25) strikes.push(strikeAt(s, 10, 10));
    const rows = buildDepthRows(mockReport({ strikes }));
    expect(strikes.length).toBeGreaterThan(DEPTH_MAX_ROWS);
    expect(rows).toHaveLength(DEPTH_MAX_ROWS);
    const got = rows.map((r) => r.strike);
    expect(got).toEqual(got.toSorted((a, b) => a - b));
    // ATM strike survives the cap
    expect(got).toContain(25750);
  });

  test("row shape is exactly {strike, ceOi, peOi}", () => {
    const rows = buildDepthRows(mockReport());
    expect(rows[0]).toEqual({ strike: 25700, ceOi: 2000, peOi: 2500 });
  });

  test("empty strikes returns empty array", () => {
    expect(buildDepthRows(mockReport({ strikes: [] }))).toEqual([]);
  });
});

describe("findOiPoc", () => {
  test("picks strike with highest total OI", () => {
    expect(findOiPoc(mockReport())).toBe(25800);
  });

  test("empty strikes returns null", () => {
    expect(findOiPoc(mockReport({ strikes: [] }))).toBeNull();
  });
});

describe("dayStats", () => {
  test("hi/lo/change math from candles", () => {
    const s = dayStats(mockReport());
    expect(s.hi).toBe(25760);
    expect(s.lo).toBe(25580);
    expect(s.last).toBe(25750);
    expect(s.changePct).toBeCloseTo(((25750 - 25620) / 25620) * 100, 6);
  });

  test("empty candles returns nulls", () => {
    expect(dayStats(mockReport({ candles: [] }))).toEqual({
      hi: null,
      lo: null,
      changePct: null,
      last: null,
    });
  });

  test("missing candles returns nulls", () => {
    expect(dayStats(mockReport({ candles: undefined }))).toEqual({
      hi: null,
      lo: null,
      changePct: null,
      last: null,
    });
  });
});

describe("formatOiCompact", () => {
  test("Cr / L / k / units boundaries", () => {
    expect(formatOiCompact(25000000)).toBe("2.50 Cr");
    expect(formatOiCompact(2500000)).toBe("25.0L");
    expect(formatOiCompact(5000)).toBe("5.0k");
    expect(formatOiCompact(500)).toBe("500");
  });

  test("negative values keep sign", () => {
    expect(formatOiCompact(-250000)).toBe("-2.5L");
  });
});

describe("candleEpochMs", () => {
  test("numeric epoch seconds expand to ms, ms passes through", () => {
    const sec = 1791776700; // 2026-10-12 09:15:00 IST in epoch seconds
    expect(candleEpochMs(sec)).toBe(sec * 1000);
    expect(candleEpochMs(sec * 1000)).toBe(sec * 1000);
    expect(formatIstTimeMs(candleEpochMs(sec))).toBe("09:15");
  });

  test("garbage times yield NaN so callers can drop the candle", () => {
    expect(candleEpochMs("")).toBeNaN();
    expect(candleEpochMs("   ")).toBeNaN();
    expect(candleEpochMs("NaT")).toBeNaN();
    expect(candleEpochMs("not-a-date")).toBeNaN();
    expect(candleEpochMs(NaN)).toBeNaN();
  });
});

describe("IST x-axis", () => {
  test("fixed epoch formats to 09:15 regardless of host TZ", () => {
    // 2026-10-12 09:15:00 IST == 03:45:00Z
    const epoch = Date.UTC(2026, 9, 12, 3, 45, 0);
    expect(formatIstTimeMs(epoch)).toBe("09:15");
  });

  test("candle wall-clock parses as IST, not host-local", () => {
    expect(candleEpochMs("2026-10-12T09:15:00")).toBe(Date.UTC(2026, 9, 12, 3, 45, 0));
  });

  test("x-axis data are epoch ms with an IST formatter", () => {
    const opt = asOpt(mockReport());
    const x = opt.xAxis[0];
    expect(typeof x.data?.[0]).toBe("number");
    expect(x.axisLabel?.formatter?.(Date.UTC(2026, 9, 12, 3, 45, 0))).toBe("09:15");
    expect(x.axisLabel?.formatter?.(Date.UTC(2026, 9, 12, 9, 45, 0))).toBe("15:15");
  });

  test("every built x-axis tick formats to HH:MM — never a price-like label", () => {
    const opt = asOpt(mockReport());
    const fmt = opt.xAxis[0].axisLabel?.formatter;
    expect(typeof fmt).toBe("function");
    // Candle session times: 09:15 and 09:30 in the mock report
    expect(fmt?.(opt.xAxis[0].data?.[0])).toBe("09:15");
    expect(fmt?.(opt.xAxis[0].data?.[1])).toBe("09:30");
    for (const v of opt.xAxis[0].data ?? []) {
      const label = fmt?.(v) ?? "";
      // HH:MM shape, and never a thousands-separated price ("22,300")
      expect(label).toMatch(/^\d{2}:\d{2}$/);
      expect(label).not.toMatch(/,\d{3}/);
    }
  });

  test("candles without a parseable time are dropped from series AND axis together", () => {
    const report = mockReport({
      candles: [
        { time: "2026-10-12T09:15:00", open: 25600, high: 25650, low: 25580, close: 25620, volume: 1000 },
        { time: "", open: 25620, high: 25760, low: 25600, close: 25750, volume: 1200 },
        { time: "NaT", open: 25620, high: 25760, low: 25600, close: 25750, volume: 1200 },
      ],
    });
    const opt = asOpt(report);
    // Index coupling preserved: one axis entry per rendered candle, all finite
    expect(opt.xAxis[0].data).toHaveLength(1);
    expect(opt.series[0].data).toHaveLength(1);
    expect(typeof opt.xAxis[0].data?.[0]).toBe("number");
    expect(Number.isFinite(Number(opt.xAxis[0].data?.[0]))).toBe(true);
    expect(opt.xAxis[0].axisLabel?.formatter?.(opt.xAxis[0].data?.[0])).toBe("09:15");
  });
});

describe("levelLines dedupe", () => {
  test("Spot wins, MP/CW within 25pts skipped (priority Spot > MP > CW/PW > OI-POC > Hi/Lo)", () => {
    const report = mockReport({
      spot: 25750,
      maxPain: 25760, // within 25 of Spot → skipped
      walls: {
        calls: [
          { strike: 25755, oi: 5000 }, // within 25 of Spot → skipped
          { strike: 26000, oi: 4000 }, // fresh → kept
        ],
        puts: [{ strike: 25500, oi: 6000 }], // fresh → kept
      },
    });
    const names = levelLines(report, dayStats(report), 26000).map((l) => l.name);
    expect(names.some((n) => n.startsWith("Spot"))).toBe(true);
    expect(names.some((n) => n.startsWith("MP"))).toBe(false);
    expect(names).toContain("CW 26,000");
    expect(names.some((n) => n.startsWith("PW"))).toBe(true);
    // OI POC dupes the CW line → skipped
    expect(names.some((n) => n.startsWith("OI POC"))).toBe(false);
  });

  test("Hi/Lo within 25pts of a placed tag are skipped", () => {
    const report = mockReport({
      spot: 25750,
      candles: [
        { time: "2026-10-12T09:15:00", open: 25740, high: 25760, low: 25740, close: 25750, volume: 100 },
      ],
    });
    const names = levelLines(report, dayStats(report), null).map((l) => l.name);
    // hi 25760 dupes Spot 25750, lo 25740 dupes Spot → both skipped
    expect(names.some((n) => n.startsWith("Hi"))).toBe(false);
    expect(names.some((n) => n.startsWith("Lo"))).toBe(false);
  });
});

describe("topOiLabelStrikes", () => {
  test("at most 6 strikes: top-3 CE plus top-3 PE", () => {
    const rows = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
      strike: 25000 + i * 50,
      ceOi: (i + 1) * 100,
      peOi: (8 - i) * 100,
    }));
    const labeled = topOiLabelStrikes(rows);
    expect(labeled.length).toBeLessThanOrEqual(6);
    // top-3 CE: highest ceOi; top-3 PE: highest peOi
    expect(labeled).toEqual(expect.arrayContaining([25350, 25300, 25250, 25000, 25050, 25100]));
  });
});

describe("buildDepthOption", () => {
  test("has candle + CE/PE bars + two dominance series", () => {
    const opt = asOpt(mockReport());
    expect(opt.series.map((s) => s.name)).toEqual([
      "Nifty 15m",
      "CE OI",
      "PE OI",
      "CE over PE",
      "PE over CE",
    ]);
  });

  test("candle y-range comes from candles ±0.15% only — bars never stretch it", () => {
    const opt = asOpt(mockReport());
    const lo = 25580;
    const hi = 25760;
    const y0 = opt.yAxis[0];
    expect(y0.type).toBe("value");
    expect(y0.min).toBeCloseTo(lo * 0.9985, 6);
    expect(y0.max).toBeCloseTo(hi * 1.0015, 6);
    // Strike extremes (24000/27500 in the full chain) are outside → bars clip
    expect(y0.min ?? 0).toBeGreaterThan(24000);
    expect(y0.max ?? 0).toBeLessThan(27500);
  });

  test("depth grid is a horizontal-bar chart: value x-axis + strike category y-axis", () => {
    const opt = asOpt(mockReport());
    // Grid 1 x-axis carries OI magnitude (labels stay hidden)
    expect(opt.xAxis[1].type).toBe("value");
    // Grid 1 y-axis carries one category row per strike in window
    const y1 = opt.yAxis[1];
    expect(y1.type).toBe("category");
    expect(y1.position).toBe("right");
    expect(y1.data).toEqual(["25700", "25800"]);
  });

  test("each strike row gets one left-going CE bar + one right-going PE bar", () => {
    const opt = asOpt(mockReport());
    const ce = opt.series.find((s) => s.name === "CE OI");
    const pe = opt.series.find((s) => s.name === "PE OI");
    expect(ce?.type).toBe("bar");
    expect(pe?.type).toBe("bar");
    // OI (dim 0) maps to the value x-axis, strike key (dim 1) to categories
    expect(ce?.encode).toEqual({ x: 0, y: 1 });
    expect(pe?.encode).toEqual({ x: 0, y: 1 });
    expect(ce?.xAxisIndex).toBe(1);
    expect(ce?.yAxisIndex).toBe(1);
    expect(pe?.xAxisIndex).toBe(1);
    expect(pe?.yAxisIndex).toBe(1);
    // Diverging: CE extends left (negative), PE right (positive)…
    const ceData = (ce?.data ?? []) as [number, string][];
    const peData = (pe?.data ?? []) as [number, string][];
    expect(ceData).toHaveLength(2);
    expect(peData).toHaveLength(2);
    for (const [oi] of ceData) expect(oi).toBeLessThanOrEqual(0);
    for (const [oi] of peData) expect(oi).toBeGreaterThanOrEqual(0);
    // …at the same strike rows, ascending (higher strike = higher row)
    expect(ceData.map((d) => d[1])).toEqual(["25700", "25800"]);
    expect(peData.map((d) => d[1])).toEqual(["25700", "25800"]);
    expect(peData[0][0]).toBe(2500);
    expect(ceData[1][0]).toBe(-9000);
  });

  test("layout: candle grid ~68%, depth grid ~30% with a gap", () => {
    const opt = asOpt(mockReport());
    expect(opt.grid).toHaveLength(2);
    expect(opt.grid[0].right).toBe("32%");
    expect(opt.grid[1].left).toBe("70%");
  });

  test("level tags live on the candle series (the price value axis), depth bars carry none", () => {
    const opt = asOpt(mockReport());
    const names = (opt.series[0].markLine?.data ?? []).map((d) => d.name);
    expect(names).toContain("CW 25,800");
    expect(names).toContain("PW 25,600");
    expect(names).toContain("MP 25,700");
    expect(names.some((n) => n.startsWith("Spot"))).toBe(true);
    // OI POC 25,800 dupes the CW 25,800 line → deduped, never doubled
    expect(names.some((n) => n.startsWith("OI POC"))).toBe(false);
    // A category axis cannot place arbitrary price levels: no markLines there
    expect(opt.series[1].markLine).toBeUndefined();
    expect(opt.series[2].markLine).toBeUndefined();
  });

  test("at most 6 bar labels; only top-3 CE + top-3 PE labeled", () => {
    const strikes = [];
    for (let s = 25000; s <= 26500; s += 50) {
      strikes.push(strikeAt(s, 1000 + s, 9000 - s));
    }
    const opt = asOpt(mockReport({ strikes }));
    const pe = opt.series[2];
    const fmt = pe.label?.formatter;
    expect(typeof fmt).toBe("function");
    const labeled = strikes
      .map((s) => s.strike)
      .filter((strike) => {
        const row = strikes.find((x) => x.strike === strike);
        const total = (row?.ce.oi ?? 0) + (row?.pe.oi ?? 0);
        return fmt?.({ value: [total, String(strike)] }) !== "";
      });
    expect(labeled.length).toBeLessThanOrEqual(6);
    expect(labeled.length).toBeGreaterThan(0);
  });

  test("dominance markers are size 6 with no labels", () => {
    const opt = asOpt(mockReport());
    const ceDom = opt.series.find((s) => s.name === "CE over PE");
    const peDom = opt.series.find((s) => s.name === "PE over CE");
    expect(ceDom?.symbolSize).toBe(6);
    expect(peDom?.symbolSize).toBe(6);
    expect(ceDom?.label?.show).toBe(false);
    expect(peDom?.label?.show).toBe(false);
    // 25800 is CE-heavy (9000 vs 1000), 25700 is PE-heavy (2000 vs 2500)
    expect(ceDom?.data).toHaveLength(1);
    expect(peDom?.data).toHaveLength(1);
  });
});

describe("NiftyDepthMap render", () => {
  test("happy path: stats, legend, chart and honesty note", () => {
    r(<NiftyDepthMap report={mockReport()} />);
    expect(screen.getByTestId("nifty-depthmap")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-depth-stats")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-depth-echarts")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-depth-legend")).toBeInTheDocument();

    const stats = screen.getByTestId("nifty-depth-stats");
    expect(within(stats).getByText("25,750")).toBeInTheDocument();
    expect(within(stats).getByText("1.12")).toBeInTheDocument();
    expect(within(stats).getByText("25,700")).toBeInTheDocument();

    const legend = screen.getByTestId("nifty-depth-legend");
    expect(within(legend).getByTestId("nifty-depth-legend-ce-dom")).toHaveTextContent("CE over PE");
    expect(within(legend).getByTestId("nifty-depth-legend-pe-dom")).toHaveTextContent("PE over CE");
    expect(within(legend).getByTestId("nifty-depth-legend-total")).toHaveTextContent("Total OI");
    expect(within(legend).getByTestId("nifty-depth-legend-poc")).toHaveTextContent("OI POC");
    expect(within(legend).getByTestId("nifty-depth-legend-chg")).toHaveTextContent("OI Chg");

    expect(screen.getByTestId("nifty-depth-note")).toHaveTextContent("no tick footprint");
  });

  test("empty strikes shows empty state instead of chart", () => {
    r(<NiftyDepthMap report={mockReport({ strikes: [] })} />);
    expect(screen.getByTestId("nifty-depthmap")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-depth-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-depth-echarts")).not.toBeInTheDocument();
  });

  test("empty candles shows dash placeholders in stats", () => {
    r(<NiftyDepthMap report={mockReport({ candles: [] })} />);
    const stats = screen.getByTestId("nifty-depth-stats");
    expect(within(screen.getByTestId("nifty-depth-stat-hilo")).getByText("—")).toBeInTheDocument();
    expect(within(stats).getByTestId("nifty-depth-stat-chg")).toHaveTextContent("—");
  });
});

describe("NiftyDepthMap active gate", () => {
  test("active={false} renders the container but performs no ECharts work", () => {
    r(<NiftyDepthMap report={mockReport()} active={false} />);
    expect(screen.getByTestId("nifty-depthmap")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-depth-echarts")).toBeInTheDocument();
    expect(depthMocks.mounts).toBe(1);
    expect(depthMocks.setOption).not.toHaveBeenCalled();
    expect(depthMocks.resize).not.toHaveBeenCalled();
  });

  test("automatic library updates are disabled — one manual driver only", () => {
    r(<NiftyDepthMap report={mockReport()} />);
    expect(typeof depthMocks.lastShouldSetOption).toBe("function");
    expect(depthMocks.lastShouldSetOption?.()).toBe(false);
  });

  test("report change while hidden stays silent; activate resizes + catches up", () => {
    const { rerender } = r(<NiftyDepthMap report={mockReport()} active={false} />);
    expect(depthMocks.setOption).not.toHaveBeenCalled();
    expect(depthMocks.resize).not.toHaveBeenCalled();

    // Report updates while hidden: still zero ECharts work.
    rerender(<NiftyDepthMap report={mockReport({ spot: 25800 })} active={false} />);
    expect(depthMocks.setOption).not.toHaveBeenCalled();
    expect(depthMocks.resize).not.toHaveBeenCalled();

    // Flipping to active: exactly one resize + one setOption with latest.
    rerender(<NiftyDepthMap report={mockReport({ spot: 25800 })} active />);
    expect(depthMocks.resize).toHaveBeenCalledTimes(1);
    expect(depthMocks.setOption).toHaveBeenCalledTimes(1);
    expect(depthMocks.mounts).toBe(1);
  });

  test("active report change pushes the new option exactly once", () => {
    const { rerender } = r(<NiftyDepthMap report={mockReport()} />);
    expect(depthMocks.setOption).toHaveBeenCalledTimes(1);
    expect(depthMocks.resize).toHaveBeenCalledTimes(1);
    rerender(<NiftyDepthMap report={mockReport({ spot: 25800 })} />);
    expect(depthMocks.setOption).toHaveBeenCalledTimes(2);
  });
});
