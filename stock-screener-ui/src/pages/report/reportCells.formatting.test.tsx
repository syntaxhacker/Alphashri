import { describe, expect, test } from "vitest";
import type { NiftyReplayMeta } from "@/api/reportNifty";
import type { NiftyReport } from "@/types/niftyReport";
import { REPLAY_STUB_REPORT, replayFromMeta as replayFromMetaShared } from "./niftyReplay";
import {
  buildOvernightLevels,
  findAtmStrike,
  formatGexLevel,
  formatGexTotal,
  formatOiCr,
  formatSignedPoints,
  gexRegimeText,
  oiBurstLogHeight,
  replayFromMeta,
  setupBannerHeadline,
} from "./reportCells";
import { reportWith, strikeAt } from "./reportCells.fixtures";

describe("formatSignedPoints", () => {
  test("signs the rounded points and groups the integer part", () => {
    expect(formatSignedPoints(733)).toBe("+733 pts");
    expect(formatSignedPoints(1250.6)).toBe("+1,251 pts");
    expect(formatSignedPoints(-139.2)).toBe("-139 pts");
    expect(formatSignedPoints(0)).toBe("0 pts");
    expect(formatSignedPoints(100000)).toBe("+1,00,000 pts");
  });
});

describe("formatOiCr", () => {
  test("compacts crores and lakhs, dashes anything unusable", () => {
    expect(formatOiCr(2.69e7)).toBe("2.69 Cr");
    expect(formatOiCr(1.84e5)).toBe("1.8 L");
    expect(formatOiCr(45000)).toBe("45,000");
    expect(formatOiCr(0)).toBe("—");
    expect(formatOiCr(-5)).toBe("—");
    expect(formatOiCr(null)).toBe("—");
    expect(formatOiCr(undefined)).toBe("—");
    expect(formatOiCr(Number.NaN)).toBe("—");
  });
});

describe("replayFromMeta", () => {
  const meta: NiftyReplayMeta = {
    date: "2026-11-20",
    count: 99,
    interval_sec: 60,
    gap_reasons: { "chain-failed": 2 },
    frames: [
      { t: "2026-11-20T09:15:00+05:30", spot: 24_500 },
      { t: "2026-11-20T09:16:00+05:30", spot: 24_510 },
    ],
  };

  test("maps the meta payload using the shared stub report object", () => {
    const shared = replayFromMetaShared(meta);
    expect(shared).toEqual({
      date: "2026-11-20",
      count: 2,
      interval_sec: 60,
      gap_reasons: { "chain-failed": 2 },
      snapshots: [
        {
          t: "2026-11-20T09:15:00+05:30",
          fetched_at: "",
          report: REPLAY_STUB_REPORT,
          sensex: null,
        },
        {
          t: "2026-11-20T09:16:00+05:30",
          fetched_at: "",
          report: REPLAY_STUB_REPORT,
          sensex: null,
        },
      ],
    });
    expect(shared.snapshots.every((frame) => frame.report === REPLAY_STUB_REPORT)).toBe(true);

    const fromCells = replayFromMeta(meta);
    expect(fromCells).toEqual(shared);
    expect(fromCells.snapshots[0].report).toBe(shared.snapshots[0].report);
  });

  test("count comes from frames, and absent gap reasons stay absent", () => {
    const replay = replayFromMeta({ ...meta, frames: [], gap_reasons: undefined });
    expect(replay.count).toBe(0);
    expect(replay.snapshots).toEqual([]);
    expect(replay.gap_reasons).toBeUndefined();
  });
});

describe("findAtmStrike", () => {
  test("picks the closest strike, lower on a tie, null without data", () => {
    expect(findAtmStrike([], 25750)).toBeNull();
    expect(findAtmStrike([strikeAt(25700)], Number.NaN)).toBeNull();
    expect(findAtmStrike([strikeAt(25700), strikeAt(25800)], 25730)).toBe(25700);
    expect(findAtmStrike([strikeAt(25700), strikeAt(25800)], 25780)).toBe(25800);
    expect(findAtmStrike([strikeAt(25800), strikeAt(25700)], 25750)).toBe(25700);
    expect(findAtmStrike([strikeAt(25000), strikeAt(25700), strikeAt(25800)], 25690)).toBe(25700);
  });
});

