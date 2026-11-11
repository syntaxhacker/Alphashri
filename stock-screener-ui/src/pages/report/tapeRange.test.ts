import { describe, expect, test } from "vitest";
import {
  ascTapeByTime,
  hhmmToMinutes,
  minutesToHhmm,
  rangeLabel,
  resampleTape,
  tapeMinute,
} from "./tapeRange";

function rows(minutes: string[]) {
  return minutes.map((t) => ({ t: `2026-10-23T${t}:00+05:30`, spot: Number(t.slice(3)) }));
}

describe("tapeMinute", () => {
  test("parses ISO and bare clock strings", () => {
    expect(tapeMinute("2026-10-23T13:33:00+05:30")).toBe(13 * 60 + 33);
    expect(tapeMinute("13:33")).toBe(13 * 60 + 33);
    expect(tapeMinute("")).toBeNull();
    expect(tapeMinute("nope")).toBeNull();
  });

  test("ISO mode also peels space-separated stamps", () => {
    expect(tapeMinute("2026-10-23 13:33")).toBe(13 * 60 + 33);
    expect(tapeMinute("2026-10-23T13:33:22+05:30")).toBe(13 * 60 + 33);
  });
});

describe("hhmmToMinutes", () => {
  test("bare HH:MM and HH:MM:SS parse, seconds are ignored", () => {
    expect(hhmmToMinutes("09:15")).toBe(9 * 60 + 15);
    expect(hhmmToMinutes("13:33:22")).toBe(13 * 60 + 33);
    expect(hhmmToMinutes("13:33:00+05:30")).toBe(13 * 60 + 33);
  });

  test("hours may be 1–2 digits, minutes exactly 2", () => {
    expect(hhmmToMinutes("9:33")).toBe(9 * 60 + 33);
    expect(hhmmToMinutes("09:05")).toBe(9 * 60 + 5);
    expect(hhmmToMinutes("9:5")).toBeNull();
    expect(hhmmToMinutes("933")).toBeNull();
  });

  test("iso mode peels the date at T, or at a space when there is no T", () => {
    expect(hhmmToMinutes("2026-10-23T13:33:00+05:30", { iso: true })).toBe(13 * 60 + 33);
    expect(hhmmToMinutes("2026-10-23 13:33:00", { iso: true })).toBe(13 * 60 + 33);
    // Bare clocks still parse with iso on (the shared parser's superset).
    expect(hhmmToMinutes("13:33", { iso: true })).toBe(13 * 60 + 33);
  });

  test("without iso a full stamp is not a bare clock", () => {
    expect(hhmmToMinutes("2026-10-23T13:33")).toBeNull();
    expect(hhmmToMinutes("2026-10-23 13:33")).toBeNull();
  });

  test("24:00 is rejected — no existing caller relies on it", () => {
    expect(hhmmToMinutes("24:00")).toBeNull();
    expect(hhmmToMinutes("25:00")).toBeNull();
  });

  test("junk and out-of-range minutes are rejected", () => {
    expect(hhmmToMinutes("")).toBeNull();
    expect(hhmmToMinutes("nope")).toBeNull();
    expect(hhmmToMinutes("10:99")).toBeNull();
    expect(hhmmToMinutes("10:", { iso: true })).toBeNull();
  });
});

describe("minutesToHhmm", () => {
  test("zero-pads both fields", () => {
    expect(minutesToHhmm(0)).toBe("00:00");
    expect(minutesToHhmm(555)).toBe("09:15");
    expect(minutesToHhmm(929)).toBe("15:29");
    expect(minutesToHhmm(1439)).toBe("23:59");
  });

  test("does not wrap by default (the copy this replaces never did)", () => {
    expect(minutesToHhmm(1440)).toBe("24:00");
    expect(minutesToHhmm(1441)).toBe("24:01");
  });

  test("wrap folds the day modulo 1440", () => {
    expect(minutesToHhmm(1440, { wrap: true })).toBe("00:00");
    expect(minutesToHhmm(1441, { wrap: true })).toBe("00:01");
    expect(minutesToHhmm(1500, { wrap: true })).toBe("01:00");
    expect(minutesToHhmm(2879, { wrap: true })).toBe("23:59");
  });
});

describe("ascTapeByTime", () => {
  const row = (t: string, spot = 0) => ({ t, spot });

  test("sorts ascending and returns a fresh array", () => {
    const input = [row("13:31"), row("13:30"), row("13:33")];
    const out = ascTapeByTime(input);
    expect(out.map((r) => r.t)).toEqual(["13:30", "13:31", "13:33"]);
    expect(out).not.toBe(input);
    expect(input.map((r) => r.t)).toEqual(["13:31", "13:30", "13:33"]);
  });

  test("drops rows without a usable t (null entries, empty or non-string t)", () => {
    const messy = [
      null,
      undefined,
      row("13:31"),
      { t: "", spot: 1 },
      { spot: 2 },
      row("13:30"),
    ] as unknown as Array<{ t: string; spot: number }>;
    expect(ascTapeByTime(messy).map((r) => r.t)).toEqual(["13:30", "13:31"]);
  });

  test("equal timestamps keep their input order (stable sort)", () => {
    const input = [row("10:00", 2), row("09:00", 1), row("10:00", 3)];
    expect(ascTapeByTime(input).map((r) => r.spot)).toEqual([1, 2, 3]);
  });

  test("null and undefined input yield an empty array", () => {
    expect(ascTapeByTime(null)).toEqual([]);
    expect(ascTapeByTime(undefined)).toEqual([]);
    expect(ascTapeByTime([])).toEqual([]);
  });
});

describe("resampleTape", () => {
  test("1m is the identity", () => {
    const input = rows(["13:30", "13:31", "13:32"]);
    expect(resampleTape(input, 1)).toBe(input);
  });

  test("5m keeps the last row of each bucket (the bucket close)", () => {
    const input = rows(["13:30", "13:31", "13:32", "13:35", "13:36", "13:40"]);
    const out = resampleTape(input, 5);
    expect(out.map((r) => r.t.slice(11, 16))).toEqual(["13:32", "13:36", "13:40"]);
  });

  test("15m groups three 5m closes", () => {
    const input = rows(["13:15", "13:29", "13:30", "13:44", "13:45", "13:59"]);
    const out = resampleTape(input, 15);
    expect(out.map((r) => r.t.slice(11, 16))).toEqual(["13:29", "13:44", "13:59"]);
  });

  test("unparseable rows are dropped, never pinned to bucket 0", () => {
    const input = [...rows(["13:30"]), { t: "bad" }];
    expect(resampleTape(input, 5)).toHaveLength(1);
  });

  test("labels are m-suffixed", () => {
    expect(rangeLabel(5)).toBe("5m");
    expect(rangeLabel(15)).toBe("15m");
  });
});
