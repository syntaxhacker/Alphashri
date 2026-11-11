// Test-only shared assertion table for the IST chart-time formatters.
// The patterns suite exercises the re-export in components/patterns/datetime.ts;
// the utils suite exercises the canonical module — both must agree.

import { expect, it } from "vitest";
import type { ISTTickKind } from "./istChartTime";

// 03:50 UTC == 09:20 IST — the chart's raw epoch would otherwise read 03:50.
export const IST_TICK_EPOCH = Date.parse("2026-05-04T03:50:00+00:00") / 1000;

// 18:30 UTC == 00:00 IST next day — the Upstox daily candle instant.
export const IST_DAILY_EPOCH = Date.parse("2026-05-04T18:30:00+00:00") / 1000;

export type ISTTickFormatter = (epochSeconds: number, kind: ISTTickKind) => string;
export type ISTCrosshairFormatter = (epochSeconds: number) => string;

export const TICK_EXPECTATIONS: ReadonlyArray<readonly [ISTTickKind, string]> = [
  ["time", "09:20"],
  ["timeSeconds", "09:20:00"],
  ["day", "04"],
  ["month", "May"],
  ["year", "2026"],
];

/** Runs the every-granularity table against the given formatISTTick. */
export function expectEveryTickGranularity(formatISTTick: ISTTickFormatter): void {
  for (const [kind, expected] of TICK_EXPECTATIONS) {
    expect(formatISTTick(IST_TICK_EPOCH, kind)).toBe(expected);
  }
}

export function expectIntradayCrosshair(formatISTCrosshair: ISTCrosshairFormatter): void {
  expect(formatISTCrosshair(IST_TICK_EPOCH)).toBe("04 May, 09:20");
}

export function expectDailyMidnightCrosshair(formatISTCrosshair: ISTCrosshairFormatter): void {
  expect(formatISTCrosshair(IST_DAILY_EPOCH)).toBe("05 May 2026");
}

export interface ISTAxisFormatters {
  formatISTTick: ISTTickFormatter;
  formatISTCrosshair: ISTCrosshairFormatter;
}

/**
 * Registers the shared lightweight-charts axis-formatter tests (titles and
 * assertion text are identical in both suites by design — each must pass
 * against its own module's exports).
 */
export function registerISTAxisTests({ formatISTTick, formatISTCrosshair }: ISTAxisFormatters): void {
  it("renders every tick granularity in IST", () => {
    expectEveryTickGranularity(formatISTTick);
  });

  it("renders the crosshair label in IST", () => {
    expectIntradayCrosshair(formatISTCrosshair);
  });

  it("shows a date-only crosshair for a daily candle's IST-midnight instant", () => {
    expectDailyMidnightCrosshair(formatISTCrosshair);
  });
}
