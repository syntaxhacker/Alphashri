// @vitest-environment happy-dom
import { describe, expect, test, vi, afterEach } from "vitest";
import { renderHook, cleanup } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import type { NiftyStrike, NiftyTapeRow } from "@/types/niftyReport";
import { detectOiBursts, burstToAlert } from "./niftyOiBursts";
import type { OiBurst, OiSignal } from "./niftyOiBursts";
import { useNiftyOiAlerts } from "./useNiftyOiAlerts";
import { hm } from "./reportTestFixtures";

// Sound/title are browser side-effects; assert the calls, never play audio in CI.
vi.mock("./alertSound", () => ({
  playAlertSound: vi.fn(),
  flashAlertTitle: vi.fn(),
  unlockAlertAudio: vi.fn(),
  alertsMuted: vi.fn(() => false),
  setAlertsMuted: vi.fn(),
}));
import { flashAlertTitle, playAlertSound } from "./alertSound";

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

interface AlertHarness {
  bursts?: OiBurst[];
  ready?: boolean;
  enabled?: boolean;
  sessionKey?: string;
  seedTrail?: boolean;
  chain?: NiftyStrike[];
  spot?: number;
}

/** Test harness: creates the accessors the Solid hook expects and returns
 * the signal setters so tests can push new data (effects flush synchronously). */
function useAlerts(harness: AlertHarness = {}) {
  const [bursts, setBursts] = createSignal<OiBurst[]>(harness.bursts ?? []);
  const [ready, setReady] = createSignal(harness.ready ?? true);
  const [enabled, setEnabled] = createSignal(harness.enabled ?? true);
  const [sessionKey, setSessionKey] = createSignal(harness.sessionKey ?? "live:nearest");
  const { result } = renderHook(() =>
    useNiftyOiAlerts(
      bursts,
      () => harness.chain ?? CHAIN,
      () => harness.spot ?? SPOT,
      ready,
      enabled,
      sessionKey,
      harness.seedTrail,
    ),
  );
  return { result, setters: { setBursts, setReady, setEnabled, setSessionKey } };
}

