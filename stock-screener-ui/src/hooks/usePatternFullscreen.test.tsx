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
}));

import { fetchSymbolChart } from "../api/chartPatterns";

const mockedFetchSymbolChart = vi.mocked(fetchSymbolChart);

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

function Harness({ onReady }: { onReady: (api: ReturnType<typeof usePatternFullscreen>) => void }) {
  const api = usePatternFullscreen({ timeframe: "1D" });
  const ref = useRef(api);
  ref.current = api;
  useEffectOnce(ref, onReady);
  return (
    <div>
      <span data-testid="fs-symbol">{api.fullscreen?.symbol ?? "none"}</span>
      <span data-testid="fs-hit">{api.fullscreen?.hit?.pattern_id ?? "none"}</span>
      <span data-testid="fs-count">{api.fullscreen?.hits.length ?? 0}</span>
      <span data-testid="fs-loading">{api.fullscreen?.loading ? "yes" : "no"}</span>
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
  });

  test("openFromSymbol promotes the newest hit", async () => {
    const older = makeHit({ id: 1, pattern_id: "double_bottom", end_date: "2026-08-01", bars_ago: 30 });
    const newer = makeHit({ id: null, pattern_id: "falling_wedge", end_date: "2026-09-20", bars_ago: 5 });
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
    // The newer RELIANCE selection stands.
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
    expect(mockedFetchSymbolChart).toHaveBeenLastCalledWith("IRCON", "1h", expect.objectContaining({ detectPatterns: true }));
    await act(async () => {
      api.closeFullscreen();
    });
    expect(screen.getByTestId("fs-symbol")).toHaveTextContent("none");
  });
});
