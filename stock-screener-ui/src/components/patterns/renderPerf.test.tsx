// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { memo, Profiler, act } from "react";
import { SimpleGrid, UIProvider } from "@/ui";
import type { PatternHitDTO } from "@/types/chartPatterns";
import type { MatrixCell, PatternMatrixRow } from "./symbolMatrix";
import { PatternCard, type PatternCardProps } from "./PatternCard";
import { PatternGrid } from "./PatternGrid";
import { PatternMiniChart } from "./PatternMiniChart";
import {
  matrixRenderStats,
  matrixRenderStatsReset,
  PatternSymbolMatrix,
  type MatrixRenderStats,
} from "./PatternSymbolMatrix";
import {
  getChartPatternsState,
  loadResults,
  resetChartPatternsState,
  subscribe,
} from "@/state/chartPatterns";

vi.mock("@/hooks/useECharts", () => ({
  useECharts: () => ({
    chartRef: { current: null },
    chartInstance: { current: null },
    setChartOption: vi.fn(),
  }),
}));

vi.mock("@/api/chartPatterns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/chartPatterns")>();
  return {
    ...actual,
    streamResults: vi.fn(),
    fetchResults: vi.fn(),
    startScan: vi.fn(),
  };
});

import { streamResults } from "@/api/chartPatterns";
const mockedStreamResults = vi.mocked(streamResults);

const SUMMARY = {
  scanned: 500,
  patterns: 12,
  in_view: 8,
  confirmed: 5,
  bullish: 4,
  bearish: 1,
  data_through: "2026-09-30",
};

function makeHit(id: number, symbol: string): PatternHitDTO {
  return {
    id,
    symbol,
    name: `${symbol} Ltd.`,
    timeframe: "1D",
    pattern_id: "falling_wedge",
    pattern_name: "Falling Wedge",
    family: "reversal",
    direction: "bullish",
    status: "confirmed",
    quality: "strong",
    confidence: 78.4,
    start_date: "2026-04-26",
    end_date: "2026-09-26",
    start_price: 100,
    end_price: 112.6,
    breakout_level: 112.6,
    target: 129.6,
    stop: 102.5,
    rr: 1.7,
    bars_ago: 2,
    volume_confirmed: true,
    trendlines: [],
    notes: "",
  };
}