/** Hook armed with an empty burst list — the session's first burst must fire. */
function renderEmptyAlerts() {
  return useAlerts({ bursts: [] });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useNiftyOiAlerts", () => {
  test("opening mid-session never toasts history — but the trail is seeded", () => {
    const { result } = useAlerts({ bursts: HISTORY });
    // nothing "fired"…
    expect(result.toasts()).toEqual([]);
    // …yet the session is reviewable immediately (post-close / mid-session)
    expect(result.trail()).toHaveLength(HISTORY.length);
  });

  test("seeding never resurrects a critical older than the banner TTL", () => {
    // A 09:58 unwind was reappearing as a live banner at 10:45 after a reload.
    const old = HISTORY.find((b) => b.severity === "critical")!;
    const stale = { ...old, t: new Date(Date.now() - 30 * 60_000).toISOString() };
    const { result } = useAlerts({ bursts: [stale] });
    expect(result.trail()).toHaveLength(1); // still reviewable
    expect(result.banners()).toEqual([]); // but never "live"
  });

  test("seedTrail=false keeps a session empty (opt-out)", () => {
    const { result } = useAlerts({ bursts: HISTORY_PLUS, enabled: false, sessionKey: "eod:x", seedTrail: false });
    expect(result.trail()).toEqual([]);
  });

  test("stays unarmed until the session feed reports ready", () => {
    const { result, setters } = useAlerts({  bursts: HISTORY, ready: false  });
    expect(result.toasts()).toEqual([]);

    // loading completes: existing history must still not toast
    setters.setBursts(HISTORY); setters.setReady(true);
    expect(result.toasts()).toEqual([]);

    // only a genuinely new burst toasts
    setters.setBursts(HISTORY_PLUS); setters.setReady(true);
    expect(result.toasts()).toHaveLength(1);
  });

  test("arms on an empty ready payload — the session's first burst is NOT swallowed", () => {
    const { result, setters } = renderEmptyAlerts();
    expect(result.toasts()).toEqual([]);

    // REGRESSION: if priming waited for a non-empty burst list, this — the
    // session's first real burst — would be treated as history and lost.
    setters.setBursts(HISTORY);
    expect(result.toasts()).toHaveLength(1);
  });

  test("a new burst minute fires once and carries a BUY plan", () => {
    const { result, setters } = useAlerts({  bursts: HISTORY  });
    expect(result.toasts()).toEqual([]);

    setters.setBursts(HISTORY_PLUS);

    expect(result.toasts()).toHaveLength(1);
    const a = result.trail()[0];
    expect(a.severity).toBe("critical");
    // call-side burst → fade with puts, nearest tradeable strike to spot
    expect(a.title).toContain("BUY PE 22,700");
    expect(a.metrics?.some((m) => m.label === "ENTRY")).toBe(true);
    expect(a.metrics?.some((m) => m.label === "SL")).toBe(true);
    expect(a.metrics?.some((m) => m.label === "TGT")).toBe(true);
    expect(a.metrics?.some((m) => m.label === "QTY")).toBe(true);
    expect(a.detail).toContain("not advice");

    // re-rendering the same data does not re-fire
    setters.setBursts(HISTORY_PLUS);
    expect(result.toasts()).toHaveLength(1);
  });

  test("put-side burst plans a CE buy", () => {
    const putHistory = detected(tape(12, [{ i: 5, inc: 50_000, put: true }]));
    const { result, setters } = useAlerts({  bursts: putHistory  });
    const putNext = detected(
      tape(13, [{ i: 5, inc: 50_000, put: true }, { i: 13, inc: 90_000, put: true }]),
    );
    setters.setBursts(putNext);
    expect(result.trail()[0].title).toContain("BUY CE 22,700");
  });

  test("disabled (EOD) never toasts", () => {
    const { result, setters } = useAlerts({  bursts: HISTORY, enabled: false  });
    setters.setBursts(HISTORY_PLUS); setters.setEnabled(false);
    expect(result.toasts()).toEqual([]);
  });

  test("switching session resets the trail and re-primes", () => {
    const { result, setters } = useAlerts({ bursts: HISTORY_PLUS, sessionKey: "live:nearest" });
    expect(result.trail()).toHaveLength(HISTORY_PLUS.length);

    setters.setSessionKey("live:2026-10-20");
    expect(result.trail()).toHaveLength(HISTORY_PLUS.length); // re-seeded
    expect(result.toasts()).toEqual([]);
  });

  test("dismissToast removes only that toast; clearTrail empties the trail", () => {
    const { result, setters } = useAlerts({  bursts: HISTORY  });
    setters.setBursts(HISTORY_PLUS);
    expect(result.toasts()).toHaveLength(1);
    const id = result.toasts()[0].id;

    result.dismissToast(id);
    expect(result.toasts()).toEqual([]);
    // the trail keeps both the seeded history and the new burst
    expect(result.trail().length).toBeGreaterThan(HISTORY.length);

    result.clearTrail();
    expect(result.trail()).toEqual([]);
  });

  test("toasts auto-expire after the TTL, the trail persists", () => {
    vi.useFakeTimers();
    // FRESH is critical (90s toast) — downgrade it so this covers the normal
    // 45s path for non-critical toasts.
    const nonCrit = HISTORY_PLUS.map((b) =>
      b.id === FRESH.id ? { ...b, severity: "watch" as const } : b,
    );
    const { result, setters } = useAlerts({  bursts: HISTORY  });
    setters.setBursts(nonCrit);
    expect(result.toasts()).toHaveLength(1);

    {
      vi.advanceTimersByTime(46_000);
    }
    expect(result.toasts()).toEqual([]);
    expect(result.trail().length).toBeGreaterThan(0);
  });

  test("a missing chain still alerts, just without the plan", () => {
    const { result, setters } = useAlerts({ bursts: HISTORY, chain: [], spot: 0 });
    setters.setBursts(HISTORY_PLUS);
    expect(result.toasts()).toHaveLength(1);
    expect(result.trail()[0].title).toContain("Call OI burst");
    expect(result.trail()[0].metrics?.some((m) => m.label === "ENTRY")).toBe(false);
  });

  test("a critical burst chirps and flashes the tab title", () => {
    const { result, setters } = useAlerts({  bursts: HISTORY  });
    setters.setBursts([
      ...HISTORY,
      {
        ...FRESH,
        id: "2026-10-23T12:45:00+05:30-call",
        t: "2026-10-23T12:45:00+05:30",
        severity: "critical",
        actionable: true,
      },
    ]);
    expect(playAlertSound).toHaveBeenCalledWith("critical");
    expect(flashAlertTitle).toHaveBeenCalled();
    // The toast/banner path is unchanged.
    expect(result.banners().length).toBeGreaterThan(0);
  });

  test("a watch burst uses the soft cue, never the critical chirp", () => {
    const { result, setters } = useAlerts({ bursts: HISTORY });
    void result;
    vi.mocked(playAlertSound).mockClear();
    vi.mocked(flashAlertTitle).mockClear();
    setters.setBursts([
      ...HISTORY,
      {
        ...FRESH,
        id: "2026-10-23T12:46:00+05:30-call",
        t: "2026-10-23T12:46:00+05:30",
        severity: "watch",
      },
    ]);
    expect(playAlertSound).toHaveBeenCalledWith("watch");
    expect(flashAlertTitle).not.toHaveBeenCalled();
  });

  test("the same setup inside ten minutes is announced once", () => {
    const { result, setters } = useAlerts({  bursts: HISTORY  });
    const first: OiBurst = {
      ...FRESH, id: "cool-1", t: "2026-10-23T09:40:00+05:30",
      severity: "critical", strike: 22_700, side: "call", flow: "writers",
    };
    setters.setBursts([...HISTORY, first]);
    const trail = result.trail().length;
    const repeat: OiBurst = { ...first, id: "cool-2", t: "2026-10-23T09:42:00+05:30" };
    setters.setBursts([...HISTORY, first, repeat]);
    // Same side + flow + strike → the second id is the same idea.
    expect(result.trail().length).toBe(trail);
  });

  test("a wall test and a same-strike rejection are two events, not a repeat", () => {
    const { result, setters } = useAlerts({  bursts: HISTORY  });
    const tested: OiBurst = {
      id: "wall-test-1154",
      type: "wall_test",
      side: "call",
      t: "2026-11-03T11:54:00+05:30",
      strike: 23_700,
      spot: 23_690,
      delta: 0,
      baseline: 0,
      score: 0,
      severity: "watch",
      cumDoi: 0,
      tickVol: 0,
    };
    // 6 minutes later, same strike — inside the 10-minute cooldown window.
    const rejected: OiBurst = {
      ...tested,
      id: "wall-reject-1200",
      type: "rejection",
      t: "2026-11-03T12:00:00+05:30",
      target: 23_650,
      spot: 23_647.7,
    };
    // A second test of the same wall is the same idea and must not re-toast.
    const retest: OiBurst = {
      ...tested,
      id: "wall-test-1202",
      t: "2026-11-03T12:02:00+05:30",
    };
    setters.setBursts([...HISTORY, tested, rejected, retest]);
    const titles = result.trail().map((a) => a.title);
    expect(titles[0]).toContain("✕ CW 23,700 → 23,650");
    expect(titles.filter((t) => t.includes("TESTED"))).toHaveLength(1);
    expect(titles.filter((t) => t.includes("REJECTED") || t.includes("✕"))).toHaveLength(1);
  });

  test("pushToast raises a toast manually and never stacks duplicates", () => {
    const { result } = useAlerts({ bursts: HISTORY });
    const alert = burstToAlert(HISTORY[0]);
    result.pushToast(alert);
    expect(result.toasts()).toHaveLength(1);
    result.pushToast(alert);
    expect(result.toasts()).toHaveLength(1);
  });

  test("a burst's pre-computed backend signal is used when it agrees with the flow", () => {
    const { result, setters } = useAlerts({  bursts: HISTORY  });

    // The locally derived plan for this call-side burst is also PE, so the
    // supplied signal is consistent with the flow read and must win verbatim
    // (it carries the backend's own strike/entry).
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
    setters.setBursts([...HISTORY, { ...FRESH, signal: supplied }]);

    const a = result.trail()[0];
    const entry = a.metrics?.find((m) => m.label === "ENTRY");
    expect(entry?.value).toBe("999.99");
    expect(a.title).toContain("BUY PE 22,700");
    expect(a.detail).toContain("buy PE 22,700");
  });

  test("a backend plan that contradicts the flow verdict is re-derived", () => {
    // 2026-10-23 11:19 live alert: call unwind −2.55M, premChg −4.45,
    // flow=liquidation, bearish=true (longs sold out → PE) while the legacy
    // backend plan said CE. The banner read "LONGS LIQUIDATING → BUY CE".
    const { result, setters } = useAlerts({  bursts: HISTORY  });
    const contradictory: OiBurst = {
      ...FRESH,
      id: "2026-10-23T11:19:48+05:30-call",
      side: "call",
      delta: -2_551_640,
      flow: "liquidation",
      bearish: true,
      premChg: -4.45,
      type: "burst",
      signal: {
        leg: "CE",
        strike: 22_450,
        entry: 176.45,
        sl: 132.34,
        target: 264.67,
        qty: 65,
        lots: 1,
        basis: "backend legacy plan (OI-only)",
      },
    };
    setters.setBursts([...HISTORY, contradictory]);

    const a = result.trail()[0];
    expect(a.title).toContain("BUY PE");
    expect(a.title).not.toContain("BUY CE");
    expect(a.detail).toContain("longs exiting");
    expect(a.detail).not.toContain("backend legacy plan");
  });
});

