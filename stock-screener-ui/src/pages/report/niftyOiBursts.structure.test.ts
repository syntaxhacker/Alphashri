import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  FUEL_STATE_LABEL,
  NIFTY_LOT_SIZE,
  OI_BURST_MIN_ABS,
  OI_BURST_TIERS,
  OI_BURST_WARMUP,
  OI_BURST_WINDOW,
  OI_SIGNAL_MIN_PREMIUM,
  OI_SIGNAL_RISK_BUDGET,
  OI_SIGNAL_SL_PCT,
  OI_SIGNAL_TP_PCT,
  OI_SIGNAL_STALE_PCT,
  SPENT_FUEL_STATES,
  TREND_EMA_SPAN,
  burstTimeLabel,
  detectOiBursts,
  severityForScore,
} from "./niftyOiBursts";
import { compact } from "./niftyOiBursts.format";

const dir = resolve(process.cwd(), "src/pages/report");
const source = (name: string) => readFileSync(resolve(dir, name), "utf8");
const lines = (name: string) => source(name).split("\n").length;

const FACADE = "niftyOiBursts.ts";
const MAX_LINES = 500;

const MODULES: Record<string, string> = {
  "niftyOiBursts.types.ts": "export interface OiBurst",
  "niftyOiBursts.format.ts": "export function burstTimeLabel",
  "niftyOiBursts.normalize.ts": "export function computeMinuteDoi",
  "niftyOiBursts.detect.ts": "export function detectOiBursts",
  "niftyOiBursts.signal.ts": "export function deriveOiSignal",
  "niftyOiBursts.alerts.ts": "export function burstToAlert",
};

describe("niftyOiBursts decomposition", () => {
  test("facade stays a facade and re-exports every focused module", () => {
    const facade = source(FACADE);
    expect(lines(FACADE)).toBeLessThan(80);
    for (const module of Object.keys(MODULES)) {
      expect(facade, `facade no longer re-exports ${module}`).toContain(
        `from "./${module.replace(/\.ts$/, "")}"`,
      );
    }
    for (const symbol of ["detectOiBursts", "OiBurst", "deriveOiSignal", "burstToAlert", "burstTimeLabel", "NIFTY_LOT_SIZE"]) {
      expect(facade, `facade dropped ${symbol}`).toMatch(new RegExp(`\\b${symbol}\\b`));
    }
    for (const implementation of ["function detectOiBursts", "export interface OiBurst", "wallEventToAlert"]) {
      expect(facade, `facade re-inlined ${implementation}`).not.toContain(implementation);
    }
  });

  test("every focused module stays under the line budget and keeps its responsibility", () => {
    for (const [module, marker] of Object.entries(MODULES)) {
      expect(lines(module), `${module} grew past the ${MAX_LINES}-line budget`).toBeLessThan(MAX_LINES);
      expect(source(module), `${module} lost its responsibility`).toContain(marker);
    }
  });

  test("pass-through helpers keep their exact units and thresholds", () => {
    expect(OI_BURST_WINDOW).toBe(10);
    expect(OI_BURST_MIN_ABS).toBe(2_000);
    expect(OI_BURST_WARMUP).toBe(3);
    expect(OI_BURST_TIERS).toEqual({ watch: 3, alert: 5, critical: 8, info: Infinity });
    expect(OI_SIGNAL_RISK_BUDGET).toBe(5_000);
    expect(OI_SIGNAL_SL_PCT).toBe(25);
    expect(OI_SIGNAL_TP_PCT).toBe(50);
    expect(OI_SIGNAL_MIN_PREMIUM).toBe(10);
    expect(OI_SIGNAL_STALE_PCT).toBe(5);
    expect(NIFTY_LOT_SIZE).toBe(65);
    expect(TREND_EMA_SPAN).toBe(20);
    expect([...SPENT_FUEL_STATES].sort()).toEqual(["longs_liquidating", "writers_covering"]);
    expect(FUEL_STATE_LABEL.fresh_buyers).toBe("FRESH BUYING");
    expect(compact(60_000)).toBe("+60.0K");
    expect(compact(-1_480_000)).toBe("-1.48M");
    expect(burstTimeLabel("14:03")).toBe("14:03");
    expect(severityForScore(8)).toBe("critical");
  });

  test("detection still emits the same burst shape through the facade", () => {
    const rows = Array.from({ length: 13 }, (_, i) => ({
      t: `${String(9).padStart(2, "0")}:${String(15 + i).padStart(2, "0")}`,
      spot: 22_550,
      call_doi: i === 12 ? 71_000 : i * 1_000,
      put_doi: 0,
    }));
    const bursts = detectOiBursts(rows as never);
    expect(bursts).toHaveLength(1);
    expect(bursts[0]).toMatchObject({
      side: "call",
      delta: 60_000,
      baseline: OI_BURST_MIN_ABS,
      severity: "critical",
      cumDoi: 71_000,
    });
  });
});
