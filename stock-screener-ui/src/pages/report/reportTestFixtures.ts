// Test-only shared builders and stream mocks for the report page and hook
// suites. Extracted so the report test suites stop cloning the same tape /
// clock / candle / WebSocket harnesses.
//
// Imported by: useNiftyBurstStream.test, useNiftyReportStream.test,
// niftyFlowStrip.test, useNiftyOiAlerts.test, niftyFlowRead.test,
// niftyChartData.test.

import { act } from "@testing-library/react";
import { test, vi } from "vitest";
import type { ChainTuple } from "./chainTuple";
import type { NiftyIntradayCandle, NiftyReport, NiftyStrike } from "@/types/niftyReport";
import type { ReplayCandle } from "@/types/replay";
import type { SpotPoint, TapeSpotPoint } from "./niftyChartData";

// ---------------- Stream mocks (shared by useNiftyBurstStream / useNiftyReportStream) ----------------

type Handler = ((ev: never) => void) | null;

export class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  onopen: Handler = null;
  onmessage: Handler = null;
  onclose: Handler = null;
  onerror: Handler = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.({} as never);
  }
  receive(payload: unknown) {
    const data = typeof payload === "string" ? payload : JSON.stringify(payload);
    this.onmessage?.({ data } as never);
  }
}

export const REAL_WS = (globalThis as Record<string, unknown>).WebSocket;

export function installMockWs() {
  MockWebSocket.instances = [];
  (globalThis as Record<string, unknown>).WebSocket = MockWebSocket;
}

export function uninstallMockWs() {
  (globalThis as Record<string, unknown>).WebSocket = REAL_WS;
}

/**
 * The "error then close schedules a single reconnect" test shared by both
 * stream suites. Browsers fire `error` followed by `close` for one failure;
 * both handlers run `scheduleReconnect`, so the first timer handle is
 * overwritten and a second socket must not open. Advancing past both
 * backoffs must still leave exactly two sockets.
 */
export function expectSingleReconnect(render: () => void): void {
  test("error followed by close schedules a single reconnect (no socket doubling)", () => {
    vi.useFakeTimers();
    try {
      render();
      expect(MockWebSocket.instances).toHaveLength(1);
      const ws = MockWebSocket.instances[0];
      act(() => {
        ws.onerror?.({} as never);
        ws.onclose?.({} as never);
      });
      // First backoff is 2s; the overwritten duplicate would fire at 4s and
      // open a third socket — advancing past both must still leave exactly 2.
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(MockWebSocket.instances).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
}

// ---------------- Shared clock / tape / candle builders ----------------

/** 09:15 + i minutes → "HH:MM". */
export function hm(i: number): string {
  const total = 9 * 60 + 15 + i;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** One tape spot `{ t, spot }`. */
export function tapeSpot(t: string, spot: number): TapeSpotPoint {
  return { t, spot };
}

/** One 10-second chain spot point `{ t, spot }`. */
export function spotPoint(t: string, spot: number | null): SpotPoint {
  return { t, spot };
}

/** One intraday candle. */
export function ohlcCandle(
  t: string,
  o: number,
  h: number,
  l: number,
  c: number,
): NiftyIntradayCandle {
  return { time: t, open: o, high: h, low: l, close: c };
}

/** One spot-derived candle (volume 0). */
export function spotCandle(
  t: string,
  o: number,
  h: number,
  l: number,
  c: number,
): NiftyIntradayCandle {
  return { time: t, open: o, high: h, low: l, close: c, volume: 0 };
}

/** One tape-derived replay candle. */
export function tapeCandle(
  t: string,
  o: number,
  h: number,
  l: number,
  c: number,
  volume = 0,
): ReplayCandle {
  return { time: t, open: o, high: h, low: l, close: c, volume };
}

/**
 * Per-strike chain map: `chain[strike] = [ce_ltp, pe_ltp, ce_oi, pe_oi,
 * ce_vol, pe_vol]`.
 */
export function chainAt(
  strikes: number[],
  ceOi: number,
  peOi: number,
  ceLtp = 10,
  peLtp = 12,
  ceVol = 100,
  peVol = 100,
): Record<string, ChainTuple> {
  const out: Record<string, ChainTuple> = {};
  for (const s of strikes) {
    out[String(s)] = [ceLtp, peLtp, ceOi, peOi, ceVol, peVol];
  }
  return out;
}

/** `NiftyStrike[]` with neutral sides, used by flow-noise style tests. */
export function makeStrikes(
  ceOi: number,
  peOi: number,
  count: number,
  baseStrike = 22_500,
  step = 50,
): NiftyStrike[] {
  const strikes: NiftyStrike[] = [];
  for (let i = 0; i < count; i++) {
    strikes.push({
      strike: baseStrike + i * step,
      ce: {
        oi: ceOi,
        ltp: 0,
        close: 0,
        prevOi: 0,
        oiChange: 0,
        priceChange: 0,
        sentiment: "Neutral",
        volume: 0,
        delta: 0.5,
        gamma: 0,
        theta: 0,
        vega: 0,
        iv: 0,
      },
      pe: {
        oi: peOi,
        ltp: 0,
        close: 0,
        prevOi: 0,
        oiChange: 0,
        priceChange: 0,
        sentiment: "Neutral",
        volume: 0,
        delta: -0.5,
        gamma: 0,
        theta: 0,
        vega: 0,
        iv: 0,
      },
    });
  }
  return strikes;
}

/** A report with empty intraday / candles, overlaid with `overrides`. */
export function mockReport(
  date: string,
  overrides?: Record<string, unknown>,
): NiftyReport {
  return {
    mode: "live",
    date,
    intraday: [],
    candles: [],
    ...overrides,
  } as unknown as NiftyReport;
}