describe("useNiftyOiAlerts critical prominence", () => {
  /** FRESH is critical; clone it into distinct critical bursts. */
  function crit(id: string, t: string): OiBurst {
    // Distinct strikes: the cooldown dedupes by side + flow + strike, so two
    // criticals from the same setup inside 10 minutes are one announcement.
    const n = Number(id.replace(/\D/g, "")) || 0;
    return { ...FRESH, id, t, severity: "critical" as const, strike: 22_500 + n * 50 };
  }

  test("critical toasts survive the normal 45s timer and last 90s", () => {
    vi.useFakeTimers();
    const { result, setters } = useAlerts({  bursts: HISTORY  });
    setters.setBursts(HISTORY_PLUS);
    expect(result.toasts()).toHaveLength(1);
    expect(result.toasts()[0].severity).toBe("critical");

    {
      vi.advanceTimersByTime(46_000);
    }
    // still up — the normal toast timer must not kill a critical
    expect(result.toasts()).toHaveLength(1);

    {
      vi.advanceTimersByTime(45_000);
    }
    expect(result.toasts()).toEqual([]);
    expect(result.trail().length).toBeGreaterThan(0);
  });

  test("banners fire only for critical bursts", () => {
    const { result, setters } = useAlerts({  bursts: HISTORY  });
    // the seeded history already carries one critical → one banner
    expect(result.banners()).toHaveLength(1);

    // non-critical fresh burst → toast, but no new banner
    const watch = HISTORY_PLUS.map((b) =>
      b.id === FRESH.id ? { ...b, severity: "watch" as const } : b,
    );
    setters.setBursts(watch);
    expect(result.toasts()).toHaveLength(1);
    expect(result.banners()).toHaveLength(1);

    // critical fresh burst (new minute) → banner, newest first
    setters.setBursts([...watch, crit("crit-2", "09:31")]);
    expect(result.banners()).toHaveLength(2);
    expect(result.banners()[0].id).toBe("crit-2");
    expect(result.banners().every((b) => b.severity === "critical")).toBe(true);
  });

  test("banners cap at two, newest first", () => {
    const { result, setters } = useAlerts({  bursts: HISTORY  });
    const three = [
      ...HISTORY,
      crit("crit-1", "09:30"),
      crit("crit-2", "09:31"),
      crit("crit-3", "09:32"),
    ];
    setters.setBursts(three);
    expect(result.banners()).toHaveLength(2);
    expect(result.banners().map((b) => b.id)).toEqual([
      "crit-3",
      "crit-2",
    ]);
  });

  test("banners auto-dismiss after five minutes with fake timers", () => {
    vi.useFakeTimers();
    const { result, setters } = useAlerts({  bursts: HISTORY  });
    setters.setBursts(HISTORY_PLUS);
    expect(result.banners()).toHaveLength(2);

    {
      vi.advanceTimersByTime(5 * 60_000 + 1_000);
    }
    expect(result.banners()).toEqual([]);
    // the trail keeps the burst long after the banner is gone
    expect(result.trail().length).toBeGreaterThan(0);
  });

  test("dismissBanner removes only that banner", () => {
    const { result, setters } = useAlerts({  bursts: HISTORY  });
setters.setBursts([...HISTORY, crit("crit-1", "09:30"), crit("crit-2", "09:31")]);
    expect(result.banners().map((b) => b.id)).toEqual([
      "crit-2",
      "crit-1",
    ]);

    result.dismissBanner("crit-2");
    expect(result.banners().map((b) => b.id)).toEqual(["crit-1"]);
  });

  test("clearTrail and session switch clear banners too", () => {
    const { result, setters } = useAlerts({ bursts: HISTORY_PLUS, sessionKey: "live:nearest" });
    // HISTORY_PLUS seeds two criticals → two banners (capped at two)
    expect(result.banners()).toHaveLength(2);

    result.clearTrail();
    expect(result.banners()).toEqual([]);

    setters.setSessionKey("live:other");
    expect(result.banners()).toHaveLength(2);
  });

  test("pushToast of a critical also raises a banner; non-critical does not", () => {
    const { result } = useAlerts({ bursts: HISTORY });
    const seeded = result.banners().map((b) => b.id);
    const watchAlert = { ...burstToAlert(HISTORY[0]), severity: "watch" as const };
    result.pushToast(watchAlert);
    expect(result.banners().map((b) => b.id)).toEqual(seeded);

    const critAlert = burstToAlert(crit("crit-x", "09:40"));
    result.pushToast(critAlert);
    expect(result.banners()[0].id).toBe("crit-x");
    expect(result.banners()).toHaveLength(2);
  });
});