function renderWithUI(ui: React.ReactElement) {
  return render(ui, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

/** Mount `ui`, re-render once with `next()`, and tally Profiler commits + time. */
function measure(ui: React.ReactElement, next: () => React.ReactElement) {
  let commits = 0;
  let mountMs = 0;
  let updateMs = 0;
  const { rerender } = renderWithUI(
    <Profiler
      id="perf"
      onRender={(_id, phase, actualDuration) => {
        commits += 1;
        if (phase === "mount") mountMs += actualDuration ?? 0;
        else updateMs += actualDuration ?? 0;
      }}
    >
      {ui}
    </Profiler>
  );
  act(() => {
    rerender(next());
  });
  return { commits, mountMs, updateMs };
}

describe("render perf — patterns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChartPatternsState();
  });
  afterEach(() => {
    cleanup();
    resetChartPatternsState();
  });

  test("mounts 60 cards and keeps all testids", () => {
    const hits = Array.from({ length: 60 }, (_, i) => makeHit(100 + i, `S${i}`));
    renderWithUI(<PatternGrid hits={hits} onSelect={vi.fn()} />);
    expect(screen.getByTestId("patterns-grid")).toBeInTheDocument();
    expect(screen.getAllByTestId("patterns-card")).toHaveLength(60);
    expect(screen.getByTestId("patterns-card-S0-falling_wedge")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-mini-chart-S0-falling_wedge")).toBeInTheDocument();
  });

  test("PatternCard identical re-render (profiler)", () => {
    const hit = makeHit(1, "IRCON");
    const onClick = vi.fn();
    const { commits, mountMs, updateMs } = measure(
      <PatternCard hit={hit} onClick={onClick} />,
      () => <PatternCard hit={hit} onClick={onClick} />
    );
    // eslint-disable-next-line no-console
    console.log(
      `[PERF] PatternCard identical re-render commits=${commits} mountMs=${mountMs.toFixed(2)} updateMs=${updateMs.toFixed(2)}`
    );
    expect(screen.getByTestId("patterns-card-IRCON-falling_wedge")).toBeInTheDocument();
  });

  test("PatternMiniChart identical re-render (profiler)", () => {
    const hit = makeHit(1, "IRCON");
    const { commits, mountMs, updateMs } = measure(
      <PatternMiniChart hit={hit} />,
      () => <PatternMiniChart hit={hit} />
    );
    // eslint-disable-next-line no-console
    console.log(
      `[PERF] PatternMiniChart identical re-render commits=${commits} mountMs=${mountMs.toFixed(2)} updateMs=${updateMs.toFixed(2)}`
    );
    expect(screen.getByTestId("patterns-mini-chart-IRCON-falling_wedge")).toBeInTheDocument();
  });

  test("PatternGrid identical-hits re-render (profiler)", () => {
    const hits = Array.from({ length: 60 }, (_, i) => makeHit(100 + i, `S${i}`));
    const cb = vi.fn();
    const grid = () => (
      <PatternGrid
        hits={hits}
        onSelect={cb}
        onExpand={cb}
        onShowMembers={cb}
        onSymbolPreview={cb}
        onSymbolPreviewEnd={cb}
        onSymbolOpen={cb}
        activeHit={null}
      />
    );
    const { commits, mountMs, updateMs } = measure(grid(), grid);
    // eslint-disable-next-line no-console
    console.log(
      `[PERF] PatternGrid identical-hits re-render commits=${commits} mountMs=${mountMs.toFixed(2)} updateMs=${updateMs.toFixed(2)}`
    );
    expect(screen.getAllByTestId("patterns-card")).toHaveLength(60);
  }, 20000);

  test("streaming 44 items ends with the full list, no error", async () => {
    const hits = Array.from({ length: 44 }, (_, i) => makeHit(1000 + i, `SYM${i}`));
    let notifyCount = 0;
    const unsub = subscribe(() => {
      notifyCount += 1;
    });
    mockedStreamResults.mockImplementation(async (_query, handlers) => {
      handlers.onMeta?.({ total: 44, summary: SUMMARY, data_through: "2026-09-30" });
      for (const hit of hits) {
        handlers.onItem?.(hit as never);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      handlers.onDone?.();
    });

    await loadResults();
    unsub();

    const state = getChartPatternsState();
    // eslint-disable-next-line no-console
    console.log(
      `[PERF] stream 44 items notifyCount=${notifyCount} results=${state.results.length} streaming=${state.streaming}`
    );
    expect(state.results).toHaveLength(44);
    expect(state.streaming).toBe(false);
    expect(state.error).toBeNull();
  });
});

describe("PatternSymbolMatrix render counts", () => {
  let rows: PatternMatrixRow[];
  let timeframes: string[];

  beforeEach(() => {
    matrixRenderStatsReset();
    const hit5m = perfHit({
      id: 11,
      symbol: "AAA",
      timeframe: "5m",
      pattern_name: "Double Bottom",
      direction: "bullish",
      status: "confirmed",
      confidence: 82.5,
      breakout_score: 73.4,
      range_pos: 88,
    });
    const hit1d = perfHit({
      id: 12,
      symbol: "AAA",
      timeframe: "1D",
      pattern_name: "Head and Shoulders",
      direction: "bearish",
      status: "forming",
      confidence: 55,
      breakout_score: null,
    });
    const hit1dB = perfHit({
      id: 21,
      symbol: "BBB",
      timeframe: "1D",
      pattern_name: "Ascending Triangle",
      direction: "bullish",
      status: "confirmed",
      confidence: 66.4,
      breakout_score: 41.6,
      range_pos: 61.7,
    });
    rows = [
      perfRow(
        "AAA",
        "Alpha Industries Ltd.",
        1234.5,
        2.5,
        [hit1d, hit5m],
        hit5m,
        {
          "5m": perfCell({ confidence: 82.5, patterns: ["Double Bottom"], best_id: 11 }),
          "1D": perfCell({
            direction: "bearish",
            status: "forming",
            confidence: 55,
            patterns: ["Head and Shoulders"],
            best_id: 12,
          }),
        },
      ),
      perfRow(
        "BBB",
        null,
        null,
        null,
        [hit1dB],
        hit1dB,
        { "1D": perfCell({ confidence: 66.4, patterns: ["Ascending Triangle"], best_id: 21 }) },
      ),
    ];
    timeframes = ["1D", "5m"];
  });
  afterEach(() => cleanup());

  function perfHit(overrides: Partial<PatternHitDTO>): PatternHitDTO {
    return {
      id: 1,
      symbol: "AAA",
      name: null,
      timeframe: "1D",
      pattern_id: "double_bottom",
      pattern_name: "Double Bottom",
      family: "reversal",
      direction: "bullish",
      status: "confirmed",
      quality: "strong",
      confidence: 80,
      start_date: "2026-01-01",
      end_date: "2026-02-01",
      start_price: 100,
      end_price: 110,
      breakout_level: 110,
      target: 125,
      stop: 98,
      rr: 2,
      bars_ago: 3,
      volume_confirmed: true,
      trendlines: [],
      notes: "",
      ...overrides,
    };
  }

  function perfCell(overrides: Partial<MatrixCell> = {}): MatrixCell {
    return {
      direction: "bullish",
      status: "confirmed",
      count: 1,
      confidence: 80,
      patterns: ["Double Bottom"],
      best_id: 1,
      ...overrides,
    };
  }

  function perfRow(
    symbol: string,
    name: string | null,
    ltp: number | null,
    change: number | null,
    hits: PatternHitDTO[],
    best: PatternHitDTO | null,
    timeframes: Record<string, MatrixCell>,
  ): PatternMatrixRow {
    return {
      symbol,
      name,
      ltp,
      day_change_pct: change,
      timeframes,
      hits,
      best,
      hit_count: hits.length,
    };
  }

  function delta(before: MatrixRenderStats, after: MatrixRenderStats): MatrixRenderStats {
    const out: Partial<MatrixRenderStats> = {};
    for (const key of Object.keys(before) as Array<keyof MatrixRenderStats>) {
      out[key] = after[key] - before[key];
    }
    return out as MatrixRenderStats;
  }

  function mountMatrix(overrides: Partial<React.ComponentProps<typeof PatternSymbolMatrix>> = {}) {
    return render(
      <UIProvider>
        <PatternSymbolMatrix rows={rows} timeframes={timeframes} onSelect={vi.fn()} {...overrides} />
      </UIProvider>,
    );
  }

  test("mount builds columns and visible rows once, and renders every cell once", () => {
    const before = matrixRenderStats();
    mountMatrix();
    const d = delta(before, matrixRenderStats());
    expect(d.matrixRenders).toBe(1);
    expect(d.columnsBuilds).toBe(1);
    expect(d.visibleRowsBuilds).toBe(1);
    expect(d.symbolCellRenders).toBe(2);
    expect(d.tfGlyphRenders).toBe(4); // 2 rows × 2 timeframe columns
    expect(d.patternChipRenders).toBe(3); // 2 chips on AAA + 1 on BBB
    expect(d.numTextRenders).toBe(8); // LTP/Chg%/Score/Pos% × 2 rows
    expect(screen.getByTestId("patterns-symbol-matrix")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-matrix-row-AAA")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-matrix-row-BBB")).toBeInTheDocument();
  });

  test("identical props re-render rebuilds no columns and no cells", () => {
    mountMatrix(); // discarded container
    const { container, rerender } = mountMatrix();
    const before = matrixRenderStats();
    rerender(
      <UIProvider>
        <PatternSymbolMatrix rows={rows} timeframes={timeframes} onSelect={vi.fn()} />
      </UIProvider>,
    );
    const d = delta(before, matrixRenderStats());
    // The matrix function re-runs (props object is new) but every memo bails out.
    expect(d.matrixRenders).toBe(1);
    expect(d.columnsBuilds).toBe(0);
    expect(d.visibleRowsBuilds).toBe(0);
    expect(d.symbolCellRenders).toBe(0);
    expect(d.tfGlyphRenders).toBe(0);
    expect(d.patternChipRenders).toBe(0);
    expect(d.numTextRenders).toBe(0);
    expect(within(container).getByTestId("patterns-matrix-row-AAA")).toBeInTheDocument();
  });

  test("opening a chart (new callbacks + activeSymbol) rebuilds no columns and no cells", () => {
    const { rerender } = mountMatrix({ activeSymbol: null });
    const before = matrixRenderStats();
    const onSelect2 = vi.fn();
    rerender(
      <UIProvider>
        <PatternSymbolMatrix
          rows={rows}
          timeframes={timeframes}
          onSelect={onSelect2}
          activeSymbol="AAA"
        />
      </UIProvider>,
    );
    const d = delta(before, matrixRenderStats());
    // The highlight changed, so the matrix re-runs once; columns and every
    // memoised cell must bail out even though `onSelect` identity changed.
    expect(d.matrixRenders).toBe(1);
    expect(d.columnsBuilds).toBe(0);
    expect(d.visibleRowsBuilds).toBe(0);
    expect(d.symbolCellRenders).toBe(0);
    expect(d.tfGlyphRenders).toBe(0);
    expect(d.patternChipRenders).toBe(0);
    expect(d.numTextRenders).toBe(0);
    // Markup and testids are identical; only the highlight moved.
    expect(screen.getByTestId("patterns-matrix-row-AAA")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("patterns-matrix-row-BBB")).not.toHaveAttribute("data-active");
    expect(screen.getByTestId("patterns-matrix-tv-AAA")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-matrix-chart-AAA")).toBeInTheDocument();
  });

  test("filter change (new rows) rebuilds visible rows once, columns never", () => {
    const { rerender } = mountMatrix();
    const before = matrixRenderStats();
    const hitC = perfHit({ id: 31, symbol: "CCC", timeframe: "5m", pattern_name: "Flag", confidence: 90 });
    const rowC = perfRow("CCC", null, 50, 1, [hitC], hitC, { "5m": perfCell({ confidence: 90 }) });
    rerender(
      <UIProvider>
        <PatternSymbolMatrix rows={[...rows, rowC]} timeframes={timeframes} onSelect={vi.fn()} />
      </UIProvider>,
    );
    const d = delta(before, matrixRenderStats());
    // Rows changed, so visibleRows rebuilds exactly once; columns must not
    // be rebuilt by callback identity (onSelect is a new vi.fn each render).
    expect(d.matrixRenders).toBe(1);
    expect(d.columnsBuilds).toBe(0);
    expect(d.visibleRowsBuilds).toBe(1);
    expect(screen.getByTestId("patterns-matrix-row-CCC")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-matrix-row-AAA")).toBeInTheDocument();
  });
});

describe("render perf — 200-card grid (results limit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChartPatternsState();
  });
  afterEach(() => {
    cleanup();
    resetChartPatternsState();
  });

  /** Wraps PatternCard so the test can count how many times a card actually renders. */
  interface CountingCardProps extends PatternCardProps {
    counter: { renders: number };
  }
  function countingCard(props: CountingCardProps) {
    props.counter.renders += 1;
    return <PatternCard {...props} />;
  }
  const CountingCard = memo(countingCard);

  test("mount 200 cards — wall ms + card render counts", () => {
    const counter = { renders: 0 };
    const hits = Array.from({ length: 200 }, (_, i) => makeHit(1000 + i, `P${i}`));
    const t0 = performance.now();
    renderWithUI(
      <SimpleGrid data-testid="patterns-grid" cols={4} spacing={16}>
        {hits.map((hit) => <CountingCard key={hit.id} hit={hit} counter={counter} />)}
      </SimpleGrid>
    );
    const mountMs = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(
      `[PERF] mount 200 cards: ${mountMs.toFixed(2)} ms, card renders=${counter.renders}`,
    );
    expect(screen.getByTestId("patterns-grid")).toBeInTheDocument();
    expect(screen.getAllByTestId("patterns-card")).toHaveLength(200);
    expect(screen.getByTestId("patterns-card-P0-falling_wedge")).toBeInTheDocument();
    expect(counter.renders).toBe(200);
  }, 20000);

  test("update 200 cards with identical hits — card render count stays flat", () => {
    const counter = { renders: 0 };
    const hits = Array.from({ length: 200 }, (_, i) => makeHit(1000 + i, `P${i}`));
    const { rerender } = renderWithUI(
      <SimpleGrid data-testid="patterns-grid" cols={4} spacing={16}>
        {hits.map((hit) => <CountingCard key={hit.id} hit={hit} counter={counter} />)}
      </SimpleGrid>
    );
    const mountRenders = counter.renders;
    const t0 = performance.now();
    act(() => {
      rerender(
        <SimpleGrid data-testid="patterns-grid" cols={4} spacing={16}>
          {hits.map((hit) => <CountingCard key={hit.id} hit={hit} counter={counter} />)}
        </SimpleGrid>
      );
    });
    const updateMs = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(
      `[PERF] update 200 cards identical: ${updateMs.toFixed(2)} ms, card renders=${counter.renders} (mount ${mountRenders})`,
    );
    expect(screen.getAllByTestId("patterns-card")).toHaveLength(200);
    expect(counter.renders).toBe(mountRenders); // memo bails out: zero extra card renders
  }, 20000);
});
