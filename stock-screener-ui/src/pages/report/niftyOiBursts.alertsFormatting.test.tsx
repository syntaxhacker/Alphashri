// @vitest-environment happy-dom

import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { MarketAlertRow, MarketAlertStack } from "@/components/notifications/MarketAlertCard";
import type { OiBurst, OiSignal } from "./niftyOiBursts";
import {
  burstToAlert,
  criticalBannerText,
  deriveOiSignal,
  detectOiBursts,
  dropConflictingSides,
  entryFreshness,
  resolveFuelState,
  sortAlertsCriticalFirst,
} from "./niftyOiBursts";
import { callSeries, putSeries } from "./niftyOiBursts.fixtures";

describe("burstToAlert", () => {
  test("maps to the shared MarketAlert shape", () => {
    const rows = callSeries([...Array.from({ length: 12 }, () => 1_000), 60_000]);
    const b = detectOiBursts(rows)[0];
    const a = burstToAlert(b);
    expect(a.kind).toBe("oi_burst");
    expect(a.severity).toBe("critical");
    expect(a.symbol).toBe("NIFTY");
    expect(a.title).toContain("Call OI burst");
    expect(a.title).toContain("+60.0K");
    expect(a.metrics?.find((m) => m.label === "ΔOI")?.value).toBe("+60.0K");
    expect(a.source).toContain("Nifty tape");
    expect(a.href).toBe("/report/index");
  });

  test("put side labels correctly and signs the tone down when negative", () => {
    const rows = callSeries([...Array.from({ length: 12 }, () => 1_000), 60_000]);
    const b = detectOiBursts(rows)[0];
    const signal = deriveOiSignal(b, [{ strike: 22_700, ce: { ltp: 22 }, pe: { ltp: 28 } }], 22_720)!;
    const a = burstToAlert(b, signal);
    expect(a.title).toContain("BUY PE 22,700");
    expect(a.title).toContain("qty");
    expect(a.metrics?.find((m) => m.label === "ENTRY")?.value).toBe("28.00");
    expect(a.metrics?.find((m) => m.label === "TGT")?.value).toBe("42.00");
    expect(a.metrics?.find((m) => m.label === "SL")?.value).toBe("21.00");
    expect(a.detail).toContain("not advice");
    expect(a.source).toContain("mechanical plan");
  });

  test("with a signal the title leads with the trade plan and metrics carry it", () => {
    const rows = putSeries([...Array.from({ length: 12 }, () => -1_000), -50_000]);
    const a = burstToAlert(detectOiBursts(rows)[0]);
    expect(a.title).toContain("Put OI burst");
    expect(a.title).toContain("-50.0K");
    expect(a.metrics?.find((m) => m.label === "ΔOI")?.tone).toBe("down");
  });

  test("short squeeze is a scalp watch with a trigger and playbook", () => {
    const rows = callSeries([...Array.from({ length: 12 }, () => 1_000), -198_575]);
    const b = {
      ...detectOiBursts(rows)[0],
      setup: "short_squeeze",
      setup_label: "SHORT SQUEEZE",
      horizon: "scalp",
      trigger: 25_000,
      playbook: "Wait for a 1-min close above 25,000; exit if OI rebuilds.",
    };
    const a = burstToAlert(b);
    expect(a.title).toContain("SHORT SQUEEZE");
    expect(a.title).toContain("25,000");
    expect(a.actionable).toBe(false);
    expect(a.detail).toContain("exit if OI rebuilds");
    expect(a.metrics?.find((m) => m.label === "MODE")?.value).toBe("SCALP");
    expect(a.metrics?.find((m) => m.label === "TRIGGER")?.value).toBe("25,000");
  });

  test("fresh buying carries the setup and swing mode", () => {
    const rows = callSeries([...Array.from({ length: 12 }, () => 1_000), 60_000]);
    const b = {
      ...detectOiBursts(rows)[0],
      setup: "fresh_long",
      setup_label: "FRESH BUYING",
      horizon: "swing",
      trigger: 22_700,
      playbook: "Buy the first pullback holding the breakout.",
    };
    const a = burstToAlert(b);
    expect(a.title).toContain("FRESH BUY");
    expect(a.metrics?.find((m) => m.label === "SETUP")?.value).toBe("FRESH BUYING");
    expect(a.metrics?.find((m) => m.label === "MODE")?.value).toBe("SWING");
    expect(a.detail).toContain("first pullback");
  });
});

