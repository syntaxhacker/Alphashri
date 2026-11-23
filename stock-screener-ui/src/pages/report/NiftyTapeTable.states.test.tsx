// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi } from "vitest";
import { screen, within } from "@solidjs/testing-library";
import {
  NiftyTapeTable,
  buildTapeHead,
  computeChangedCells,
  computeSpotDeltas,
  computeTapeScale,
  computeTapeSession,
  formatIstClock,
  formatTapeBaseline,
  formatTapeCompact,
  formatTapePct,
  formatTapePrice,
  formatTapeRatio,
  formatTapeSigned,
  formatTapeTime,
  getTapeBaseline,
  tapeDoiLabel,
  tapeHeat,
} from "./NiftyTapeTable";
import { r, tapeRow, tapeWith, T } from "./NiftyTapeTable.fixtures";

vi.mock("@/components/common/states", () => ({ InlineLoader: () => null }));

describe("tape formatters", () => {
  test("compact M/K with sign", () => {
    expect(formatTapeCompact(170160000)).toBe("+170.16M");
    expect(formatTapeCompact(5530000)).toBe("+5.53M");
    expect(formatTapeCompact(-1200000)).toBe("-1.20M");
    expect(formatTapeCompact(850)).toBe("+850");
    expect(formatTapeCompact(-400)).toBe("-400");
    expect(formatTapeCompact(0)).toBe("+0");
  });

  test("null/NaN render as em dash", () => {
    expect(formatTapeCompact(null)).toBe("—");
    expect(formatTapeCompact(undefined)).toBe("—");
    expect(formatTapeCompact(NaN)).toBe("—");
    expect(formatTapeSigned(null)).toBe("—");
    expect(formatTapePrice(undefined)).toBe("—");
    expect(formatTapePct(NaN)).toBe("—");
    expect(formatTapeRatio(null)).toBe("—");
  });

  test("price, signed, pct, ratio shapes", () => {
    expect(formatTapePrice(25750.5)).toBe("25,750.5");
    expect(formatTapeSigned(12)).toBe("+12");
    expect(formatTapeSigned(-8)).toBe("-8");
    expect(formatTapePct(2.35)).toBe("+2.35%");
    expect(formatTapePct(-1.2)).toBe("-1.20%");
    expect(formatTapeRatio(1.12)).toBe("1.12");
  });

  test("time strips ISO dates, passes HH:MM through", () => {
    expect(formatTapeTime("2026-10-12T09:15:00+05:30")).toBe("09:15:00");
    expect(formatTapeTime("09:15")).toBe("09:15");
  });
});

describe("buildTapeHead math", () => {
  test("derives PCR OI, ΔOI since open, max pain, flip delta, walls from last row", () => {
    const rows = [
      tapeRow({ t: "09:15", pcr_doi: 0.05 }),
      tapeRow({ t: "09:16", pcr_oi: 1.15, pcr_doi: 0.08 }),
    ];
    const head = buildTapeHead(rows);
    expect(head.pcrOi).toBe(1.15);
    expect(head.pcrDoiDelta).toBeCloseTo(0.03, 10);
    expect(head.maxPain).toBe(25700);
    expect(head.flipDeltaPts).toBeCloseTo(-11.5, 10);
    expect(head.wallCall).toBe(25900);
    expect(head.wallPut).toBe(25600);
  });

  test("falls back to session summary when the last row carries zeros", () => {
    const rows = [tapeRow({ t: "09:15", pcr_oi: 0, max_pain: 0, flip: 0, walls: { call: 0, put: 0 } })];
    const head = buildTapeHead(rows, {
      date: "2026-10-12",
      interval_sec: 60,
      rows,
      pcr_oi: 0.62,
      max_pain: 22400,
      flip: 22350,
      walls: { call: 22500, put: 22200 },
    });
    expect(head.pcrOi).toBe(0.62);
    expect(head.maxPain).toBe(22400);
    expect(head.flip).toBe(22350);
    expect(head.wallCall).toBe(22500);
    expect(head.wallPut).toBe(22200);
  });

  test("zero flip yields zero delta instead of a bogus -spot", () => {
    const head = buildTapeHead([tapeRow({ t: "09:15", flip: 0 })]);
    expect(head.flipDeltaPts).toBe(0);
  });
});

describe("magnitude heat scale", () => {
  test("computeTapeScale takes the per-column max |value|", () => {
    const s = computeTapeScale([
      tapeRow({
        call_doi: 100,
        put_doi: -500,
        net: 20,
        net_pct: -3,
        call_tick: 7,
        put_tick: -9,
        pcr_doi: 0.5,
        spot_flip: -12,
      }),
      tapeRow({
        call_doi: -250,
        put_doi: 300,
        net: -80,
        net_pct: 1,
        call_tick: -11,
        put_tick: 4,
        pcr_doi: -0.9,
        spot_flip: null,
      }),
    ]);
    expect(s.call_doi).toBe(250);
    expect(s.put_doi).toBe(500);
    expect(s.net).toBe(80);
    expect(s.net_pct).toBe(3);
    expect(s.call_tick).toBe(11);
    expect(s.put_tick).toBe(9);
    expect(s.pcr_doi).toBe(0.9);
    expect(s.spot_flip).toBe(12);
  });

  test("empty rows yield a zero scale (no tint anywhere)", () => {
    const s = computeTapeScale([]);
    expect(Object.values(s).every((v) => v === 0)).toBe(true);
  });

  test("tapeHeat alpha grows with magnitude; zero/max<=0 → undefined", () => {
    expect(tapeHeat(0, 100, "#1F7FFF")).toBeUndefined();
    expect(tapeHeat(5, 0, "#1F7FFF")).toBeUndefined();
    const alpha = (s: string | undefined) =>
      s ? Number(s.match(/,\s*([0-9.]+)\)/)?.[1] ?? 0) : 0;
    const lo = alpha(tapeHeat(10, 100, "#1F7FFF", 0, 1));
    const hi = alpha(tapeHeat(100, 100, "#1F7FFF", 0, 1));
    expect(lo).toBeCloseTo(0.1, 5);
    expect(hi).toBeCloseTo(1, 5);
    expect(hi).toBeGreaterThan(lo);
  });
});

