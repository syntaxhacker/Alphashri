// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vitest";

import {
  fetchNiftyBursts,
  fetchNiftyTape,
  normalizeBurst,
  normalizeReport,
  normalizeTapeRow,
} from "./reportNifty";
import { fetchWithAuth } from "../state/auth";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

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

  test("gex absent stays undefined so old snapshots still render", () => {
    const rep = normalizeReport(snakeReport);
    expect(rep.gex).toBeUndefined();
  });

  test("maps snake_case gex block to camelCase", () => {
    const rep = normalizeReport({
      ...snakeReport,
      gex: {
        strikes: [
          { strike: 25700, call_gex: -3.1, put_gex: 8.3, net_gex: 5.2 },
        ],
        net_total: 12.4,
        regime: "long",
        top_positive: [{ strike: 25700, net_gex: 5.2 }],
        top_negative: [{ strike: 25800, net_gex: -5.3 }],
        zero_cross: 25750,
      },
    });
    expect(rep.gex).toBeDefined();
    expect(rep.gex!.netTotal).toBe(12.4);
    expect(rep.gex!.regime).toBe("long");
    expect(rep.gex!.zeroCross).toBe(25750);
    expect(rep.gex!.strikes[0]).toEqual({
      strike: 25700,
      callGex: -3.1,
      putGex: 8.3,
      netGex: 5.2,
    });
    expect(rep.gex!.topPositive).toEqual([{ strike: 25700, netGex: 5.2 }]);
    expect(rep.gex!.topNegative).toEqual([{ strike: 25800, netGex: -5.3 }]);
  });

  test("gex null flip maps to null with safe defaults", () => {
    const rep = normalizeReport({
      ...snakeReport,
      gex: { net_total: -4.5, regime: "SHORT", zero_cross: null },
    });
    expect(rep.gex!.regime).toBe("short");
    expect(rep.gex!.zeroCross).toBeNull();
    expect(rep.gex!.strikes).toEqual([]);
    expect(rep.gex!.topPositive).toEqual([]);
  });
});

describe("normalizeTapeRow (sparse payloads -> safe defaults)", () => {
  test("maps full camelCase row", () => {
    const row = normalizeTapeRow({
      t: "09:16",
      spot: 25760,
      call_doi: 1000000,
      put_doi: 500000,
      net: 500000,
      net_pct: 0.5,
      call_tick: 100,
      put_tick: 50,
      pcr_vol: 0.96,
      pcr_oi: 1.15,
      pcr_doi: 0.08,
      spot_flip: -8,
      max_pain: 25700,
      flip: 25762,
      walls: { call: 25900, put: 25600 },
    });
    expect(row.t).toBe("09:16");
    expect(row.spot).toBe(25760);
    expect(row.call_doi).toBe(1000000);
    expect(row.spot_flip).toBe(-8);
    expect(row.walls).toEqual({ call: 25900, put: 25600 });
  });

  test("accepts time/ticks aliases, defaults numbers to 0, spot_flip null-safe", () => {
    const row = normalizeTapeRow({ time: "09:19", ticks: 42 } as never);
    expect(row.t).toBe("09:19");
    expect(row.call_tick).toBe(42);
    expect(row.put_tick).toBe(42);
    expect(row.spot).toBe(0);
    expect(row.net).toBe(0);
    expect(row.spot_flip).toBeNull();
    expect(row.walls).toEqual({ call: 0, put: 0 });
  });

  test("tolerates empty input", () => {
    const row = normalizeTapeRow({});
    expect(row.t).toBe("");
    expect(row.spot_flip).toBeNull();
    expect(row.max_pain).toBe(0);
  });
});