describe("burst news tagging", () => {
  test("the nearest headline is appended to the detail and its source", () => {
    const rows = callSeries([...Array.from({ length: 12 }, () => 1_000), 60_000]);
    const b = {
      ...detectOiBursts(rows)[0],
      news: [
        {
          heading: "FM Sitharaman open to LTCG tax rethink",
          link: "https://upstox.com/news/a/",
          source: "upstox",
          minutesAway: -1,
        },
      ],
    };
    const a = burstToAlert(b, null);
    expect(a.detail).toContain("NEWS -1m: FM Sitharaman open to LTCG tax rethink");
    expect(a.source).toContain("upstox");
  });

  test("a positive offset is signed +Nm", () => {
    const rows = callSeries([...Array.from({ length: 12 }, () => 1_000), 60_000]);
    const b = {
      ...detectOiBursts(rows)[0],
      news: [{ heading: "IT stocks lead rally", link: "", source: "", minutesAway: 4 }],
    };
    expect(burstToAlert(b, null).detail).toContain("NEWS +4m: IT stocks lead rally");
  });

  test("no news leaves the detail clean", () => {
    const rows = callSeries([...Array.from({ length: 12 }, () => 1_000), 60_000]);
    const a = burstToAlert(detectOiBursts(rows)[0], null);
    expect(a.detail).not.toContain("NEWS");
  });
});

