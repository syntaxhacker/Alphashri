import { TickMarkType } from "lightweight-charts";
import { describe, expect, it } from "vitest";
import { MARKET_TIME_ZONE } from "@/utils/chart/time";
import {
  isTickLabelAtPaneEdge,
  TICK_EDGE_PADDING_PX,
  tvTickMarkFormatter,
} from "./tvTimeFormat";

const EPOCH = Date.parse("2026-04-15T09:15:00+05:30") / 1000;
const IST = MARKET_TIME_ZONE.india;

describe("tvTickMarkFormatter", () => {
  it("formats each lightweight-charts tick kind in IST", () => {
    expect(tvTickMarkFormatter(EPOCH, TickMarkType.Year, IST)).toBe("2026");
    expect(tvTickMarkFormatter(EPOCH, TickMarkType.Month, IST)).toBe("Apr");
    expect(tvTickMarkFormatter(EPOCH, TickMarkType.DayOfMonth, IST)).toBe("15");
    expect(tvTickMarkFormatter(EPOCH, TickMarkType.Time, IST)).toBe("09:15");
  });

  it.each(["3h", "4h"])(
    "promotes day/time ticks to month labels on multi-month %s charts",
    (timeframe) => {
      const context = { timeframe, multiMonth: true };
      expect(tvTickMarkFormatter(EPOCH, TickMarkType.DayOfMonth, IST, context)).toBe("Apr");
      expect(tvTickMarkFormatter(EPOCH, TickMarkType.Time, IST, context)).toBe("Apr");
      expect(tvTickMarkFormatter(EPOCH, TickMarkType.TimeWithSeconds, IST, context)).toBe("Apr");
      expect(tvTickMarkFormatter(EPOCH, TickMarkType.Month, IST, context)).toBe("Apr");
      expect(tvTickMarkFormatter(EPOCH, TickMarkType.Year, IST, context)).toBe("2026");
    },
  );

  it.each(["3h", "4h"])(
    "keeps day/time ticks when a %s chart is zoomed into days",
    (timeframe) => {
      const context = { timeframe, multiMonth: false };
      expect(tvTickMarkFormatter(EPOCH, TickMarkType.DayOfMonth, IST, context)).toBe("15");
      expect(tvTickMarkFormatter(EPOCH, TickMarkType.Time, IST, context)).toBe("09:15");
    },
  );

  it("leaves other timeframes on their native tick granularity", () => {
    const context = { timeframe: "1h", multiMonth: true };
    expect(tvTickMarkFormatter(EPOCH, TickMarkType.DayOfMonth, IST, context)).toBe("15");
    expect(tvTickMarkFormatter(EPOCH, TickMarkType.Time, IST, context)).toBe("09:15");
  });

  it("returns an empty label for non-numeric times", () => {
    expect(tvTickMarkFormatter({ year: 2026, month: 4, day: 15 }, TickMarkType.DayOfMonth, IST)).toBe(
      "",
    );
  });

  it("drops tick labels that would be clipped at a pane edge after zoom", () => {
    // A two-digit day centred 3 px from the right edge renders as a lone "1".
    expect(
      tvTickMarkFormatter(EPOCH, TickMarkType.DayOfMonth, IST, { x: 310, paneWidth: 313 }),
    ).toBe("");
    expect(
      tvTickMarkFormatter(EPOCH, TickMarkType.DayOfMonth, IST, { x: 5, paneWidth: 313 }),
    ).toBe("");
    // The same tick well inside the pane keeps its full label.
    expect(
      tvTickMarkFormatter(EPOCH, TickMarkType.DayOfMonth, IST, { x: 156, paneWidth: 313 }),
    ).toBe("15");
  });
});

describe("isTickLabelAtPaneEdge", () => {
  it("accounts for half the label width plus the safety gutter", () => {
    expect(isTickLabelAtPaneEdge("15", { x: 310, paneWidth: 313 })).toBe(true);
    expect(isTickLabelAtPaneEdge("15", { x: 4, paneWidth: 313 })).toBe(true);
    expect(isTickLabelAtPaneEdge("12:00", { x: 300, paneWidth: 313 })).toBe(true);
    expect(isTickLabelAtPaneEdge("15", { x: 156, paneWidth: 313 })).toBe(false);
  });

  it("uses an explicit measurer when one is available", () => {
    const measureText = (text: string) => text.length * 10;
    expect(isTickLabelAtPaneEdge("15", { x: 20, paneWidth: 200, measureText })).toBe(false);
    expect(isTickLabelAtPaneEdge("15", { x: 17, paneWidth: 200, measureText })).toBe(true);
    expect(TICK_EDGE_PADDING_PX).toBeGreaterThan(0);
  });

  it("never suppresses without usable geometry", () => {
    expect(isTickLabelAtPaneEdge("15", {})).toBe(false);
    expect(isTickLabelAtPaneEdge("15", { x: null, paneWidth: 313 })).toBe(false);
    expect(isTickLabelAtPaneEdge("", { x: 1, paneWidth: 313 })).toBe(false);
    expect(isTickLabelAtPaneEdge("15", { x: 1, paneWidth: 0 })).toBe(false);
  });
});
