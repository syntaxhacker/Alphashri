// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import type { PatternHitDTO } from "@/types/chartPatterns";
import {
  FullscreenPatternList,
  newestHit,
  sortHitsNewest,
} from "./FullscreenPatternList";

function makeHit(overrides: Partial<PatternHitDTO> = {}): PatternHitDTO {
  return {
    id: 1,
    symbol: "IRCON",
    name: null,
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

const OLD = makeHit({ id: 11, pattern_name: "Falling Wedge", end_date: "2026-08-01", bars_ago: 40, confidence: 95 });
const MID = makeHit({ id: 22, pattern_name: "Rising Wedge", end_date: "2026-09-01", bars_ago: 20, confidence: 60 });
const NEW = makeHit({ id: 33, pattern_name: "Bull Flag", end_date: "2026-09-26", bars_ago: 2, confidence: 70 });

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("sortHitsNewest", () => {
  test("orders by end_date DESC", () => {
    expect(sortHitsNewest([OLD, NEW, MID]).map((h) => h.id)).toEqual([33, 22, 11]);
  });

  test("ties on end_date break by bars_ago ASC then confidence DESC", () => {
    const a = makeHit({ id: 1, end_date: "2026-09-26", bars_ago: 5, confidence: 60 });
    const b = makeHit({ id: 2, end_date: "2026-09-26", bars_ago: 2, confidence: 50 });
    const c = makeHit({ id: 3, end_date: "2026-09-26", bars_ago: 2, confidence: 90 });
    expect(sortHitsNewest([a, b, c]).map((h) => h.id)).toEqual([3, 2, 1]);
  });

  test("newestHit returns the first of the newest-first order (null when empty)", () => {
    expect(newestHit([OLD, NEW, MID])?.id).toBe(33);
    expect(newestHit([])).toBeNull();
  });
});

describe("FullscreenPatternList", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  test("renders the section newest-first with header count", () => {
    r(<FullscreenPatternList hits={[OLD, NEW, MID]} activeKey={null} onSelect={vi.fn()} />);
    expect(screen.getByTestId("patterns-fullscreen-list")).toBeInTheDocument();
    expect(screen.getByText("Patterns (3)")).toBeInTheDocument();
    const rows = [
      screen.getByTestId("patterns-fullscreen-list-item-0"),
      screen.getByTestId("patterns-fullscreen-list-item-1"),
      screen.getByTestId("patterns-fullscreen-list-item-2"),
    ];
    expect(rows[0]).toHaveTextContent("Bull Flag");
    expect(rows[1]).toHaveTextContent("Rising Wedge");
    expect(rows[2]).toHaveTextContent("Falling Wedge");
  });

  test("marks the active row selected", () => {
    r(<FullscreenPatternList hits={[OLD, NEW, MID]} activeKey="33" onSelect={vi.fn()} />);
    expect(screen.getByTestId("patterns-fullscreen-list-item-0")).toHaveAttribute(
      "data-selected",
      "true",
    );
    expect(
      screen.getByTestId("patterns-fullscreen-list-item-1"),
    ).not.toHaveAttribute("data-selected", "true");
  });

  test("clicking a row calls onSelect with that hit", () => {
    const onSelect = vi.fn();
    r(<FullscreenPatternList hits={[OLD, NEW, MID]} activeKey="33" onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("patterns-fullscreen-list-item-1"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(MID);
  });

  test("shows each row's formation date, bars-ago, status and confidence", () => {
    r(<FullscreenPatternList hits={[NEW]} activeKey={null} onSelect={vi.fn()} />);
    const row = screen.getByTestId("patterns-fullscreen-list-item-0");
    expect(row).toHaveTextContent("2 bars ago");
    expect(row).toHaveTextContent("70%");
    expect(screen.getByTestId("patterns-status-confirmed")).toBeInTheDocument();
  });

  test("empty state", () => {
    r(<FullscreenPatternList hits={[]} activeKey={null} onSelect={vi.fn()} />);
    expect(screen.getByText("Patterns (0)")).toBeInTheDocument();
    expect(screen.getByText("No patterns detected")).toBeInTheDocument();
  });
});