describe("critical prominence helpers", () => {
  const alert = (id: string, severity: "critical" | "watch" | "alert" | "info") => ({
    id,
    kind: "oi_burst" as const,
    severity,
    symbol: "NIFTY",
    title: `burst ${id}`,
    detail: "",
    metrics: [],
    ts: Date.parse(`2026-10-21T09:${id.slice(-2)}:00+05:30`) || 0,
    source: "",
    href: "/report/index",
  });

  test("critical-first sort keeps newest-first within each group", () => {
    const rows = [alert("a-15", "watch"), alert("b-16", "critical"), alert("c-17", "alert"), alert("d-18", "critical")];
    const sorted = sortAlertsCriticalFirst(rows);
    expect(sorted.map((r) => r.id)).toEqual(["b-16", "d-18", "a-15", "c-17"]);
  });

  test("a trail without criticals is returned unchanged", () => {
    const rows = [alert("a-15", "watch"), alert("c-17", "alert")];
    expect(sortAlertsCriticalFirst(rows).map((r) => r.id)).toEqual(["a-15", "c-17"]);
  });

  test("banner text leads with side/unwind, spot, then the trade plan", () => {
    const chain = [{ strike: 22_700, ce: { ltp: 185 }, pe: { ltp: 140 } }];
    const b = { id: "x", side: "put" as const, t: "15:04", delta: -1_480_000,
      baseline: 100_000, score: 14.8, severity: "critical" as const, cumDoi: 0,
      spot: 22_701, tickVol: 5_000 };
    const signal = deriveOiSignal(b, chain, 22_701, {})!;
    const text = criticalBannerText(b, burstToAlert(b, signal));
    expect(text).toContain("CRITICAL PUT UNWIND");
    expect(text).toContain("-1.48M");
    expect(text).toContain("22,701");
    expect(text).toContain(`BUY ${signal.leg} 22,700`);
    expect(text).toContain(`entry ${signal.entry}`);
    expect(text).toContain(`SL ${signal.sl}`);
    expect(text).toContain(`TGT ${signal.target}`);
  });

  test("banner without a signal still names the unwind", () => {
    const b = { id: "x", side: "call" as const, t: "15:04", delta: -900_000,
      baseline: 100_000, score: 9, severity: "critical" as const, cumDoi: 0,
      spot: 22_701, tickVol: 0 };
    const text = criticalBannerText(b, burstToAlert(b, null));
    expect(text).toContain("CRITICAL CALL UNWIND");
    expect(text).toContain("22,701");
  });

  test("banner without a burst falls back to the alert title", () => {
    const a = { ...alert("z-99", "critical"), title: "→ BUY PE 22,700 · qty 130" };
    expect(criticalBannerText(undefined, a)).toContain("BUY PE 22,700");
  });

  test("a backend-suppressed burst prints evidence only, never a fuel or plan claim", () => {
    const b: OiBurst = {
      id: "x", side: "put", t: "2026-11-26T12:05:00+05:30",
      delta: -2_400_000, baseline: 100_000, score: 14.2, severity: "critical",
      cumDoi: -2_400_000, spot: 24_310, tickVol: 900_000,
      fuel_state: "fresh_sellers",
      plan_suppressed: true,
    };
    const signal: OiSignal = {
      leg: "PE", strike: 24_300, entry: 210, sl: 157.5, target: 315,
      qty: 130, lots: 2, basis: "backend plan — must not be shown",
    };
    const text = criticalBannerText(b, burstToAlert(b, signal));
    expect(text).toContain("OI SHIFT · unconfirmed — spot/premium did not confirm");
    for (const leaked of [
      "CRITICAL PUT", "WRITERS ADDING", "SHORTS COVERING", "BUYERS ADDING",
      "LONGS EXITING", "BUY PE", "BUY CE", "entry ", "SL ", "TGT ", "backend plan",
    ]) {
      expect(text).not.toContain(leaked);
    }
    expect(text).toContain("-2.40M");
    expect(text).toContain("24,310");
  });

  test("flow 'unconfirmed' with a backend fuel_state is still evidence-only", () => {
    const b: OiBurst = {
      id: "x", side: "put", t: "2026-11-26T12:05:00+05:30",
      delta: -2_400_000, baseline: 100_000, score: 14.2, severity: "critical",
      cumDoi: -2_400_000, spot: 24_310, tickVol: 900_000,
      flow: "unconfirmed", fuel_state: "fresh_sellers",
    };
    const text = criticalBannerText(b, burstToAlert(b, null));
    expect(text).toContain("OI SHIFT · unconfirmed — spot/premium did not confirm");
    expect(text).not.toContain("WRITERS ADDING");
    expect(text).not.toContain("CRITICAL PUT");
  });

  test("a confirmed burst keeps its directional fuel claim in the banner", () => {
    const b: OiBurst = {
      id: "x", side: "put", t: "2026-11-26T12:05:00+05:30",
      delta: -2_400_000, baseline: 100_000, score: 14.2, severity: "critical",
      cumDoi: -2_400_000, spot: 24_310, tickVol: 900_000,
      fuel_state: "fresh_sellers",
    };
    const text = criticalBannerText(b, burstToAlert(b, null));
    expect(text).toContain("CRITICAL PUT WRITERS ADDING");
    expect(text).toContain("-2.40M");
    expect(text).toContain("24,310");
  });
});

/**
 * 2026-10-22 regressions — the two alerts that looked identical on the tape
 * and traded in opposite directions.
 *
 *  11:13  CALL UNWIND −162.5K, CE premium +5.90, spot at the DAY HIGH
 *         22,779 → "BUY CE 22,700 · ENTRY 179.25". The market topped
 *         22,780.35 two minutes later and fell 160 pts.
 *  11:44  PUT UNWIND −94.9K, PE premium +6.85, spot CLOSED BELOW the
 *         22,697 pivot → "BUY PE 22,700 · ENTRY 150.20". The market fell
 *         another 60 pts.
 *
 * Both were the same 2×2 cell (unwind + premium up = writers covering). The
 * differences the UI must now expose: the FUEL state, the LOCATION, and
 * whether the plan is still priced at the market.
 */
