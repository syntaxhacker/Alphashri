import { describe, expect, test } from "vitest";

import type { OptionReplayResult } from "@/types/optionsPaper";
import { TYPE_SCALE } from "@/ui/typography";
import { pathChartOption, payoffChartOption } from "./replayCharts";

const result: OptionReplayResult = {
  positionId: 1,
  underlying: "IRFC",
  expiry: "2026-11-23",
  source: "replay",
  legs: [],
  netDebit: 2400,
  frames: [
    {
      t: "2026-11-17T09:48:00+05:30",
      spot: 82.5,
      marks: {},
      priced: true,
      grossPnl: 125,
      netPnl: -125,
      netDebit: 2400,
      equity: -125,
    },
  ],
  summary: { realized: 0, unrealized: -125, total: -125, maxDrawdown: 125, costs: 125 },
  coverage: { frames: 1, first: null, last: null, gaps: 0 },
  payoff: { spots: [80, 85, 90], expiry: [-2400, 100, 2600] },
  breakevens: [84.9],
  maxProfit: 2600,
  maxLoss: 2400,
  skipped: null,
};

function series(option: Record<string, unknown>): Array<Record<string, unknown>> {
  return option.series as Array<Record<string, unknown>>;
}

function numericFontSizes(value: unknown, out: number[] = []): number[] {
  if (Array.isArray(value)) {
    for (const item of value) numericFontSizes(item, out);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "fontSize" && typeof item === "number") out.push(item);
      else numericFontSizes(item, out);
    }
  }
  return out;
}

describe("options replay charts", () => {
  test("path option keeps the playhead on the net P&L series only", () => {
    const option = pathChartOption(result, "2026-11-17T09:48:00+05:30");
    const rows = series(option);
    expect(rows).toHaveLength(3);
    expect(rows[1].data).toEqual([["2026-11-17T09:48:00+05:30", -125]]);
    expect((rows[2].markLine as { data: unknown[] }).data).toHaveLength(1);
    expect(pathChartOption(null, null)).toBeDefined();
  });

  test("payoff option splits profit/loss and marks spot plus breakevens", () => {
    const option = payoffChartOption(result, 82.5);
    const rows = series(option);
    expect(rows[0].data).toEqual([[80, 0], [85, 100], [90, 2600]]);
    expect(rows[1].data).toEqual([[80, -2400], [85, 0], [90, 0]]);
    const marks = (rows[2].markLine as { data: Array<{ label?: { formatter?: string } }> }).data;
    expect(marks.map((mark) => mark.label?.formatter).filter(Boolean)).toEqual([
      "SPOT",
      "₹84.9",
    ]);
    expect(payoffChartOption(null, 0)).toBeDefined();
  });

  test("every numeric chart font size comes from the type scale", () => {
    const scale = Object.values(TYPE_SCALE).map((role) => role.size);
    for (const option of [
      pathChartOption(result, "2026-11-17T09:48:00+05:30"),
      payoffChartOption(result, 82.5),
    ]) {
      const sizes = numericFontSizes(option);
      expect(sizes.length).toBeGreaterThan(0);
      for (const size of sizes) expect(scale).toContain(size);
    }
  });
});
