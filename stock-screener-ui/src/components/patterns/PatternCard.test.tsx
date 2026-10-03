// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { PatternCard } from "./PatternCard";

vi.mock("@/hooks/useECharts", () => ({
  useECharts: () => ({
    chartRef: { current: null },
    chartInstance: { current: null },
    setChartOption: vi.fn(),
  }),
}));

const HIT: PatternHitDTO = {
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
};

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("PatternCard", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  test("renders symbol, pattern, status and levels", () => {
    r(<PatternCard hit={HIT} />);
    expect(screen.getByTestId("patterns-card-IRCON-falling_wedge")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-card")).toBeInTheDocument();
    expect(screen.getByText("Falling Wedge")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-status-confirmed")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-quality-strong")).toBeInTheDocument();
    expect(screen.getByText("1.70")).toBeInTheDocument();
    expect(screen.getByText("2 1D candles ago")).toBeInTheDocument();
  });

  test("marks the selected card with the primary border", () => {
    const { container } = r(<PatternCard hit={HIT} selected />);
    const card = container.querySelector('[data-testid="patterns-card-IRCON-falling_wedge"]');
    expect(card).not.toBeNull();
  });

  test("clicking the card passes the hit to onClick", async () => {
    const onClick = vi.fn();
    r(<PatternCard hit={HIT} onClick={onClick} />);
    await userEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    expect(onClick).toHaveBeenCalledWith(HIT);
  });
});