describe("2026-10-22 fuel-state alerts", () => {
  const chain = [
    { strike: 22_700, ce: { ltp: 220.3 }, pe: { ltp: 151.85 } },
  ];

  test("a covering burst says the fuel is spent and names the location", () => {
    const burst: OiBurst = {
      id: "2026-10-22T11:13:00+05:30-call",
      side: "call",
      t: "2026-10-22T11:13:00+05:30",
      delta: -162_500,
      baseline: 20_000,
      score: 8.1,
      severity: "critical",
      cumDoi: -1_861_275,
      spot: 22_779.6,
      tickVol: 49_583_495,
      flow: "covering",
    };
    const a = burstToAlert(burst);
    expect(a.title).toContain("Call OI burst");
    expect(a.detail).toContain("shorts buying back");
    expect(a.detail).toContain("@ 22,780");
    expect(a.metrics?.find((m) => m.label === "FUEL")?.value).toBe("spent");
  });

  test("a plan priced off a stale chain is marked RE-PRICE, not actionable", () => {
    const burst: OiBurst = {
      id: "2026-10-22T11:13:00+05:30-call",
      side: "call",
      t: "2026-10-22T11:13:00+05:30",
      delta: -162_500,
      baseline: 20_000,
      score: 8.1,
      severity: "critical",
      cumDoi: -1_861_275,
      spot: 22_779.6,
      tickVol: 49_583_495,
      flow: "covering",
    };
    const signal: OiSignal = {
      leg: "CE",
      strike: 22_700,
      entry: 179.25,
      sl: 134.44,
      target: 268.88,
      qty: 65,
      lots: 1,
      basis: "call OI unwind — writers covering → upside fuel → buy calls",
    };
    const a = burstToAlert(burst, signal, { freshness: entryFreshness(signal, chain) });
    expect(a.title).toContain("RE-PRICE");
    expect(a.title).toContain("220.30");
    expect(a.detail).toContain("re-price before trading");
    expect((a as { actionable?: boolean }).actionable).toBe(false);
  });

  test("a covering burst whose structure contradicts the leg carries no plan", () => {
    const burst: OiBurst = {
      id: "2026-10-22T11:13:00+05:30-call",
      side: "call",
      t: "2026-10-22T11:13:00+05:30",
      delta: -162_500,
      baseline: 20_000,
      score: 8.1,
      severity: "critical",
      cumDoi: -1_861_275,
      spot: 22_779.6,
      tickVol: 49_583_495,
      flow: "covering",
      // the underlying closed DOWN through 22,697 — a call plan is the wrong side
      structure: { level: 22_697, direction: "down", kind: "pivot" },
    };
    expect(deriveOiSignal(burst, chain, 22_779.6, {})).toBeNull();
    const a = burstToAlert(burst, null);
    expect(a.title).toContain("NO TRADE");
    expect((a as { actionable?: boolean }).actionable).toBe(false);
  });

  test("a covering burst with a structure break in the same direction keeps its plan", () => {
    const burst: OiBurst = {
      id: "2026-10-22T11:44:00+05:30-put",
      side: "put",
      t: "2026-10-22T11:44:00+05:30",
      delta: -94_900,
      baseline: 20_000,
      score: 4.7,
      severity: "alert",
      cumDoi: -886_535,
      spot: 22_687.95,
      tickVol: 68_325_660,
      flow: "covering",
      structure: { level: 22_697, direction: "down", kind: "pivot", close: 22_687.95 },
      invalidation: 22_697,
    };
    // The backend attaches the plan (leg PE — the put side's own direction);
    // the client renders it with the structure and the invalidation.
    const signal: OiSignal = {
      leg: "PE",
      strike: 22_700,
      entry: 150.2,
      sl: 112.65,
      target: 225.3,
      qty: 130,
      lots: 2,
      basis: "put OI unwind + covering — shorts bought back → downside fuel → buy puts",
    };
    const a = burstToAlert(burst, signal);
    expect(a.title).toContain("BUY PE 22,700");
    expect(a.detail).toContain("below the 22,697 pivot");
    expect(a.detail).toContain("while spot stays below 22,697");
    expect(a.detail).toContain("shorts buying back");
    expect((a as { actionable?: boolean }).actionable).toBeUndefined();
  });

  test("entryFreshness flags a plan the market has run away from", () => {
    const fresh = entryFreshness({ leg: "PE", strike: 22_700, entry: 150.2 }, chain);
    expect(fresh.stale).toBe(false);
    expect(fresh.live).toBe(151.85);
    const stale = entryFreshness({ leg: "CE", strike: 22_700, entry: 179.25 }, chain);
    expect(stale.stale).toBe(true);
    expect(stale.driftPct).toBeGreaterThan(20);
  });

  test("the backend's fuel_state is authoritative over the client's guess", () => {
    const burst: OiBurst = {
      id: "b1", side: "call", t: "2026-10-22T11:13:00+05:30",
      delta: -162_500, baseline: 20_000, score: 8.1, severity: "critical",
      cumDoi: -1_861_275, spot: 22_779.6, tickVol: 49_583_495,
      // The client would read the ATM premium as "covering" — the backend
      // knows the same-strike premium and says the fuel was spent.
      flow: "covering",
      fuel_state: "writers_covering",
    };
    expect(resolveFuelState(burst)).toBe("writers_covering");
    const a = burstToAlert(burst);
    expect(a.detail).toContain("shorts buying back");
  });

  test("a backend-suppressed burst renders an unconfirmed OI shift, not a plan", () => {
    const burst: OiBurst = {
      id: "b2", side: "call", t: "2026-10-22T11:13:00+05:30",
      delta: -162_500, baseline: 20_000, score: 8.1, severity: "critical",
      cumDoi: -1_861_275, spot: 22_779.6, tickVol: 49_583_495,
      fuel_state: "writers_covering",
      plan_suppressed: true,
    };
    // The client must not re-derive a plan the backend withheld.
    expect(deriveOiSignal(burst, chain, 22_779.6, {})).toBeNull();
    const a = burstToAlert(burst, null);
    expect(a.title).toContain("OI SHIFT · unconfirmed");
    expect((a as { actionable?: boolean }).actionable).toBe(false);
  });

  test("the invalidation level is printed even without a plan", () => {
    const burst: OiBurst = {
      id: "b3", side: "put", t: "2026-10-22T11:44:00+05:30",
      delta: -94_900, baseline: 20_000, score: 4.7, severity: "alert",
      cumDoi: -886_535, spot: 22_687.95, tickVol: 68_325_660,
      fuel_state: "writers_covering",
      structure: { level: 22_697, direction: "down", kind: "pivot" },
      invalidation: 22_697,
    };
    const a = burstToAlert(burst, null);
    expect(a.detail).toContain("while spot stays below 22,697");
  });
});

