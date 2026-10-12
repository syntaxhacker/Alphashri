import { describe, expect, test } from "vitest";

import { normalizeReport } from "./reportNifty";

const snakeReport = {
  mode: "live",
  date: "",
  expiry: "2026-10-13",
  spot: 22363.35,
  fetched_at: "2026-10-12T15:30:00+05:30",
  pcr_oi: 0.6,
  pcr_vol: 1.21,
  max_pain: 22400,
  walls: {
    calls: [{ strike: 22600, oi: 100 }],
    puts: [{ strike: 22000, oi: 200 }],
  },
  strikes: [
    {
      strike: 22350,
      ce: {
        ltp: 69.6,
        close_price: 249.9,
        oi: 1000,
        prev_oi: 500,
        oi_change: 500,
        volume: 10,
        price_change: -180.3,
        sentiment: { type: "Short Buildup", color: "red", label: "SB" },
      },
      pe: {
        ltp: 80.8,
        close_price: 37.5,
        oi: 800,
        prev_oi: 600,
        oi_change: 200,
        volume: 12,
        price_change: 43.3,
        sentiment: { type: "Long Buildup", color: "green", label: "LB" },
      },
    },
  ],
  timeline: [
    { time: "2026-10-12T15:30:00+05:30", event: "snapshot", detail: "x" },
  ],
};

describe("normalizeReport (snake_case backend -> camelCase panel)", () => {
  test("maps PCR, max pain, fetched_at", () => {
    const rep = normalizeReport(snakeReport);
    expect(rep.pcrOi).toBe(0.6);
    expect(rep.pcrVol).toBe(1.21);
    expect(rep.maxPain).toBe(22400);
    expect(rep.fetchedAt).toBe("2026-10-12T15:30:00+05:30");
  });

  test("maps legs and sentiment label", () => {
    const rep = normalizeReport(snakeReport);
    expect(rep.strikes[0].ce.close).toBe(249.9);
    expect(rep.strikes[0].ce.prevOi).toBe(500);
    expect(rep.strikes[0].ce.oiChange).toBe(500);
    expect(rep.strikes[0].ce.priceChange).toBe(-180.3);
    expect(rep.strikes[0].ce.sentiment).toBe("SB");
    expect(rep.strikes[0].pe.sentiment).toBe("LB");
  });

  test("maps timeline event -> title", () => {
    const rep = normalizeReport(snakeReport);
    expect(rep.timeline[0].title).toBe("snapshot");
  });

  test("tolerates missing sections", () => {
    const rep = normalizeReport({ mode: "live" } as never);
    expect(rep.spot).toBe(0);
    expect(rep.strikes).toEqual([]);
    expect(rep.timeline).toEqual([]);
    expect(rep.walls).toEqual({ calls: [], puts: [] });
  });
});
