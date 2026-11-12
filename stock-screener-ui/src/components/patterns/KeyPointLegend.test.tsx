// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
vi.mock("@/ui", async (importOriginal) => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  const actual = await importOriginal<typeof import("@/ui")>();
  return mockSolidUi(actual);
});
import type { PatternHitDTO } from "@/types/chartPatterns";
import { KeyPointLegend } from "./KeyPointLegend";

function hit(pattern_id: string, pivots: PatternHitDTO["pivots"]): PatternHitDTO {
  return {
    id: 1,
    symbol: "TEST",
    name: null,
    timeframe: "1D",
    pattern_id,
    pattern_name: pattern_id,
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
    target: 120,
    stop: 95,
    rr: 2,
    bars_ago: 1,
    volume_confirmed: true,
    trendlines: [],
    notes: "",
    pivots,
  };
}

describe("KeyPointLegend", () => {
  afterEach(() => cleanup());

  test("explains head & shoulders labels", () => {
    render(() =>       <KeyPointLegend
        hit={hit("head_shoulders", [
          { t: "2026-01-02", price: 100, kind: "high" },
          { t: "2026-01-05", price: 90, kind: "low" },
          { t: "2026-01-10", price: 110, kind: "high" },
          { t: "2026-01-15", price: 92, kind: "low" },
          { t: "2026-01-20", price: 101, kind: "high" },
        ])}
      />);
    const legend = screen.getByTestId("patterns-key-point-legend");
    expect(legend).toHaveTextContent("LS Left shoulder");
    expect(legend).toHaveTextContent("H Head");
    expect(legend).toHaveTextContent("RS Right shoulder");
    expect(legend).toHaveTextContent("N1 Neckline");
  });

  test("explains cup & handle labels", () => {
    render(() =>       <KeyPointLegend
        hit={hit("cup_handle", [
          { t: "2026-01-02", price: 110, kind: "high" },
          { t: "2026-01-10", price: 90, kind: "low" },
          { t: "2026-01-20", price: 108, kind: "high" },
          { t: "2026-01-25", price: 96, kind: "low" },
        ])}
      />);
    expect(screen.getByTestId("patterns-key-point-legend")).toHaveTextContent("H Handle");
  });

  test("renders nothing without key points", () => {
    render(() => <KeyPointLegend hit={hit("head_shoulders", [])} />);
    expect(screen.queryByTestId("patterns-key-point-legend")).not.toBeInTheDocument();
  });
});