describe("strike-wall events", () => {
  /** 2026-11-03 11:54 — the call wall was tested, not broken. */
  const TEST_EVENT = {
    id: "wall_test:2026-11-03T11:54:00+05:30:call:23700:",
    type: "wall_test" as const,
    side: "call" as const,
    t: "2026-11-03T11:54:00+05:30",
    strike: 23700,
    target: null,
    spot: 23690,
    label: "CALL WALL 23,700 TESTED",
  };
  /** 2026-11-03 12:10 — the same wall rejected, target = max pain 23,650. */
  const REJECT = {
    id: "rejection:2026-11-03T12:10:00+05:30:call:23700:23650",
    type: "rejection" as const,
    side: "call" as const,
    t: "2026-11-03T12:10:00+05:30",
    strike: 23700,
    target: 23650,
    spot: 23647.7,
    label: "CALL WALL REJECTED 23,700",
  };

  const wall = (over: Pick<OiBurst, "id"> & Partial<OiBurst>): OiBurst => ({
    side: "call",
    t: "2026-11-03T11:54:00+05:30",
    delta: 0,
    baseline: 0,
    score: 0,
    severity: "watch",
    cumDoi: 0,
    spot: 23690,
    tickVol: 0,
    ...over,
  });

  afterEach(() => cleanup());

  test("a wall test is a watch alert with the tested level in the title", () => {
    const a = burstToAlert(wall(TEST_EVENT));
    expect(a.kind).toBe("oi_burst");
    expect(a.severity).toBe("watch");
    expect(a.title).toContain("◇ CW 23,700 TESTED");
    expect(a.metrics?.find((m) => m.label === "STRIKE")?.value).toBe("23,700");
    expect(a.detail).toContain("no break yet");
  });

  test("a rejection is an alert and prints wall → target", () => {
    const a = burstToAlert(wall(REJECT));
    expect(a.kind).toBe("oi_burst");
    expect(a.severity).toBe("alert");
    expect(a.title).toBe("✕ CW 23,700 → 23,650");
    expect(a.metrics?.find((m) => m.label === "TGT")?.value).toBe("23,650");
    expect(a.detail).toContain("held");
  });

  test("a break is an alert with a directional icon", () => {
    const callBreak = burstToAlert(
      wall({ ...TEST_EVENT, id: "b1", type: "break", target: 23750, spot: 23760 }),
    );
    expect(callBreak.severity).toBe("alert");
    expect(callBreak.title).toBe("↑ CW 23,700 → 23,750");

    const putBreak = burstToAlert(
      wall({
        ...TEST_EVENT,
        id: "b2",
        type: "wall_break",
        side: "put",
        strike: 23500,
        target: 23450,
        spot: 23468,
      }),
    );
    expect(putBreak.title).toBe("↓ PW 23,500 → 23,450");
  });

  test("wall events never take part in the two-sided pin drop", () => {
    const callWall = wall({ ...TEST_EVENT, id: "wall-call" });
    const putWall = wall({
      ...TEST_EVENT,
      id: "wall-put",
      type: "wall_test",
      side: "put",
      strike: 23500,
    });
    // A regular call + put writer build in the SAME minute still cancels,
    // but the wall rows beside them survive.
    const callBurst = wall({
      id: "burst-call",
      t: "2026-11-03T11:54:00+05:30",
      delta: 3_600_000,
      flow: "writers",
      strike: 23_700,
      type: undefined,
    });
    const putBurst = wall({
      id: "burst-put",
      t: "2026-11-03T11:54:00+05:30",
      delta: 2_200_000,
      flow: "writers",
      strike: 23_500,
      side: "put",
      type: undefined,
    });
    const kept = dropConflictingSides([callWall, putWall, callBurst, putBurst]);
    expect(kept.map((b) => b.id).sort()).toEqual(["wall-call", "wall-put"]);
  });

  test("renders through MarketAlertRow with the right severity rail", () => {
    const testAlert = burstToAlert(wall(TEST_EVENT));
    const rejectAlert = burstToAlert(wall(REJECT));
    render(() => (
      <UIProvider>
        <MarketAlertRow alert={testAlert} />
        <MarketAlertRow alert={rejectAlert} />
      </UIProvider>
    ));
    const rows = screen.getAllByTestId("market-alert-oi_burst");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("data-severity", "watch");
    expect(rows[0]).toHaveTextContent("◇ CW 23,700 TESTED");
    expect(rows[1]).toHaveAttribute("data-severity", "alert");
    expect(rows[1]).toHaveTextContent("✕ CW 23,700 → 23,650");
  });

  test("data_stale maps to a critical system alert", () => {
    const a = burstToAlert(
      wall({
        id: "data_stale:2026-11-03T12:00:00+05:30:call::",
        type: "data_stale",
        t: "2026-11-03T12:00:00+05:30",
        label: "TAPE STALE 3m",
        detail: "No new tape row for 3 minutes.",
      }),
    );
    expect(a.kind).toBe("system");
    expect(a.severity).toBe("critical");
    expect(a.title).toBe("TAPE STALE 3m");
    expect(a.detail).toContain("No new tape row");
  });
});