describe("fetchNiftyTape (top-level summary + sparse rows)", () => {
  test("parses summary scalars and array walls, rows stay null-safe", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        pcr_oi: 0.62,
        max_pain: 22400,
        flip: 22350,
        walls: {
          calls: [
            { strike: 22500, oi: 5000 },
            { strike: 22400, oi: 4000 },
          ],
          puts: [
            { strike: 22200, oi: 6000 },
            { strike: 22300, oi: 4500 },
          ],
        },
        rows: [
          { time: "09:19", call_doi: 12000, put_doi: 18500, net: 6500, net_pct: 1.8, ticks: 42, pcr_oi: 0.62 },
        ],
      }),
    } as unknown as Response);
    const tape = await fetchNiftyTape();
    expect(tape.interval_sec).toBe(60);
    expect(tape.pcr_oi).toBe(0.62);
    expect(tape.max_pain).toBe(22400);
    expect(tape.flip).toBe(22350);
    expect(tape.walls).toEqual({ call: 22500, put: 22200 });
    expect(tape.rows).toHaveLength(1);
    expect(tape.rows[0].t).toBe("09:19");
    expect(tape.rows[0].call_tick).toBe(42);
    expect(tape.rows[0].spot).toBe(0);
    expect(tape.rows[0].spot_flip).toBeNull();
    expect(vi.mocked(fetchWithAuth)).toHaveBeenCalledWith(
      expect.stringContaining("/api/reports/nifty/tape"),
      { signal: undefined },
    );
  });

  test("date param is encoded into the query string", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ date: "2026-10-10", rows: [] }),
    } as unknown as Response);
    const tape = await fetchNiftyTape("2026-10-10");
    expect(tape.date).toBe("2026-10-10");
    expect(tape.rows).toEqual([]);
    expect(vi.mocked(fetchWithAuth)).toHaveBeenCalledWith(
      expect.stringContaining("date=2026-10-10"),
      { signal: undefined },
    );
  });

  test("baseline_t passes through so the header can label ΔOI honestly", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        date: "2026-10-13",
        baseline_t: "2026-10-13T12:04:00+05:30",
        rows: [{ t: "2026-10-13T12:04:00+05:30" }],
      }),
    } as unknown as Response);
    const tape = await fetchNiftyTape();
    expect(tape.baseline_t).toBe("2026-10-13T12:04:00+05:30");
    expect(tape.rows[0].t).toBe("2026-10-13T12:04:00+05:30");
  });

  test("missing baseline_t stays undefined (old payloads fall back to first row)", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ date: "2026-10-13", rows: [] }),
    } as unknown as Response);
    const tape = await fetchNiftyTape();
    expect(tape.baseline_t).toBeUndefined();
  });

  test("non-ok response throws with backend detail", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ detail: "Tape unavailable" }),
    } as unknown as Response);
    await expect(fetchNiftyTape()).rejects.toThrow("Tape unavailable");
  });
});

describe("normalizeTapeRow walls", () => {
  test("reduces strike arrays to top-OI strikes", async () => {
    const { normalizeTapeRow } = await import("./reportNifty");
    const row = normalizeTapeRow({
      t: "10:00",
      walls: {
        calls: [
          { strike: 22600, oi: 100 },
          { strike: 22500, oi: 500 },
        ],
        puts: [{ strike: 22400, oi: 300 }],
      },
    });
    expect(row.walls).toEqual({ call: 22500, put: 22400 });
  });

  test("empty arrays give zeros, scalars pass through", async () => {
    const { normalizeTapeRow } = await import("./reportNifty");
    expect(
      normalizeTapeRow({ t: "x", walls: { calls: [], puts: [] } }).walls,
    ).toEqual({ call: 0, put: 0 });
    expect(
      normalizeTapeRow({ t: "x", walls: { call: 22600, put: 22400 } }).walls,
    ).toEqual({ call: 22600, put: 22400 });
  });
});

