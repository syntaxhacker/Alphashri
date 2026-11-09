// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { UIProvider } from "@/ui";
import type { PatternHitDTO } from "../types/chartPatterns";
import {
  fullscreenDedupeKey,
  fullscreenHitIdentity,
  usePatternFullscreen,
} from "./usePatternFullscreen";

vi.mock("../api/chartPatterns", () => ({
  fetchSymbolChart: vi.fn(),
  fetchPatternHit: vi.fn(),
}));

import { fetchPatternHit, fetchSymbolChart } from "../api/chartPatterns";

const mockedFetchSymbolChart = vi.mocked(fetchSymbolChart);
const mockedFetchPatternHit = vi.mocked(fetchPatternHit);

function makeHit(overrides: Partial<PatternHitDTO> = {}): PatternHitDTO {
  return {
    id: 7,
    symbol: "IRCON",
    name: null,
    timeframe: "1D",
    pattern_id: "falling_wedge",
    pattern_name: "Falling Wedge",
    family: "reversal",
    direction: "bullish",
    status: "confirmed",
    quality: "strong",
    confidence: 80,
    start_date: "2026-08-01",
    end_date: "2026-09-20",
    start_price: 100,
    end_price: 120,
    breakout_level: 120,
    target: 130,
    stop: 95,
    rr: 2,
    bars_ago: 5,
    volume_confirmed: false,
    trendlines: [],
    notes: "",
    ...overrides,
  };
}

function candle(overrides: Partial<{ t: string; o: number; h: number; l: number; c: number; v: number }> = {}) {
  return {
    t: "2026-09-20",
    o: 118,
    h: 122,
    l: 117,
    c: 120,
    v: 1000,
    ...overrides,
  };
}

function Harness({
  onReady,
  scopeKey,
  resolutionKey,
}: {
  onReady: (api: ReturnType<typeof usePatternFullscreen>) => void;
  scopeKey?: string | null;
  resolutionKey?: string | null;
}) {
  const api = usePatternFullscreen({ timeframe: "1D", scopeKey, resolutionKey });
  const ref = useRef(api);
  ref.current = api;
  useEffectOnce(ref, onReady);
  return (
    <div>
      <span data-testid="fs-symbol">{api.fullscreen?.symbol ?? "none"}</span>
      <span data-testid="fs-hit">{api.fullscreen?.hit?.pattern_id ?? "none"}</span>
      <span data-testid="fs-status">{api.fullscreen?.hit?.status ?? "none"}</span>
      <span data-testid="fs-count">{api.fullscreen?.hits.length ?? 0}</span>
      <span data-testid="fs-candles">{api.fullscreen?.candles.length ?? 0}</span>
      <span data-testid="fs-loading">{api.fullscreen?.loading ? "yes" : "no"}</span>
      <span data-testid="fs-patterns-loading">{api.fullscreen?.patternsLoading ? "yes" : "no"}</span>
    </div>
  );
}

import { useEffect, useRef } from "react";