describe("unconfirmed OI shifts are never trade plans", () => {
  afterEach(() => cleanup());

  const base = (over: Partial<OiBurst> = {}): OiBurst => ({
    id: "unconfirmed-1",
    side: "call",
    t: "2026-11-26T12:05:00+05:30",
    delta: -2_400_000,
    baseline: 100_000,
    score: 14.2,
    severity: "critical",
    cumDoi: -2_400_000,
    spot: 24_310,
    tickVol: 900_000,
    ...over,
  });
  const supplied: OiSignal = {
    leg: "CE", strike: 24_300, entry: 210, sl: 157.5, target: 315,
    qty: 65, lots: 1, basis: "backend plan — must not be shown",
  };
  const planMetric = (a: ReturnType<typeof burstToAlert>) =>
    a.metrics?.find((m) => ["ENTRY", "SL", "TGT", "QTY"].includes(m.label));

  test("plan_suppressed beats even a supplied backend plan", () => {
    const a = burstToAlert(base({ plan_suppressed: true }), supplied);
    expect(a.title).toBe("OI SHIFT · unconfirmed");
    expect(a.title).not.toContain("BUY");
    expect(a.detail).not.toContain("backend plan");
    expect(planMetric(a)).toBeUndefined();
    expect(a.metrics?.find((m) => m.label === "ΔOI")?.value).toBe("-2.40M");
    expect(a.metrics?.find((m) => m.label === "SPOT")?.value).toBe("24,310");
    expect(a.severity).toBe("critical");
    expect(a.actionable).toBe(false);
  });

  test("flow: 'unconfirmed' names same-strike and spot evidence in text and metrics", () => {
    const a = burstToAlert(base({
      flow: "unconfirmed",
      confirmation: {
        same_strike: false,
        strike_oi_delta: -30_000,
        strike_premium_change: -4.25,
        spot_change: -18.4,
        reasons: ["premium moved at a different strike", "spot did not follow"],
      },
    }), supplied);

    expect(a.title).toContain("OI SHIFT · unconfirmed");
    expect(a.detail).toContain("no same-strike agreement");
    expect(a.detail).toContain("strike OI -30.0K");
    expect(a.detail).toContain("strike premium -4.25");
    expect(a.detail).toContain("spot -18.4 pts");
    expect(a.detail).toContain("premium moved at a different strike");
    expect(a.detail).toContain("spot did not follow");
    expect(a.metrics?.find((m) => m.label === "SAME STRIKE")?.value).toBe("no");
    expect(a.metrics?.find((m) => m.label === "STRIKE ΔOI")?.value).toBe("-30.0K");
    expect(a.metrics?.find((m) => m.label === "STRIKE Δ₹")?.value).toBe("-4.25");
    expect(a.metrics?.find((m) => m.label === "SPOT Δ")?.value).toBe("-18.4");
    expect(a.metrics?.find((m) => m.label === "REASON")?.value).toBe("premium moved at a different strike");
    expect(planMetric(a)).toBeUndefined();
    expect(a.actionable).toBe(false);
  });

  test("a withheld burst makes no directional fuel claim", () => {
    const a = burstToAlert(base({ flow: "unconfirmed", fuel_state: "fresh_sellers" }), null);
    for (const claim of ["writers adding", "shorts covering", "buyers adding", "longs exiting", "BUY CE", "BUY PE"]) {
      expect(a.detail).not.toContain(claim);
      expect(a.title).not.toContain(claim);
    }
    expect(a.detail).toContain("No trade");
    expect(a.actionable).toBe(false);
  });

  test("severity rail and row layout stay unchanged for an unconfirmed alert", () => {
    const a = burstToAlert(base({ severity: "watch", flow: "unconfirmed" }), null);
    render(() => (
      <UIProvider>
        <MarketAlertRow alert={a} />
      </UIProvider>
    ));
    const row = screen.getByTestId("market-alert-oi_burst");
    expect(row).toHaveAttribute("data-severity", "watch");
    expect(row).toHaveTextContent("OI SHIFT · unconfirmed");
  });

  test("the toast stack prints evidence only — never a BUY CE/PE instruction", () => {
    const a = burstToAlert(base({ flow: "unconfirmed" }), supplied);
    render(() => (
      <UIProvider>
        <MarketAlertStack alerts={[a]} />
      </UIProvider>
    ));
    const stack = screen.getByTestId("market-alert-stack");
    expect(stack).toHaveTextContent("OI SHIFT · unconfirmed");
    expect(stack).not.toHaveTextContent("BUY CE");
    expect(stack).not.toHaveTextContent("BUY PE");
    expect(stack).not.toHaveTextContent("backend plan");
  });
});