describe("normalizeBurst (snake_case backend -> camelCase panel)", () => {
  test("maps attached news, tolerating snake_case and dropping bad rows", () => {
    const burst = normalizeBurst({
      id: "b1",
      side: "call",
      t: "2026-10-13T14:20:00+05:30",
      news: [
        { heading: "FM Sitharaman open to LTCG tax rethink", link: "u1", source: "upstox", minutesAway: -1 },
        { headline: "snake variant", url: "u2", minutes_away: 5 },
        { source: "no heading here" },
        "junk",
      ],
    });
    expect(burst.news).toHaveLength(2);
    expect(burst.news?.[0].heading).toBe("FM Sitharaman open to LTCG tax rethink");
    expect(burst.news?.[0].minutesAway).toBe(-1);
    expect(burst.news?.[1].heading).toBe("snake variant");
    expect(burst.news?.[1].link).toBe("u2");
    expect(burst.news?.[1].minutesAway).toBe(5);
  });

  test("missing or malformed news yields an empty list, never null", () => {
    expect(normalizeBurst({ side: "call" }).news).toEqual([]);
    expect(normalizeBurst({ side: "call", news: "nope" }).news).toEqual([]);
    expect(normalizeBurst({ side: "call", news: [null, 1] }).news).toEqual([]);
  });

  test("maps full camelCase burst with nested signal", () => {
    const burst = normalizeBurst({
      id: "b1",
      side: "call",
      t: "10:04",
      delta: 120000,
      baseline: 4000,
      score: 3.2,
      severity: "alert",
      cumDoi: 900000,
      spot: 25760,
      tickVol: 88,
      signal: {
        leg: "CE",
        strike: 25800,
        entry: 120.5,
        sl: 100,
        target: 160,
        qty: 75,
        lots: 1,
        basis: "3x delta spike",
      },
    });
    expect(burst.id).toBe("b1");
    expect(burst.side).toBe("call");
    expect(burst.t).toBe("10:04");
    expect(burst.delta).toBe(120000);
    expect(burst.baseline).toBe(4000);
    expect(burst.score).toBe(3.2);
    expect(burst.severity).toBe("alert");
    expect(burst.cumDoi).toBe(900000);
    expect(burst.tickVol).toBe(88);
    expect(burst.signal).toEqual({
      leg: "CE",
      strike: 25800,
      entry: 120.5,
      sl: 100,
      target: 160,
      qty: 75,
      lots: 1,
      basis: "3x delta spike",
    });
  });

  test("maps snake_case burst and prefixed signal fields", () => {
    const burst = normalizeBurst({
      side: "put",
      time: "10:07",
      cum_doi: 500000,
      tick_vol: 64,
      severity: "critical",
      delta: "90000",
      signal: {
        signal_leg: "PE",
        signal_strike: 25600,
        signal_entry: 95,
        signal_sl: 80,
        signal_target: 130,
        signal_qty: 75,
        signal_lots: 1,
        signal_basis: "oi unwind",
      },
    });
    expect(burst.side).toBe("put");
    expect(burst.t).toBe("10:07");
    expect(burst.cumDoi).toBe(500000);
    expect(burst.tickVol).toBe(64);
    expect(burst.delta).toBe(90000);
    expect(burst.signal).toEqual({
      leg: "PE",
      strike: 25600,
      entry: 95,
      sl: 80,
      target: 130,
      qty: 75,
      lots: 1,
      basis: "oi unwind",
    });
  });

  test("coerces unknown side to call and unknown severity to watch", () => {
    const burst = normalizeBurst({ side: "sideways", severity: "meh" });
    expect(burst.side).toBe("call");
    expect(burst.severity).toBe("watch");
    expect(burst.id).toBe("");
    expect(burst.t).toBe("");
    expect(burst.delta).toBe(0);
    expect(burst.signal).toBeNull();
  });

  test("signal is null when the block is missing", () => {
    expect(normalizeBurst({ side: "call" }).signal).toBeNull();
    expect(normalizeBurst({ signal: null } as never).signal).toBeNull();
  });

  test("signal is null when incomplete (strike present, entry absent)", () => {
    const burst = normalizeBurst({
      signal: { leg: "CE", strike: 25800 },
    });
    expect(burst.signal).toBeNull();
  });

  test("signal is null when strike is absent", () => {
    const burst = normalizeBurst({
      signal: { leg: "PE", entry: 95 },
    });
    expect(burst.signal).toBeNull();
  });
});

describe("fetchNiftyBursts (additive feed, never throws)", () => {
  test("returns the parsed list on 200", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        bursts: [
          {
            id: "b1",
            side: "call",
            t: "10:04",
            severity: "alert",
            cum_doi: 900000,
            tick_vol: 88,
            signal: { leg: "CE", strike: 25800, entry: 120.5 },
          },
        ],
      }),
    } as unknown as Response);
    const bursts = await fetchNiftyBursts();
    expect(bursts).toHaveLength(1);
    expect(bursts[0].id).toBe("b1");
    expect(bursts[0].side).toBe("call");
    expect(bursts[0].severity).toBe("alert");
    expect(bursts[0].cumDoi).toBe(900000);
    expect(bursts[0].tickVol).toBe(88);
    expect(bursts[0].signal!.strike).toBe(25800);
    expect(vi.mocked(fetchWithAuth)).toHaveBeenCalledWith(
      expect.stringContaining("/api/reports/nifty/bursts"),
      { signal: undefined },
    );
  });

  test("returns [] on 500", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ detail: "boom" }),
    } as unknown as Response);
    await expect(fetchNiftyBursts()).resolves.toEqual([]);
  });

  test("returns [] on malformed JSON", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as Response);
    await expect(fetchNiftyBursts()).resolves.toEqual([]);
  });

  test("returns [] when the response body has no bursts array", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ nope: true }),
    } as unknown as Response);
    await expect(fetchNiftyBursts()).resolves.toEqual([]);
  });

  test("appends ?date= when a date is passed", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ bursts: [] }),
    } as unknown as Response);
    await fetchNiftyBursts("2026-10-10");
    expect(vi.mocked(fetchWithAuth)).toHaveBeenCalledWith(
      expect.stringContaining("date=2026-10-10"),
      { signal: undefined },
    );
  });

  test("returns [] on network/abort failure", async () => {
    vi.mocked(fetchWithAuth).mockRejectedValueOnce(new Error("aborted"));
    await expect(fetchNiftyBursts()).resolves.toEqual([]);
  });
});
