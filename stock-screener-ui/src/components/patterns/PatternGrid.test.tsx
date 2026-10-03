// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { PatternGrid } from "./PatternGrid";

vi.mock("@/hooks/useECharts", () => ({
  useECharts: () => ({
    chartRef: { current: null },
    chartInstance: { current: null },
    setChartOption: vi.fn(),
  }),
}));

function makeHit(overrides: Partial<PatternHitDTO> = {}): PatternHitDTO {
  return {
    id: 1,
    symbol: "IRCON",
    name: "IRCON International Ltd.",
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
    ...overrides,
  };
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("PatternGrid", () => {
  afterEach(() => cleanup());

  test("renders two hits with the same symbol+pattern+timeframe without duplicate keys", () => {
    const warnings: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const hits = [
        makeHit({ id: 11, start_date: "2026-04-26", end_date: "2026-06-26" }),
        makeHit({ id: 22, start_date: "2026-07-01", end_date: "2026-09-26" }),
      ];
      r(<PatternGrid hits={hits} onSelect={vi.fn()} />);
      // Both instances render (keyed by hit.id, not the shared composite).
      expect(screen.getAllByTestId("patterns-card")).toHaveLength(2);
      expect(warnings.some((w) => w.includes("duplicate") && w.includes("key"))).toBe(false);
    } finally {
      console.error = origError;
    }
  });
});
