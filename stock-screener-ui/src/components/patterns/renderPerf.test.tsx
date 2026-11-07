// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Profiler, act } from "react";
import { UIProvider } from "@/ui";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { PatternCard } from "./PatternCard";
import { PatternGrid } from "./PatternGrid";
import { PatternMiniChart } from "./PatternMiniChart";
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
  });

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