describe("setupBannerHeadline", () => {
  test("a live flip outranks arming and names its reason", () => {
    expect(setupBannerHeadline(true, "5m vs session", 5, 11)).toBe(
      "FLOW FLIP · 5m vs session — setup paused",
    );
    expect(setupBannerHeadline(true, null, 5, 11)).toBe(
      "FLOW FLIP · 5m vs 15m — setup paused",
    );
    expect(setupBannerHeadline(false, "5m vs session", 5, 11)).toBe("⏳ SETUP ARMING 5/11");
  });
});

describe("buildOvernightLevels", () => {
  test("derives resistance and support from the live walls", () => {
    const levels = buildOvernightLevels(
      reportWith({
        walls: {
          calls: [
            { strike: 25500, oi: 1 },
            { strike: 25200, oi: 2 },
            { strike: 25300, oi: 3 },
          ],
          puts: [
            { strike: 24800, oi: 1 },
            { strike: 24600, oi: 2 },
            { strike: 24900, oi: 3 },
          ],
        },
      }),
    );
    expect(levels.resistance).toEqual([
      { strike: 25200, pct: 0.8 },
      { strike: 25300, pct: 1.2 },
    ]);
    expect(levels.support).toEqual([
      { strike: 24900, pct: -0.4 },
      { strike: 24800, pct: -0.8 },
    ]);
    expect(levels.painPull.dir).toBe("flat");
    expect(levels.painPull.pct).toBe(0);
    expect(levels.pcrVerdict).toBe("Neutral (PCR-OI 0.85)");
  });

  test("empty walls and a missing PCR degrade without throwing", () => {
    const flat = buildOvernightLevels(reportWith({}));
    expect(flat.resistance).toEqual([]);
    expect(flat.support).toEqual([]);
    expect(flat.pcrVerdict).toBe("Neutral (PCR-OI 0.85)");

    const missing = buildOvernightLevels(
      reportWith({ pcrOi: Number.NaN, walls: undefined as unknown as NiftyReport["walls"] }),
    );
    expect(missing.pcrVerdict).toBe("PCR-OI n/a — chain incomplete");

    expect(buildOvernightLevels(reportWith({ pcrOi: 0.5 })).pcrVerdict).toBe(
      "Bearish (PCR-OI 0.50 — call writers in control)",
    );
    expect(buildOvernightLevels(reportWith({ pcrOi: 1.2 })).pcrVerdict).toBe(
      "Bullish (PCR-OI 1.20 — put writers in control)",
    );
  });

  test("max pain above and below spot sets the pull direction", () => {
    expect(buildOvernightLevels(reportWith({ maxPain: 25100 })).painPull.dir).toBe("up");
    expect(buildOvernightLevels(reportWith({ maxPain: 24900 })).painPull.dir).toBe("down");
    expect(buildOvernightLevels(reportWith({ spot: 0, maxPain: 25000 })).painPull.pct).toBe(0);
  });
});

describe("gex copy", () => {
  test("regime line for long, short and flat", () => {
    expect(gexRegimeText("long")).toBe("Dealers LONG gamma — moves dampened");
    expect(gexRegimeText("short")).toBe("Dealers SHORT gamma — moves amplified");
    expect(gexRegimeText("flat")).toBe("Flat");
    expect(gexRegimeText("")).toBe("Flat");
  });

  test("signed Cr/pt total", () => {
    expect(formatGexTotal(12.4)).toBe("+12.40 Cr/pt");
    expect(formatGexTotal(0)).toBe("+0.00 Cr/pt");
    expect(formatGexTotal(-3.456)).toBe("-3.46 Cr/pt");
  });

  test("strike plus signed exposure", () => {
    expect(formatGexLevel(25700, 5.2)).toBe("25,700 (+5.20 Cr)");
    expect(formatGexLevel(25700, -5.2)).toBe("25,700 (-5.20 Cr)");
    expect(formatGexLevel(0, 0)).toBe("0 (+0.00 Cr)");
  });
});

describe("oiBurstLogHeight", () => {
  test("grows 20px per alert and caps at 140", () => {
    expect(oiBurstLogHeight(0)).toBe(40);
    expect(oiBurstLogHeight(1)).toBe(60);
    expect(oiBurstLogHeight(2)).toBe(80);
    expect(oiBurstLogHeight(5)).toBe(140);
    expect(oiBurstLogHeight(50)).toBe(140);
  });
});