describe("spot deltas + session roll-up", () => {
  test("computeSpotDeltas keys each minute to its change vs the previous", () => {
    const rows = [
      tapeRow({ t: "09:15", spot: 22500 }),
      tapeRow({ t: "09:16", spot: 22510 }),
      tapeRow({ t: "09:17", spot: 22495 }),
    ];
    const d = computeSpotDeltas(rows);
    expect(d.has("09:15")).toBe(false);
    expect(d.get("09:16")).toBeCloseTo(10, 5);
    expect(d.get("09:17")).toBeCloseTo(-15, 5);
  });

  test("computeTapeSession reports spot range, biggest prints and the last net", () => {
    const s = computeTapeSession([
      tapeRow({ spot: 22500, call_doi: 100, put_doi: -500, net: 20 }),
      tapeRow({ spot: 22600, call_doi: -250, put_doi: 300, net: -80 }),
    ]);
    expect(s.spotLo).toBe(22500);
    expect(s.spotHi).toBe(22600);
    expect(s.maxCallDoi).toBe(250);
    expect(s.maxPutDoi).toBe(500);
    expect(s.netLast).toBeCloseTo(-80, 5);
  });

  test("computeTapeSession on empty rows is all zeros", () => {
    const s = computeTapeSession([]);
    expect(s).toEqual({ spotHi: 0, spotLo: 0, maxCallDoi: 0, maxPutDoi: 0, netLast: 0 });
  });
});

describe("live change detection", () => {
  test("computeChangedCells reports only fields that actually moved", () => {
    const prev = new Map([
      ["09:15", tapeRow({ t: "09:15", call_doi: 100, net: 5, spot: 100 })],
      ["09:16", tapeRow({ t: "09:16", call_doi: 200, net: 6, spot: 101 })],
    ]);
    const rows = [
      tapeRow({ t: "09:15", call_doi: 100, net: 5, spot: 100 }),
      tapeRow({ t: "09:16", call_doi: 250, net: 6, spot: 103 }),
      tapeRow({ t: "09:17", call_doi: 999, net: 9, spot: 104 }),
    ];
    const out = computeChangedCells(prev, rows);
    expect(out.has("09:15")).toBe(false);
    expect([...(out.get("09:16") ?? [])].sort()).toEqual(["call_doi", "spot"]);
    expect(out.has("09:17")).toBe(false);
  });

  test("computeChangedCells on an empty previous snapshot reports nothing", () => {
    expect(computeChangedCells(new Map(), [tapeRow({ t: "09:15" })]).size).toBe(0);
  });
});

describe("NiftyTapeTable null states", () => {
  test("null spot_flip renders em dash", () => {
    r(() => <NiftyTapeTable rows={[tapeRow({ t: "09:15", spot_flip: null })]} />);
    const table = screen.getByTestId("nifty-tape-table");
    expect(within(table).getByText("—")).toBeInTheDocument();
  });
});

describe("tape baseline label", () => {
  test("formatTapeBaseline trims ISO to HH:MM, passes bare labels through", () => {
    expect(formatTapeBaseline("2026-10-13T12:04:00+05:30")).toBe("12:04");
    expect(formatTapeBaseline("09:15")).toBe("09:15");
    expect(formatTapeBaseline(null)).toBe("");
    expect(formatTapeBaseline(undefined)).toBe("");
    expect(formatTapeBaseline("")).toBe("");
  });

  test("explicit baseline_t wins even when rows start earlier", () => {
    const rows = [tapeRow({ t: "09:15" }), tapeRow({ t: "09:16" })];
    const tape = tapeWith("2026-10-13T12:04:00+05:30", rows);
    expect(getTapeBaseline(tape, rows)).toBe("12:04");
    expect(tapeDoiLabel(tape, rows)).toBe("PCR ΔOI since 12:04");
  });

  test("falls back to the earliest row when baseline_t is absent", () => {
    const rows = [tapeRow({ t: "09:16" }), tapeRow({ t: "09:15" })];
    expect(getTapeBaseline(undefined, rows)).toBe("09:15");
    expect(getTapeBaseline(tapeWith(undefined, rows), rows)).toBe("09:15");
    expect(tapeDoiLabel(undefined, rows)).toBe("PCR ΔOI since 09:15");
  });

  test("no rows and no tape keeps the legacy since-open label", () => {
    expect(getTapeBaseline()).toBeNull();
    expect(getTapeBaseline(undefined, [])).toBeNull();
    expect(tapeDoiLabel()).toBe("PCR ΔOI since open");
  });
});

describe("last / next update stamps", () => {
  test("formatIstClock renders IST HH:MM:SS host-TZ independently", () => {
    expect(formatIstClock(T)).toBe("12:03:15");
    expect(formatIstClock(Date.parse("2026-10-14T06:33:15Z"))).toBe("12:03:15");
    expect(formatIstClock(NaN)).toBe("—");
  });
});
