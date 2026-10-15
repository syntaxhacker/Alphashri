// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

vi.mock("./PatternMiniChart", () => ({
  PatternMiniChart: ({ trendlinesView }: { trendlinesView?: string }) => (
    <div data-testid="mini-stub" data-trendlines-view={trendlinesView ?? "both"} />
  ),
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

describe("PatternGrid missing coverage", () => {
  afterEach(() => cleanup());

  test("renders one card per hit", () => {
    const hits = [
      makeHit({ id: 1, symbol: "AAA" }),
      makeHit({ id: 2, symbol: "BBB" }),
      makeHit({ id: 3, symbol: "CCC" }),
    ];
    r(<PatternGrid hits={hits} onSelect={vi.fn()} />);
    expect(screen.getByTestId("patterns-grid")).toBeInTheDocument();
    expect(screen.getAllByTestId("patterns-card")).toHaveLength(3);
    expect(screen.getByTestId("patterns-card-AAA-falling_wedge")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-card-BBB-falling_wedge")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-card-CCC-falling_wedge")).toBeInTheDocument();
  });

  test("renders an empty grid with no cards", () => {
    r(<PatternGrid hits={[]} onSelect={vi.fn()} />);
    expect(screen.getByTestId("patterns-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-card")).not.toBeInTheDocument();
  });

  test("same symbol across patterns/timeframes renders without duplicate keys (composite fallback)", () => {
    const warnings: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const hits = [
        {
          ...makeHit({
            pattern_id: "double_bottom",
            pattern_name: "Double Bottom",
            timeframe: "1D",
            start_date: "2026-01-01",
          }),
          id: undefined as unknown as number,
        },
        {
          ...makeHit({
            pattern_id: "flag",
            pattern_name: "Flag",
            timeframe: "1W",
            start_date: "2026-02-01",
          }),
          id: undefined as unknown as number,
        },
      ];
      r(<PatternGrid hits={hits} onSelect={vi.fn()} />);
      expect(screen.getAllByTestId("patterns-card")).toHaveLength(2);
      expect(screen.getByTestId("patterns-card-IRCON-double_bottom")).toBeInTheDocument();
      expect(screen.getByTestId("patterns-card-IRCON-flag")).toBeInTheDocument();
      expect(warnings.some((w) => w.includes("duplicate") && w.includes("key"))).toBe(false);
    } finally {
      console.error = origError;
    }
  });

  test("clicking a card calls onSelect with that hit", async () => {
    const onSelect = vi.fn();
    const hits = [makeHit({ id: 1, symbol: "AAA" }), makeHit({ id: 2, symbol: "BBB" })];
    r(<PatternGrid hits={hits} onSelect={onSelect} />);
    await userEvent.click(screen.getByTestId("patterns-card-BBB-falling_wedge"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(hits[1]);
  });

  test("expand buttons call onExpand with the matching hit without selecting the card", async () => {
    const onSelect = vi.fn();
    const onExpand = vi.fn();
    const hits = [
      makeHit({ id: 1, symbol: "AAA", pattern_id: "flag", pattern_name: "Flag" }),
      makeHit({ id: 2, symbol: "BBB", pattern_id: "flag", pattern_name: "Flag" }),
    ];
    r(<PatternGrid hits={hits} onSelect={onSelect} onExpand={onExpand} />);
    await userEvent.click(screen.getByTestId("patterns-card-expand-AAA-flag"));
    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onExpand).toHaveBeenCalledWith(hits[0]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("renders no expand buttons when onExpand is omitted", () => {
    r(<PatternGrid hits={[makeHit({ id: 1 })]} onSelect={vi.fn()} />);
    expect(
      screen.queryByTestId("patterns-card-expand-IRCON-falling_wedge"),
    ).not.toBeInTheDocument();
  });

  test("forwards trendlinesView to every mini chart", () => {
    const hits = [makeHit({ id: 1, symbol: "AAA" }), makeHit({ id: 2, symbol: "BBB" })];
    r(<PatternGrid hits={hits} onSelect={vi.fn()} trendlinesView="support" />);
    const stubs = screen.getAllByTestId("mini-stub");
    expect(stubs).toHaveLength(2);
    stubs.forEach((stub) => expect(stub).toHaveAttribute("data-trendlines-view", "support"));
  });

  test("defaults trendlinesView to both", () => {
    r(<PatternGrid hits={[makeHit({ id: 1 })]} onSelect={vi.fn()} />);
    expect(screen.getByTestId("mini-stub")).toHaveAttribute("data-trendlines-view", "both");
  });
});