function useEffectOnce(api: { current: ReturnType<typeof usePatternFullscreen> }, onReady: (api: ReturnType<typeof usePatternFullscreen>) => void) {
  useEffect(() => {
    onReady({
      get fullscreen() {
        return api.current.fullscreen;
      },
      openFromCard: (...args) => api.current.openFromCard(...args),
      openFromSymbol: (...args) => api.current.openFromSymbol(...args),
      changeFullscreenTimeframe: (...args) => api.current.changeFullscreenTimeframe(...args),
      changeFullscreenAsOf: (...args) => api.current.changeFullscreenAsOf(...args),
      selectFullscreenHit: (...args) => api.current.selectFullscreenHit(...args),
      closeFullscreen: (...args) => api.current.closeFullscreen(...args),
    } as ReturnType<typeof usePatternFullscreen>);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

describe("fullscreen key helpers", () => {
  test("identity uses the DB id when present", () => {
    expect(fullscreenHitIdentity(makeHit({ id: 42 }))).toBe("42");
  });

  test("dedupe key ignores the DB id so stored + live twins merge", () => {
    const stored = makeHit({ id: 42 });
    const live = makeHit({ id: null });
    expect(fullscreenDedupeKey(stored)).toBe(fullscreenDedupeKey(live));
  });
});

describe("usePatternFullscreen", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  test("openFromSymbol promotes the newest hit", async () => {
    const older = makeHit({ id: 1, pattern_id: "double_bottom", end_date: "2026-08-01", bars_ago: 30 });
    const newer = makeHit({ id: null, pattern_id: "falling_wedge", end_date: "2026-09-20", bars_ago: 5 });
    // Phase 1 (detectPatterns=0) + phase 2 (detectPatterns=1) both resolve immediately.
    mockedFetchSymbolChart.mockResolvedValue({ candles: [], hits: [older, newer], trend_lines: [] } as never);
    let api!: ReturnType<typeof usePatternFullscreen>;
    render(
      <UIProvider>
        <Harness onReady={(a) => { api = a; }} />
      </UIProvider>,
    );
    await act(async () => {
      api.openFromSymbol("IRCON");
    });
    await waitFor(() => expect(screen.getByTestId("fs-hit")).toHaveTextContent("falling_wedge"));
    expect(screen.getByTestId("fs-symbol")).toHaveTextContent("IRCON");
    expect(screen.getByTestId("fs-count")).toHaveTextContent("2");
    expect(screen.getByTestId("fs-loading")).toHaveTextContent("no");
    expect(screen.getByTestId("fs-patterns-loading")).toHaveTextContent("no");
    expect(mockedFetchSymbolChart).toHaveBeenCalledTimes(2);
    expect(mockedFetchSymbolChart).toHaveBeenNthCalledWith(
      1,
      "IRCON",
      "1D",
      expect.objectContaining({ detectPatterns: false }),
    );
    expect(mockedFetchSymbolChart).toHaveBeenNthCalledWith(
      2,
      "IRCON",
      "1D",
      expect.objectContaining({ detectPatterns: true }),
    );
  });

  test("openFromCard uses the stored hit and skips live detection", async () => {
    const slim = makeHit({ id: 7, trendlines: [], pivots: [] });
    const full = makeHit({
      id: 7,
      trendlines: [[{ t: "2026-08-01", price: 100 }, { t: "2026-09-20", price: 120 }]],
      pivots: [{ t: "2026-08-01", price: 100, kind: "low" }],
    });
    mockedFetchPatternHit.mockResolvedValue(full);
    mockedFetchSymbolChart.mockResolvedValue({ candles: [], hits: [], trend_lines: [] } as never);
    let api!: ReturnType<typeof usePatternFullscreen>;
    render(
      <UIProvider>
        <Harness onReady={(a) => { api = a; }} />
      </UIProvider>,
    );
    await act(async () => {
      api.openFromCard(slim);
    });
    await waitFor(() => expect(screen.getByTestId("fs-hit")).toHaveTextContent("falling_wedge"));
    expect(mockedFetchPatternHit).toHaveBeenCalledWith(7);
    expect(mockedFetchSymbolChart).toHaveBeenCalledWith(
      "IRCON",
      "1D",
      expect.objectContaining({ detectPatterns: false }),
    );
    expect(screen.getByTestId("fs-count")).toHaveTextContent("1");
    expect(screen.getByTestId("fs-loading")).toHaveTextContent("no");
  });

  test("stale responses never overwrite a newer selection", async () => {
    let resolveFirst!: (v: unknown) => void;
    mockedFetchSymbolChart.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );
    mockedFetchSymbolChart.mockResolvedValueOnce({ candles: [], hits: [makeHit()], trend_lines: [] } as never);
    let api!: ReturnType<typeof usePatternFullscreen>;
    render(
      <UIProvider>
        <Harness onReady={(a) => { api = a; }} />
      </UIProvider>,
    );
    let second!: Promise<void>;
    await act(async () => {
      api.openFromSymbol("IRCON");
      second = (async () => { api.openFromSymbol("RELIANCE"); })();
    });
    await act(async () => {
      await second;
    });
    await act(async () => {
      resolveFirst({ candles: [], hits: [makeHit({ symbol: "IRCON" })], trend_lines: [] });
    });
    // The newer RELIANCE selection stands; the stale IRCON phase-1 response is dropped.
    expect(screen.getByTestId("fs-symbol")).toHaveTextContent("RELIANCE");
  });

  test("timeframe switch reloads and close clears", async () => {
    mockedFetchSymbolChart.mockResolvedValue({ candles: [], hits: [makeHit()], trend_lines: [] } as never);
    let api!: ReturnType<typeof usePatternFullscreen>;
    render(
      <UIProvider>
        <Harness onReady={(a) => { api = a; }} />
      </UIProvider>,
    );
    await act(async () => {
      api.openFromSymbol("IRCON");
    });
    await waitFor(() => expect(screen.getByTestId("fs-hit")).toHaveTextContent("falling_wedge"));
    await act(async () => {
      api.changeFullscreenTimeframe("1h");
    });
    // Last call is phase 2 (detection enabled) for the new timeframe.
    expect(mockedFetchSymbolChart).toHaveBeenLastCalledWith("IRCON", "1h", expect.objectContaining({ detectPatterns: true }));
    await act(async () => {
      api.closeFullscreen();
    });
    expect(screen.getByTestId("fs-symbol")).toHaveTextContent("none");
  });

  test("a scopeKey change closes an open chart", async () => {
    mockedFetchPatternHit.mockResolvedValue(makeHit({ id: 7 }));
    mockedFetchSymbolChart.mockResolvedValue({ candles: [], hits: [], trend_lines: [] } as never);
    let api!: ReturnType<typeof usePatternFullscreen>;
    const onReady = (a: ReturnType<typeof usePatternFullscreen>) => {
      api = a;
    };
    const { rerender } = render(
      <UIProvider>
        <Harness onReady={onReady} scopeKey="nifty500|1D" resolutionKey="scan-1" />
      </UIProvider>,
    );
    await act(async () => {
      api.openFromCard(makeHit({ id: 7 }));
    });
    await waitFor(() => expect(screen.getByTestId("fs-symbol")).toHaveTextContent("IRCON"));

    // Same resolution key: the chart must close purely because the scope moved.
    rerender(
      <UIProvider>
        <Harness onReady={onReady} scopeKey="nifty50|1D" resolutionKey="scan-1" />
      </UIProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("fs-symbol")).toHaveTextContent("none"));
    expect(mockedFetchPatternHit).toHaveBeenCalledTimes(1);
  });

  test("a resolutionKey change re-fetches a stored hit and updates its status", async () => {
    mockedFetchPatternHit
      .mockResolvedValueOnce(makeHit({ id: 7, status: "confirmed" }))
      .mockResolvedValueOnce(makeHit({ id: 7, status: "failed", confidence: 42 }));
    mockedFetchSymbolChart.mockResolvedValue({ candles: [], hits: [], trend_lines: [] } as never);
    let api!: ReturnType<typeof usePatternFullscreen>;
    const onReady = (a: ReturnType<typeof usePatternFullscreen>) => {
      api = a;
    };
    const { rerender } = render(
      <UIProvider>
        <Harness onReady={onReady} scopeKey="nifty500|1D" resolutionKey="scan-1" />
      </UIProvider>,
    );
    await act(async () => {
      api.openFromCard(makeHit({ id: 7, status: "forming" }));
    });
    await waitFor(() => expect(screen.getByTestId("fs-status")).toHaveTextContent("confirmed"));

    rerender(
      <UIProvider>
        <Harness onReady={onReady} scopeKey="nifty500|1D" resolutionKey="scan-2" />
      </UIProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("fs-status")).toHaveTextContent("failed"));
    expect(screen.getByTestId("fs-symbol")).toHaveTextContent("IRCON");
    expect(mockedFetchPatternHit).toHaveBeenCalledTimes(2);
    expect(mockedFetchPatternHit).toHaveBeenLastCalledWith(7);
  });

  test("a 404 on re-fetch closes the chart", async () => {
    mockedFetchPatternHit
      .mockResolvedValueOnce(makeHit({ id: 7 }))
      .mockRejectedValueOnce(new Error("Pattern hit not found"));
    mockedFetchSymbolChart.mockResolvedValue({ candles: [], hits: [], trend_lines: [] } as never);
    let api!: ReturnType<typeof usePatternFullscreen>;
    const onReady = (a: ReturnType<typeof usePatternFullscreen>) => {
      api = a;
    };
    const { rerender } = render(
      <UIProvider>
        <Harness onReady={onReady} scopeKey="nifty500|1D" resolutionKey="scan-1" />
      </UIProvider>,
    );
    await act(async () => {
      api.openFromCard(makeHit({ id: 7 }));
    });
    await waitFor(() => expect(screen.getByTestId("fs-symbol")).toHaveTextContent("IRCON"));

    rerender(
      <UIProvider>
        <Harness onReady={onReady} scopeKey="nifty500|1D" resolutionKey="scan-2" />
      </UIProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("fs-symbol")).toHaveTextContent("none"));
  });

  test("unchanged scopeKey/resolutionKey neither closes nor refetches", async () => {
    mockedFetchPatternHit.mockResolvedValue(makeHit({ id: 7 }));
    mockedFetchSymbolChart.mockResolvedValue({ candles: [], hits: [], trend_lines: [] } as never);
    let api!: ReturnType<typeof usePatternFullscreen>;
    const onReady = (a: ReturnType<typeof usePatternFullscreen>) => {
      api = a;
    };
    const { rerender } = render(
      <UIProvider>
        <Harness onReady={onReady} scopeKey="nifty500|1D" resolutionKey="scan-1" />
      </UIProvider>,
    );
    await act(async () => {
      api.openFromCard(makeHit({ id: 7 }));
    });
    await waitFor(() => expect(screen.getByTestId("fs-symbol")).toHaveTextContent("IRCON"));

    rerender(
      <UIProvider>
        <Harness onReady={onReady} scopeKey="nifty500|1D" resolutionKey="scan-1" />
      </UIProvider>,
    );
    // Let any stray effect settle before asserting nothing happened.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("fs-symbol")).toHaveTextContent("IRCON");
    expect(mockedFetchPatternHit).toHaveBeenCalledTimes(1);
  });

  test("openFromCard keeps the clicked snapshot when fetchPatternHit 404s", async () => {
    // Intentional fallback (usePatternFullscreen.ts:135 `fetchPatternHit(...).catch(() => hit)`):
    // a deleted/missing row must not close the chart — the user keeps the snapshot they clicked.
    const clicked = makeHit({
      id: 7,
      pattern_id: "falling_wedge",
      status: "confirmed",
      confidence: 80,
      end_price: 120,
    });
    const candles = [candle({ c: 120 })];
    mockedFetchPatternHit.mockRejectedValueOnce(new Error("Pattern hit not found"));
    mockedFetchSymbolChart.mockResolvedValueOnce({
      candles,
      hits: [],
      trend_lines: [],
    } as never);
    let api!: ReturnType<typeof usePatternFullscreen>;
    render(
      <UIProvider>
        <Harness onReady={(a) => { api = a; }} />
      </UIProvider>,
    );
    await act(async () => {
      api.openFromCard(clicked);
    });
    await waitFor(() => expect(screen.getByTestId("fs-symbol")).toHaveTextContent("IRCON"));
    await waitFor(() => expect(screen.getByTestId("fs-loading")).toHaveTextContent("no"));
    expect(mockedFetchPatternHit).toHaveBeenCalledWith(7);
    expect(mockedFetchSymbolChart).toHaveBeenCalledWith(
      "IRCON",
      "1D",
      expect.objectContaining({ detectPatterns: false }),
    );
    // Chart stays open on the clicked snapshot's fields, not a closed chart.
    expect(screen.getByTestId("fs-hit")).toHaveTextContent("falling_wedge");
    expect(screen.getByTestId("fs-status")).toHaveTextContent("confirmed");
    expect(screen.getByTestId("fs-count")).toHaveTextContent("1");
    expect(api.fullscreen?.symbol).toBe("IRCON");
    expect(api.fullscreen?.hit).toMatchObject({
      id: 7,
      pattern_id: "falling_wedge",
      status: "confirmed",
      confidence: 80,
      end_price: 120,
    });
    expect(api.fullscreen?.candles).toEqual(candles);
  });

  test("openFromSymbol with zero hits leaves hit null and still exposes candles", async () => {
    const candles = [candle(), candle({ t: "2026-09-21", c: 124 })];
    // Phase 1 (candles) then phase 2 (detection) — both resolve with no hits.
    mockedFetchSymbolChart
      .mockResolvedValueOnce({ candles, hits: [], trend_lines: [] } as never)
      .mockResolvedValueOnce({ candles, hits: [], trend_lines: [] } as never);
    let api!: ReturnType<typeof usePatternFullscreen>;
    render(
      <UIProvider>
        <Harness onReady={(a) => { api = a; }} />
      </UIProvider>,
    );
    await act(async () => {
      api.openFromSymbol("IRCON");
    });
    await waitFor(() => expect(screen.getByTestId("fs-symbol")).toHaveTextContent("IRCON"));
    await waitFor(() => expect(screen.getByTestId("fs-loading")).toHaveTextContent("no"));
    expect(mockedFetchSymbolChart).toHaveBeenCalledTimes(2);
    expect(mockedFetchSymbolChart).toHaveBeenCalledWith(
      "IRCON",
      "1D",
      expect.objectContaining({ detectPatterns: true }),
    );
    expect(screen.getByTestId("fs-hit")).toHaveTextContent("none");
    expect(screen.getByTestId("fs-count")).toHaveTextContent("0");
    expect(screen.getByTestId("fs-candles")).toHaveTextContent("2");
    expect(api.fullscreen?.hit).toBeNull();
    expect(api.fullscreen?.hits).toEqual([]);
    expect(api.fullscreen?.loading).toBe(false);
    expect(api.fullscreen?.candles).toEqual(candles);
  });

  test("symbol chart cache serves a second open within 60s and refetches after expiry", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const chart = {
        candles: [candle()],
        hits: [makeHit()],
        trend_lines: [],
      };
      mockedFetchSymbolChart.mockResolvedValue(chart as never);
      let api!: ReturnType<typeof usePatternFullscreen>;
      render(
        <UIProvider>
          <Harness onReady={(a) => { api = a; }} />
        </UIProvider>,
      );
      // First open: phase 1 (candles) + phase 2 (patterns) each hit the wire.
      await act(async () => {
        api.openFromSymbol("IRCON");
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mockedFetchSymbolChart).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("fs-symbol")).toHaveTextContent("IRCON");
      expect(screen.getByTestId("fs-loading")).toHaveTextContent("no");

      // Second open inside the 60 s window: both phases served from cache, no wire call.
      await act(async () => {
        api.openFromSymbol("IRCON");
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockedFetchSymbolChart).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("fs-symbol")).toHaveTextContent("IRCON");
      expect(screen.getByTestId("fs-loading")).toHaveTextContent("no");

      // Once the entry ages past SYMBOL_CHART_CACHE_MS (60_000) both phases refetch.
      vi.setSystemTime(60_001);
      await act(async () => {
        api.openFromSymbol("IRCON");
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mockedFetchSymbolChart).toHaveBeenCalledTimes(4);
      expect(mockedFetchSymbolChart).toHaveBeenNthCalledWith(
        1,
        "IRCON",
        "1D",
        expect.objectContaining({ detectPatterns: false }),
      );
      expect(mockedFetchSymbolChart).toHaveBeenNthCalledWith(
        2,
        "IRCON",
        "1D",
        expect.objectContaining({ detectPatterns: true }),
      );
      expect(screen.getByTestId("fs-symbol")).toHaveTextContent("IRCON");
      expect(screen.getByTestId("fs-loading")).toHaveTextContent("no");
      expect(api.fullscreen?.hits).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a late card response never overwrites a newer symbol open", async () => {
    let resolveCardChart!: (v: unknown) => void;
    const clicked = makeHit({ id: 7, symbol: "IRCON", pattern_id: "falling_wedge" });
    const relianceCandle = candle({ t: "2026-09-20", c: 11 });
    const doubleBottom = makeHit({
      id: null,
      symbol: "RELIANCE",
      pattern_id: "double_bottom",
      end_date: "2026-09-20",
      bars_ago: 2,
    });
    mockedFetchPatternHit.mockResolvedValue(makeHit({ id: 7, symbol: "IRCON" }));
    // Call 1: openFromCard chart (pending). Calls 2-3: RELIANCE phase 1 + phase 2.
    mockedFetchSymbolChart
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveCardChart = resolve; }),
      )
      .mockResolvedValueOnce({ candles: [relianceCandle], hits: [doubleBottom], trend_lines: [] } as never)
      .mockResolvedValueOnce({ candles: [relianceCandle], hits: [doubleBottom], trend_lines: [] } as never);
    let api!: ReturnType<typeof usePatternFullscreen>;
    render(
      <UIProvider>
        <Harness onReady={(a) => { api = a; }} />
      </UIProvider>,
    );
    await act(async () => {
      api.openFromCard(clicked);
      api.openFromSymbol("RELIANCE");
    });
    await waitFor(() => expect(screen.getByTestId("fs-symbol")).toHaveTextContent("RELIANCE"));
    await waitFor(() => expect(screen.getByTestId("fs-hit")).toHaveTextContent("double_bottom"));
    expect(screen.getByTestId("fs-loading")).toHaveTextContent("no");
    // The stale card chart resolves late — the token guard must drop it.
    await act(async () => {
      resolveCardChart({
        candles: [candle({ t: "2026-09-20", c: 120 })],
        hits: [makeHit({ symbol: "IRCON", pattern_id: "falling_wedge" })],
        trend_lines: [],
      });
    });
    expect(screen.getByTestId("fs-symbol")).toHaveTextContent("RELIANCE");
    expect(screen.getByTestId("fs-hit")).toHaveTextContent("double_bottom");
    expect(screen.getByTestId("fs-count")).toHaveTextContent("1");
    expect(screen.getByTestId("fs-loading")).toHaveTextContent("no");
    expect(api.fullscreen?.symbol).toBe("RELIANCE");
    expect(api.fullscreen?.hit?.pattern_id).toBe("double_bottom");
    expect(mockedFetchSymbolChart).toHaveBeenCalledTimes(3);
    expect(mockedFetchSymbolChart).toHaveBeenNthCalledWith(
      1,
      "IRCON",
      "1D",
      expect.objectContaining({ detectPatterns: false }),
    );
    expect(mockedFetchSymbolChart).toHaveBeenNthCalledWith(
      2,
      "RELIANCE",
      "1D",
      expect.objectContaining({ detectPatterns: false }),
    );
    expect(mockedFetchSymbolChart).toHaveBeenNthCalledWith(
      3,
      "RELIANCE",
      "1D",
      expect.objectContaining({ detectPatterns: true }),
    );
  });

  // --- Two-phase load tests ---

  test("phase 1 renders candles before phase 2 resolves", async () => {
    let resolvePhase1!: (v: unknown) => void;
    let resolvePhase2!: (v: unknown) => void;
    mockedFetchSymbolChart
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePhase1 = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePhase2 = resolve; }));
    const candles = [candle()];
    let api!: ReturnType<typeof usePatternFullscreen>;
    render(
      <UIProvider>
        <Harness onReady={(a) => { api = a; }} />
      </UIProvider>,
    );
    await act(async () => {
      api.openFromSymbol("IRCON");
    });
    // Phase 1 still in flight: nothing rendered yet.
    expect(screen.getByTestId("fs-candles")).toHaveTextContent("0");
    expect(screen.getByTestId("fs-loading")).toHaveTextContent("yes");
    expect(screen.getByTestId("fs-patterns-loading")).toHaveTextContent("no");

    await act(async () => {
      resolvePhase1({ candles, hits: [], trend_lines: [] });
    });
    // Candles committed, loading cleared, phase 2 now in flight.
    expect(screen.getByTestId("fs-candles")).toHaveTextContent("1");
    expect(screen.getByTestId("fs-loading")).toHaveTextContent("no");
    expect(screen.getByTestId("fs-patterns-loading")).toHaveTextContent("yes");
    expect(screen.getByTestId("fs-hit")).toHaveTextContent("none");

    await act(async () => {
      resolvePhase2({ candles, hits: [makeHit({ id: null })], trend_lines: [] });
    });
    expect(screen.getByTestId("fs-count")).toHaveTextContent("1");
    expect(screen.getByTestId("fs-patterns-loading")).toHaveTextContent("no");
    expect(mockedFetchSymbolChart).toHaveBeenCalledTimes(2);
    expect(mockedFetchSymbolChart).toHaveBeenNthCalledWith(
      1,
      "IRCON",
      "1D",
      expect.objectContaining({ detectPatterns: false }),
    );
    expect(mockedFetchSymbolChart).toHaveBeenNthCalledWith(
      2,
      "IRCON",
      "1D",
      expect.objectContaining({ detectPatterns: true }),
    );
  });

  test("patternsLoading is true between the two phases", async () => {
    let resolvePhase1!: (v: unknown) => void;
    let resolvePhase2!: (v: unknown) => void;
    mockedFetchSymbolChart
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePhase1 = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePhase2 = resolve; }));
    let api!: ReturnType<typeof usePatternFullscreen>;
    render(
      <UIProvider>
        <Harness onReady={(a) => { api = a; }} />
      </UIProvider>,
    );
    await act(async () => {
      api.openFromSymbol("IRCON");
    });
    expect(screen.getByTestId("fs-patterns-loading")).toHaveTextContent("no");

    await act(async () => {
      resolvePhase1({ candles: [], hits: [], trend_lines: [] });
    });
    expect(screen.getByTestId("fs-patterns-loading")).toHaveTextContent("yes");

    await act(async () => {
      resolvePhase2({ candles: [], hits: [], trend_lines: [] });
    });
    expect(screen.getByTestId("fs-patterns-loading")).toHaveTextContent("no");
  });

  test("phase 2 updates hits while keeping phase-1 candles", async () => {
    const candles = [candle()];
    mockedFetchSymbolChart
      .mockResolvedValueOnce({ candles, hits: [], trend_lines: [] } as never)
      .mockResolvedValueOnce({
        candles,
        hits: [makeHit({ id: null, pattern_id: "double_bottom" })],
        trend_lines: [],
      } as never);
    let api!: ReturnType<typeof usePatternFullscreen>;
    render(
      <UIProvider>
        <Harness onReady={(a) => { api = a; }} />
      </UIProvider>,
    );
    await act(async () => {
      api.openFromSymbol("IRCON");
    });
    await waitFor(() => expect(screen.getByTestId("fs-count")).toHaveTextContent("1"));
    await waitFor(() => expect(screen.getByTestId("fs-hit")).toHaveTextContent("double_bottom"));
    expect(screen.getByTestId("fs-candles")).toHaveTextContent("1");
    expect(screen.getByTestId("fs-loading")).toHaveTextContent("no");
    expect(screen.getByTestId("fs-patterns-loading")).toHaveTextContent("no");
    expect(api.fullscreen?.candles).toEqual(candles);
  });

  test("phase 2 failure keeps the phase-1 candles", async () => {
    const candles = [candle()];
    mockedFetchSymbolChart
      .mockResolvedValueOnce({ candles, hits: [], trend_lines: [] } as never)
      .mockRejectedValueOnce(new Error("detection boom"));
    let api!: ReturnType<typeof usePatternFullscreen>;
    render(
      <UIProvider>
        <Harness onReady={(a) => { api = a; }} />
      </UIProvider>,
    );
    await act(async () => {
      api.openFromSymbol("IRCON");
    });
    await waitFor(() => expect(screen.getByTestId("fs-loading")).toHaveTextContent("no"));
    await waitFor(() => expect(screen.getByTestId("fs-patterns-loading")).toHaveTextContent("no"));
    // Candles survived the failed detection; no hits were applied.
    expect(screen.getByTestId("fs-candles")).toHaveTextContent("1");
    expect(screen.getByTestId("fs-count")).toHaveTextContent("0");
    expect(screen.getByTestId("fs-hit")).toHaveTextContent("none");
    expect(mockedFetchSymbolChart).toHaveBeenCalledTimes(2);
  });

  test("detectPatterns=false makes exactly one request (candles only)", async () => {
    const candles = [candle()];
    mockedFetchSymbolChart.mockResolvedValue({ candles, hits: [], trend_lines: [] } as never);
    let api!: ReturnType<typeof usePatternFullscreen>;
    render(
      <UIProvider>
        <Harness onReady={(a) => { api = a; }} />
      </UIProvider>,
    );
    await act(async () => {
      api.openFromSymbol("IRCON", undefined, false);
    });
    await waitFor(() => expect(screen.getByTestId("fs-loading")).toHaveTextContent("no"));
    expect(mockedFetchSymbolChart).toHaveBeenCalledTimes(1);
    expect(mockedFetchSymbolChart).toHaveBeenCalledWith(
      "IRCON",
      "1D",
      expect.objectContaining({ detectPatterns: false }),
    );
    expect(screen.getByTestId("fs-patterns-loading")).toHaveTextContent("no");
    expect(screen.getByTestId("fs-candles")).toHaveTextContent("1");
    expect(screen.getByTestId("fs-count")).toHaveTextContent("0");
  });

  test("switching symbol ignores a stale phase-2 response", async () => {
    let resolvePhase2IRCON!: (v: unknown) => void;
    const irconCandle = candle({ c: 120 });
    const relCandle = candle({ t: "2026-09-20", c: 11 });
    const relHit = makeHit({ id: null, symbol: "RELIANCE", pattern_id: "double_bottom" });
    const irconHit = makeHit({ id: null, symbol: "IRCON", pattern_id: "falling_wedge" });
    // Call 1: IRCON phase 1. Call 2: IRCON phase 2 (pending). Calls 3-4: RELIANCE phase 1 + phase 2.
    mockedFetchSymbolChart
      .mockResolvedValueOnce({ candles: [irconCandle], hits: [], trend_lines: [] } as never)
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePhase2IRCON = resolve; }))
      .mockResolvedValueOnce({ candles: [relCandle], hits: [], trend_lines: [] } as never)
      .mockResolvedValueOnce({ candles: [relCandle], hits: [relHit], trend_lines: [] } as never);
    let api!: ReturnType<typeof usePatternFullscreen>;
    render(
      <UIProvider>
        <Harness onReady={(a) => { api = a; }} />
      </UIProvider>,
    );
    await act(async () => {
      api.openFromSymbol("IRCON");
    });
    await waitFor(() => expect(screen.getByTestId("fs-loading")).toHaveTextContent("no"));
    expect(screen.getByTestId("fs-symbol")).toHaveTextContent("IRCON");

    await act(async () => {
      api.openFromSymbol("RELIANCE");
    });
    await waitFor(() => expect(screen.getByTestId("fs-symbol")).toHaveTextContent("RELIANCE"));
    await waitFor(() => expect(screen.getByTestId("fs-hit")).toHaveTextContent("double_bottom"));

    // The stale IRCON phase-2 response resolves late — the token guard drops it.
    await act(async () => {
      resolvePhase2IRCON({ candles: [irconCandle], hits: [irconHit], trend_lines: [] });
    });
    expect(screen.getByTestId("fs-symbol")).toHaveTextContent("RELIANCE");
    expect(screen.getByTestId("fs-hit")).toHaveTextContent("double_bottom");
    expect(screen.getByTestId("fs-count")).toHaveTextContent("1");
    expect(mockedFetchSymbolChart).toHaveBeenCalledTimes(4);
  });
});