describe("useNiftyOiAlerts flow-aware direction", () => {
  // CHAIN spot 22,722: nearest CE to spot with premium ≥ 10 is 22,700 @ 22.
  function flowBurst(overrides: Partial<OiBurst> = {}): OiBurst {
    return {
      id: "flow-1",
      side: "put",
      t: "15:04",
      delta: -1_480_000,
      baseline: 100_000,
      score: 14.8,
      severity: "critical",
      cumDoi: 0,
      spot: 22_701,
      tickVol: 5_000,
      ...overrides,
    };
  }

  test("put unwind + covering threads into a BUY CE banner action", () => {
    const { result, setters } = renderEmptyAlerts();
setters.setBursts([
      flowBurst({ flow: "covering", bearish: false, trend: "up", trend5m: "up" }),
    ]);
    expect(result.toasts()).toHaveLength(1);
    expect(result.trail()[0].title).toContain("BUY CE 22,700");
    expect(result.trail()[0].metrics?.find((m) => m.label === "ENTRY")?.value).toBe(
      "22.00",
    );
    expect(result.banners()).toHaveLength(1);
    expect(result.banners()[0].title).toContain("BUY CE 22,700");
  });

  test("trend5m rescues a covering plan when the session trend lags", () => {
    const { result, setters } = renderEmptyAlerts();
setters.setBursts([
      flowBurst({
        id: "flow-2",
        flow: "covering",
        bearish: false,
        trend: "down",
        trend5m: "up",
      }),
    ]);
    // without trend5m threading this would be suppressed as counter-trend
    expect(result.trail()[0].title).toContain("BUY CE 22,700");
  });

  test("liquidation + downtrend threads into a BUY PE action", () => {
    const { result, setters } = renderEmptyAlerts();
setters.setBursts([
      flowBurst({
        id: "flow-3",
        flow: "liquidation",
        bearish: true,
        trend: "down",
        trend5m: "down",
      }),
    ]);
    expect(result.trail()[0].title).toContain("BUY PE 22,700");
    expect(result.trail()[0].metrics?.find((m) => m.label === "ENTRY")?.value).toBe(
      "28.00",
    );
  });
});
