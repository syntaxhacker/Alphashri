// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  return mockSolidUi();
});
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createSignal, For, type JSX } from "solid-js";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { SimpleGrid, UIProvider } from "@/ui";
import type { ChartCandle, PatternHitDTO } from "@/types/chartPatterns";
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

vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: async () => ({
    init: () => ({
      setOption: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
    }),
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

/**
 * Wall-time tripwires for the dense results grid, recorded from the measured
 * numbers logged below (dev box, happy-dom). They sit ~3-4x above the quiet-load
 * figure because the harness is dominated by node insertion and CI runs 20
 * shards x 4 workers on shared vCPUs; a slow machine must not fail the suite,
 * but a card that gets materially heavier still trips. The authoritative number
 * for any change is the `[PERF]` log line, not these limits.
 */
const BUDGET = {
  card: 150,
  miniChart: 50,
  grid60: 5000,
  grid200: 10000,
  grid200Candles: 12000,
  update200: 300,
};

function budget(label: string, ms: number, limit: number): string {
  return `${label}: ${ms.toFixed(2)} ms (budget ${limit} ms)`;
}

/** 120 one-minute candles — the shape a real hit carries into the grid. */
function makeCandles(count: number): ChartCandle[] {
  return Array.from({ length: count }, (_, i) => {
    const o = 100 + Math.sin(i / 7) * 5 + i * 0.05;
    const c = o + Math.cos(i / 5) * 2;
    return {
      t: `2026-09-${String((i % 27) + 1).padStart(2, "0")}`,
      o,
      h: Math.max(o, c) + 1,
      l: Math.min(o, c) - 1,
      c,
      v: 1000,
    };
  });
}

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
    render(() => <PatternGrid hits={hits} onSelect={vi.fn()} />);
    expect(screen.getByTestId("patterns-grid")).toBeInTheDocument();
    expect(screen.getAllByTestId("patterns-card")).toHaveLength(60);
    expect(screen.getByTestId("patterns-card-S0-falling_wedge")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-mini-chart-S0-falling_wedge")).toBeInTheDocument();
  });

  test("PatternCard mount stays within a sane wall-time budget", () => {
    const hit = makeHit(1, "IRCON");
    const onClick = vi.fn();
    const t0 = performance.now();
    render(() => <PatternCard hit={hit} onClick={onClick} />);
    const mountMs = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[PERF] PatternCard mount ${mountMs.toFixed(2)} ms`);
    expect(mountMs, budget("PatternCard mount", mountMs, BUDGET.card)).toBeLessThan(BUDGET.card);
    expect(screen.getByTestId("patterns-card-IRCON-falling_wedge")).toBeInTheDocument();
  });

  test("PatternMiniChart mount stays within a sane wall-time budget", () => {
    const hit = makeHit(1, "IRCON");
    const t0 = performance.now();
    render(() => <PatternMiniChart hit={hit} />);
    const mountMs = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[PERF] PatternMiniChart mount ${mountMs.toFixed(2)} ms`);
    expect(mountMs, budget("PatternMiniChart mount", mountMs, BUDGET.miniChart)).toBeLessThan(BUDGET.miniChart);
    expect(screen.getByTestId("patterns-mini-chart-IRCON-falling_wedge")).toBeInTheDocument();
  });

  test("PatternGrid mounts identical hits once per card", () => {
    const hits = Array.from({ length: 60 }, (_, i) => makeHit(100 + i, `S${i}`));
    const cb = vi.fn();
    const t0 = performance.now();
    render(() => (
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
    ));
    const mountMs = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[PERF] PatternGrid 60-card mount ${mountMs.toFixed(2)} ms`);
    expect(mountMs, budget("PatternGrid 60-card mount", mountMs, BUDGET.grid60)).toBeLessThan(BUDGET.grid60);
    expect(screen.getAllByTestId("patterns-card")).toHaveLength(60);
  }, 20000);

  test("streaming 44 items ends with the full list, no error", async () => {
    const hits = Array.from({ length: 44 }, (_, i) => makeHit(1000 + i, `SYM${i}`));
    let notifyCount = 0;
    const unsub = subscribe(() => {
      notifyCount += 1;
    });
    mockedStreamResults.mockImplementation(async (_query, handlers) => {
      if (!handlers) return;
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
    timeframesMap: Record<string, MatrixCell>,
  ): PatternMatrixRow {
    return {
      symbol,
      name,
      ltp,
      day_change_pct: change,
      timeframes: timeframesMap,
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

  function mountMatrix(overrides: {
    rows?: () => PatternMatrixRow[];
    activeSymbol?: () => string | null | undefined;
  } = {}) {
    return render(() => (
      <UIProvider>
        <PatternSymbolMatrix
          rows={overrides.rows ? overrides.rows() : rows}
          timeframes={timeframes}
          onSelect={vi.fn()}
          activeSymbol={overrides.activeSymbol ? overrides.activeSymbol() : undefined}
        />
      </UIProvider>
    ));
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

  test("setting the active symbol rebuilds no columns and no cells", () => {
    const [active, setActive] = createSignal<string | null>(null);
    mountMatrix({ activeSymbol: () => active() });
    const before = matrixRenderStats();
    setActive("AAA");
    const d = delta(before, matrixRenderStats());
    // The highlight is read inline by each row; columns and memoised cells
    // never rebuild even though the active symbol changed.
    expect(d.matrixRenders).toBe(0);
    expect(d.columnsBuilds).toBe(0);
    expect(d.visibleRowsBuilds).toBe(0);
    expect(d.symbolCellRenders).toBe(0);
    expect(d.tfGlyphRenders).toBe(0);
    expect(d.patternChipRenders).toBe(0);
    expect(d.numTextRenders).toBe(0);
    expect(screen.getByTestId("patterns-matrix-row-AAA")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("patterns-matrix-row-BBB")).not.toHaveAttribute("data-active");
    expect(screen.getByTestId("patterns-matrix-tv-AAA")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-matrix-chart-AAA")).toBeInTheDocument();
    setActive(null);
    expect(screen.getByTestId("patterns-matrix-row-AAA")).not.toHaveAttribute("data-active");
  });

  test("filter change (new rows) rebuilds visible rows once, columns never", () => {
    const [rowsSignal, setRowsSignal] = createSignal<PatternMatrixRow[]>(rows);
    mountMatrix({ rows: () => rowsSignal() });
    const before = matrixRenderStats();
    const hitC = perfHit({ id: 31, symbol: "CCC", timeframe: "5m", pattern_name: "Flag", confidence: 90 });
    const rowC = perfRow("CCC", null, 50, 1, [hitC], hitC, { "5m": perfCell({ confidence: 90 }) });
    setRowsSignal([...rows, rowC]);
    const d = delta(before, matrixRenderStats());
    // Rows changed, so visibleRows rebuilds exactly once; columns must not rebuild.
    expect(d.matrixRenders).toBe(0);
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
  function CountingCard(props: CountingCardProps): JSX.Element {
    props.counter.renders += 1;
    const { counter: _counter, ...rest } = props;
    return <PatternCard {...rest} />;
  }

  test("mount 200 cards — wall ms + card render counts", () => {
    const counter = { renders: 0 };
    const hits = Array.from({ length: 200 }, (_, i) => makeHit(1000 + i, `P${i}`));
    const t0 = performance.now();
    render(() => (
      <SimpleGrid data-testid="patterns-grid" cols={4} spacing={16}>
        <For each={hits}>{(hit) => <CountingCard hit={hit} counter={counter} />}</For>
      </SimpleGrid>
    ));
    const mountMs = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[PERF] mount 200 cards: ${mountMs.toFixed(2)} ms, card renders=${counter.renders}`);
    expect(mountMs, budget("mount 200 cards", mountMs, BUDGET.grid200)).toBeLessThan(BUDGET.grid200);
    expect(screen.getByTestId("patterns-grid")).toBeInTheDocument();
    expect(screen.getAllByTestId("patterns-card")).toHaveLength(200);
    expect(screen.getByTestId("patterns-card-P0-falling_wedge")).toBeInTheDocument();
    expect(counter.renders).toBe(200);
  }, 20000);

  test("mount 200 cards that each carry a candle window stays within budget", () => {
    const counter = { renders: 0 };
    const hits = Array.from({ length: 200 }, (_, i) => ({
      ...makeHit(2000 + i, `C${i}`),
      candles: makeCandles(120),
    }));
    const t0 = performance.now();
    render(() => (
      <SimpleGrid data-testid="patterns-grid" cols={4} spacing={16}>
        <For each={hits}>{(hit) => <CountingCard hit={hit} counter={counter} />}</For>
      </SimpleGrid>
    ));
    const mountMs = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(
      `[PERF] mount 200 cards with 120 candles: ${mountMs.toFixed(2)} ms, card renders=${counter.renders}`,
    );
    expect(
      mountMs,
      budget("mount 200 candle cards", mountMs, BUDGET.grid200Candles),
    ).toBeLessThan(BUDGET.grid200Candles);
    expect(screen.getAllByTestId("patterns-card")).toHaveLength(200);
    expect(counter.renders).toBe(200);
    expect(screen.getByTestId("patterns-mini-chart-C0-falling_wedge")).toBeInTheDocument();
  }, 20000);

  test("setting the list to a new array of the same hit objects renders no new cards", () => {
    const counter = { renders: 0 };
    const hits = Array.from({ length: 200 }, (_, i) => makeHit(1000 + i, `P${i}`));
    const [items, setItems] = createSignal(hits);
    render(() => (
      <SimpleGrid data-testid="patterns-grid" cols={4} spacing={16}>
        <For each={items()}>{(hit) => <CountingCard hit={hit} counter={counter} />}</For>
      </SimpleGrid>
    ));
    const mountRenders = counter.renders;
    const t0 = performance.now();
    setItems([...hits]);
    const updateMs = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(
      `[PERF] update 200 cards identical: ${updateMs.toFixed(2)} ms, card renders=${counter.renders} (mount ${mountRenders})`,
    );
    expect(updateMs, budget("update 200 cards identical", updateMs, BUDGET.update200)).toBeLessThan(BUDGET.update200);
    expect(screen.getAllByTestId("patterns-card")).toHaveLength(200);
    expect(counter.renders).toBe(mountRenders); // For keys by reference: zero extra card renders
  }, 20000);
});
