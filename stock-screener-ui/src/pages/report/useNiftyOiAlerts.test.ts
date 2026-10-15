// @vitest-environment happy-dom
import { describe, expect, test, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { NiftyStrike, NiftyTapeRow } from "@/types/niftyReport";
import { detectOiBursts, burstToAlert } from "./niftyOiBursts";
import type { OiBurst, OiSignal } from "./niftyOiBursts";
import { useNiftyOiAlerts } from "./useNiftyOiAlerts";

function hm(i: number): string {
  const total = 9 * 60 + 15 + i;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function tapeRow(t: string, callDoi: number, putDoi = 0): NiftyTapeRow {
  return {
    t,
    spot: 22_722,
    call_doi: callDoi,
    put_doi: putDoi,
    net: putDoi - callDoi,
    net_pct: 0,
    call_tick: 1_000,
    put_tick: 1_000,
    pcr_vol: 1,
    pcr_oi: 1,
    pcr_doi: 0,
    spot_flip: 0,
    max_pain: 22_700,
    flip: 22_650,
    walls: { call: 22_750, put: 22_700 },
  };
}

/** Steady +1000/min both sides, with optional extra spikes on chosen minutes. */
function tape(
  n: number,
  spikes: Array<{ i: number; inc: number; put?: boolean }> = [],
): NiftyTapeRow[] {
  const at = new Map<number, { inc: number; put: boolean }>();
  for (const s of spikes) at.set(s.i, { inc: s.inc, put: Boolean(s.put) });
  let cCum = 0;
  let pCum = 0;
  const rows: NiftyTapeRow[] = [tapeRow(hm(0), 0, 0)];
  for (let i = 1; i <= n; i++) {
    cCum += 1_000;
    pCum += 1_000;
    const s = at.get(i);
    if (s) {
      if (s.put) pCum += s.inc;
      else cCum += s.inc;
    }
    rows.push(tapeRow(hm(i), cCum, pCum));
  }
  return rows;
}

function detected(rows: NiftyTapeRow[]): OiBurst[] {
  return detectOiBursts(rows);
}

function side(ltp: number) {
  return { ltp, close: ltp, oi: 1_000, prevOi: 1_000, oiChange: 0, priceChange: 0, sentiment: "LB", volume: 1_000 };
}

/** Spot 22,722; CE/PE premiums tradeable at 22,650/22,700. */
const CHAIN: NiftyStrike[] = [
  { strike: 22_650, ce: side(70), pe: side(12) },
  { strike: 22_700, ce: side(22), pe: side(28) },
  { strike: 22_750, ce: side(8), pe: side(60) },
];
const SPOT = 22_722;

/** A history with one detected call burst at 09:20 (i = 5). */
const HISTORY = detected(tape(12, [{ i: 5, inc: 50_000 }]));
/** The same tape plus a fresh call burst at 09:28 (i = 13). */
const HISTORY_PLUS = detected(tape(13, [{ i: 5, inc: 50_000 }, { i: 13, inc: 60_000 }]));

/** The one burst in `HISTORY_PLUS` that was not already in `HISTORY`. */
const FRESH = HISTORY_PLUS.find((b) => !HISTORY.some((h) => h.id === b.id))!;

/** Test hook with the argument order spelled out once. */
function useAlerts(
  bursts: OiBurst[],
  ready = true,
  enabled = true,
  sessionKey = "live:nearest",
  seedTrail?: boolean,
) {
  return seedTrail === undefined
    ? useNiftyOiAlerts(bursts, CHAIN, SPOT, ready, enabled, sessionKey)
    : useNiftyOiAlerts(bursts, CHAIN, SPOT, ready, enabled, sessionKey, seedTrail);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useNiftyOiAlerts", () => {
  test("opening mid-session never toasts history — but the trail is seeded", () => {
    const { result } = renderHook(() => useAlerts(HISTORY));
    // nothing "fired"…
    expect(result.current.toasts).toEqual([]);
    // …yet the session is reviewable immediately (post-close / mid-session)
    expect(result.current.trail).toHaveLength(HISTORY.length);
  });

  test("seedTrail=false keeps a session empty (opt-out)", () => {
    const { result } = renderHook(() => useAlerts(HISTORY_PLUS, true, false, "eod:x", false));
    expect(result.current.trail).toEqual([]);
  });

  test("stays unarmed until the session feed reports ready", () => {
    const { result, rerender } = renderHook(
      ({ bursts, ready }: { bursts: OiBurst[]; ready: boolean }) => useAlerts(bursts, ready),
      { initialProps: { bursts: HISTORY, ready: false } },
    );
    expect(result.current.toasts).toEqual([]);

    // loading completes: existing history must still not toast
    act(() => rerender({ bursts: HISTORY, ready: true }));
    expect(result.current.toasts).toEqual([]);

    // only a genuinely new burst toasts
    act(() => rerender({ bursts: HISTORY_PLUS, ready: true }));
    expect(result.current.toasts).toHaveLength(1);
  });

  test("arms on an empty ready payload — the session's first burst is NOT swallowed", () => {
    const { result, rerender } = renderHook(
      ({ bursts }: { bursts: OiBurst[] }) => useAlerts(bursts),
      { initialProps: { bursts: [] as OiBurst[] } },
    );
    expect(result.current.toasts).toEqual([]);

    // REGRESSION: if priming waited for a non-empty burst list, this — the
    // session's first real burst — would be treated as history and lost.
    act(() => rerender({ bursts: HISTORY }));
    expect(result.current.toasts).toHaveLength(1);
  });

  test("a new burst minute fires once and carries a BUY plan", () => {
    const { result, rerender } = renderHook(
      ({ bursts }: { bursts: OiBurst[] }) => useAlerts(bursts),
      { initialProps: { bursts: HISTORY } },
    );
    expect(result.current.toasts).toEqual([]);

    act(() => rerender({ bursts: HISTORY_PLUS }));

    expect(result.current.toasts).toHaveLength(1);
    const a = result.current.trail[0];
    expect(a.severity).toBe("critical");
    // call-side burst → fade with puts, nearest tradeable strike to spot
    expect(a.title).toContain("BUY PE 22,700");
    expect(a.metrics?.some((m) => m.label === "ENTRY")).toBe(true);
    expect(a.metrics?.some((m) => m.label === "SL")).toBe(true);
    expect(a.metrics?.some((m) => m.label === "TGT")).toBe(true);
    expect(a.metrics?.some((m) => m.label === "QTY")).toBe(true);
    expect(a.detail).toContain("not advice");

    // re-rendering the same data does not re-fire
    act(() => rerender({ bursts: HISTORY_PLUS }));
    expect(result.current.toasts).toHaveLength(1);
  });

  test("put-side burst plans a CE buy", () => {
    const putHistory = detected(tape(12, [{ i: 5, inc: 50_000, put: true }]));
    const { result, rerender } = renderHook(
      ({ bursts }: { bursts: OiBurst[] }) => useAlerts(bursts),
      { initialProps: { bursts: putHistory } },
    );
    const putNext = detected(
      tape(13, [{ i: 5, inc: 50_000, put: true }, { i: 13, inc: 90_000, put: true }]),
    );
    act(() => rerender({ bursts: putNext }));
    expect(result.current.trail[0].title).toContain("BUY CE 22,700");
  });

  test("disabled (EOD) never toasts", () => {
    const { result, rerender } = renderHook(
      ({ bursts, enabled }: { bursts: OiBurst[]; enabled: boolean }) =>
        useAlerts(bursts, true, enabled, "eod:2026-10-13"),
      { initialProps: { bursts: HISTORY, enabled: false } },
    );
    act(() => rerender({ bursts: HISTORY_PLUS, enabled: false }));
    expect(result.current.toasts).toEqual([]);
  });

  test("switching session resets the trail and re-primes", () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useAlerts(HISTORY_PLUS, true, true, key),
      { initialProps: { key: "live:nearest" } },
    );
    expect(result.current.trail).toHaveLength(HISTORY_PLUS.length);

    act(() => rerender({ key: "live:2026-10-20" }));
    expect(result.current.trail).toHaveLength(HISTORY_PLUS.length); // re-seeded
    expect(result.current.toasts).toEqual([]);
  });

  test("dismissToast removes only that toast; clearTrail empties the trail", () => {
    const { result, rerender } = renderHook(
      ({ bursts }: { bursts: OiBurst[] }) => useAlerts(bursts),
      { initialProps: { bursts: HISTORY } },
    );
    act(() => rerender({ bursts: HISTORY_PLUS }));
    expect(result.current.toasts).toHaveLength(1);
    const id = result.current.toasts[0].id;

    act(() => result.current.dismissToast(id));
    expect(result.current.toasts).toEqual([]);
    // the trail keeps both the seeded history and the new burst
    expect(result.current.trail.length).toBeGreaterThan(HISTORY.length);

    act(() => result.current.clearTrail());
    expect(result.current.trail).toEqual([]);
  });

  test("toasts auto-expire after the TTL, the trail persists", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ bursts }: { bursts: OiBurst[] }) => useAlerts(bursts),
      { initialProps: { bursts: HISTORY } },
    );
    act(() => rerender({ bursts: HISTORY_PLUS }));
    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(46_000);
    });
    expect(result.current.toasts).toEqual([]);
    expect(result.current.trail.length).toBeGreaterThan(0);
  });

  test("a missing chain still alerts, just without the plan", () => {
    const { result, rerender } = renderHook(
      ({ bursts }: { bursts: OiBurst[] }) =>
        useNiftyOiAlerts(bursts, [], 0, true, true, "live:nearest"),
      { initialProps: { bursts: HISTORY } },
    );
    act(() => rerender({ bursts: HISTORY_PLUS }));
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.trail[0].title).toContain("Call OI burst");
    expect(result.current.trail[0].metrics?.some((m) => m.label === "ENTRY")).toBe(false);
  });

  test("pushToast raises a toast manually and never stacks duplicates", () => {
    const { result } = renderHook(() => useAlerts(HISTORY));
    const alert = burstToAlert(HISTORY[0]);
    act(() => result.current.pushToast(alert));
    expect(result.current.toasts).toHaveLength(1);
    act(() => result.current.pushToast(alert));
    expect(result.current.toasts).toHaveLength(1);
  });

  test("a burst's pre-computed backend signal is used verbatim", () => {
    const { result, rerender } = renderHook(
      ({ bursts }: { bursts: OiBurst[] }) => useAlerts(bursts),
      { initialProps: { bursts: HISTORY } },
    );

    // The locally derived plan for this call-side burst would be ~28 on PE
    // 22,700. A supplied signal must win over that derivation.
    const supplied: OiSignal = {
      leg: "PE",
      strike: 22_700,
      entry: 999.99,
      sl: 750,
      target: 1_500,
      qty: 375,
      lots: 5,
      basis: "backend plan — supplied verbatim",
    };
    act(() => rerender({ bursts: [...HISTORY, { ...FRESH, signal: supplied }] }));

    const a = result.current.trail[0];
    const entry = a.metrics?.find((m) => m.label === "ENTRY");
    expect(entry?.value).toBe("999.99");
    expect(a.title).toContain("BUY PE 22,700");
    expect(a.detail).toContain("backend plan");
  });
});
