// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { PatternFullscreenView } from "./PatternFullscreenView";

vi.mock("./PatternTradingViewChart", () => ({
  PatternTradingViewChart: () => <div data-testid="patterns-tv-chart" />,
}));

const HIT: PatternHitDTO = {
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
};

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("PatternFullscreenView as-of replay", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  test("hides replay inputs when no onAsOfChange handler is provided", () => {
    r(<PatternFullscreenView opened onClose={vi.fn()} hit={HIT} candles={[]} />);
    expect(screen.queryByTestId("patterns-fullscreen-asof-from")).not.toBeInTheDocument();
    expect(screen.queryByTestId("patterns-fullscreen-asof-to")).not.toBeInTheDocument();
    expect(screen.queryByTestId("patterns-fullscreen-asof-banner")).not.toBeInTheDocument();
  });

  test("renders From/To datetime inputs when replay is wired", () => {
    r(
      <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={HIT}
        candles={[]}
        asOf={null}
        fromDate={null}
        onAsOfChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("patterns-fullscreen-asof-from")).toHaveAttribute(
      "type",
      "datetime-local",
    );
    expect(screen.getByTestId("patterns-fullscreen-asof-to")).toHaveAttribute(
      "type",
      "datetime-local",
    );
    // Live (no cutoff): no banner.
    expect(screen.queryByTestId("patterns-fullscreen-asof-banner")).not.toBeInTheDocument();
  });

  test("shows the as-of banner when a cutoff is set", () => {
    r(
      <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={HIT}
        candles={[]}
        asOf="2026-09-30T14:30"
        fromDate={null}
        onAsOfChange={vi.fn()}
      />,
    );
    const banner = screen.getByTestId("patterns-fullscreen-asof-banner");
    expect(banner).toHaveTextContent("Viewing as of 2026-09-30 14:30");
  });

  test("changing the To input reports (asOf, fromDate)", () => {
    const onAsOfChange = vi.fn();
    r(
      <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={HIT}
        candles={[]}
        asOf={null}
        fromDate="2026-06-01T09:15"
        onAsOfChange={onAsOfChange}
      />,
    );
    fireEvent.change(screen.getByTestId("patterns-fullscreen-asof-to"), {
      target: { value: "2026-09-30T14:30" },
    });
    expect(onAsOfChange).toHaveBeenCalledWith("2026-09-30T14:30", "2026-06-01T09:15");
  });

  test("changing the From input reports (asOf, fromDate)", () => {
    const onAsOfChange = vi.fn();
    r(
      <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={HIT}
        candles={[]}
        asOf="2026-09-30T14:30"
        fromDate={null}
        onAsOfChange={onAsOfChange}
      />,
    );
    fireEvent.change(screen.getByTestId("patterns-fullscreen-asof-from"), {
      target: { value: "2026-06-01T09:15" },
    });
    expect(onAsOfChange).toHaveBeenCalledWith("2026-09-30T14:30", "2026-06-01T09:15");
  });
});
